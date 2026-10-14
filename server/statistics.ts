import type { Knex } from 'knex';
import type { Result } from '../shared/types.js';
import { json } from './db.js';
export async function statistics(db: Knex) {
  const users = await db('users').where({ role: 'student' }).select('id', 'name', 'email');
  const attempts = await db('attempts').select('user_id', 'mode', 'status', 'started_at');
  const results = await db('score_results')
    .select('user_id', 'created_at', 'report')
    .orderBy('created_at', 'desc');
  const students = users.map((u) => {
    const tests = attempts.filter((a) => a.user_id === u.id),
      reports = results.filter((r) => r.user_id === u.id).map((r) => json<Result>(r.report));
    const count = reports.reduce((s, r) => s + r.total, 0),
      correct = reports.reduce((s, r) => s + r.correct, 0);
    return {
      ...u,
      attempts: tests.length,
      fullAttempts: tests.filter((a) => a.mode === 'full').length,
      practiceAttempts: tests.filter((a) => a.mode !== 'full').length,
      completedAttempts: reports.length,
      accuracy: count ? correct / count : null,
      questionsAnswered: count,
      latestScore: reports.find((r) => r.totalScore !== null)?.totalScore ?? null,
      lastActivity:
        tests
          .map((a) => a.started_at)
          .sort()
          .at(-1) || null,
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
  const completed = results.map((r) => json<Result>(r.report)),
    total = completed.reduce((s, r) => s + r.total, 0),
    correct = completed.reduce((s, r) => s + r.correct, 0);
  return {
    summary: {
      students: users.length,
      attempts: attempts.length,
      completedAttempts: results.length,
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
