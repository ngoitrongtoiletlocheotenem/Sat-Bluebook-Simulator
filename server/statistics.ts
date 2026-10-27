import type { Knex } from 'knex';
import type { Result } from '../shared/types.js';
import { json } from './db.js';
export async function statistics(db: Knex) {
  const users = await db('users').where({ role: 'student' }).select('id', 'name', 'email');
  const attempts: any[] = await db('attempts')
    .groupBy('user_id')
    .select('user_id')
    .count({ total: 'id' })
    .sum({ full: db.raw('CASE WHEN mode = ? THEN 1 ELSE 0 END', ['full']) })
    .max({ last_activity: 'started_at' });
  const attemptsByUser = new Map(attempts.map((row) => [row.user_id, row]));
  // Keyset batches bound raw report materialization while preserving complete
  // historical totals. The initial upper bound keeps concurrent inserts from
  // extending this scan indefinitely; this endpoint is not a snapshot export.
  const upper = (await db('score_results').max({ id: 'attempt_id' }).first())?.id;
  const reportsByUser = new Map<
    string,
    {
      completed: number;
      total: number;
      correct: number;
      latestScore: number | null;
      scoredAt: string;
      scoredAttemptId: string;
    }
  >();
  let completedCount = 0,
    total = 0,
    correct = 0,
    cursor: string | undefined;
  while (upper) {
    const query = db('score_results')
      .select('attempt_id', 'user_id', 'created_at', 'report')
      .where('attempt_id', '<=', upper)
      .orderBy('attempt_id')
      .limit(250);
    if (cursor) query.where('attempt_id', '>', cursor);
    const rows = await query;
    for (const row of rows) {
      const report = json<Result>(row.report);
      const aggregate = reportsByUser.get(row.user_id) || {
        completed: 0,
        total: 0,
        correct: 0,
        latestScore: null,
        scoredAt: '',
        scoredAttemptId: '',
      };
      aggregate.completed++;
      aggregate.total += report.total;
      aggregate.correct += report.correct;
      if (
        report.totalScore !== null &&
        report.totalScore !== undefined &&
        (row.created_at > aggregate.scoredAt ||
          (row.created_at === aggregate.scoredAt && row.attempt_id > aggregate.scoredAttemptId))
      ) {
        aggregate.latestScore = report.totalScore;
        aggregate.scoredAt = row.created_at;
        aggregate.scoredAttemptId = row.attempt_id;
      }
      reportsByUser.set(row.user_id, aggregate);
      completedCount++;
      total += report.total;
      correct += report.correct;
    }
    if (rows.length < 250) break;
    cursor = rows.at(-1)!.attempt_id;
  }
  const students = users.map((u) => {
    const tests = attemptsByUser.get(u.id),
      reports = reportsByUser.get(u.id);
    const count = Number(tests?.total || 0),
      full = Number(tests?.full || 0);
    return {
      ...u,
      attempts: count,
      fullAttempts: full,
      practiceAttempts: count - full,
      completedAttempts: reports?.completed || 0,
      accuracy: reports?.total ? reports.correct / reports.total : null,
      questionsAnswered: reports?.total || 0,
      latestScore: reports?.latestScore ?? null,
      lastActivity: tests?.last_activity || null,
    };
  });
  const questionRows = await db('questions as q')
    .leftJoin('responses as r', 'r.question_id', 'q.id')
    .whereNull('q.owner_id')
    .groupBy('q.id', 'q.public_id', 'q.section', 'q.domain_id', 'q.skill_id', 'q.difficulty', 'q.usage_count')
    .select('q.id', 'q.public_id', 'q.section', 'q.domain_id', 'q.skill_id', 'q.difficulty', 'q.usage_count')
    .count({ graded: 'r.correct' })
    .sum({ correct: db.raw('CASE WHEN r.correct = ? THEN 1 ELSE 0 END', [true]) })
    .orderBy('q.usage_count', 'desc')
    .limit(1000);
  const questions = questionRows.map((q: any) => ({
    id: q.id,
    publicId: q.public_id,
    section: q.section,
    domainId: q.domain_id,
    skillId: q.skill_id,
    difficulty: q.difficulty,
    usageCount: q.usage_count,
    graded: Number(q.graded || 0),
    correct: Number(q.correct || 0),
    accuracy: Number(q.graded) > 0 ? Number(q.correct || 0) / Number(q.graded) : null,
  }));
  return {
    summary: {
      students: users.length,
      attempts: attempts.reduce((sum, row) => sum + Number(row.total), 0),
      completedAttempts: completedCount,
      sharedQuestions: Number(
        (await db('questions').whereNull('owner_id').count({ count: 'id' }).first())?.count || 0,
      ),
      questionsAnswered: total,
      accuracy: total ? correct / total : null,
    },
    students,
    questions,
  };
}
