export type Section = 'rw' | 'math';
export type Role = 'student' | 'teacher' | 'admin';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type Mode = 'full' | 'module' | 'practice' | 'tutor' | 'wrong' | 'weak' | 'bookmarks';
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  targetScore?: number;
}
export interface Skill {
  id: string;
  name: string;
  domainId: string;
}
export interface Domain {
  id: string;
  section: Section;
  name: string;
  percentage: number;
  questionRange: string;
  skills: Skill[];
}
export interface Choice {
  id: string;
  text: string;
  rationale?: string;
}
export interface QuestionAsset {
  id: string;
  name: string;
  url: string;
  size: number;
  mimeType: string;
  createdAt: string;
}
export interface Question {
  id: string;
  publicId: string;
  section: Section;
  domainId: string;
  skillId: string;
  subskill?: string;
  type: 'mcq' | 'spr';
  difficulty: Difficulty;
  difficultyValue?: number;
  passage: string;
  stem: string;
  choices: Choice[];
  correctAnswer?: string;
  acceptedAnswers?: string[];
  explanation?: string;
  hint?: string;
  strategy?: string;
  images?: string[];
  tags: string[];
  source: string;
  sourceUrl?: string;
  license: string;
  author?: string;
  calculator?: string;
  adminNotes?: string;
  version: number;
  status: 'draft' | 'published' | 'archived';
  ownerId?: string | null;
  usageCount?: number;
  createdAt?: string;
  updatedAt?: string;
  bookmarked?: boolean;
}
export interface Highlight {
  id: string;
  field: 'passage' | 'stem';
  start: number;
  end: number;
  text: string;
  color?: string;
  style?: 'highlight' | 'underline';
  underline?: boolean;
  underlineStyle?: 'none' | 'solid' | 'dashed' | 'dotted';
  note?: string;
  noteAttached?: boolean;
}
export interface Response {
  answer: string;
  eliminated: string[];
  marked: boolean;
  highlights: Highlight[];
  note: string;
  elapsedMs: number;
}
export interface Module {
  id: string;
  section: Section;
  index: number;
  route: 'mixed' | 'higher' | 'lower';
  status: 'active' | 'closed' | 'pending';
  durationSeconds: number;
  startedAt?: string;
  deadline?: string;
  questionCount: number;
  questions?: Question[];
}
export interface Attempt {
  id: string;
  revision: number;
  mode: Mode;
  title: string;
  status: 'active' | 'break' | 'paused' | 'completed';
  currentModule: number;
  currentQuestion: number;
  modules: Module[];
  module: Module | null;
  responses: Record<string, Response>;
  routes: Record<string, string>;
  breakUntil?: string;
  remainingSeconds?: number;
  user?: User;
  seed: string;
  createdAt: string;
}
export interface AttemptInput {
  domainDistribution?: Record<string, number>;
  mode: Mode;
  blueprintId?: string;
  section?: Section;
  domainId?: string;
  skillId?: string;
  difficulty?: Difficulty;
  count?: number;
  seed?: string;
  excludeSeen?: boolean;
  includeWrong?: boolean;
  timeMultiplier?: number;
  breakSeconds?: number;
  questionIds?: string[];
  timedSeconds?: number;
  tags?: string[];
  source?: string;
}
export interface Performance {
  id: string;
  name: string;
  section: Section;
  attempts: number;
  correct: number;
  accuracy: number;
  averageMs: number;
  level: number;
  recentAccuracy?: number;
  trend?: number;
}
export interface ReviewItem {
  question: Question;
  response: Response;
  correct: boolean;
  moduleId: string;
}
export interface Result {
  attemptId: string;
  title: string;
  mode: Mode;
  student: string;
  completedAt: string;
  totalScore: number | null;
  rwScore: number | null;
  mathScore: number | null;
  scoreRange?: [number, number];
  scoreModelVersion: string;
  scoreLabel: string;
  accuracy: number;
  correct: number;
  total: number;
  unanswered: number;
  marked: number;
  elapsedMs: number;
  averageMs: number;
  routes: Record<string, string>;
  domains: Performance[];
  skills: Performance[];
  difficulties: Performance[];
  review: ReviewItem[];
  previousDelta?: number | null;
}
export interface HistoryItem {
  id: string;
  title: string;
  mode: Mode;
  completedAt: string;
  totalScore: number | null;
  rwScore: number | null;
  mathScore: number | null;
  accuracy: number;
  total: number;
}
export interface Recommendation {
  title: string;
  reason: string;
  domainId?: string;
  skillId?: string;
  mode: Mode;
  count: number;
}
export interface Dashboard {
  domainHistory?: { attemptId: string; completedAt: string; domains: Performance[] }[];
  history: HistoryItem[];
  activeAttempts: Attempt[];
  domainStats: Performance[];
  skillStats: Performance[];
  recommendations: Recommendation[];
  stats: {
    questionsAnswered: number;
    accuracy: number;
    averageMs: number;
    studyDays: number;
    bookmarks: number;
    errors: number;
  };
}
export interface ErrorItem {
  id: string;
  question: Question;
  attemptId: string;
  answer: string;
  correctAnswer: string;
  createdAt: string;
  elapsedMs: number;
  reason: string | null;
  mastered: boolean;
  retryCount: number;
  lastCorrect?: boolean | null;
  dueAt?: string;
}
export interface BlueprintModule {
  section: Section;
  index: number;
  route: 'mixed' | 'higher' | 'lower';
  count: number;
  durationSeconds: number;
  questionIds: string[];
}
export interface Blueprint {
  id: string;
  title: string;
  description: string;
  kind: 'full' | 'custom';
  published: boolean;
  seed: string;
  routingThreshold: number;
  routingModelVersion: string;
  modules: BlueprintModule[];
  createdAt?: string;
}
export interface ImportRow {
  row: number;
  question: Partial<Question>;
  errors: string[];
  imageErrors?: string[];
  duplicate: boolean;
}
export interface ImportPreview {
  id: string;
  rows: ImportRow[];
  valid: number;
  invalid: number;
  duplicates: number;
  columns?: string[];
}
export const emptyResponse = (): Response => ({
  answer: '',
  eliminated: [],
  marked: false,
  highlights: [],
  note: '',
  elapsedMs: 0,
});
