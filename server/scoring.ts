import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { ReviewItem, Section } from '../shared/types.js';
import { estimateSection, SCORE_MODEL } from './engines.js';
import { ApiError } from './validation.js';

const modelSchema = z
  .object({
    version: z.string().min(1).max(100),
    kind: z.enum(['estimated', 'form-mapping', 'calibrated-internal']),
    label: z.string().min(1).max(200),
    // Each conversion is bound to exactly the selected immutable question IDs.
    // Different adaptive routes require their own supplied form mapping.
    forms: z
      .array(
        z.object({
          section: z.enum(['rw', 'math']),
          questionIds: z.array(z.string()).min(1),
          questionVersions: z.record(z.string(), z.number().int().min(1)),
          scores: z.array(z.number().int().min(200).max(800)).min(2),
        }),
      )
      .default([]),
  })
  .superRefine((model, ctx) => {
    for (const f of model.forms) {
      if (f.scores.length !== f.questionIds.length + 1)
        ctx.addIssue({
          code: 'custom',
          message: 'Mapping requires one score per raw correct count, including zero',
        });
      if (new Set(f.questionIds).size !== f.questionIds.length)
        ctx.addIssue({ code: 'custom', message: 'Form mapping question IDs must be unique' });
    }
    if (model.kind !== 'estimated' && !model.forms.length)
      ctx.addIssue({ code: 'custom', message: 'Supplied score models require exact form mappings' });
  });
export type ScoringConfiguration = z.infer<typeof modelSchema>;
export interface ScoringEngine {
  score(section: Section, items: ReviewItem[]): number | null;
}
export class EstimatedScoringEngine implements ScoringEngine {
  score(_section: Section, items: ReviewItem[]) {
    return estimateSection(items.filter((r) => r.correct).length, items.length);
  }
}
export class FormMappingScoringEngine implements ScoringEngine {
  constructor(private model: ScoringConfiguration) {}
  score(section: Section, items: ReviewItem[]) {
    const ids = [...items.map((r) => r.question.id)].sort();
    const form = this.model.forms.find(
      (f) =>
        f.section === section &&
        f.questionIds.length === ids.length &&
        [...f.questionIds].sort().every((id, i) => id === ids[i]) &&
        items.every((r) => f.questionVersions[r.question.id] === r.question.version),
    );
    if (!form)
      throw new ApiError(
        422,
        'Configured scoring model has no mapping for this exact question form; configure a matching mapping before scoring',
      );
    return form.scores[items.filter((r) => r.correct).length]!;
  }
}
export class CalibratedInternalScoringEngine extends FormMappingScoringEngine {}
export function scoringModelSnapshot(): ScoringConfiguration {
  if (process.env.SCORING_MODEL_FILE)
    return modelSchema.parse(JSON.parse(readFileSync(process.env.SCORING_MODEL_FILE, 'utf8')));
  return { version: SCORE_MODEL, kind: 'estimated', label: 'Estimated SAT Score', forms: [] };
}
export function scoreSection(model: ScoringConfiguration, section: Section, items: ReviewItem[]) {
  const engine: ScoringEngine =
    model.kind === 'estimated'
      ? new EstimatedScoringEngine()
      : model.kind === 'form-mapping'
        ? new FormMappingScoringEngine(model)
        : new CalibratedInternalScoringEngine(model);
  return engine.score(section, items);
}
