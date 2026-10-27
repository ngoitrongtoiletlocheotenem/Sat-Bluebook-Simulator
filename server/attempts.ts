import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  Attempt,
  AttemptInput,
  Blueprint,
  Module,
  Question,
  Response,
  Result,
  ReviewItem,
  User,
} from '../shared/types.js';
import { encode, json, now } from './db.js';
import { ApiError } from './validation.js';
import { questionQuery, toQuestion } from './questions.js';
import {
  adaptiveRoute,
  assembleModule,
  assembleByDistribution,
  fullBlueprint,
  gradeAnswer,
  performance,
} from './engines.js';
import { withAttemptLock } from './attempt-lock.js';
import { scoringModelSnapshot, scoreSection, type ScoringConfiguration } from './scoring.js';
import { loadTaxonomy } from './taxonomy-management.js';

export const attemptInputSchema = z.object({
  mode: z.enum(['full', 'module', 'practice', 'tutor', 'wrong', 'weak', 'bookmarks']),
  blueprintId: z.string().optional(),
  section: z.enum(['rw', 'math']).optional(),
  domainId: z.string().optional(),
  skillId: z.string().optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  count: z.number().int().min(1).max(100).optional(),
  seed: z.string().max(100).optional(),
  excludeSeen: z.boolean().optional(),
  includeWrong: z.boolean().optional(),
  timeMultiplier: z.union([z.literal(1), z.literal(1.5), z.literal(2)]).optional(),
  breakSeconds: z.number().int().min(0).max(3600).optional(),
  questionIds: z.array(z.string()).max(100).optional(),
  timedSeconds: z.number().int().min(30).max(14_400).optional(),
  tags: z.array(z.string()).max(30).optional(),
  source: z.string().max(500).optional(),
  domainDistribution: z.record(z.string(), z.number().min(0).max(100)).optional(),
});
const savedResponseSchema = z.object({
  answer: z.string().max(100),
  eliminated: z.array(z.string().max(10)).max(5),
  marked: z.boolean(),
  highlights: z
    .array(
      z.object({
        id: z.string().max(100),
        field: z.enum(['passage', 'stem']),
        underline: z.boolean().optional(),
        underlineStyle: z.enum(['none', 'solid', 'dashed', 'dotted']).optional(),
        start: z.number().int().min(0),
        end: z.number().int().min(1),
        text: z.string().max(10_000),
        color: z.string().max(20).optional(),
        style: z.enum(['highlight', 'underline']).optional(),
        note: z.string().max(5000).optional(),
        noteAttached: z.boolean().optional(),
      }),
    )
    .max(100),
  note: z.string().max(10_000),
  elapsedMs: z.number().int().min(0).max(86_400_000),
});
export const attemptRevisionSchema = z.object({
  expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});
export const attemptTransitionSchema = attemptRevisionSchema.extend({ moduleId: z.string().min(1) });
export const attemptSaveSchema = attemptRevisionSchema.extend({
  moduleId: z.string(),
  currentQuestion: z.number().int().min(0).optional(),
  responses: z.record(z.string(), savedResponseSchema).optional(),
});
// Synchronize deadlines in the parent transaction; reject client work in a savepoint.
// A conflict must not roll back the server's elapsed-time transitions.
async function mutateAttempt<T>(
  db: Knex,
  user: User,
  id: string,
  action: (trx: Knex.Transaction) => Promise<T>,
): Promise<T> {
  const outcome = await withAttemptLock(db, user, id, async (trx) => {
    await synchronizeAttempt(trx, user, id);
    try {
      return { value: await trx.transaction(action) };
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) return { error };
      throw error;
    }
  });
  if ('error' in outcome) throw outcome.error;
  return outcome.value;
}
function checkRevision(attempt: any, expectedRevision: number) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    throw new ApiError(400, 'A valid expectedRevision is required');
  if (Number(attempt.revision) !== expectedRevision)
    throw new ApiError(409, 'Attempt changed; refresh before saving', 'ATTEMPT_REVISION_CONFLICT');
}
type Snapshot = {
  blueprint: Blueprint;
  title: string;
  breakSeconds: number;
  timeMultiplier: number;
  scoringModel?: ScoringConfiguration;
  pools: Record<string, { id: string; versionId: string; question: Question }[]>;
};

function responseValue(row: any): Response {
  return {
    answer: row.answer,
    eliminated: json(row.eliminated),
    marked: !!row.marked,
    highlights: json(row.highlights),
    note: json<any[]>(row.notes)[0]?.text || '',
    elapsedMs: row.time_spent_ms,
  };
}
function redacted(q: Question): Question {
  const safe = { ...q } as Question & { calibration?: unknown };
  delete safe.correctAnswer;
  delete safe.acceptedAnswers;
  delete safe.explanation;
  delete safe.hint;
  delete safe.strategy;
  delete safe.adminNotes;
  delete safe.calibration;
  return { ...safe, choices: q.choices.map(({ id, text }) => ({ id, text })) };
}
async function ownedAttempt(db: Knex, user: User, id: string) {
  const a = await db('attempts').where({ id, user_id: user.id }).first();
  if (!a) throw new ApiError(404, 'Attempt not found');
  return a;
}
function poolKey(section: string, index: number, route: string) {
  return `${section}:${index}:${route}`;
}
async function installQuestions(db: Knex, attempt: any, module: any, items: Snapshot['pools'][string]) {
  for (let i = 0; i < items.length; i++)
    await db('responses').insert({
      id: randomUUID(),
      attempt_id: attempt.id,
      module_id: module.id,
      question_id: items[i]!.id,
      version_id: items[i]!.versionId,
      position: i,
      updated_at: now(),
    });
  if (db.client.config.client === 'pg')
    await db('questions')
      .whereIn(
        'id',
        items.map((q) => q.id),
      )
      .orderBy('id')
      .forUpdate()
      .select('id');
  await db('questions')
    .whereIn(
      'id',
      items.map((q) => q.id),
    )
    .increment('usage_count', 1);
}
export async function createAttempt(db: Knex, user: User, input: AttemptInput): Promise<Attempt> {
  const distribution = (input as AttemptInput & { domainDistribution?: Record<string, number> })
    .domainDistribution;
  if (distribution) {
    if (
      !input.section ||
      input.mode === 'full' ||
      input.mode === 'module' ||
      input.blueprintId ||
      input.questionIds?.length
    )
      throw new ApiError(422, 'Custom domain distribution requires a practice section and random assembly');
    const domains = await db('domains').where({ section: input.section });
    if (Object.keys(distribution).some((id) => !domains.some((d) => d.id === id)))
      throw new ApiError(422, 'Every weighted domain must belong to the selected section');
  }
  const seed = input.seed || randomUUID();
  let blueprint: Blueprint;
  if (input.blueprintId) {
    const row = await db('blueprints').where({ id: input.blueprintId }).first();
    if (!row || (!row.published && user.role === 'student'))
      throw new ApiError(404, 'Published blueprint not found');
    blueprint = json(row.config);
  } else blueprint = fullBlueprint(seed);
  if (input.mode === 'full' && blueprint.kind !== 'full')
    throw new ApiError(422, 'Full SAT mode requires a full SAT blueprint');
  const query = questionQuery(db, user).where('q.status', 'published');
  if (input.mode === 'full') query.whereNull('q.owner_id');
  else {
    if (input.mode === 'weak' && !input.domainId && !input.skillId) {
      const history = await db('score_results')
        .where({ user_id: user.id })
        .orderBy('created_at', 'desc')
        .limit(30);
      const stats = performance(
        history.flatMap((r) => json<Result>(r.report).review),
        'skill',
        await loadTaxonomy(db),
      )
        .filter((s) => s.attempts > 0)
        .sort((a, b) => a.accuracy - b.accuracy || b.averageMs - a.averageMs);
      if (stats[0]) input = { ...input, skillId: stats[0].id };
    }
    for (const [key, col] of Object.entries({
      section: 'q.section',
      domainId: 'q.domain_id',
      skillId: 'q.skill_id',
      difficulty: 'q.difficulty',
    }))
      if ((input as any)[key]) query.where(col, (input as any)[key]);
    if (input.questionIds?.length) query.whereIn('q.id', input.questionIds);
    if (input.mode === 'bookmarks')
      query.whereIn('q.id', db('bookmarks').where({ user_id: user.id }).select('question_id'));
    if (input.mode === 'wrong' || input.includeWrong)
      query.whereIn(
        'q.id',
        db('error_logs').where({ user_id: user.id }).whereNot({ status: 'mastered' }).select('question_id'),
      );
    if (input.excludeSeen)
      query.whereNotIn(
        'q.id',
        db('responses')
          .join('attempts', 'attempts.id', 'responses.attempt_id')
          .where('attempts.user_id', user.id)
          .select('responses.question_id'),
      );
  }
  let rows = await query.orderBy('q.public_id');
  if (input.tags?.length)
    rows = rows.filter((r) => input.tags!.every((tag) => json<any>(r.content).tags.includes(tag)));
  if (input.source) rows = rows.filter((r) => json<any>(r.content).source === input.source);
  const questions = rows.map((r) => toQuestion(r, true));
  const pools: Snapshot['pools'] = {},
    excluded = new Set<string>();
  let modules = blueprint.modules;
  if (input.mode !== 'full' && !input.blueprintId) {
    const section = input.section || questions[0]?.section || 'rw';
    const mixedSections = !input.section && input.mode !== 'module';
    const available = mixedSections
      ? questions.length
      : questions.filter((q) => q.section === section).length;
    const requested =
      input.mode === 'module' ? (section === 'rw' ? 27 : 22) : input.questionIds?.length || input.count || 10;
    const count = ['weak', 'wrong', 'bookmarks'].includes(input.mode)
      ? Math.min(requested, available)
      : requested;
    if (count < 1) throw new ApiError(422, 'No questions match this practice collection');
    if (
      mixedSections &&
      questions.some((q) => q.section === 'rw') &&
      questions.some((q) => q.section === 'math')
    ) {
      const rwAvailable = questions.filter((q) => q.section === 'rw').length,
        mathAvailable = questions.filter((q) => q.section === 'math').length;
      let rwCount = Math.min(Math.ceil(count / 2), rwAvailable),
        mathCount = count - rwCount;
      if (mathCount > mathAvailable) {
        mathCount = mathAvailable;
        rwCount = count - mathCount;
      }
      if (input.questionIds?.length) {
        rwCount = questions.filter((q) => q.section === 'rw').length;
        mathCount = questions.filter((q) => q.section === 'math').length;
      }
      modules = [
        { section: 'rw' as const, count: rwCount },
        { section: 'math' as const, count: mathCount },
      ]
        .filter((m) => m.count > 0)
        .map((m) => ({
          ...m,
          index: 1,
          route: 'mixed' as const,
          durationSeconds: input.timedSeconds ? Math.round((input.timedSeconds * m.count) / count) : 0,
          questionIds:
            input.questionIds?.filter((id) =>
              questions.some((q) => q.id === id && q.section === m.section),
            ) || [],
        }));
    } else
      modules = [
        {
          section,
          index: 1,
          route: 'mixed',
          count,
          durationSeconds:
            input.mode === 'module' ? (section === 'rw' ? 1920 : 2100) : input.timedSeconds || 0,
          questionIds: input.questionIds || [],
        },
      ];
    blueprint = {
      ...blueprint,
      id: 'custom',
      title:
        input.mode === 'tutor'
          ? 'Tutor practice'
          : input.mode === 'module'
            ? 'Timed SAT module'
            : input.mode === 'wrong'
              ? 'Mistake review'
              : input.mode === 'weak'
                ? 'Targeted skill practice'
                : input.mode === 'bookmarks'
                  ? 'Bookmarked questions'
                  : 'Custom practice',
      kind: 'custom',
      modules,
    };
  }
  for (const m of modules) {
    let selected: Question[];
    if (m.questionIds.length) {
      if (new Set(m.questionIds).size !== m.questionIds.length)
        throw new ApiError(422, 'Blueprint contains duplicate questions');
      selected = m.questionIds.map((id) => {
        const q = questions.find((q) => q.id === id);
        if (!q || q.section !== m.section || excluded.has(q.id))
          throw new ApiError(
            422,
            'Blueprint question is unavailable, belongs to another section, or repeats',
          );
        excluded.add(q.id);
        return q;
      });
      if (selected.length !== m.count)
        throw new ApiError(422, 'Blueprint question count does not match its pool');
    } else
      selected = distribution
        ? assembleByDistribution(questions, m.section, m.count, distribution, seed, excluded)
        : assembleModule(
            questions,
            m.section,
            m.count,
            m.route,
            `${seed}:${poolKey(m.section, m.index, m.route)}`,
            excluded,
            input.mode === 'full' ||
              (input.mode === 'module' && !input.domainId && !input.skillId && !input.difficulty),
          );
    pools[poolKey(m.section, m.index, m.route)] = selected.map((q) => ({
      id: q.id,
      versionId: rows.find((r) => r.id === q.id)!.version_id,
      question: q,
    }));
  }
  modules = [...modules].sort(
    (a, b) =>
      (a.section === 'rw' ? 0 : 1) - (b.section === 'rw' ? 0 : 1) ||
      a.index - b.index ||
      ['mixed', 'higher', 'lower'].indexOf(a.route) - ['mixed', 'higher', 'lower'].indexOf(b.route),
  );
  const activeDefinitions = modules.filter((m) => m.route !== 'lower');
  const started = now(),
    id = randomUUID(),
    snapshot: Snapshot = {
      blueprint,
      title: blueprint.title,
      breakSeconds: input.breakSeconds ?? (input.mode === 'full' ? 600 : 0),
      timeMultiplier: input.timeMultiplier || 1,
      scoringModel: scoringModelSnapshot(),
      pools,
    };
  if (input.mode === 'full' && snapshot.scoringModel!.kind !== 'estimated')
    for (const section of ['rw', 'math'] as const)
      for (const route of ['higher', 'lower']) {
        const form = [...pools[poolKey(section, 1, 'mixed')]!, ...pools[poolKey(section, 2, route)]!].map(
          (item) => ({
            question: item.question,
            response: { answer: '', eliminated: [], marked: false, highlights: [], note: '', elapsedMs: 0 },
            correct: false,
            moduleId: 'validation',
          }),
        );
        scoreSection(snapshot.scoringModel!, section, form);
      }
  await db.transaction(async (trx) => {
    await trx('attempts').insert({
      id,
      user_id: user.id,
      blueprint_id: input.blueprintId || (input.mode === 'full' ? 'standard-sat' : null),
      mode: input.mode,
      status: 'active',
      seed,
      snapshot: encode(snapshot),
      started_at: started,
    });
    for (let i = 0; i < activeDefinitions.length; i++) {
      const def = activeDefinitions[i]!,
        duration = Math.round(def.durationSeconds * snapshot.timeMultiplier),
        module = {
          id: randomUUID(),
          attempt_id: id,
          position: i,
          section: def.section,
          route: def.index === 1 ? 'mixed' : 'higher',
          status: i === 0 ? 'active' : 'pending',
          duration_seconds: duration,
          started_at: i === 0 ? started : null,
          deadline:
            i === 0 && duration > 0 ? new Date(Date.parse(started) + duration * 1000).toISOString() : null,
        };
      await trx('module_attempts').insert(module);
      if (i === 0)
        await installQuestions(trx, { id }, module, pools[poolKey(def.section, def.index, module.route)]!);
    }
  });
  return getAttempt(db, user, id);
}
async function reviewItems(db: Knex, attemptId: string): Promise<ReviewItem[]> {
  const rows = await db('responses as r')
    .join('question_versions as v', 'v.id', 'r.version_id')
    .join('questions as q', 'q.id', 'r.question_id')
    .join('module_attempts as m', 'm.id', 'r.module_id')
    .where('r.attempt_id', attemptId)
    .select(
      'r.*',
      'v.content',
      'v.version',
      'q.public_id',
      'q.owner_id',
      'q.status',
      'q.created_at',
      'q.updated_at as question_updated_at',
    )
    .orderBy('m.position')
    .orderBy('r.position');
  return rows.map((row) => {
    const question = {
      ...json(row.content),
      id: row.question_id,
      version: row.version,
      status: row.status,
      ownerId: row.owner_id,
    };
    delete question.adminNotes;
    delete question.calibration;
    return { question, response: responseValue(row), correct: !!row.correct, moduleId: row.module_id };
  });
}
async function scoreResult(db: Knex, attempt: any, user: User) {
  if (await db('score_results').where({ attempt_id: attempt.id }).first()) return;
  const review = await reviewItems(db, attempt.id),
    snapshot = json<Snapshot>(attempt.snapshot),
    modules = await db('module_attempts').where({ attempt_id: attempt.id });
  const rw = review.filter((r) => r.question.section === 'rw'),
    math = review.filter((r) => r.question.section === 'math');
  const scoring = snapshot.scoringModel || scoringModelSnapshot();
  const rwScore = attempt.mode === 'full' ? scoreSection(scoring, 'rw', rw) : null,
    mathScore = attempt.mode === 'full' ? scoreSection(scoring, 'math', math) : null;
  const totalScore = rwScore !== null && mathScore !== null ? rwScore + mathScore : null;
  const correct = review.filter((r) => r.correct).length,
    total = review.length,
    elapsedMs = review.reduce((s, r) => s + r.response.elapsedMs, 0),
    routes: Record<string, string> = {};
  for (const m of modules) if (m.route !== 'mixed') routes[m.section] = m.route;
  const previous = await db('score_results as s')
    .join('attempts as a', 'a.id', 's.attempt_id')
    .where({ 's.user_id': user.id, 'a.mode': 'full' })
    .orderBy('s.created_at', 'desc')
    .select('s.report')
    .first();
  const previousScore = previous ? json<Result>(previous.report).totalScore : null;
  const taxonomy = await loadTaxonomy(db);
  const result: Result = {
    attemptId: attempt.id,
    title: snapshot.title,
    mode: attempt.mode,
    student: user.name,
    completedAt: now(),
    totalScore,
    rwScore,
    mathScore,
    ...(totalScore === null || scoring.kind !== 'estimated'
      ? {}
      : {
          scoreRange: [Math.max(400, totalScore - 60), Math.min(1600, totalScore + 60)] as [number, number],
        }),
    scoreModelVersion: scoring.version,
    scoreLabel: attempt.mode === 'full' ? scoring.label : 'Practice accuracy',
    accuracy: total ? correct / total : 0,
    correct,
    total,
    unanswered: review.filter((r) => !r.response.answer.trim()).length,
    marked: review.filter((r) => r.response.marked).length,
    elapsedMs,
    averageMs: total ? Math.round(elapsedMs / total) : 0,
    routes,
    domains: performance(review, 'domain', taxonomy),
    skills: performance(review, 'skill', taxonomy),
    difficulties: performance(review, 'difficulty', taxonomy),
    review,
    previousDelta: totalScore !== null && previousScore !== null ? totalScore - previousScore : null,
  };
  await db('score_results').insert({
    attempt_id: attempt.id,
    user_id: user.id,
    report: encode(result),
    created_at: result.completedAt,
  });
  const questionIds = [...new Set(review.map((item) => item.question.id))].sort();
  const versions = new Map(
    (await db('responses').where({ attempt_id: attempt.id }).select('question_id', 'version_id')).map(
      (row) => [row.question_id, row.version_id],
    ),
  );
  let priorQuery = db('error_logs')
    .where({ user_id: user.id })
    .whereIn('question_id', questionIds)
    .whereNot({ attempt_id: attempt.id })
    .orderBy('question_id')
    .orderBy('id');
  // Attempts can share historical mistakes: lock all prior evidence in a single
  // deterministic order before updating counters, independently of report order.
  if (db.client.config.client === 'pg') priorQuery = priorQuery.forUpdate();
  const priorByQuestion = new Map<string, any[]>();
  for (const row of await priorQuery) {
    const rows = priorByQuestion.get(row.question_id) || [];
    rows.push(row);
    priorByQuestion.set(row.question_id, rows);
  }
  for (const item of review) {
    const priorErrors = priorByQuestion.get(item.question.id) || [];
    for (const e of priorErrors)
      await db('error_logs')
        .where({ id: e.id })
        .update({
          retries: e.retries + 1,
          status: item.correct ? (e.status === 'mastered' ? 'mastered' : 'reviewing') : 'new',
          due_at: new Date(Date.now() + (item.correct ? 3 : 1) * 86_400_000).toISOString(),
          updated_at: now(),
        });
    if (!item.correct)
      await db('error_logs')
        .insert({
          id: randomUUID(),
          user_id: user.id,
          question_id: item.question.id,
          version_id: versions.get(item.question.id),
          attempt_id: attempt.id,
          selected_answer: item.response.answer,
          due_at: new Date(Date.now() + 86_400_000).toISOString(),
          created_at: now(),
          updated_at: now(),
        })
        .onConflict(['user_id', 'attempt_id', 'question_id'])
        .ignore();
  }
  await db('attempts')
    .where({ id: attempt.id })
    .update({ status: 'completed', completed_at: result.completedAt, revision: attempt.revision + 1 });
}
async function closeModule(db: Knex, attempt: any, user: User, closedAt: string) {
  const module = await db('module_attempts')
    .where({ attempt_id: attempt.id, position: attempt.active_module })
    .first();
  if (!module || module.status !== 'active') throw new ApiError(409, 'Module is already closed');
  const rows = await db('responses as r')
    .join('question_versions as v', 'v.id', 'r.version_id')
    .where('r.module_id', module.id)
    .where('r.attempt_id', attempt.id)
    .select('r.*', 'v.content');
  let correct = 0;
  for (const row of rows) {
    const isCorrect = gradeAnswer(json(row.content), row.answer);
    if (isCorrect) correct++;
    await db('responses').where({ id: row.id }).update({ correct: isCorrect });
  }
  await db('module_attempts').where({ id: module.id }).update({ status: 'closed', closed_at: closedAt });
  const next = await db('module_attempts')
      .where({ attempt_id: attempt.id, position: module.position + 1 })
      .first(),
    snapshot = json<Snapshot>(attempt.snapshot);
  if (!next) {
    await scoreResult(db, attempt, user);
    return;
  }
  if (next.section === module.section && next.route !== 'mixed') {
    const routing = {
      ...adaptiveRoute(correct, rows.length, snapshot.blueprint.routingThreshold),
      modelVersion: snapshot.blueprint.routingModelVersion,
      blueprintVersion: snapshot.blueprint,
    };
    await db('module_attempts')
      .where({ id: module.id })
      .update({ routing_result: encode(routing) });
    next.route = routing.route;
    await db('module_attempts').where({ id: next.id }).update({ route: routing.route });
  }
  await db('attempts')
    .where({ id: attempt.id })
    .update({ active_module: next.position, current_question: 0, revision: attempt.revision + 1 });
  const nextDefinition = snapshot.blueprint.modules.find(
    (m) => m.section === next.section && m.route === next.route,
  )!;
  await installQuestions(
    db,
    attempt,
    next,
    snapshot.pools[poolKey(next.section, nextDefinition.index, next.route)]!,
  );
  if (next.section !== module.section && snapshot.breakSeconds > 0) {
    await db('attempts')
      .where({ id: attempt.id })
      .update({
        status: 'break',
        break_until: new Date(Date.parse(closedAt) + snapshot.breakSeconds * 1000).toISOString(),
      });
  } else await startModule(db, attempt.id, next, closedAt);
}
async function startModule(db: Knex, attemptId: string, module: any, start: string) {
  await db('module_attempts')
    .where({ id: module.id })
    .update({
      status: 'active',
      started_at: start,
      deadline:
        module.duration_seconds > 0
          ? new Date(Date.parse(start) + module.duration_seconds * 1000).toISOString()
          : null,
    });
  await db('attempts')
    .where({ id: attemptId })
    .update({ status: 'active', break_until: null, paused_at: null })
    .increment('revision', 1);
}
// The server owns deadlines. Long offline intervals advance all expired modules
// using their actual boundaries, so reconnecting never grants extra exam time.
export async function synchronizeAttempt(db: Knex, user: User, id: string): Promise<any> {
  if (!db.isTransaction) return withAttemptLock(db, user, id, (trx) => synchronizeAttempt(trx, user, id));
  let attempt = await ownedAttempt(db, user, id);
  for (let steps = 0; steps < 10; steps++) {
    if (attempt.status === 'completed' || attempt.status === 'paused') return attempt;
    const module = await db('module_attempts')
      .where({ attempt_id: id, position: attempt.active_module })
      .first();
    if (attempt.status === 'break' && Date.parse(attempt.break_until) <= Date.now())
      await startModule(db, id, module, attempt.break_until);
    else if (attempt.status === 'active' && module.deadline && Date.parse(module.deadline) <= Date.now())
      await closeModule(db, attempt, user, module.deadline);
    else return attempt;
    attempt = await ownedAttempt(db, user, id);
  }
  return attempt;
}
export async function getAttempt(db: Knex, user: User, id: string): Promise<Attempt> {
  if (!db.isTransaction) return withAttemptLock(db, user, id, (trx) => getAttempt(trx, user, id));
  const attempt = await synchronizeAttempt(db, user, id),
    snapshot = json<Snapshot>(attempt.snapshot),
    rows = await db('module_attempts').where({ attempt_id: id }).orderBy('position');
  const responses = await db('responses as r')
    .join('question_versions as v', 'v.id', 'r.version_id')
    .where('r.attempt_id', id)
    .select('r.*', 'v.content', 'v.version');
  const modules: Module[] = rows.map((row) => ({
    id: row.id,
    section: row.section,
    index: row.route === 'mixed' ? 1 : 2,
    route: row.route,
    status: row.status,
    durationSeconds: row.duration_seconds,
    startedAt: row.started_at || undefined,
    deadline: row.deadline || undefined,
    questionCount:
      snapshot.blueprint.modules.find((m) => m.section === row.section && m.route === row.route)?.count || 0,
  }));
  const active = modules[attempt.active_module] || null;
  if ((active && attempt.status === 'active') || (active && attempt.status === 'paused'))
    active!.questions = responses
      .filter((r) => r.module_id === active!.id)
      .sort((a, b) => a.position - b.position)
      .map((r) => redacted({ ...json(r.content), id: r.question_id, version: r.version }));
  const responseMap: Record<string, Response> = {};
  for (const r of responses) if (r.module_id === active?.id) responseMap[r.question_id] = responseValue(r);
  const routes: Record<string, string> = {};
  for (const row of rows) if (row.routing_result) routes[row.section] = json(row.routing_result).route;
  return {
    id,
    mode: attempt.mode,
    revision: Number(attempt.revision),
    title: snapshot.title,
    status: attempt.status,
    currentModule: attempt.active_module,
    currentQuestion: attempt.current_question,
    modules,
    module: attempt.status === 'break' || attempt.status === 'completed' ? null : active,
    responses: responseMap,
    routes,
    breakUntil: attempt.break_until || undefined,
    remainingSeconds:
      attempt.status === 'paused'
        ? Number(json<any>(attempt.snapshot).pausedRemaining)
        : active?.deadline
          ? Math.max(0, Math.ceil((Date.parse(active.deadline) - Date.now()) / 1000))
          : undefined,
    user,
    seed: attempt.seed,
    createdAt: attempt.started_at,
  };
}
export async function saveAttempt(
  db: Knex,
  user: User,
  id: string,
  input: z.infer<typeof attemptSaveSchema>,
): Promise<Attempt> {
  if (!db.isTransaction) return mutateAttempt(db, user, id, (trx) => saveAttempt(trx, user, id, input));
  const attempt = await synchronizeAttempt(db, user, id);
  checkRevision(attempt, input.expectedRevision);
  if (attempt.status !== 'active') throw new ApiError(409, 'Attempt is not accepting answers');
  const module = await db('module_attempts')
    .where({ attempt_id: id, position: attempt.active_module })
    .first();
  if (input.moduleId !== module.id) throw new ApiError(409, 'This module is closed; refresh the attempt');
  const rows = await db('responses as r')
    .join('question_versions as v', 'v.id', 'r.version_id')
    .where('r.module_id', module.id)
    .where('r.attempt_id', attempt.id)
    .select('r.*', 'v.content');
  if (input.currentQuestion !== undefined && input.currentQuestion >= rows.length)
    throw new ApiError(400, 'Question index is outside this module');
  await db.transaction(async (trx) => {
    for (const [qid, response] of Object.entries(input.responses || {})) {
      const row = rows.find((r) => r.question_id === qid);
      if (!row) throw new ApiError(400, 'Question is outside the active module');
      const q = json<Question>(row.content);
      if (q.type === 'mcq' && response.answer && !q.choices.some((c) => c.id === response.answer))
        throw new ApiError(400, 'Invalid answer choice');
      if (response.eliminated.some((e) => !q.choices.some((c) => c.id === e)))
        throw new ApiError(400, 'Invalid eliminated choice');
      if (response.highlights.some((h) => h.end <= h.start))
        throw new ApiError(400, 'Invalid highlight range');
      const elapsedCap = Math.min(
        module.duration_seconds > 0 ? module.duration_seconds * 1000 : Number.MAX_SAFE_INTEGER,
        Math.max(0, Date.now() - Date.parse(module.started_at)),
      );
      await trx('responses')
        .where({ id: row.id })
        .update({
          answer: response.answer,
          marked: response.marked,
          eliminated: encode(response.eliminated),
          highlights: encode(response.highlights),
          notes: encode([{ id: 'note', text: response.note }]),
          time_spent_ms: Math.min(Math.max(row.time_spent_ms, response.elapsedMs), elapsedCap),
          updated_at: now(),
        });
    }
    await trx('attempts')
      .where({ id })
      .update({
        current_question: input.currentQuestion ?? attempt.current_question,
        revision: attempt.revision + 1,
      });
  });
  return getAttempt(db, user, id);
}
export async function finishModule(
  db: Knex,
  user: User,
  id: string,
  moduleId: string,
  expectedRevision: number,
): Promise<Attempt> {
  if (!db.isTransaction)
    return mutateAttempt(db, user, id, (trx) => finishModule(trx, user, id, moduleId, expectedRevision));
  const attempt = await synchronizeAttempt(db, user, id);
  checkRevision(attempt, expectedRevision);
  if (attempt.status === 'completed' || attempt.status === 'break') return getAttempt(db, user, id);
  if (attempt.status !== 'active') throw new ApiError(409, 'Resume before submitting');
  const module = await db('module_attempts')
    .where({ attempt_id: id, position: attempt.active_module })
    .first();
  if (moduleId && moduleId !== module.id) throw new ApiError(409, 'The submitted module is already closed');
  await db.transaction(async (trx) => {
    await closeModule(trx, attempt, user, now());
  });
  return getAttempt(db, user, id);
}
export async function continueBreak(
  db: Knex,
  user: User,
  id: string,
  expectedRevision: number,
): Promise<Attempt> {
  if (!db.isTransaction)
    return mutateAttempt(db, user, id, (trx) => continueBreak(trx, user, id, expectedRevision));
  const attempt = await synchronizeAttempt(db, user, id);
  checkRevision(attempt, expectedRevision);
  if (attempt.status !== 'break') return getAttempt(db, user, id);
  const module = await db('module_attempts')
    .where({ attempt_id: id, position: attempt.active_module })
    .first();
  await startModule(db, id, module, now());
  return getAttempt(db, user, id);
}
export async function pauseAttempt(
  db: Knex,
  user: User,
  id: string,
  resume: boolean,
  expectedRevision: number,
): Promise<Attempt> {
  if (!db.isTransaction)
    return mutateAttempt(db, user, id, (trx) => pauseAttempt(trx, user, id, resume, expectedRevision));
  const a = await synchronizeAttempt(db, user, id),
    m = await db('module_attempts').where({ attempt_id: id, position: a.active_module }).first();
  checkRevision(a, expectedRevision);
  if (a.mode === 'full') throw new ApiError(409, 'Strict full SAT simulations cannot be paused');
  const snapshot = json<any>(a.snapshot);
  if (resume && a.status === 'paused') {
    await db('module_attempts')
      .where({ id: m.id })
      .update({
        deadline:
          m.duration_seconds > 0
            ? new Date(Date.now() + snapshot.pausedRemaining * 1000).toISOString()
            : null,
      });
    await db('attempts')
      .where({ id })
      .update({ status: 'active', paused_at: null, revision: a.revision + 1 });
  } else if (!resume && a.status === 'active') {
    snapshot.pausedRemaining = m.deadline
      ? Math.max(0, Math.ceil((Date.parse(m.deadline) - Date.now()) / 1000))
      : 0;
    await db('attempts')
      .where({ id })
      .update({ status: 'paused', paused_at: now(), snapshot: encode(snapshot), revision: a.revision + 1 });
  } else throw new ApiError(409, 'Attempt cannot perform this pause/resume transition');
  return getAttempt(db, user, id);
}
export async function getResult(db: Knex, user: User, id: string): Promise<Result> {
  await synchronizeAttempt(db, user, id);
  const row = await db('score_results').where({ attempt_id: id, user_id: user.id }).first();
  if (!row) throw new ApiError(409, 'Finish the test to see results');
  const result = json<Result>(row.report);
  for (const item of result.review) delete item.question.adminNotes;
  return result;
}
export async function tutorFeedback(
  db: Knex,
  user: User,
  id: string,
  questionId: string,
  response: Response,
  expectedRevision: number,
): Promise<ReviewItem & { revision: number }> {
  if (!db.isTransaction)
    return mutateAttempt(db, user, id, (trx) =>
      tutorFeedback(trx, user, id, questionId, response, expectedRevision),
    );
  const a = await ownedAttempt(db, user, id);
  if (a.mode !== 'tutor') throw new ApiError(403, 'Immediate explanations are only available in tutor mode');
  const module = await db('module_attempts').where({ attempt_id: id, position: a.active_module }).first();
  await saveAttempt(
    db,
    user,
    id,
    attemptSaveSchema.parse({ expectedRevision, moduleId: module.id, responses: { [questionId]: response } }),
  );
  const r = await db('responses as r')
    .join('question_versions as v', 'v.id', 'r.version_id')
    .where({ 'r.attempt_id': id, 'r.question_id': questionId, 'r.module_id': module.id })
    .select('r.*', 'v.content', 'v.version')
    .first();
  const question = { ...json(r.content), id: questionId, version: r.version };
  delete question.adminNotes;
  delete question.calibration;
  const correct = gradeAnswer(question, response.answer);
  await db('responses').where({ id: r.id }).update({ correct });
  if (!correct)
    await db('error_logs')
      .insert({
        id: randomUUID(),
        user_id: user.id,
        question_id: questionId,
        version_id: r.version_id,
        attempt_id: id,
        selected_answer: response.answer,
        due_at: new Date(Date.now() + 86_400_000).toISOString(),
        created_at: now(),
        updated_at: now(),
      })
      .onConflict(['user_id', 'attempt_id', 'question_id'])
      .ignore();
  else {
    const error = await db('error_logs')
      .where({ user_id: user.id, attempt_id: id, question_id: questionId })
      .first();
    if (error)
      await db('error_logs')
        .where({ id: error.id })
        .update({
          retries: error.retries + 1,
          status: error.status === 'mastered' ? 'mastered' : 'reviewing',
          due_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
          updated_at: now(),
        });
  }
  return {
    question,
    response: responseValue(r),
    correct,
    moduleId: module.id,
    revision: Number((await ownedAttempt(db, user, id)).revision),
  };
}
export { reviewItems, responseValue };
