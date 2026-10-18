// Generate practice sets (extra drills, recognise questions, lesson check) for lesson files with
// Claude, using the same structured-output call the app uses for lesson generation.
import { readFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { MODELS } from '../../src/core/models';
import { promptsFor } from '../../prompts';
import { getLanguage } from '../../src/core/languages';
import { renderLessonFile, type LessonFile } from '../../src/core/course/lesson-file';
import { validateLesson } from '../../src/core/lessons/types';
import { withPractice, type Practice } from '../../src/core/lessons/practice';
import { numberedTitle } from '../../src/core/course/lesson-file';

const Choice = z.object({ prompt: z.string(), options: z.array(z.string()), answer: z.number().int() });
export const PracticeSchema = z.object({
  extraDrills: z.array(z.object({ en: z.string(), zh: z.string() })),
  recognise: z.array(Choice),
  checkChoice: z.array(Choice),
  checkTranslate: z.array(z.object({ en: z.string(), zh: z.string() })),
  checkFix: z.array(z.object({ wrong: z.string(), right: z.string(), note: z.string() })),
});

/** The key from .dev.vars (local secrets), unless already in the environment. */
function apiKey(): string {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const m = /^ANTHROPIC_API_KEY=(.+)$/m.exec(readFileSync('.dev.vars', 'utf8'));
  if (!m?.[1]?.trim()) throw new Error('No ANTHROPIC_API_KEY in the environment or .dev.vars');
  return m[1].trim();
}

/** Ask Claude for a practice set for one lesson; one retry with the problems if it fails validation. */
export async function generatePractice(f: LessonFile, courseNo: number, lang = 'zh'): Promise<{ file: LessonFile; usage: { input: number; output: number } }> {
  const client = new Anthropic({ apiKey: apiKey(), maxRetries: 2, timeout: 180_000 });
  const md = renderLessonFile(f);
  let problem = '';
  const usage = { input: 0, output: 0 };
  for (let attempt = 0; attempt < 2; attempt++) {
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: `Lesson ${courseNo}:\n\n${md}` }];
    if (problem) messages.push({ role: 'user', content: `Your previous answer was rejected: ${problem}. Produce it again, fixing that.` });
    const res = await client.beta.messages.parse({
      model: MODELS.lessons.id,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: promptsFor(lang).practice, cache_control: { type: 'ephemeral' } }],
      messages,
      output_config: { format: betaZodOutputFormat(PracticeSchema), effort: 'medium' },
    });
    usage.input += res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0);
    usage.output += res.usage.output_tokens;
    if (res.stop_reason === 'refusal') throw new Error('the model declined this request');
    const parsed = res.parsed_output as Practice | null;
    if (!parsed) {
      problem = res.stop_reason === 'max_tokens' ? 'the output was cut off; be more concise' : 'the output did not match the schema';
      continue;
    }
    const file = withPractice(f, parsed);
    const problems = validateLesson({ title: numberedTitle(courseNo, f.title), ...file.content }, getLanguage(lang)?.script ?? 'han');
    if (!problems.length) return { file, usage };
    problem = problems.slice(0, 6).join('; ');
  }
  throw new Error(`practice generation failed after retry: ${problem}`);
}
