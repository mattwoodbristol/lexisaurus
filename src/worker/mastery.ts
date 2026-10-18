// Mastery per lesson (see core/lessons/mastery.ts), from saved progress, check passes, grammar
// quizzes and chat uses.
import { dayIn, mastery, type Mastery } from '../core/lessons/mastery';
import { userTz } from './day';

export async function lessonMastery(db: D1Database, lang: string): Promise<Map<number, Mastery>> {
  const [lessons, progress, passes, quizzes, uses] = await Promise.all([
    db.prepare('SELECT id, completed_at FROM lessons WHERE lang = ?1').bind(lang).all<{ id: number; completed_at: string | null }>(),
    db.prepare('SELECT lesson_id, steps_json FROM lesson_progress').all<{ lesson_id: number; steps_json: string }>(),
    db.prepare('SELECT lesson_id, MIN(created_at) AS at FROM lesson_checks WHERE passed = 1 GROUP BY lesson_id').all<{ lesson_id: number; at: string }>(),
    db
      .prepare('SELECT g.lesson_id, q.score, q.total, q.created_at AS at FROM grammar_quizzes q JOIN grammar_points g ON g.id = q.grammar_point_id WHERE g.lang = ?1')
      .bind(lang)
      .all<{ lesson_id: number; score: number; total: number; at: string }>(),
    db
      .prepare('SELECT g.lesson_id, u.correct, u.prompted, u.created_at AS at FROM chat_uses u JOIN grammar_points g ON g.id = u.grammar_point_id WHERE g.lang = ?1')
      .bind(lang)
      .all<{ lesson_id: number; correct: number; prompted: number; at: string }>(),
  ]);
  const dayOf = dayIn(await userTz(db));
  const started = new Set(progress.results.filter((p) => p.steps_json !== '[]').map((p) => p.lesson_id));
  const passedAt = new Map(passes.results.map((p) => [p.lesson_id, p.at]));
  const out = new Map<number, Mastery>();
  for (const l of lessons.results) {
    out.set(
      l.id,
      mastery({
        started: started.has(l.id),
        // Lessons marked done before checks existed count as practised from that day.
        passedAt: passedAt.get(l.id) ?? l.completed_at,
        quizzes: quizzes.results.filter((q) => q.lesson_id === l.id),
        chatUses: uses.results.filter((u) => u.lesson_id === l.id).map((u) => ({ at: u.at, correct: !!u.correct, prompted: !!u.prompted })),
        dayOf,
      }),
    );
  }
  return out;
}
