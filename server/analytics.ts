import type { Knex } from 'knex';
import type { Dashboard, ErrorItem, HistoryItem, Result, User } from '../shared/types.js';
import { json } from './db.js';
import { getAttempt } from './attempts.js';
import { performance } from './engines.js';
import { loadTaxonomy } from './taxonomy-management.js';

export async function history(db: Knex, user: User): Promise<HistoryItem[]> {
  const rows = await db('score_results').where({ user_id: user.id }).orderBy('created_at', 'desc').limit(500);
  return rows.reverse().map((row) => {
    const r = json<Result>(row.report);
    return {
      id: r.attemptId,
      title: r.title,
      mode: r.mode,
      completedAt: r.completedAt,
      totalScore: r.totalScore,
      rwScore: r.rwScore,
      mathScore: r.mathScore,
      accuracy: r.accuracy,
      total: r.total,
    };
  });
}
export async function dashboard(db: Knex, user: User, days?: number): Promise<Dashboard> {
  const query = db('score_results').where({ user_id: user.id });
  if (days && [7, 30, 90].includes(days))
    query.where('created_at', '>=', new Date(Date.now() - days * 86_400_000).toISOString());
  const results = (await query.orderBy('created_at', 'desc').limit(1000)).map((row) =>
    json<Result>(row.report),
  );
  const review = results.flatMap((r) => r.review),
    taxonomy = await loadTaxonomy(db),
    domainStats = performance(review, 'domain', taxonomy),
    skillStats = performance(review, 'skill', taxonomy);
  for (const stats of [domainStats, skillStats])
    for (const stat of stats) {
      const entries = review.filter((r) =>
          stats === domainStats ? r.question.domainId === stat.id : r.question.skillId === stat.id,
        ),
        recent = entries.slice(0, 20),
        prior = entries.slice(20, 40);
      stat.recentAccuracy = recent.length ? recent.filter((r) => r.correct).length / recent.length : 0;
      stat.trend = prior.length
        ? stat.recentAccuracy - prior.filter((r) => r.correct).length / prior.length
        : 0;
    }
  const active = await db('attempts')
    .where({ user_id: user.id })
    .whereNot({ status: 'completed' })
    .orderBy('started_at', 'desc')
    .limit(20);
  const activeAttempts = [];
  for (const a of active) {
    const attempt = await getAttempt(db, user, a.id);
    if (attempt.status !== 'completed') activeAttempts.push(attempt);
  }
  const errors = Number(
    (
      await db('error_logs')
        .where({ user_id: user.id })
        .whereNot({ status: 'mastered' })
        .count({ count: 'id' })
        .first()
    )?.count || 0,
  );
  const bookmarks = Number(
    (await db('bookmarks').where({ user_id: user.id }).count({ count: 'id' }).first())?.count || 0,
  );
  const weakest = skillStats
    .filter((s) => s.attempts >= 1)
    .sort((a, b) => a.accuracy - b.accuracy || b.averageMs - a.averageMs)
    .slice(0, 3);
  const recommendations: Dashboard['recommendations'] = [];
  for (const s of weakest) {
    const available = Number(
      (
        await db('questions')
          .where({ skill_id: s.id, status: 'published' })
          .where(function () {
            this.whereNull('owner_id').orWhere('owner_id', user.id);
          })
          .count({ total: 'id' })
          .first()
      )?.total || 0,
    );
    if (available)
      recommendations.push({
        title: `Practice ${s.name}`,
        reason: `${Math.round(s.accuracy * 100)}% accuracy across ${s.attempts} responses. Target this skill next.`,
        skillId: s.id,
        mode: 'weak',
        count: Math.min(10, available),
      });
  }
  if (errors)
    recommendations.unshift({
      title: 'Revisit recent mistakes',
      reason: `${errors} mistakes remain in your review queue. Read each explanation and retry.`,
      mode: 'wrong',
      count: Math.min(10, errors),
    });
  if (!recommendations.length)
    recommendations.push({
      title: 'Start with a timed module',
      reason: 'Build your first assessment to see strengths and areas to practice.',
      mode: 'module',
      count: 27,
    });
  return {
    history: await history(db, user),
    domainHistory: [...results]
      .reverse()
      .map((r) => ({ attemptId: r.attemptId, completedAt: r.completedAt, domains: r.domains })),
    activeAttempts,
    domainStats,
    skillStats,
    recommendations,
    stats: {
      questionsAnswered: review.filter((r) => r.response.answer.trim()).length,
      accuracy: review.length ? review.filter((r) => r.correct).length / review.length : 0,
      averageMs: review.length
        ? Math.round(review.reduce((s, r) => s + r.response.elapsedMs, 0) / review.length)
        : 0,
      studyDays: new Set(results.map((r) => r.completedAt.slice(0, 10))).size,
      bookmarks,
      errors,
    },
  };
}
export async function errorItems(
  db: Knex,
  user: User,
  filters: Record<string, any> = {},
): Promise<{ items: ErrorItem[]; total: number }> {
  const query = db('error_logs as e')
    .join('question_versions as v', 'v.id', 'e.version_id')
    .join('questions as q', 'q.id', 'e.question_id')
    .where('e.user_id', user.id);
  for (const [key, column] of Object.entries({
    section: 'q.section',
    domainId: 'q.domain_id',
    skillId: 'q.skill_id',
    difficulty: 'q.difficulty',
  }))
    if (filters[key]) query.where(column, filters[key]);
  if (filters.status === 'mastered') query.where('e.status', 'mastered');
  else if (filters.status === 'open') query.whereNot('e.status', 'mastered');
  else if (filters.status === 'never-retried') query.where('e.retries', 0).whereNot('e.status', 'mastered');
  else if (filters.status === 'still-wrong') query.where('e.retries', '>', 0).where('e.status', 'new');
  if (filters.days && [7, 30, 90].includes(Number(filters.days)))
    query.where('e.created_at', '>=', new Date(Date.now() - Number(filters.days) * 86_400_000).toISOString());
  const total = Number((await query.clone().count({ total: 'e.id' }).first())?.total || 0);
  const rows = await query
    .select('e.*', 'v.content', 'v.version')
    .orderBy('e.created_at', 'desc')
    .limit(100)
    .offset(Math.max(0, (Number(filters.page) || 1) - 1) * 100);
  const items: ErrorItem[] = [];
  for (const r of rows) {
    const response = await db('responses')
      .where({ attempt_id: r.attempt_id, question_id: r.question_id })
      .first();
    const q = { ...json(r.content), id: r.question_id, version: r.version };
    delete q.adminNotes;
    delete q.calibration;
    items.push({
      id: r.id,
      question: q,
      attemptId: r.attempt_id,
      answer: r.selected_answer,
      correctAnswer: q.type === 'mcq' ? q.correctAnswer : q.acceptedAnswers.join(' or '),
      createdAt: r.created_at,
      elapsedMs: response?.time_spent_ms || 0,
      reason: r.reason,
      mastered: r.status === 'mastered',
      retryCount: r.retries,
      lastCorrect: r.retries > 0 ? r.status !== 'new' : null,
      dueAt: r.due_at,
    });
  }
  return { items, total };
}
