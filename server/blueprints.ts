import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Blueprint, User } from '../shared/types.js';
import { encode, json, now } from './db.js';
import { ApiError } from './validation.js';
import { ROUTING_MODEL, quotaCounts } from './engines.js';

const moduleSchema = z.object({
  section: z.enum(['rw', 'math']),
  index: z.number().int().min(1).max(2),
  route: z.enum(['mixed', 'higher', 'lower']),
  count: z.number().int().min(1).max(100),
  durationSeconds: z.number().int().min(30).max(14_400),
  questionIds: z.array(z.string()).max(100),
});
export const blueprintSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(2000).default(''),
    kind: z.enum(['full', 'custom']),
    published: z.boolean(),
    seed: z.string().max(100).default('blueprint-v1'),
    routingThreshold: z.number().min(0).max(1).default(0.65),
    routingModelVersion: z.string().max(100).default(ROUTING_MODEL),
    modules: z.array(moduleSchema).min(1).max(6),
  })
  .superRefine((b, ctx) => {
    const keys = b.modules.map((m) => `${m.section}:${m.index}:${m.route}`);
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({
        code: 'custom',
        message: 'Blueprint modules must have unique section/index/route keys',
      });
    if (b.kind === 'full') {
      for (const section of ['rw', 'math'])
        for (const [index, route] of [
          [1, 'mixed'],
          [2, 'higher'],
          [2, 'lower'],
        ] as const) {
          const m = b.modules.find((m) => m.section === section && m.index === index && m.route === route);
          if (
            !m ||
            m.count !== (section === 'rw' ? 27 : 22) ||
            m.durationSeconds !== (section === 'rw' ? 1920 : 2100)
          )
            ctx.addIssue({
              code: 'custom',
              message:
                'Full SAT requires six pools: 27-question 32-minute RW and 22-question 35-minute Math, mixed + higher/lower routes',
            });
        }
      if (b.modules.length !== 6)
        ctx.addIssue({ code: 'custom', message: 'Full SAT requires exactly six adaptive pools' });
    }
    for (const m of b.modules)
      if (m.questionIds.length && m.questionIds.length !== m.count)
        ctx.addIssue({ code: 'custom', message: 'Manual question counts must match module count' });
    for (const m of b.modules) {
      if ((m.index === 1 && m.route !== 'mixed') || (m.index === 2 && m.route === 'mixed'))
        ctx.addIssue({
          code: 'custom',
          message: 'Module 1 uses mixed routing; module 2 uses higher or lower routing',
        });
      if (
        m.index === 2 &&
        (!b.modules.some((other) => other.section === m.section && other.index === 1) ||
          !b.modules.some(
            (other) => other.section === m.section && other.index === 2 && other.route !== m.route,
          ))
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Adaptive module 2 requires module 1 and both higher/lower pools in the same section',
        });
    }
    const ids = b.modules.flatMap((m) => m.questionIds);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: 'custom', message: 'Question pools must be disjoint' });
    if (b.kind === 'custom' && b.modules.some((m) => m.index === 2) && !b.modules.some((m) => m.index === 1))
      ctx.addIssue({ code: 'custom', message: 'Adaptive module 2 requires a first module' });
  });
export async function saveBlueprint(db: Knex, user: User, input: unknown, id?: string): Promise<Blueprint> {
  const content = blueprintSchema.parse(input),
    timestamp = now();
  const allIds = content.modules.flatMap((m) => m.questionIds);
  const questionRows = allIds.length ? await db('questions').whereIn('id', allIds) : [];
  const questionsById = new Map(questionRows.map((q) => [q.id, q]));
  if (allIds.length) {
    const qs = questionRows;
    if (
      qs.length !== allIds.length ||
      qs.some((q) => q.status !== 'published' || (q.owner_id && q.owner_id !== user.id))
    )
      throw new ApiError(422, 'Manual blueprint contains unavailable questions');
    for (const m of content.modules)
      if (m.questionIds.some((qid) => questionsById.get(qid)?.section !== m.section))
        throw new ApiError(422, 'Manual question section does not match module');
  }
  if (content.kind === 'full')
    for (const m of content.modules)
      if (m.questionIds.length) {
        const qs = m.questionIds.map((qid) => questionsById.get(qid)!);
        if (qs.some((q) => q.owner_id))
          throw new ApiError(422, 'Full SAT forms use the shared question bank');
        for (const quota of quotaCounts(m.section, m.count, m.route))
          if (qs.filter((q) => q.domain_id === quota.id).length !== quota.count)
            throw new ApiError(
              422,
              `Standard ${m.section} ${m.route} pool requires ${quota.count} questions in ${quota.id}; use Custom Mode for a different distribution`,
            );
      }
  if (id) {
    const existing = await db('blueprints').where({ id }).first();
    if (!existing) throw new ApiError(404, 'Blueprint not found');
    if (user.role === 'teacher' && existing.owner_id !== user.id)
      throw new ApiError(403, 'Only the blueprint author or an administrator can edit');
    await db('blueprints')
      .where({ id })
      .update({
        name: content.title,
        published: content.published,
        version: existing.version + 1,
        config: encode({ ...content, id }),
        updated_at: timestamp,
      });
  } else {
    id = randomUUID();
    await db('blueprints').insert({
      id,
      name: content.title,
      owner_id: user.id,
      published: content.published,
      version: 1,
      config: encode({ ...content, id }),
      created_at: timestamp,
      updated_at: timestamp,
    });
  }
  return { ...content, id };
}
export async function listBlueprints(db: Knex, user: User) {
  const query = db('blueprints');
  if (user.role === 'student') query.where({ published: true });
  return (await query.orderBy('created_at', 'desc')).map((row) => ({
    ...json(row.config),
    id: row.id,
    published: !!row.published,
    createdAt: row.created_at,
  }));
}
