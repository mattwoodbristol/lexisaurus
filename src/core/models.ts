// Claude model IDs and list prices (USD per 1M tokens), verified 2026-10-04
// against the Anthropic docs. Change here, nowhere else.
export const MODELS = {
  // Chat turns and exercise-sentence batches: cheap and fast.
  chat: { id: 'claude-haiku-4-5', inputPerM: 1.0, outputPerM: 5.0 },
  exercises: { id: 'claude-haiku-4-5', inputPerM: 1.0, outputPerM: 5.0 },
  // Lesson generation: higher quality, lower volume.
  lessons: { id: 'claude-sonnet-5-5', inputPerM: 2.0, outputPerM: 10.0 },
  // Listening passages: keeping a text inside the learner's level needs the stronger model; one call per passage.
  listening: { id: 'claude-sonnet-5-5', inputPerM: 2.0, outputPerM: 10.0 },
  // Checking the learner's chat messages for mistakes: accuracy matters (they feed the mistakes list).
  checking: { id: 'claude-sonnet-5-5', inputPerM: 2.0, outputPerM: 10.0 },
} as const;

export type ModelRole = keyof typeof MODELS;

export function estimateCostUsd(role: ModelRole, inputTokens: number, outputTokens: number): number {
  const m = MODELS[role];
  return (inputTokens * m.inputPerM + outputTokens * m.outputPerM) / 1_000_000;
}
