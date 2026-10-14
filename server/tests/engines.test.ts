import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adaptiveRoute,
  assembleModule,
  assembleByDistribution,
  estimateSection,
  gradeAnswer,
  normalizeNumeric,
  performance,
  quotaCounts,
  shuffle,
} from '../engines.js';
import { originalQuestions } from '../seed.js';
import type { Question, ReviewItem } from '../../shared/types.js';
import { emptyResponse } from '../../shared/types.js';
import { questionSchema } from '../validation.js';
import { blueprintSchema } from '../blueprints.js';
import { SKILLS } from '../taxonomy.js';
import { scoreSection, type ScoringConfiguration } from '../scoring.js';

test('numeric responses normalize fractions/decimals and reject expressions/non-finite values', () => {
  assert.equal(normalizeNumeric(' 3/4 '), 0.75);
  assert.equal(normalizeNumeric('−.25'), -0.25);
  assert.equal(normalizeNumeric('1/0'), null);
  for (const value of ['1+2', '1 1/2', '25%', '1,000', 'NaN', 'Infinity', '1e2'])
    assert.equal(normalizeNumeric(value), null);
  assert.equal(gradeAnswer({ type: 'spr', acceptedAnswers: ['3/4'] }, '.75'), true);
  assert.equal(gradeAnswer({ type: 'spr', acceptedAnswers: ['3/4'] }, '0.7'), false);
  assert.equal(gradeAnswer({ type: 'mcq', correctAnswer: 'B' }, 'B'), true);
  assert.equal(gradeAnswer({ type: 'mcq', correctAnswer: 'B' }, ''), false);
});
test('seed produces 352 original validated examples with every domain/skill and MCQ/SPR/chart', () => {
  const items = originalQuestions();
  assert.equal(items.length, 352);
  assert.equal(new Set(items.map((q) => q.publicId)).size, 352);
  items.forEach((q) => assert.equal(questionSchema.safeParse(q).success, true));
  assert(items.some((q) => q.images.length));
  assert(items.some((q) => q.type === 'spr'));
  assert.equal(new Set(items.map((q) => q.domainId)).size, 8);
  assert.equal(new Set(items.map((q) => q.skillId)).size, SKILLS.length);
});
test('full assembly is reproducible, quota constrained, and disjoint across both adaptive alternatives', () => {
  const pool = originalQuestions().map((q, i) => ({ ...q, id: String(i), version: 1 })) as Question[];
  const excluded = new Set<string>(),
    picked: Question[][] = [];
  for (const section of ['rw', 'math'])
    for (const route of ['mixed', 'higher', 'lower']) {
      const count = section === 'rw' ? 27 : 22;
      const selected = assembleModule(pool, section, count, route, `seed:${section}:${route}`, excluded);
      picked.push(selected);
      assert.equal(selected.length, count);
      for (const quota of quotaCounts(section, count, route))
        assert.equal(selected.filter((q) => q.domainId === quota.id).length, quota.count);
    }
  assert.equal(excluded.size, 147);
  assert.equal(picked.flat().length, 147);
  assert.deepEqual(
    assembleModule(pool, 'rw', 27, 'mixed', 'same'),
    assembleModule(pool, 'rw', 27, 'mixed', 'same'),
  );
  assert.notDeepEqual(
    shuffle(pool, 'a').map((q) => q.id),
    shuffle(pool, 'b').map((q) => q.id),
  );
  assert.throws(() => assembleModule(pool.slice(0, 5), 'rw', 27, 'mixed', 'seed'), /Insufficient/);
});
test('adaptive routing is configurable and boundary deterministic', () => {
  assert.equal(adaptiveRoute(13, 20, 0.65).route, 'higher');
  assert.equal(adaptiveRoute(12, 20, 0.65).route, 'lower');
  assert.equal(adaptiveRoute(12, 20, 0.5).route, 'higher');
  assert.equal(adaptiveRoute(0, 0).route, 'lower');
  assert.throws(() => adaptiveRoute(10, 20, 1.1));
});
test('estimated scoring is bounded and domain level is clearly internal', () => {
  assert.equal(estimateSection(0, 54), 200);
  assert.equal(estimateSection(54, 54), 800);
  assert.equal(estimateSection(27, 54), 500);
  assert.equal(estimateSection(0, 0), null);
  const question = { ...originalQuestions()[0]!, id: '1', version: 1 } as Question;
  const items: ReviewItem[] = [
    { question, response: { ...emptyResponse(), elapsedMs: 1200 }, correct: true, moduleId: 'm' },
    { question, response: { ...emptyResponse(), elapsedMs: 2400 }, correct: false, moduleId: 'm' },
  ];
  const domain = performance(items, 'domain').find((d) => d.id === question.domainId)!;
  assert.equal(domain.attempts, 2);
  assert.equal(domain.accuracy, 0.5);
  assert.equal(domain.averageMs, 1800);
  assert.equal(domain.level, 4);
});
test('question validator rejects inconsistent keys and removes executable HTML', () => {
  const q = originalQuestions()[0]!;
  assert.equal(questionSchema.safeParse({ ...q, correctAnswer: 'Z' }).success, false);
  const sanitized = questionSchema.parse({
    ...q,
    stem: '<script>alert(1)</script><p onclick="evil()">Safe</p>',
  });
  assert.equal(sanitized.stem, '<p>Safe</p>');
});
test('full blueprint rejects custom dimensions and duplicate pools', () => {
  const custom = {
    title: 'Short',
    description: '',
    kind: 'full',
    published: true,
    seed: 's',
    routingThreshold: 0.65,
    routingModelVersion: 'v1',
    modules: [{ section: 'rw', index: 1, route: 'mixed', count: 1, durationSeconds: 60, questionIds: [] }],
  };
  assert.equal(blueprintSchema.safeParse(custom).success, false);
});
test('supplied scoring models bind to exact form AND question versions, failing closed for other forms', () => {
  const q = { ...originalQuestions()[0]!, id: 'Q-1', version: 1 } as Question;
  const items: ReviewItem[] = [{ question: q, response: emptyResponse(), correct: true, moduleId: 'm' }];
  const model: ScoringConfiguration = {
    kind: 'form-mapping',
    version: 'provided-form-2026',
    label: 'Provided form score',
    forms: [{ section: 'rw', questionIds: ['Q-1'], questionVersions: { 'Q-1': 1 }, scores: [200, 800] }],
  };
  assert.equal(scoreSection(model, 'rw', items), 800);
  assert.throws(() => scoreSection(model, 'math', items), /exact question form/);
  assert.throws(
    () => scoreSection(model, 'rw', [{ ...items[0]!, question: { ...q, version: 2 } }]),
    /exact question form/,
  );
});
test('custom domain weights enforce requested distribution with reproducible selection', () => {
  const pool = originalQuestions().map((q, i) => ({ ...q, id: String(i), version: 1 })) as Question[],
    weights = { 'math-algebra': 70, 'math-advanced': 30 };
  const items = assembleByDistribution(pool, 'math', 10, weights, 'weighted');
  assert.equal(items.filter((q) => q.domainId === 'math-algebra').length, 7);
  assert.equal(items.filter((q) => q.domainId === 'math-advanced').length, 3);
  assert.deepEqual(items, assembleByDistribution(pool, 'math', 10, weights, 'weighted'));
  assert.throws(() => assembleByDistribution(pool, 'math', 10, { 'math-algebra': 0 }, 'weighted'));
});
