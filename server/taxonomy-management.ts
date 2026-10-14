import type { Knex } from 'knex';
import { z } from 'zod';
import type { Domain } from '../shared/types.js';
import { ApiError } from './validation.js';
const identifier = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers and hyphens');
const schema = z.object({
  domains: z
    .array(
      z.object({
        id: identifier,
        section: z.enum(['rw', 'math']),
        name: z.string().trim().min(1).max(200),
        percentage: z.number().int().min(0).max(100),
        questionRange: z.string().max(100),
      }),
    )
    .max(100)
    .optional(),
  skills: z
    .array(z.object({ id: identifier, domainId: identifier, name: z.string().trim().min(1).max(300) }))
    .max(500)
    .optional(),
});
export async function loadTaxonomy(db: Knex): Promise<Domain[]> {
  const domains = await db('domains').orderBy('position'),
    skills = await db('skills');
  return domains.map((d) => ({
    id: d.id,
    section: d.section,
    name: d.name,
    percentage: d.percentage,
    questionRange: d.question_range,
    skills: skills
      .filter((s) => s.domain_id === d.id)
      .map((s) => ({ id: s.id, domainId: s.domain_id, name: s.name })),
  }));
}
export async function updateTaxonomy(db: Knex, input: unknown) {
  const change = schema.parse(input);
  if (!change.domains?.length && !change.skills?.length)
    throw new ApiError(422, 'Provide domains or skills to save');
  await db.transaction(async (trx) => {
    for (const d of change.domains || []) {
      const existing = await trx('domains').where({ id: d.id }).first();
      if (
        existing &&
        existing.section !== d.section &&
        (await trx('questions').where({ domain_id: d.id }).first())
      )
        throw new ApiError(409, 'A domain in use cannot change section; create a new domain instead');
      const position =
        existing?.position ??
        Number((await trx('domains').max({ position: 'position' }).first())?.position ?? -1) + 1;
      await trx('domains')
        .insert({
          id: d.id,
          section: d.section,
          name: d.name,
          percentage: d.percentage,
          question_range: d.questionRange,
          position,
        })
        .onConflict('id')
        .merge({
          section: d.section,
          name: d.name,
          percentage: d.percentage,
          question_range: d.questionRange,
        });
    }
    for (const s of change.skills || []) {
      if (!(await trx('domains').where({ id: s.domainId }).first()))
        throw new ApiError(422, 'Skill domain does not exist');
      const existing = await trx('skills').where({ id: s.id }).first();
      if (
        existing &&
        existing.domain_id !== s.domainId &&
        (await trx('questions').where({ skill_id: s.id }).first())
      )
        throw new ApiError(409, 'A skill in use cannot move domains; create a new skill instead');
      await trx('skills')
        .insert({ id: s.id, domain_id: s.domainId, name: s.name })
        .onConflict('id')
        .merge({ domain_id: s.domainId, name: s.name });
    }
  });
  return loadTaxonomy(db);
}
