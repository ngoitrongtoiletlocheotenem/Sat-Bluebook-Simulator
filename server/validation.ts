import { z } from 'zod';
import sanitizeHtml from 'sanitize-html';

const rich = z
  .string()
  .max(100_000)
  .transform((text) =>
    sanitizeHtml(text, {
      allowedTags: [
        'p',
        'br',
        'strong',
        'em',
        'u',
        's',
        'sub',
        'sup',
        'ul',
        'ol',
        'li',
        'h2',
        'h3',
        'blockquote',
        'table',
        'thead',
        'tbody',
        'tr',
        'td',
        'th',
        'span',
        'img',
      ],
      allowedAttributes: {
        span: ['class'],
        img: ['src', 'alt', 'width', 'height'],
        td: ['colspan', 'rowspan'],
        th: ['colspan', 'rowspan'],
      },
      allowedSchemes: ['https'],
      allowedSchemesByTag: { img: ['https'] },
      allowProtocolRelative: false,
    }),
  );
const safeUrl = z
  .string()
  .max(2000)
  .refine(
    (s) => !s || /^https:\/\//.test(s) || /^\/(?:assets|uploads)\/[a-zA-Z0-9_./-]+$/.test(s),
    'Use HTTPS or a local /assets/ or /uploads/ URL',
  );
export const questionSchema = z
  .object({
    publicId: z.string().min(1).max(120),
    section: z.enum(['rw', 'math']),
    domainId: z.string().min(1),
    skillId: z.string().min(1),
    type: z.enum(['mcq', 'spr']),
    difficulty: z.enum(['easy', 'medium', 'hard']),
    difficultyValue: z.number().min(0).max(1).optional(),
    passage: rich.default(''),
    stem: rich.refine((s) => s.trim().length > 0, 'Question stem is required'),
    choices: z
      .array(
        z.object({
          id: z.string().min(1).max(10),
          text: rich.refine((s) => s.trim().length > 0, 'Choice text is required'),
          rationale: rich.default(''),
        }),
      )
      .max(5)
      .default([]),
    correctAnswer: z.string().max(100).default(''),
    acceptedAnswers: z.array(z.string().max(100)).max(20).default([]),
    explanation: rich.refine((s) => s.trim().length > 0, 'Explanation is required'),
    hint: rich.default(''),
    strategy: rich.default(''),
    tags: z.array(z.string().max(60)).max(30).default([]),
    source: z.string().min(1).max(500).default('User authored'),
    sourceUrl: safeUrl.default(''),
    license: z.string().min(1).max(3000),
    author: z.string().max(200).default(''),
    images: z.array(safeUrl).max(10).default([]),
    assets: z
      .array(
        z.object({
          url: safeUrl,
          alt: z.string().min(1).max(1000),
          kind: z.enum(['image', 'chart', 'table']).default('image'),
        }),
      )
      .max(10)
      .default([]),
    calculator: z.enum(['allowed', 'not-needed', 'recommended', 'unnecessary']).default('allowed'),
    subskill: z.string().max(300).default(''),
    adminNotes: z.string().max(10_000).default(''),
    calibration: z.record(z.string(), z.number()).optional(),
    status: z.enum(['draft', 'published', 'archived']).default('published'),
    private: z.boolean().default(false),
  })
  .superRefine((q, ctx) => {
    if (q.type === 'mcq' && (q.choices.length !== 4 || !q.choices.some((c) => c.id === q.correctAnswer)))
      ctx.addIssue({ code: 'custom', message: 'MCQ requires four choices and a valid correctAnswer' });
    if (new Set(q.choices.map((c) => c.id)).size !== q.choices.length)
      ctx.addIssue({ code: 'custom', message: 'Choice identifiers must be unique' });
    if (q.type === 'spr' && (!q.acceptedAnswers.length || q.choices.length || q.section !== 'math'))
      ctx.addIssue({
        code: 'custom',
        message: 'Student-produced responses require Math, acceptedAnswers, and no choices',
      });
    if (
      q.type === 'spr' &&
      q.acceptedAnswers.some((value) => {
        const s = value.trim();
        if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)) return !Number.isFinite(Number(s));
        if (/^[+-]?\d+\s*\/\s*[+-]?\d+$/.test(s)) {
          const [a, b] = s.split('/').map(Number);
          return b === 0 || !Number.isFinite(a! / b!);
        }
        return true;
      })
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Accepted numeric answers must be valid decimals or nonzero-denominator fractions',
      });
    if (q.section === 'rw' && q.type !== 'mcq')
      ctx.addIssue({ code: 'custom', message: 'Reading and Writing supports MCQ only' });
  });
export type QuestionContent = z.infer<typeof questionSchema>;
export const responseSchema = z.object({
  answer: z.string().max(100).optional(),
  marked: z.boolean().optional(),
  eliminated: z.array(z.string().max(10)).max(5).optional(),
  highlights: z
    .array(
      z.object({
        id: z.string().max(100),
        field: z.enum(['passage', 'stem']).optional(),
        underline: z.boolean().optional(),
        underlineStyle: z.enum(['none', 'solid', 'dashed', 'dotted']).optional(),
        start: z.number().int().min(0),
        end: z.number().int().min(1),
        text: z.string().max(10_000),
        color: z.enum(['yellow', 'blue', 'pink']).default('yellow'),
        note: z.string().max(5000).optional(),
        noteAttached: z.boolean().optional(),
        style: z.enum(['highlight', 'underline']).optional(),
      }),
    )
    .max(100)
    .optional(),
  notes: z
    .array(z.object({ id: z.string().max(100), text: z.string().max(5000) }))
    .max(100)
    .optional(),
  timeSpentMs: z.number().int().min(0).max(86_400_000).optional(),
  currentQuestion: z.number().int().min(0).max(500).optional(),
});
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
