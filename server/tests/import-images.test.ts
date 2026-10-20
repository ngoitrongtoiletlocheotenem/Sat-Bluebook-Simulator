import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../app.js';
import { createDatabase, migrate } from '../db.js';
import { seed } from '../seed.js';
import type { ImportPreview } from '../../shared/types.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64',
);
function question(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  return {
    publicId: `MANUAL-IMAGE-${id}`,
    section: 'math',
    domainId: 'math-algebra',
    skillId: 'math-algebra-1',
    type: 'mcq',
    difficulty: 'easy',
    stem: `What is 2 + 2? Original manual image test ${id}.`,
    choiceA: '4',
    choiceB: '3',
    choiceC: '5',
    choiceD: '6',
    correctAnswer: 'A',
    explanation: 'Adding two and two gives four.',
    source: 'Original test authors',
    license: 'CC0-1.0; original question fixture',
    images: [],
    ...overrides,
  };
}

test('import images are repaired on their question rows before confirmation', async (t) => {
  const previousDirectory = process.env.UPLOAD_DIR;
  const directory = mkdtempSync(join(tmpdir(), 'pathwise-import-images-'));
  process.env.UPLOAD_DIR = directory;
  const db = createDatabase(':memory:');
  try {
    await migrate(db);
    await seed(db);
    const app = createApp(db);
    const owner = request.agent(app);
    const stranger = request.agent(app);
    const register = async (agent: ReturnType<typeof request.agent>, name: string) =>
      (
        await agent
          .post('/api/auth/register')
          .send({
            name,
            email: `${name}@manual-images.test`,
            password: 'An original manual image test password',
          })
          .expect(201)
      ).body.csrfToken as string;
    const token = await register(owner, 'owner');
    const strangerToken = await register(stranger, 'stranger');
    const beforeCount = (await db('questions')).length;
    const preview = async (rows: unknown[]) =>
      (
        await owner
          .post('/api/imports/preview')
          .set('x-csrf-token', token)
          .field('scope', 'private')
          .attach('file', Buffer.from(JSON.stringify(rows)), 'questions.json')
          .expect(200)
      ).body as ImportPreview;
    const patch = (id: string, row: number, images: unknown) =>
      owner.patch(`/api/imports/${id}/rows/${row}/images`).set('x-csrf-token', token).send({ images });

    await t.test(
      'detects supplied image failures without requiring images on ordinary questions',
      async () => {
        const result = await preview([
          question({ images: ['/uploads/missing.png'] }),
          question({ images: ['data:image/png;base64,AAAA'] }),
          question({ images: ['/uploads/../outside.png'] }),
          question({ images: ['https://'] }),
          question({ images: ['/assets/seedling-chart.svg'] }),
          question({ images: ['https://remote-image.example.invalid/figure.png'] }),
          question(),
        ]);
        assert.equal(result.valid, 3);
        assert.equal(result.invalid, 4);
        for (const row of result.rows.slice(0, 4)) {
          assert(row.imageErrors?.length);
          assert(row.imageErrors.every((error) => row.errors.includes(error)));
        }
        assert.match(result.rows[2]!.imageErrors!.join(' '), /inside/);
        for (const row of result.rows.slice(4)) assert.deepEqual(row.imageErrors, []);
        assert.equal((await db('questions')).length, beforeCount);
      },
    );

    await t.test('upload and row patch preserve content, errors, duplicate decisions and scope', async () => {
      const missing = question({ images: ['/uploads/not-here.png'] });
      const otherErrors = question({
        images: ['file:///C:/Pictures/graph.png'],
        domainId: 'unrecognized-domain',
        skillId: 'unrecognized-skill',
        explanation: '',
        choiceD: '',
        correctAnswer: 'Z',
      });
      const original = await preview([missing, otherErrors, question(), { ...missing }]);
      assert.equal(original.valid, 1);
      assert.equal(original.invalid, 3);
      assert.equal(original.duplicates, 1);
      const upload = (
        await owner
          .post('/api/assets')
          .set('x-csrf-token', token)
          .attach('file', png, 'manual-figure.png')
          .expect(201)
      ).body;
      const repaired = (await patch(original.id, 2, [upload.url]).expect(200)).body as ImportPreview;
      assert.equal(repaired.id, original.id);
      assert.equal(repaired.valid, 2);
      assert.equal(repaired.invalid, 2);
      assert.equal(repaired.duplicates, 1);
      assert.deepEqual(repaired.rows[0]!.imageErrors, []);
      assert.deepEqual(repaired.rows[0]!.question, { ...original.rows[0]!.question, images: [upload.url] });
      assert.deepEqual(repaired.rows.slice(1), original.rows.slice(1));
      assert.equal((await db('questions')).length, beforeCount);

      const stillInvalid = (await patch(original.id, 3, [upload.url]).expect(200)).body as ImportPreview;
      assert.deepEqual(stillInvalid.rows[1]!.question, {
        ...original.rows[1]!.question,
        images: [upload.url],
      });
      assert.deepEqual(
        stillInvalid.rows[1]!.errors,
        original.rows[1]!.errors.filter((error) => !original.rows[1]!.imageErrors!.includes(error)),
      );
      assert.equal((stillInvalid.rows[1]!.question as any).private, true);
      const duplicate = (await patch(original.id, 5, [upload.url]).expect(200)).body as ImportPreview;
      assert.equal(duplicate.rows[3]!.duplicate, true);
      assert.equal(duplicate.valid, 2);
      assert.equal(duplicate.invalid, 1);
      assert.equal(duplicate.duplicates, 1);

      await stranger
        .patch(`/api/imports/${original.id}/rows/2/images`)
        .set('x-csrf-token', strangerToken)
        .send({ images: [] })
        .expect(404);
      await owner.patch(`/api/imports/${original.id}/rows/2/images`).send({ images: [] }).expect(403);
      await patch(original.id, 999, []).expect(404);
      for (const invalid of ['not-an-array', [123], new Array(11).fill(upload.url), ['javascript:alert(1)']])
        await patch(original.id, 2, invalid).expect(422);
      await owner
        .patch(`/api/imports/${original.id}/rows/2/images`)
        .set('x-csrf-token', token)
        .send({ images: [upload.url], stem: 'Do not change content' })
        .expect(422);
      assert.equal((await db('questions')).length, beforeCount);
      const report = (
        await owner
          .post(`/api/imports/${original.id}/confirm`)
          .set('x-csrf-token', token)
          .send({ skipDuplicates: true })
          .expect(200)
      ).body;
      assert.equal(report.imported, 2);
      assert.equal(report.skipped, 2);
      assert.equal(report.errors.length, 1);
      const saved = (await owner.get('/api/questions').query({ q: missing.publicId }).expect(200)).body.items;
      assert.equal(saved.length, 1);
      assert.deepEqual(saved[0].images, [upload.url]);
      assert.equal((await db('questions')).length, beforeCount + 2);
      await patch(original.id, 2, []).expect(409);
    });

    await t.test(
      'rechecks local files at confirmation and allows manual attachment to a row without detected images',
      async () => {
        const file = join(directory, 'removed-after-preview.png');
        writeFileSync(file, png);
        const result = await preview([question({ images: [`/uploads/${basename(file)}`] }), question()]);
        assert.equal(result.valid, 2);
        const attached = (await patch(result.id, 3, ['/assets/seedling-chart.svg']).expect(200))
          .body as ImportPreview;
        assert.equal(attached.valid, 2);
        assert.deepEqual(attached.rows[1]!.question.images, ['/assets/seedling-chart.svg']);
        unlinkSync(file);
        const report = (
          await owner
            .post(`/api/imports/${result.id}/confirm`)
            .set('x-csrf-token', token)
            .send({})
            .expect(200)
        ).body;
        assert.equal(report.imported, 1);
        assert.equal(report.skipped, 1);
        assert.match(report.errors[0].errors.join(' '), /Local image not found/);
      },
    );
  } finally {
    await db.destroy();
    if (previousDirectory === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = previousDirectory;
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert(directory.startsWith(join(tmpdir(), 'pathwise-import-images-')));
    rmSync(directory, { recursive: true, force: true });
  }
});
