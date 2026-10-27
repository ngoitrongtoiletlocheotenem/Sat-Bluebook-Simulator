import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import request from 'supertest';
import { createApp } from '../app.js';
import { createDatabase, migrate, SCHEMA_VERSION } from '../db.js';
import { createUser } from '../auth.js';
import type { QuestionAsset } from '../../shared/types.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSf8AAAAASUVORK5CYII=',
  'base64',
);
const jpeg = Buffer.from([255, 216, 255, 224, 0, 2, 255, 217]);
const webp = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');

test('asset migration upgrades version 1 without replacing existing data and is idempotent', async () => {
  const db = createDatabase(':memory:');
  try {
    await migrate(db);
    const user = await createUser(db, {
      name: 'Existing owner',
      email: 'existing-assets@example.test',
      password: 'A long asset test password',
    });
    const version1 = await db('schema_migrations').where({ version: 1 }).first();
    // Recreate the exact version-1 schema state of an existing installation.
    for (const [table, name] of [
      ['sessions', 'sessions_user_idx'],
      ['score_results', 'results_user_created_idx'],
      ['error_logs', 'errors_user_created_idx'],
      ['attempts', 'attempts_user_started_idx'],
      ['responses', 'responses_question_idx'],
    ])
      await db.schema.alterTable(table, (t) => t.dropIndex([], name));
    for (const table of ['score_results', 'error_logs', 'attempts'])
      await db.schema.alterTable(table, (t) => t.index(['user_id']));
    await db.schema.dropTable('question_assets');
    await db('schema_migrations').where('version', '>', 1).delete();
    await migrate(db);
    await migrate(db);
    assert(await db.schema.hasTable('question_assets'));
    assert.deepEqual(await db('schema_migrations').where({ version: 1 }).first(), version1);
    assert.equal((await db('users').where({ id: user.id }).first()).email, user.email);
    assert.deepEqual(
      (await db('schema_migrations').orderBy('version')).map((row) => row.version),
      Array.from({ length: SCHEMA_VERSION }, (_, i) => i + 1),
    );
    assert.equal((await db('question_assets')).length, 0);
  } finally {
    await db.destroy();
  }
});

test('uploaded image metadata is owner-only, paginated, validated and backed by unchanged bytes', async (t) => {
  const previousDirectory = process.env.UPLOAD_DIR;
  const directory = mkdtempSync(join(tmpdir(), 'pathwise-assets-'));
  process.env.UPLOAD_DIR = directory;
  const db = createDatabase(':memory:');
  try {
    await migrate(db);
    const app = createApp(db);
    const alice = request.agent(app);
    const bob = request.agent(app);
    const register = async (agent: ReturnType<typeof request.agent>, name: string) =>
      (
        await agent.post('/api/auth/register').send({
          name,
          email: `${name.toLowerCase()}@asset-library.test`,
          password: 'A long asset test password',
        })
      ).body.csrfToken as string;
    const aliceToken = await register(alice, 'Alice');
    const bobToken = await register(bob, 'Bob');
    let chart: QuestionAsset;
    let diagram: QuestionAsset;

    await t.test('requires authentication and CSRF before accepting uploads', async () => {
      await request(app).get('/api/assets').expect(401);
      await request(app).post('/api/assets').attach('file', png, 'chart.png').expect(401);
      await alice.post('/api/assets').attach('file', png, 'chart.png').expect(403);
      await alice
        .post('/api/assets')
        .set('x-csrf-token', aliceToken)
        .set('Origin', 'https://elsewhere.example')
        .attach('file', png, 'chart.png')
        .expect(403);
      assert.deepEqual(readdirSync(directory), []);
    });

    await t.test(
      'records detected formats and normalized names and serves original image bytes',
      async () => {
        chart = (
          await alice
            .post('/api/assets')
            .set('x-csrf-token', aliceToken)
            .attach('file', png, { filename: 'C:\\fakepath\\chart.png', contentType: 'text/plain' })
            .expect(201)
        ).body;
        assert.equal(chart.name, 'chart.png');
        assert.equal(chart.mimeType, 'image/png');
        assert.equal(chart.size, png.length);
        assert.equal(chart.url, `/uploads/${chart.id}.png`);
        assert(Number.isFinite(Date.parse(chart.createdAt)));
        assert.deepEqual(Object.keys(chart).sort(), ['createdAt', 'id', 'mimeType', 'name', 'size', 'url']);
        const retrieved = await request(app).get(chart.url).expect(200);
        assert.match(retrieved.headers['content-type'], /image\/png/);
        assert.deepEqual(retrieved.body, png);

        diagram = (
          await alice
            .post('/api/assets')
            .set('x-csrf-token', aliceToken)
            .attach('file', webp, `${'a'.repeat(270)}.webp`)
            .expect(201)
        ).body;
        assert.equal(diagram.name.length, 255);
        assert.equal(diagram.mimeType, 'image/webp');
        assert.deepEqual((await request(app).get(diagram.url).expect(200)).body, webp);
        const photo = (
          await bob
            .post('/api/assets')
            .set('x-csrf-token', bobToken)
            .attach('file', jpeg, 'đồ-thị.jpeg')
            .expect(201)
        ).body as QuestionAsset;
        assert.equal(photo.name, 'đồ-thị.jpeg');
        assert.equal(photo.mimeType, 'image/jpeg');
        assert.match(photo.url, /\.jpg$/);
        assert.deepEqual((await request(app).get(photo.url).expect(200)).body, jpeg);
      },
    );

    await t.test(
      'lists only the signed-in owner across app instances and never claims legacy files',
      async () => {
        writeFileSync(join(directory, 'legacy-chart.png'), png);
        const mine = (await alice.get('/api/assets').expect(200)).body;
        assert.equal(mine.total, 2);
        assert.equal(mine.page, 1);
        assert.equal(mine.pageSize, 50);
        assert.deepEqual(
          new Set(mine.items.map((item: QuestionAsset) => item.id)),
          new Set([chart.id, diagram.id]),
        );
        assert(mine.items.every((item: QuestionAsset) => !('owner_id' in item)));
        const theirs = (await bob.get('/api/assets').expect(200)).body;
        assert.equal(theirs.total, 1);
        assert.equal(theirs.items[0].name, 'đồ-thị.jpeg');
        assert.equal((await alice.get('/api/assets?owner_id=someone-else').expect(200)).body.total, 2);
        assert.deepEqual((await request(app).get('/uploads/legacy-chart.png').expect(200)).body, png);

        const restarted = request.agent(createApp(db));
        await restarted
          .post('/api/auth/login')
          .send({
            email: 'alice@asset-library.test',
            password: 'A long asset test password',
          })
          .expect(200);
        assert.equal((await restarted.get('/api/assets').expect(200)).body.total, 2);

        const first = (await alice.get('/api/assets?page=1&pageSize=1').expect(200)).body;
        const second = (await alice.get('/api/assets?page=2&pageSize=1').expect(200)).body;
        assert.equal(first.total, 2);
        assert.equal(first.pageSize, 1);
        assert.equal(first.items.length, 1);
        assert.equal(second.page, 2);
        assert.equal(second.items.length, 1);
        assert.notEqual(first.items[0].id, second.items[0].id);
        assert.deepEqual((await alice.get('/api/assets?page=3&pageSize=1').expect(200)).body.items, []);
        for (const query of ['page=0', 'page=1.5', 'page=1000001', 'pageSize=0', 'pageSize=101', 'page=no'])
          await alice.get(`/api/assets?${query}`).expect(422);
      },
    );

    await t.test(
      'rejects unsupported, missing, multiple and oversized files without creating assets',
      async () => {
        const before = readdirSync(directory).sort();
        await alice.post('/api/assets').set('x-csrf-token', aliceToken).expect(400);
        await alice
          .post('/api/assets')
          .set('x-csrf-token', aliceToken)
          .attach('file', Buffer.from('<svg></svg>'), 'chart.png')
          .expect(415);
        await alice
          .post('/api/assets')
          .set('x-csrf-token', aliceToken)
          .attach('file', Buffer.alloc(5 * 1024 * 1024 + 1), 'too-large.png')
          .expect(413);
        await alice
          .post('/api/assets')
          .set('x-csrf-token', aliceToken)
          .attach('file', png, 'one.png')
          .attach('file', png, 'two.png')
          .expect(400);
        assert.equal((await alice.get('/api/assets').expect(200)).body.total, 2);
        assert.deepEqual(readdirSync(directory).sort(), before);
      },
    );

    await t.test('removes the newly written file when metadata cannot be saved', async () => {
      const before = readdirSync(directory).sort();
      await db.schema.dropTable('question_assets');
      await alice
        .post('/api/assets')
        .set('x-csrf-token', aliceToken)
        .attach('file', png, 'cannot-save.png')
        .expect(500);
      assert.deepEqual(readdirSync(directory).sort(), before);
    });
  } finally {
    await db.destroy();
    if (previousDirectory === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = previousDirectory;
    // Only remove the dedicated temporary directory created above.
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert(directory.startsWith(join(tmpdir(), 'pathwise-assets-')));
    rmSync(directory, { recursive: true, force: true });
  }
});
