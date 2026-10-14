import type { Question, Performance, ReviewItem, Blueprint } from '../shared/types.js';
import { DOMAINS, SKILLS } from './taxonomy.js';
import { ApiError } from './validation.js';

export function seededRandom(seed: string) {
  let state = 2166136261;
  for (const c of seed) state = Math.imul(state ^ c.charCodeAt(0), 16777619);
  return () => {
    state += 0x6d2b79f5;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffle<T>(items: T[], seed: string): T[] {
  const result = [...items],
    random = seededRandom(seed);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
export function normalizeNumeric(input: string): number | null {
  const value = input.trim().replace(/−/g, '-');
  // SPR permits a fraction or decimal. Mixed numbers, expressions, percentages,
  // scientific notation and thousands separators are deliberately rejected.
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (/^[+-]?\d+\s*\/\s*[+-]?\d+$/.test(value)) {
    const [a, b] = value.split('/').map(Number);
    return b !== 0 && Number.isFinite(a! / b!) ? a! / b! : null;
  }
  return null;
}
export function gradeAnswer(
  question: Pick<Question, 'type' | 'correctAnswer' | 'acceptedAnswers'>,
  answer: string,
) {
  if (!answer.trim()) return false;
  if (question.type === 'mcq') return question.correctAnswer === answer.trim();
  const n = normalizeNumeric(answer);
  return (
    n !== null &&
    (question.acceptedAnswers || []).some((a) => {
      const accepted = normalizeNumeric(a);
      return accepted !== null && Math.abs(n - accepted) <= Math.max(1, Math.abs(accepted)) * 1e-7;
    })
  );
}
export const ROUTING_MODEL = 'accuracy-threshold-v1';
export function adaptiveRoute(correct: number, total: number, threshold = 0.65) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)
    throw new ApiError(400, 'Routing threshold must be between 0 and 1');
  const accuracy = total > 0 ? correct / total : 0;
  return {
    route: accuracy >= threshold ? ('higher' as const) : ('lower' as const),
    accuracy,
    correct,
    total,
    threshold,
    modelVersion: ROUTING_MODEL,
  };
}
export function quotaCounts(section: string, count: number, route = 'mixed') {
  const domains = DOMAINS.filter((d) => d.section === section);
  // Complementary module distributions keep BOTH possible full paths within
  // the published approximate section domain ranges.
  if (section === 'rw' && count === 27)
    return domains.map((d, i) => ({
      id: d.id,
      count: (route === 'mixed' ? [7, 7, 6, 7] : [7, 8, 5, 7])[i]!,
      remainder: 0,
    }));
  if (section === 'math' && count === 22)
    return domains.map((d, i) => ({
      id: d.id,
      count: (route === 'mixed' ? [8, 7, 4, 3] : [7, 8, 3, 4])[i]!,
      remainder: 0,
    }));
  const quotas = domains.map((d) => ({
    id: d.id,
    count: Math.floor((count * d.percentage) / 100),
    remainder: ((count * d.percentage) / 100) % 1,
  }));
  let left = count - quotas.reduce((sum, q) => sum + q.count, 0);
  for (const q of [...quotas].sort((a, b) => b.remainder - a.remainder)) if (left-- > 0) q.count++;
  return quotas;
}
export function assembleModule(
  pool: Question[],
  section: string,
  count: number,
  route: string,
  seed: string,
  excluded = new Set<string>(),
  enforceDomains = true,
) {
  const available = pool.filter(
    (q) => q.section === section && q.status === 'published' && !excluded.has(q.id),
  );
  const randomOrder = shuffle(available, seed);
  // Route pools overlap in difficulty, but selection across all five blueprint
  // pools is disjoint. Both higher/lower alternatives remain snapshotted.
  const rank =
    route === 'higher'
      ? ['hard', 'medium', 'easy']
      : route === 'lower'
        ? ['easy', 'medium', 'hard']
        : ['medium', 'easy', 'hard'];
  const select = (candidates: Question[], n: number) => {
    if (route === 'mixed') {
      const order = shuffle(candidates, `${seed}:mix`);
      const result: Question[] = [];
      const desired = { easy: Math.floor(n / 3), medium: n - 2 * Math.floor(n / 3), hard: Math.floor(n / 3) };
      for (const [difficulty, amount] of Object.entries(desired))
        result.push(...order.filter((q) => q.difficulty === difficulty).slice(0, amount));
      for (const q of order) if (result.length < n && !result.some((r) => r.id === q.id)) result.push(q);
      return result;
    }
    return [...candidates]
      .sort((a, b) => rank.indexOf(a.difficulty) - rank.indexOf(b.difficulty))
      .slice(0, n);
  };
  const selected: Question[] = [];
  if (enforceDomains)
    for (const quota of quotaCounts(section, count, route)) {
      const candidates = randomOrder.filter((q) => q.domainId === quota.id);
      if (candidates.length < quota.count)
        throw new ApiError(
          422,
          `Insufficient ${quota.id} questions: need ${quota.count}, have ${candidates.length}`,
        );
      selected.push(...select(candidates, quota.count));
    }
  else selected.push(...select(randomOrder, count));
  if (selected.length !== count)
    throw new ApiError(422, `Insufficient questions: need ${count}, have ${selected.length}`);
  selected.forEach((q) => excluded.add(q.id));
  return shuffle(selected, `${seed}:display`);
}
export function fullBlueprint(seed = 'sat-original-v1'): Blueprint {
  return {
    id: 'standard-sat',
    title: 'Full Digital SAT Simulation',
    description: 'Original questions · estimated score · adaptive practice',
    kind: 'full',
    published: true,
    seed,
    routingThreshold: 0.65,
    routingModelVersion: ROUTING_MODEL,
    modules: [
      ...(['rw', 'math'] as const).flatMap((section) => [
        {
          section,
          index: 1,
          route: 'mixed' as const,
          count: section === 'rw' ? 27 : 22,
          durationSeconds: section === 'rw' ? 1920 : 2100,
          questionIds: [],
        },
        {
          section,
          index: 2,
          route: 'higher' as const,
          count: section === 'rw' ? 27 : 22,
          durationSeconds: section === 'rw' ? 1920 : 2100,
          questionIds: [],
        },
        {
          section,
          index: 2,
          route: 'lower' as const,
          count: section === 'rw' ? 27 : 22,
          durationSeconds: section === 'rw' ? 1920 : 2100,
          questionIds: [],
        },
      ]),
    ],
  };
}
export const SCORE_MODEL = 'estimated-linear-v1';
export function estimateSection(correct: number, total: number): number | null {
  return total > 0
    ? Math.min(800, Math.max(200, Math.round((200 + (600 * correct) / total) / 10) * 10))
    : null;
}
export function performance(
  items: ReviewItem[],
  grouping: 'domain' | 'skill' | 'difficulty',
  taxonomy?: {
    id: string;
    section: string;
    name: string;
    skills: { id: string; domainId: string; name: string }[];
  }[],
): Performance[] {
  const domains = taxonomy || DOMAINS;
  const skills = taxonomy ? taxonomy.flatMap((d) => d.skills) : SKILLS;
  const groups =
    grouping === 'domain'
      ? domains
      : grouping === 'skill'
        ? skills.map((s) => ({ ...s, section: domains.find((d) => d.id === s.domainId)!.section }))
        : ['easy', 'medium', 'hard'].map((id) => ({ id, name: id, section: 'rw' }));
  return groups.map((group) => {
    const rows = items.filter(
      (r) =>
        (grouping === 'domain'
          ? r.question.domainId
          : grouping === 'skill'
            ? r.question.skillId
            : r.question.difficulty) === group.id,
    );
    const correct = rows.filter((r) => r.correct).length,
      accuracy = rows.length ? correct / rows.length : 0;
    return {
      id: group.id,
      name: group.name,
      section: group.section as 'rw' | 'math',
      attempts: rows.length,
      correct,
      accuracy,
      averageMs: rows.length
        ? Math.round(rows.reduce((s, r) => s + r.response.elapsedMs, 0) / rows.length)
        : 0,
      level: rows.length ? Math.max(1, Math.min(7, Math.round(accuracy * 6) + 1)) : 0,
    };
  });
}
export function assembleByDistribution(
  pool: Question[],
  section: string,
  count: number,
  weights: Record<string, number>,
  seed: string,
  excluded = new Set<string>(),
) {
  const positive = Object.entries(weights).filter(([, w]) => w > 0),
    totalWeight = positive.reduce((sum, [, w]) => sum + w, 0);
  if (!totalWeight || positive.some(([, w]) => !Number.isFinite(w)))
    throw new ApiError(422, 'Provide at least one positive domain weight');
  const quotas = positive.map(([id, weight]) => ({
    id,
    count: Math.floor((count * weight) / totalWeight),
    fraction: ((count * weight) / totalWeight) % 1,
  }));
  let remaining = count - quotas.reduce((sum, q) => sum + q.count, 0);
  for (const q of [...quotas].sort((a, b) => b.fraction - a.fraction || a.id.localeCompare(b.id)))
    if (remaining-- > 0) q.count++;
  const selected: Question[] = [];
  for (const q of quotas)
    if (q.count)
      selected.push(
        ...assembleModule(
          pool.filter((item) => item.domainId === q.id),
          section,
          q.count,
          'mixed',
          `${seed}:${q.id}`,
          excluded,
          false,
        ),
      );
  return shuffle(selected, `${seed}:distribution`);
}
