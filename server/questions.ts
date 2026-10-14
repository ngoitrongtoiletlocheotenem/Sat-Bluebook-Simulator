import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import type { Question, User } from '../shared/types.js';
import { encode, json, now } from './db.js';
import { ApiError, questionSchema } from './validation.js';

export function toQuestion(row: any, reveal = true): Question {
  const q = {
    ...json(row.content),
    id: row.id,
    version: row.version,
    status: row.status,
    ownerId: row.owner_id,
    usageCount: row.usage_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } as Question;
  if (!reveal) {
    delete q.correctAnswer;
    delete q.acceptedAnswers;
    delete q.explanation;
    delete q.hint;
    delete q.strategy;
    delete q.adminNotes;
    q.choices = q.choices.map(({ id, text }) => ({ id, text }));
  }
  return q;
}
export function questionQuery(db: Knex, user: User) {
  return db('questions as q')
    .join('question_versions as v', function () {
      this.on('v.question_id', '=', 'q.id').andOn('v.version', '=', 'q.version');
    })
    .where(function () {
      this.whereNull('q.owner_id').orWhere('q.owner_id', user.id);
    })
    .select('q.*', 'v.content', 'v.id as version_id');
}
export async function findQuestion(db: Knex, user: User, id: string, reveal = true) {
  const row = await questionQuery(db, user).where('q.id', id).first();
  if (!row) throw new ApiError(404, 'Question not found');
  if (user.role === 'student' && row.owner_id !== user.id && row.status !== 'published')
    throw new ApiError(404, 'Question not found');
  const question = toQuestion(row, reveal);
  if (user.role !== 'admin') delete question.adminNotes;
  return { row, question };
}
export async function createQuestion(db: Knex, user: User, input: unknown) {
  const raw = input as any;
  const content = questionSchema.parse({
      ...raw,
      publicId: raw.publicId || `Q-${randomUUID()}`,
      private: raw.scope === 'private' || raw.private,
      adminNotes: user.role === 'admin' ? raw.adminNotes : '',
      ...(raw.type === 'spr' ? { choices: [] } : {}),
    }),
    privateBank = user.role === 'student' || content.private;
  const domain = await db('domains').where({ id: content.domainId, section: content.section }).first();
  const skill = await db('skills').where({ id: content.skillId, domain_id: content.domainId }).first();
  if (!domain || !skill) throw new ApiError(422, 'Domain and skill must match the question section');
  if (await db('questions').where({ public_id: content.publicId }).first())
    throw new ApiError(409, 'Question public identifier already exists');
  const id = randomUUID(),
    timestamp = now();
  await db.transaction(async (trx) => {
    await trx('questions').insert({
      id,
      public_id: content.publicId,
      section: content.section,
      domain_id: content.domainId,
      skill_id: content.skillId,
      difficulty: content.difficulty,
      status: content.status,
      owner_id: privateBank ? user.id : null,
      version: 1,
      created_at: timestamp,
      updated_at: timestamp,
    });
    await trx('question_versions').insert({
      id: randomUUID(),
      question_id: id,
      version: 1,
      content: encode(content),
      created_at: timestamp,
    });
  });
  return (await findQuestion(db, user, id)).question;
}
export async function updateQuestion(db: Knex, user: User, id: string, input: unknown) {
  const { row } = await findQuestion(db, user, id);
  if ((row.owner_id && row.owner_id !== user.id) || (user.role === 'student' && row.owner_id !== user.id))
    throw new ApiError(403, 'Only authorized authors can change this question');
  const raw = input as any,
    content = questionSchema.parse({
      ...raw,
      publicId: raw.publicId || row.public_id,
      adminNotes: user.role === 'admin' ? raw.adminNotes : json<any>(row.content).adminNotes || '',
      ...(raw.type === 'spr' ? { choices: [] } : {}),
    });
  if (
    !(await db('domains').where({ id: content.domainId, section: content.section }).first()) ||
    !(await db('skills').where({ id: content.skillId, domain_id: content.domainId }).first())
  )
    throw new ApiError(422, 'Domain and skill do not match');
  if (await db('questions').where({ public_id: content.publicId }).whereNot({ id }).first())
    throw new ApiError(409, 'Question public identifier already exists');
  await db.transaction(async (trx) => {
    // Optimistic compare-and-swap prevents lost concurrent version updates.
    const ownerId =
      user.role === 'student'
        ? user.id
        : raw.scope === 'private'
          ? user.id
          : raw.scope === 'global'
            ? null
            : row.owner_id;
    const updated = await trx('questions')
      .where({ id, version: row.version })
      .update({
        public_id: content.publicId,
        section: content.section,
        domain_id: content.domainId,
        skill_id: content.skillId,
        difficulty: content.difficulty,
        status: content.status,
        owner_id: ownerId,
        version: row.version + 1,
        updated_at: now(),
      });
    if (!updated) throw new ApiError(409, 'Question changed; reload before saving');
    await trx('question_versions').insert({
      id: randomUUID(),
      question_id: id,
      version: row.version + 1,
      content: encode(content),
      created_at: now(),
    });
  });
  return (await findQuestion(db, user, id)).question;
}
export async function listQuestions(db: Knex, user: User, filters: Record<string, any>) {
  const page = Math.max(1, Number(filters.page) || 1),
    pageSize = Math.max(1, Math.min(100, Number(filters.pageSize) || 20));
  const query = questionQuery(db, user);
  if (user.role === 'student')
    query.where(function () {
      this.where('q.owner_id', user.id).orWhere(function () {
        this.whereNull('q.owner_id').andWhere('q.status', 'published');
      });
    });
  if (filters.status) query.where('q.status', filters.status);
  for (const [input, column] of Object.entries({
    section: 'q.section',
    domainId: 'q.domain_id',
    skillId: 'q.skill_id',
    difficulty: 'q.difficulty',
  }))
    if (filters[input]) query.where(column, String(filters[input]));
  if (filters.scope === 'private') query.where('q.owner_id', user.id);
  else if (filters.scope === 'global') query.whereNull('q.owner_id');
  if (filters.q)
    query.where(function () {
      this.where('q.public_id', 'like', `%${String(filters.q).slice(0, 200)}%`).orWhere(
        'v.content',
        'like',
        `%${String(filters.q).slice(0, 200)}%`,
      );
    });
  if (filters.bookmarked === 'true')
    query.whereIn('q.id', db('bookmarks').where({ user_id: user.id }).select('question_id'));
  const count = await query.clone().clearSelect().count({ total: 'q.id' }).first();
  const rows = await query
    .orderBy('q.created_at', 'desc')
    .orderBy('q.public_id')
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const bookmarks = await db('bookmarks')
    .where({ user_id: user.id })
    .whereIn(
      'question_id',
      rows.map((r) => r.id),
    );
  const items = rows.map((row) => ({
    ...toQuestion(row, true),
    bookmarked: bookmarks.some((b) => b.question_id === row.id),
  }));
  if (user.role !== 'admin')
    items.forEach((q) => {
      delete q.adminNotes;
    });
  return { items, total: Number(count?.total || 0), page, pageSize };
}
