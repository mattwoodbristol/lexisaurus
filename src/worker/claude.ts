// Server-side Claude access with a daily token budget enforced in code.
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';
import type { Env } from './env';
import { MODELS, type ModelRole } from '../core/models';

export class BudgetExceededError extends Error {
  constructor(
    public used: number,
    public budget: number,
  ) {
    super(`daily token budget exceeded (${used}/${budget})`);
  }
}

export class NotConfiguredError extends Error {
  constructor() {
    super('ANTHROPIC_API_KEY is not set');
  }
}

export class StructuredOutputError extends Error {}

const today = () => new Date().toISOString().slice(0, 10);

export async function dailyBudget(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'daily_token_budget'").first<{ value: string }>();
  const n = row ? Number(JSON.parse(row.value)) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 200_000;
}

export async function tokensUsedToday(db: D1Database): Promise<number> {
  const row = await db
    .prepare('SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS n FROM usage_log WHERE date = ?1')
    .bind(today())
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function assertBudget(db: D1Database): Promise<{ used: number; budget: number }> {
  const [used, budget] = await Promise.all([tokensUsedToday(db), dailyBudget(db)]);
  if (used >= budget) throw new BudgetExceededError(used, budget);
  return { used, budget };
}

interface UsageLike {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

async function logUsage(db: D1Database, model: string, usage: UsageLike): Promise<void> {
  const input = usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  await db
    .prepare(
      `INSERT INTO usage_log(date, model, input_tokens, output_tokens) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(date, model) DO UPDATE SET
         input_tokens = input_tokens + excluded.input_tokens,
         output_tokens = output_tokens + excluded.output_tokens`,
    )
    .bind(today(), model, input, usage.output_tokens)
    .run();
}

function client(env: Env): Anthropic {
  if (!env.ANTHROPIC_API_KEY) throw new NotConfiguredError();
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 120_000 });
}

function systemBlocks(system: string[]): Anthropic.TextBlockParam[] {
  return system.map((text, i) => (i === 0 ? { type: 'text', text, cache_control: { type: 'ephemeral' } } : { type: 'text', text }));
}

export interface ClaudeCall {
  role: ModelRole;
  /** Stable text first (cached), then per-session text. */
  system: string[];
  messages: Anthropic.MessageParam[];
  maxTokens: number;
}

export interface ClaudeResult {
  text: string;
  model: string;
  stopReason: string | null;
}

export async function callClaude(env: Env, call: ClaudeCall): Promise<ClaudeResult> {
  const c = client(env);
  await assertBudget(env.DB);
  const model = MODELS[call.role].id;
  const res = await c.messages.create({ model, max_tokens: call.maxTokens, system: systemBlocks(call.system), messages: call.messages });
  await logUsage(env.DB, model, res.usage);
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  return { text, model, stopReason: res.stop_reason };
}

/**
 * Structured JSON output validated against a zod schema, with one retry on a parse or
 * validation failure (SPEC 9). `extraCheck` adds domain validation (e.g. no pinyin in Hanzi).
 */
export async function callStructured<S extends z.ZodType>(
  env: Env,
  call: ClaudeCall & { schema: S; extraCheck?: (v: z.infer<S>) => string[]; effort?: 'low' | 'medium' | 'high' },
): Promise<z.infer<S>> {
  const c = client(env);
  const model = MODELS[call.role].id;
  let lastProblem = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    await assertBudget(env.DB);
    const messages: Anthropic.MessageParam[] =
      attempt === 0
        ? call.messages
        : [...call.messages, { role: 'user', content: `Your previous answer was rejected: ${lastProblem}. Produce it again, fixing that.` }];
    let parsed: z.infer<S> | null;
    let stop: string | null;
    if (model.startsWith('claude-sonnet-5-5')) {
      // Sonnet 5.5: refusal fallbacks on by default (server-side routing; Claude API only).
      const res = await c.beta.messages.parse({
        model,
        max_tokens: call.maxTokens,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: systemBlocks(call.system),
        messages,
        output_config: { format: betaZodOutputFormat(call.schema), ...(call.effort ? { effort: call.effort } : {}) },
      });
      await logUsage(env.DB, res.model ?? model, res.usage);
      parsed = res.parsed_output as z.infer<S> | null;
      stop = res.stop_reason;
    } else {
      const res = await c.messages.parse({
        model,
        max_tokens: call.maxTokens,
        system: systemBlocks(call.system),
        messages,
        output_config: { format: zodOutputFormat(call.schema) },
      });
      await logUsage(env.DB, model, res.usage);
      parsed = res.parsed_output as z.infer<S> | null;
      stop = res.stop_reason;
    }
    if (stop === 'refusal') throw new StructuredOutputError('the model declined this request');
    if (stop === 'max_tokens') lastProblem = 'the output was cut off at the length limit; be more concise';
    else if (!parsed) lastProblem = 'the output did not match the JSON schema';
    else {
      const problems = call.extraCheck?.(parsed) ?? [];
      if (problems.length === 0) return parsed;
      lastProblem = problems.slice(0, 5).join('; ');
    }
  }
  throw new StructuredOutputError(`structured output failed after retry: ${lastProblem}`);
}

export function claudeErrorResponse(e: unknown): { status: 429 | 503 | 502; body: { error: string; detail?: string } } {
  if (e instanceof BudgetExceededError) return { status: 429, body: { error: 'budget', detail: e.message } };
  if (e instanceof NotConfiguredError) return { status: 503, body: { error: 'not_configured', detail: e.message } };
  console.error(e);
  return { status: 502, body: { error: 'claude_failed', detail: e instanceof Error ? e.message : String(e) } };
}
