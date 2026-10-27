import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createDatabase, migrate, json } from '../db.js';
import { seed } from '../seed.js';
import { createApp } from '../app.js';
import { createUser } from '../auth.js';
import { emptyResponse } from '../../shared/types.js';
import { parseFile, previewImport, confirmImport, template } from '../imports.js';
import { responseSchema } from '../validation.js';

test('Desmos iframe confines executable evaluation to its public calculator document', async () => {
  const db = createDatabase(':memory:');
  const app = createApp(db);
  const directive = (policy: string, name: string) =>
    policy
      .split(';')
      .map((entry) => entry.trim().split(/\s+/))
      .find(([key]) => key === name)
      ?.slice(1) || [];
  try {
    const main = await request(app).get('/');
    // Before a production build, the root has no static HTML and returns 404.
    // Its document policy must remain strict in either development or production.
    assert([200, 404].includes(main.status));
    const mainPolicy = String(main.headers['content-security-policy']);
    assert(!mainPolicy.includes("'unsafe-eval'"));
    assert(directive(mainPolicy, 'frame-src').includes("'self'"));
    assert.equal(main.headers['cross-origin-resource-policy'], 'same-origin');

    const calculator = await request(app).get('/desmos-calculator.html').expect(200);
    assert.match(calculator.headers['content-type'], /text\/html/);
    const calculatorPolicy = String(calculator.headers['content-security-policy']);
    assert(directive(calculatorPolicy, 'script-src').includes("'unsafe-eval'"));
    assert.deepEqual(directive(calculatorPolicy, 'frame-ancestors'), ["'self'"]);
    assert.deepEqual(directive(calculatorPolicy, 'default-src'), ["'none'"]);
    assert.match(calculator.text, /desmos-calculator\.js/);
    assert.equal(calculator.headers['set-cookie'], undefined);
    assert.equal(calculator.headers['cross-origin-resource-policy'], 'same-origin');

    const childScript = await request(app).get('/desmos-calculator.js').expect(200);
    assert.match(childScript.headers['content-type'], /(?:application|text)\/(?:java|ecma)script/);
    assert(childScript.text.length > 0);
    assert(!String(childScript.headers['content-security-policy']).includes("'unsafe-eval'"));
    assert.equal(childScript.headers['set-cookie'], undefined);
    assert.equal(childScript.headers['cross-origin-resource-policy'], 'cross-origin');
  } finally {
    await db.destroy();
  }
});

test('authenticated adaptive test lifecycle, durable autosave, question versions, results and history', async () => {
  const db = createDatabase(':memory:');
  await migrate(db);
  await seed(db);
  const app = createApp(db),
    agent = request.agent(app);
  try {
    const signup = await agent
        .post('/api/auth/register')
        .send({ name: 'Learner', email: 'learner@example.test', password: 'A strong test password 2026' })
        .expect(201),
      csrf = signup.body.csrfToken,
      user = signup.body.user;
    assert.equal((await agent.get('/api/me').expect(200)).body.user.id, user.id);
    await agent.post('/api/attempts').send({ mode: 'full' }).expect(403);
    await agent
      .post('/api/attempts')
      .set('x-csrf-token', csrf)
      .set('Origin', 'https://evil.example')
      .send({ mode: 'full' })
      .expect(403);
    const initial = (
      await agent
        .post('/api/attempts')
        .set('x-csrf-token', csrf)
        .send({ mode: 'full', seed: 'integration', breakSeconds: 0 })
        .expect(201)
    ).body;
    assert.equal(initial.module.questions.length, 27);
    assert.equal(initial.modules.length, 4);
    assert.equal(initial.module.questions[0].correctAnswer, undefined);
    assert.equal(initial.module.questions[0].choices[0].rationale, undefined);
    assert.equal(initial.modules[1].questions, undefined);
    // Missing revision must fail validation instead of silently reverting to last-write-wins.
    await agent
      .patch(`/api/attempts/${initial.id}`)
      .set('x-csrf-token', csrf)
      .send({ moduleId: initial.module.id, responses: {} })
      .expect(422);
    await agent
      .post(`/api/attempts/${initial.id}/finish-module`)
      .set('x-csrf-token', csrf)
      .send({ moduleId: initial.module.id })
      .expect(422);
    const q = initial.module.questions[0],
      response = {
        ...emptyResponse(),
        answer: 'A',
        marked: true,
        eliminated: ['B'],
        note: 'Check the supporting evidence',
        highlights: [
          { id: 'h', field: 'passage', start: 0, end: 4, text: q.passage.slice(0, 4), underline: true },
          {
            id: 'empty-attached-note',
            field: 'passage',
            start: 0,
            end: 4,
            text: q.passage.slice(0, 4),
            note: '',
            noteAttached: true,
          },
          {
            id: 'detached-note',
            field: 'stem',
            start: 0,
            end: 4,
            text: q.stem.slice(0, 4),
            note: 'Previously attached note',
            noteAttached: false,
          },
          {
            id: 'legacy-note',
            field: 'stem',
            start: 0,
            end: 4,
            text: q.stem.slice(0, 4),
            note: 'Legacy annotation without an attachment flag',
          },
          {
            id: 'legacy-style',
            field: 'stem',
            start: 0,
            end: 4,
            text: q.stem.slice(0, 4),
            style: 'underline',
          },
          ...(['none', 'solid', 'dashed', 'dotted'] as const).map((underlineStyle, index) => ({
            id: `style-${underlineStyle}`,
            field: 'passage',
            start: index * 4,
            end: index * 4 + 4,
            text: q.passage.slice(index * 4, index * 4 + 4),
            underlineStyle,
            color: index % 2 === 0 ? 'yellow' : 'blue',
          })),
        ],
      };
    const legacyHighlight = responseSchema.parse({
      highlights: [{ id: 'old', start: 0, end: 4, text: 'Text' }],
    });
    assert.equal(legacyHighlight.highlights![0]!.underlineStyle, undefined);
    assert.equal(legacyHighlight.highlights![0]!.noteAttached, undefined);
    assert.deepEqual(
      responseSchema.parse({ highlights: response.highlights }).highlights!.map((h) => ({
        id: h.id,
        note: h.note,
        noteAttached: h.noteAttached,
      })),
      response.highlights.map((h) => ({
        id: h.id,
        note: 'note' in h ? h.note : undefined,
        noteAttached: 'noteAttached' in h ? h.noteAttached : undefined,
      })),
    );
    assert.deepEqual(
      responseSchema.parse({ highlights: response.highlights }).highlights!.map((h) => h.underlineStyle),
      response.highlights.map((h) => ('underlineStyle' in h ? h.underlineStyle : undefined)),
    );
    await agent
      .patch(`/api/attempts/${initial.id}`)
      .set('x-csrf-token', csrf)
      .send({
        expectedRevision: initial.revision,
        moduleId: initial.module.id,
        currentQuestion: 2,
        responses: { [q.id]: response },
      })
      .expect(200);
    const resumed = (await agent.get(`/api/attempts/${initial.id}`).expect(200)).body;
    assert.equal(resumed.currentQuestion, 2);
    assert.equal(resumed.responses[q.id].note, response.note);
    assert.equal(resumed.responses[q.id].highlights[0].field, 'passage');
    assert.equal(resumed.responses[q.id].highlights[0].underline, true);
    assert.deepEqual(resumed.responses[q.id].highlights, response.highlights);
    await agent
      .patch(`/api/attempts/${initial.id}`)
      .set('x-csrf-token', csrf)
      .send({
        expectedRevision: resumed.revision,
        moduleId: initial.module.id,
        responses: {
          [q.id]: { ...response, highlights: [{ ...response.highlights[0], underlineStyle: 'wavy' }] },
        },
      })
      .expect(422);
    assert.deepEqual(
      (await agent.get(`/api/attempts/${initial.id}`).expect(200)).body.responses[q.id].highlights,
      response.highlights,
    );
    await agent
      .post(`/api/attempts/${initial.id}/pause`)
      .set('x-csrf-token', csrf)
      .send({ expectedRevision: resumed.revision })
      .expect(409);
    const second = (
      await agent
        .post(`/api/attempts/${initial.id}/finish-module`)
        .set('x-csrf-token', csrf)
        .send({ expectedRevision: resumed.revision, moduleId: initial.module.id })
        .expect(200)
    ).body;
    assert.equal(second.module.route, 'lower');
    assert.equal(second.routes.rw, 'lower');
    await agent
      .patch(`/api/attempts/${initial.id}`)
      .set('x-csrf-token', csrf)
      .send({
        expectedRevision: second.revision,
        moduleId: initial.module.id,
        responses: { [q.id]: response },
      })
      .expect(409);
    await agent
      .post(`/api/attempts/${initial.id}/finish-module`)
      .set('x-csrf-token', csrf)
      .send({ expectedRevision: second.revision, moduleId: initial.module.id })
      .expect(409);
    let current = second;
    for (let i = 0; i < 3; i++)
      current = (
        await agent
          .post(`/api/attempts/${initial.id}/finish-module`)
          .set('x-csrf-token', csrf)
          .send({ expectedRevision: current.revision, moduleId: current.module.id })
          .expect(200)
      ).body;
    assert.equal(current.status, 'completed');
    const result = (await agent.get(`/api/attempts/${initial.id}/result`).expect(200)).body;
    assert.equal(result.total, 98);
    assert.equal(result.domains.length, 8);
    assert.equal(result.review.length, 98);
    assert.deepEqual(
      result.review.find((item: any) => item.question.id === q.id).response.highlights,
      response.highlights,
    );
    assert.equal(result.scoreLabel, 'Estimated SAT Score');
    assert(result.totalScore >= 400 && result.totalScore <= 1600);
    assert(result.review.every((r: any) => r.question.explanation));
    assert.equal((await agent.get('/api/history').expect(200)).body.length, 1);
    assert((await agent.get('/api/errors').expect(200)).body.total >= 97);
    assert.equal((await agent.get('/api/dashboard').expect(200)).body.history.length, 1);
    const other = request.agent(app);
    await other
      .post('/api/auth/register')
      .send({ name: 'Other', email: 'other@example.test', password: 'Another long test password' })
      .expect(201);
    await other.get(`/api/attempts/${initial.id}`).expect(404);
    await other.get(`/api/attempts/${initial.id}/result`).expect(404);
    await agent
      .put(`/api/questions/${q.id}`)
      .set('x-csrf-token', csrf)
      .send({ ...q, license: 'CC0', explanation: 'E', correctAnswer: 'A' })
      .expect(403);
    const admin = await createUser(
        db,
        { name: 'Admin', email: 'admin@example.test', password: 'An original admin password' },
        'admin',
      ),
      adminAgent = request.agent(app),
      login = await adminAgent
        .post('/api/auth/login')
        .send({ email: admin.email, password: 'An original admin password' })
        .expect(200),
      adminCsrf = login.body.csrfToken;
    const original = (await adminAgent.get(`/api/questions/${q.id}`).expect(200)).body;
    const changed = (
      await adminAgent
        .put(`/api/questions/${q.id}`)
        .set('x-csrf-token', adminCsrf)
        .send({ ...original, stem: 'An updated, original question stem.', explanation: 'A new explanation.' })
        .expect(200)
    ).body;
    assert.equal(changed.version, 2);
    const historical = (await agent.get(`/api/attempts/${initial.id}/result`).expect(200)).body.review.find(
      (r: any) => r.question.id === q.id,
    );
    assert.equal(historical.question.stem, original.stem);
    assert.equal(historical.question.version, 1);
    await adminAgent.delete(`/api/questions/${q.id}`).set('x-csrf-token', adminCsrf).expect(200);
    await agent.get(`/api/questions/${q.id}`).expect(404);
    const persisted = await db('score_results').where({ attempt_id: initial.id }).first();
    assert.equal(json<any>(persisted.report).total, 98);
    await agent
      .put('/api/taxonomy')
      .set('x-csrf-token', csrf)
      .send({ skills: [{ id: 'new-skill', domainId: 'math-algebra', name: 'Private addition' }] })
      .expect(403);
    const taxonomy = (
      await adminAgent
        .put('/api/taxonomy')
        .set('x-csrf-token', adminCsrf)
        .send({
          domains: [
            {
              id: 'math-extension',
              section: 'math',
              name: 'Additional Math Study',
              percentage: 0,
              questionRange: 'Custom',
            },
          ],
          skills: [{ id: 'math-extension-1', domainId: 'math-extension', name: 'Original extension skill' }],
        })
        .expect(200)
    ).body;
    assert(
      taxonomy.some(
        (d: any) => d.id === 'math-extension' && d.skills.some((s: any) => s.id === 'math-extension-1'),
      ),
    );
    await adminAgent
      .put('/api/taxonomy')
      .set('x-csrf-token', adminCsrf)
      .send({
        domains: [
          {
            id: 'math-algebra',
            section: 'rw',
            name: 'Wrong section',
            percentage: 35,
            questionRange: '13–15',
          },
        ],
      })
      .expect(409);
  } finally {
    await db.destroy();
  }
});

test('server deadlines reject late saves and synchronize break/modules without extra offline time', async () => {
  const db = createDatabase(':memory:');
  await migrate(db);
  await seed(db);
  const app = createApp(db),
    agent = request.agent(app);
  try {
    const registered = (
        await agent
          .post('/api/auth/register')
          .send({ name: 'Timed', email: 'timer@example.test', password: 'A secure timing password' })
          .expect(201)
      ).body,
      csrf = registered.csrfToken;
    let a = (
      await agent
        .post('/api/attempts')
        .set('x-csrf-token', csrf)
        .send({ mode: 'full', breakSeconds: 600 })
        .expect(201)
    ).body;
    const q = a.module.questions[0];
    await db('module_attempts')
      .where({ id: a.module.id })
      .update({ deadline: new Date(Date.now() - 1000).toISOString() });
    await agent
      .patch(`/api/attempts/${a.id}`)
      .set('x-csrf-token', csrf)
      .send({
        expectedRevision: a.revision,
        moduleId: a.module.id,
        responses: { [q.id]: { ...emptyResponse(), answer: 'A' } },
      })
      .expect(409);
    a = (await agent.get(`/api/attempts/${a.id}`).expect(200)).body;
    assert.equal(a.currentModule, 1);
    assert.equal(a.routes.rw, 'lower');
    a = (
      await agent
        .post(`/api/attempts/${a.id}/finish-module`)
        .set('x-csrf-token', csrf)
        .send({ expectedRevision: a.revision, moduleId: a.module.id })
        .expect(200)
    ).body;
    assert.equal(a.status, 'break');
    assert.equal(a.module, null);
    const breakDeadline = a.breakUntil;
    await db('attempts')
      .where({ id: a.id })
      .update({ break_until: new Date(Date.now() - 1000).toISOString() });
    a = (await agent.get(`/api/attempts/${a.id}`).expect(200)).body;
    assert.equal(a.module.section, 'math');
    assert.equal(a.status, 'active');
    assert(breakDeadline);
    const moduleId = a.module.id;
    const submits = await Promise.all([
      agent
        .post(`/api/attempts/${a.id}/finish-module`)
        .set('x-csrf-token', csrf)
        .send({ moduleId, expectedRevision: a.revision }),
      agent
        .post(`/api/attempts/${a.id}/finish-module`)
        .set('x-csrf-token', csrf)
        .send({ moduleId, expectedRevision: a.revision }),
    ]);
    assert.deepEqual(submits.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await agent.get(`/api/attempts/${a.id}`).expect(200)).body.currentModule, 3);
  } finally {
    await db.destroy();
  }
});

test('question imports validate previews, detect duplicates, map columns, and restore CSV/XLSX/JSON', async () => {
  const db = createDatabase(':memory:');
  await migrate(db);
  await seed(db);
  try {
    const user = await createUser(
      db,
      { name: 'Teacher', email: 'teacher@example.test', password: 'A long teacher password' },
      'teacher',
    );
    const csv = await template('csv'),
      parsed = await parseFile(csv.data, csv.filename);
    assert.equal(parsed.length, 1);
    const preview = await previewImport(
      db,
      user,
      [...parsed, { ...parsed[0] }, { ...parsed[0], publicId: 'BAD', correctAnswer: 'Z' }],
      {},
      'global',
    );
    assert.equal(preview.valid, 1);
    assert.equal(preview.duplicates, 2);
    assert.equal(preview.invalid, 1);
    const report = await confirmImport(db, user, preview.id);
    assert.equal(report.imported, 1);
    assert.equal(report.skipped, 2);
    assert.equal(report.errors.length, 1);
    assert.deepEqual(await confirmImport(db, user, preview.id), report);
    const xlsx = await template('xlsx');
    assert.equal((await parseFile(xlsx.data, xlsx.filename))[0]!.publicId, 'YOUR-001');
    const jsonTemplate = await template('json');
    assert.equal((await parseFile(jsonTemplate.data, jsonTemplate.filename)).length, 1);
    const row = { ...parsed[0], ID: 'MAPPED-002', stem: 'A new custom stem', publicId: undefined };
    const mapped = await previewImport(db, user, [row], { publicId: 'ID' }, 'private');
    assert.equal(mapped.valid, 1);
    await confirmImport(db, user, mapped.id);
    assert.equal((await db('questions').where({ public_id: 'MAPPED-002' }).first()).owner_id, user.id);
    const malformed = await previewImport(
      db,
      user,
      [{ ...parsed[0], publicId: 'MALFORMED', choices: { incorrect: 'object' } }],
      {},
      'private',
    );
    assert.equal(malformed.invalid, 1);
    assert.equal((await confirmImport(db, user, malformed.id)).imported, 0);
  } finally {
    await db.destroy();
  }
});

test('manual and random test blueprints, private bank permissions, tutor feedback and practice pause', async () => {
  const db = createDatabase(':memory:');
  await migrate(db);
  await seed(db);
  const app = createApp(db),
    agent = request.agent(app);
  try {
    const registered = (
        await agent
          .post('/api/auth/register')
          .send({ name: 'Student', email: 'practice@example.test', password: 'A unique practice password' })
          .expect(201)
      ).body,
      csrf = registered.csrfToken;
    const items = (await agent.get('/api/questions?section=math&pageSize=5').expect(200)).body.items;
    const privateQ = (
      await agent
        .post('/api/questions')
        .set('x-csrf-token', csrf)
        .send({ ...items[0], publicId: 'PRIVATE-ONE', stem: 'My original private problem', private: true })
        .expect(201)
    ).body;
    assert.equal(privateQ.ownerId, registered.user.id);
    const draft = (
      await agent
        .post('/api/questions')
        .set('x-csrf-token', csrf)
        .send({
          ...privateQ,
          publicId: 'MY-DRAFT',
          stem: 'My unpublished original problem',
          status: 'draft',
          scope: 'private',
        })
        .expect(201)
    ).body;
    assert(
      (await agent.get('/api/questions?scope=private').expect(200)).body.items.some(
        (q: any) => q.id === draft.id,
      ),
    );
    await agent
      .put('/api/profile')
      .set('x-csrf-token', csrf)
      .send({ name: 'Updated student', targetScore: 1400 })
      .expect(200);
    assert.equal((await agent.get('/api/me').expect(200)).body.user.targetScore, 1400);
    await agent.get('/api/statistics').expect(403);
    const rwQuestion = (await agent.get('/api/questions?section=rw&pageSize=1').expect(200)).body.items[0];
    let mixed = (
      await agent
        .post('/api/attempts')
        .set('x-csrf-token', csrf)
        .send({ mode: 'practice', questionIds: [privateQ.id, rwQuestion.id] })
        .expect(201)
    ).body;
    assert.equal(mixed.modules.length, 2);
    assert.equal(mixed.module.section, 'rw');
    assert.equal(mixed.module.questions[0].id, rwQuestion.id);
    mixed = (
      await agent
        .post(`/api/attempts/${mixed.id}/finish-module`)
        .set('x-csrf-token', csrf)
        .send({ expectedRevision: mixed.revision, moduleId: mixed.module.id })
        .expect(200)
    ).body;
    assert.equal(mixed.status, 'active');
    assert.equal(mixed.module.section, 'math');
    assert.equal(mixed.module.questions[0].id, privateQ.id);
    await agent.post('/api/blueprints').set('x-csrf-token', csrf).send({}).expect(403);
    const untimed = (
      await agent
        .post('/api/attempts')
        .set('x-csrf-token', csrf)
        .send({ mode: 'practice', count: 2, section: 'math' })
        .expect(201)
    ).body;
    assert.equal(untimed.module.durationSeconds, 0);
    assert.equal(untimed.module.deadline, undefined);
    let practice = (
      await agent
        .post('/api/attempts')
        .set('x-csrf-token', csrf)
        .send({ mode: 'tutor', questionIds: [privateQ.id], count: 1, section: 'math', timedSeconds: 600 })
        .expect(201)
    ).body;
    const feedback = (
      await agent
        .post(`/api/attempts/${practice.id}/tutor`)
        .set('x-csrf-token', csrf)
        .send({
          expectedRevision: practice.revision,
          questionId: privateQ.id,
          response: {
            ...emptyResponse(),
            answer: privateQ.type === 'mcq' ? privateQ.correctAnswer : privateQ.acceptedAnswers[0],
          },
        })
        .expect(200)
    ).body;
    assert.equal(feedback.correct, true);
    assert(feedback.question.explanation);
    practice = (
      await agent
        .post(`/api/attempts/${practice.id}/pause`)
        .set('x-csrf-token', csrf)
        .send({ expectedRevision: feedback.revision })
        .expect(200)
    ).body;
    assert.equal(practice.status, 'paused');
    const remaining = practice.remainingSeconds;
    practice = (
      await agent
        .post(`/api/attempts/${practice.id}/resume`)
        .set('x-csrf-token', csrf)
        .send({ expectedRevision: practice.revision })
        .expect(200)
    ).body;
    assert.equal(practice.status, 'active');
    assert(practice.remainingSeconds >= remaining - 1);
    const teacher = await createUser(
        db,
        { name: 'Author', email: 'author@example.test', password: 'A unique author password' },
        'teacher',
      ),
      teacherAgent = request.agent(app),
      login = (
        await teacherAgent
          .post('/api/auth/login')
          .send({ email: teacher.email, password: 'A unique author password' })
          .expect(200)
      ).body;
    const stats = (await teacherAgent.get('/api/statistics').expect(200)).body;
    assert.equal(stats.summary.students, 1);
    assert.equal(stats.summary.sharedQuestions, 352);
    assert(!stats.questions.some((q: any) => q.id === privateQ.id));
    assert.equal(stats.students[0].latestScore, null);
    const blueprint = {
      title: 'Manual module',
      description: 'Original practice',
      kind: 'custom',
      published: true,
      seed: 'manual-seed',
      routingThreshold: 0.7,
      routingModelVersion: 'accuracy-threshold-v1',
      modules: [
        {
          section: 'math',
          index: 1,
          route: 'mixed',
          count: 2,
          durationSeconds: 60,
          questionIds: items.slice(1, 3).map((q: any) => q.id),
        },
      ],
    };
    const saved = (
      await teacherAgent
        .post('/api/blueprints')
        .set('x-csrf-token', login.csrfToken)
        .send(blueprint)
        .expect(201)
    ).body;
    const manual = (
      await agent
        .post('/api/attempts')
        .set('x-csrf-token', csrf)
        .send({ mode: 'practice', blueprintId: saved.id })
        .expect(201)
    ).body;
    assert.deepEqual(
      manual.module.questions.map((q: any) => q.id),
      blueprint.modules[0]!.questionIds,
    );
    const random = (
      await teacherAgent
        .post('/api/blueprints')
        .set('x-csrf-token', login.csrfToken)
        .send({
          ...blueprint,
          title: 'Random module',
          modules: [{ ...blueprint.modules[0], questionIds: [] }],
        })
        .expect(201)
    ).body;
    const generated = (
      await agent
        .post('/api/attempts')
        .set('x-csrf-token', csrf)
        .send({ mode: 'practice', blueprintId: random.id, seed: 'repeat' })
        .expect(201)
    ).body;
    assert.equal(generated.module.questions.length, 2);
  } finally {
    await db.destroy();
  }
});
