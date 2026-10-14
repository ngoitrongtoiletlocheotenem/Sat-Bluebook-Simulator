import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import { z, ZodError } from 'zod';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Knex } from 'knex';
import {
  authenticated,
  authentication,
  createUser,
  csrfProtection,
  loginSchema,
  makeSession,
  publicUser,
  registerSchema,
  roles,
  type AuthRequest,
} from './auth.js';
import { ApiError } from './validation.js';
import { DOMAINS, SKILLS } from './taxonomy.js';
import { createQuestion, findQuestion, listQuestions, updateQuestion } from './questions.js';
import {
  attemptInputSchema,
  attemptSaveSchema,
  continueBreak,
  createAttempt,
  finishModule,
  getAttempt,
  getResult,
  pauseAttempt,
  saveAttempt,
  tutorFeedback,
} from './attempts.js';
import { dashboard, errorItems, history } from './analytics.js';
import { listBlueprints, saveBlueprint } from './blueprints.js';
import { confirmImport, exportQuestions, parseFile, previewImport, template } from './imports.js';
import { now } from './db.js';
import { statistics } from './statistics.js';
import { loadTaxonomy, updateTaxonomy } from './taxonomy-management.js';

const user = (req: Request) => (req as AuthRequest).user;
const param = (req: Request, key = 'id') => String(req.params[key]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 10 },
});
export function createApp(db: Knex) {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY));
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", 'https://www.desmos.com'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", 'https://www.desmos.com'],
          frameSrc: ["'self'", 'https://www.desmos.com'],
          workerSrc: ["'self'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
        },
      },
    }),
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  // Desmos v1.12 evaluates generated code. Limit that permission to its
  // sandboxed calculator document; the main application keeps a strict CSP.
  app.get('/desmos-calculator.html', (_req, res) => {
    res.set(
      'Content-Security-Policy',
      [
        "default-src 'none'",
        "script-src 'self' https://www.desmos.com 'unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https://www.desmos.com",
        "font-src 'self' data:",
        "connect-src 'self' https://www.desmos.com",
        'worker-src blob:',
        "frame-ancestors 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ].join('; '),
    );
    res.sendFile(resolve('public/desmos-calculator.html'));
  });
  app.get('/desmos-calculator.js', (_req, res) => {
    // The opaque calculator sandbox cannot use resources marked same-origin.
    // This public bridge contains no credentials and accepts its parent only.
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.sendFile(resolve('public/desmos-calculator.js'));
  });
  app.get('/api/health', async (_req, res) => {
    await db.raw('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  });
  app.use(
    '/api',
    rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: 'draft-8', legacyHeaders: false }),
  );
  app.use('/api', authentication(db), csrfProtection, (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  const authLimit = rateLimit({
    windowMs: 15 * 60_000,
    limit: 40,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });
  app.get('/api/me', (req, res) =>
    res.json({ user: user(req) || null, csrfToken: (req as AuthRequest).csrfToken || null }),
  );
  app.get('/api/auth/me', (req, res) =>
    res.json({ user: user(req) || null, csrfToken: (req as AuthRequest).csrfToken || null }),
  );
  app.post('/api/auth/register', authLimit, async (req, res) => {
    const created = await createUser(db, registerSchema.parse(req.body));
    res.status(201).json(await makeSession(db, created, res));
  });
  app.post('/api/auth/login', authLimit, async (req, res) => {
    const input = loginSchema.parse(req.body),
      row = await db('users').where({ email: input.email }).first();
    if (!row || !(await bcrypt.compare(input.password, row.password_hash)))
      throw new ApiError(401, 'Email or password is incorrect');
    res.json(await makeSession(db, publicUser(row), res));
  });
  app.post('/api/auth/logout', authenticated, async (req, res) => {
    await db('sessions')
      .where({ token_hash: (req as AuthRequest).sessionHash })
      .delete();
    res.clearCookie('sat_session', { path: '/' });
    res.json({ ok: true });
  });
  app.get('/api/taxonomy', async (_req, res) => res.json(await loadTaxonomy(db)));
  app.use('/api', authenticated);
  app.put('/api/taxonomy', roles('admin'), async (req, res) => res.json(await updateTaxonomy(db, req.body)));
  app.get('/api/meta', (_req, res) => res.json({ domains: DOMAINS, skills: SKILLS, version: '1.0.0' }));
  app.put('/api/profile', async (req, res) => {
    const input = z
      .object({
        name: z.string().trim().min(1).max(100),
        targetScore: z.number().int().min(400).max(1600).optional(),
      })
      .parse(req.body);
    await db('users')
      .where({ id: user(req).id })
      .update({ name: input.name, profile: JSON.stringify({ targetScore: input.targetScore }) });
    res.json({ ...user(req), ...input });
  });
  app.get('/api/users', roles('admin'), async (_req, res) =>
    res.json((await db('users').select('id', 'email', 'name', 'role')).map(publicUser)),
  );
  app.get('/api/statistics', roles('teacher', 'admin'), async (_req, res) => res.json(await statistics(db)));
  app.put('/api/users/:id', roles('admin'), async (req, res) => {
    const role = z.enum(['student', 'teacher', 'admin']).parse(req.body.role);
    if (param(req) === user(req).id && role !== 'admin')
      throw new ApiError(409, 'You cannot remove your own administrator role');
    const count = await db('users')
      .where({ id: param(req) })
      .update({ role });
    if (!count) throw new ApiError(404, 'User not found');
    await db('sessions')
      .where({ user_id: param(req) })
      .delete();
    res.json(
      publicUser(
        await db('users')
          .where({ id: param(req) })
          .first(),
      ),
    );
  });
  // Fixed routes precede :id so exports cannot be confused with identifiers.
  app.get('/api/questions/export', async (req, res) => {
    if (user(req).role === 'student' && req.query.scope === 'global')
      throw new ApiError(403, 'Shared exports require an author role');
    let questions = await exportQuestions(db, user(req));
    if (user(req).role === 'student') questions = questions.filter((q) => q.ownerId === user(req).id);
    res.set('Content-Disposition', 'attachment; filename="question-bank.json"').json(questions);
  });
  app.get('/api/questions', async (req, res) => res.json(await listQuestions(db, user(req), req.query)));
  app.get('/api/questions/:id', async (req, res) => {
    const { question } = await findQuestion(db, user(req), param(req));
    if (user(req).role === 'student') delete question.adminNotes;
    res.json(question);
  });
  app.get('/api/questions/:id/versions', roles('teacher', 'admin'), async (req, res) => {
    await findQuestion(db, user(req), param(req));
    res.json(
      await db('question_versions')
        .where({ question_id: param(req) })
        .select('id', 'version', 'created_at'),
    );
  });
  app.post('/api/questions', async (req, res) =>
    res.status(201).json(await createQuestion(db, user(req), req.body)),
  );
  app.put('/api/questions/:id', async (req, res) =>
    res.json(await updateQuestion(db, user(req), param(req), req.body)),
  );
  app.delete('/api/questions/:id', async (req, res) => {
    const { question } = await findQuestion(db, user(req), param(req));
    res.json(await updateQuestion(db, user(req), param(req), { ...question, status: 'archived' }));
  });
  app.get('/api/blueprints', async (req, res) => res.json(await listBlueprints(db, user(req))));
  app.post('/api/blueprints', roles('teacher', 'admin'), async (req, res) =>
    res.status(201).json(await saveBlueprint(db, user(req), req.body)),
  );
  app.put('/api/blueprints/:id', roles('teacher', 'admin'), async (req, res) =>
    res.json(await saveBlueprint(db, user(req), req.body, param(req))),
  );
  app.post('/api/attempts', async (req, res) =>
    res.status(201).json(await createAttempt(db, user(req), attemptInputSchema.parse(req.body))),
  );
  app.get('/api/attempts', async (req, res) => {
    const rows = await db('attempts')
      .where({ user_id: user(req).id })
      .orderBy('started_at', 'desc')
      .limit(50);
    const values = [];
    for (const row of rows) values.push(await getAttempt(db, user(req), row.id));
    res.json(values);
  });
  app.get('/api/attempts/:id', async (req, res) => res.json(await getAttempt(db, user(req), param(req))));
  app.patch('/api/attempts/:id', async (req, res) =>
    res.json(await saveAttempt(db, user(req), param(req), attemptSaveSchema.parse(req.body))),
  );
  app.post('/api/attempts/:id/finish-module', async (req, res) =>
    res.json(await finishModule(db, user(req), param(req), req.body?.moduleId)),
  );
  app.post('/api/attempts/:id/submit-module', async (req, res) =>
    res.json(await finishModule(db, user(req), param(req), req.body?.moduleId)),
  );
  app.post('/api/attempts/:id/continue', async (req, res) =>
    res.json(await continueBreak(db, user(req), param(req))),
  );
  app.post('/api/attempts/:id/pause', async (req, res) =>
    res.json(await pauseAttempt(db, user(req), param(req))),
  );
  app.post('/api/attempts/:id/resume', async (req, res) =>
    res.json(await pauseAttempt(db, user(req), param(req), true)),
  );
  app.post('/api/attempts/:id/tutor', async (req, res) => {
    const input = z.object({ questionId: z.string(), response: z.unknown() }).parse(req.body);
    res.json(await tutorFeedback(db, user(req), param(req), input.questionId, input.response as any));
  });
  app.get('/api/attempts/:id/result', async (req, res) =>
    res.json(await getResult(db, user(req), param(req))),
  );
  app.get('/api/results/:id', async (req, res) => res.json(await getResult(db, user(req), param(req))));
  app.get('/api/history', async (req, res) => res.json(await history(db, user(req))));
  app.get('/api/dashboard', async (req, res) =>
    res.json(await dashboard(db, user(req), Number(req.query.days))),
  );
  app.get('/api/errors', async (req, res) => res.json(await errorItems(db, user(req), req.query)));
  app.put('/api/errors/:id', async (req, res) => {
    const input = z
      .object({
        reason: z
          .enum([
            'Concept gap',
            'Misread question',
            'Calculation error',
            'Grammar rule',
            'Vocabulary',
            'Time pressure',
            'Careless mistake',
            'Guessed',
            'Other',
          ])
          .nullable()
          .optional(),
        mastered: z.boolean().optional(),
        note: z.string().max(10_000).optional(),
      })
      .parse(req.body);
    const row = await db('error_logs')
      .where({ id: param(req), user_id: user(req).id })
      .first();
    if (!row) throw new ApiError(404, 'Review item not found');
    await db('error_logs')
      .where({ id: row.id })
      .update({
        reason: input.reason === undefined ? row.reason : input.reason,
        status: input.mastered === undefined ? row.status : input.mastered ? 'mastered' : 'new',
        note: input.note === undefined ? row.note : input.note,
        updated_at: now(),
      });
    res.json({ ok: true });
  });
  app.post('/api/bookmarks/:id', async (req, res) => {
    await findQuestion(db, user(req), param(req));
    const row = await db('bookmarks')
      .where({ user_id: user(req).id, question_id: param(req) })
      .first();
    if (row) await db('bookmarks').where({ id: row.id }).delete();
    else
      await db('bookmarks').insert({
        id: randomUUID(),
        user_id: user(req).id,
        question_id: param(req),
        created_at: now(),
      });
    res.json({ bookmarked: !row });
  });
  app.get('/api/bookmarks', async (req, res) =>
    res.json((await listQuestions(db, user(req), { bookmarked: 'true', pageSize: 100 })).items),
  );
  app.get('/api/imports/template', async (req, res) => {
    const f = String(req.query.format || 'csv');
    if (!['csv', 'json', 'xlsx'].includes(f)) throw new ApiError(400, 'Unknown template format');
    const file = await template(f);
    res.type(file.type).set('Content-Disposition', `attachment; filename="${file.filename}"`).send(file.data);
  });
  app.post('/api/imports/preview', upload.single('file'), async (req, res) => {
    if (!req.file) throw new ApiError(400, 'Upload a question file');
    let mapping: Record<string, string> = {};
    if (req.body.mapping) {
      try {
        mapping = z.record(z.string(), z.string()).parse(JSON.parse(req.body.mapping));
      } catch {
        throw new ApiError(400, 'Column mapping must be a JSON object');
      }
    }
    const scope = req.body.scope || (user(req).role === 'student' ? 'private' : 'global');
    if (!['global', 'private'].includes(scope)) throw new ApiError(400, 'Unknown question-bank scope');
    res.json(
      await previewImport(
        db,
        user(req),
        await parseFile(req.file.buffer, req.file.originalname),
        mapping,
        scope,
      ),
    );
  });
  app.post('/api/imports/:id/confirm', async (req, res) =>
    res.json(await confirmImport(db, user(req), param(req), req.body.skipDuplicates !== false)),
  );
  app.get('/api/imports/:id/report', async (req, res) => {
    const job = await db('import_jobs')
      .where({ id: param(req), user_id: user(req).id })
      .first();
    if (!job) throw new ApiError(404, 'Import not found');
    res
      .type('json')
      .set('Content-Disposition', 'attachment; filename="import-report.json"')
      .send(job.report || '{}');
  });
  app.post('/api/assets', upload.single('file'), async (req, res) => {
    const file = req.file;
    if (!file) throw new ApiError(400, 'Upload an image');
    const b = file.buffer;
    const kind =
      b.length > 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? 'png'
        : b.length > 3 && b[0] === 255 && b[1] === 216 && b[2] === 255
          ? 'jpg'
          : b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP'
            ? 'webp'
            : null;
    if (!kind) throw new ApiError(415, 'Only PNG, JPEG, and WebP images are supported');
    const directory = resolve(process.env.UPLOAD_DIR || 'data/uploads');
    mkdirSync(directory, { recursive: true });
    const filename = `${randomUUID()}.${kind}`;
    writeFileSync(resolve(directory, filename), b);
    res.status(201).json({ url: `/uploads/${filename}` });
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found' }));
  app.use(
    '/uploads',
    express.static(resolve(process.env.UPLOAD_DIR || 'data/uploads'), {
      fallthrough: false,
      maxAge: '1d',
      setHeaders(res) {
        res.setHeader('Content-Security-Policy', "default-src 'none'");
      },
    }),
  );
  app.use('/assets', express.static(resolve('public/assets')));
  if (existsSync(resolve('dist/index.html'))) {
    app.use(express.static(resolve('dist')));
    app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
  }
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ZodError)
      return res
        .status(422)
        .json({ error: error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ') });
    if (error instanceof ApiError) return res.status(error.status).json({ error: error.message });
    if (error instanceof multer.MulterError)
      return res
        .status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400)
        .json({ error: 'Upload rejected; maximum file size is 5 MB' });
    if (error.status === 400) return res.status(400).json({ error: 'Invalid request body' });
    // No request bodies, answers, passwords or student identifiers are logged.
    console.error('Server request failed:', error.name || 'Error');
    return res.status(500).json({ error: 'The server could not complete this request' });
  });
  return app;
}
