import type { Knex } from 'knex';
import type { Request, Response, NextFunction } from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { User } from '../shared/types.js';
import { ApiError } from './validation.js';
import { now } from './db.js';

export type AuthRequest = Request & { user: User; csrfToken: string; sessionHash: string };
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export const publicUser = (u: any): User => {
  let profile: any = {};
  try {
    profile = typeof u.profile === 'string' ? JSON.parse(u.profile) : u.profile || {};
  } catch {}
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    ...(profile.targetScore ? { targetScore: profile.targetScore } : {}),
  };
};
const password = z
  .string()
  .max(128)
  .refine((s) => Buffer.byteLength(s, 'utf8') <= 72, 'Password must be at most 72 UTF-8 bytes');
export const registerSchema = z.object({
  email: z
    .email()
    .max(320)
    .transform((s) => s.toLowerCase().trim()),
  name: z.string().trim().min(1).max(100),
  password: password.refine((s) => s.length >= 10, 'Password must contain at least 10 characters'),
});
export const loginSchema = z.object({
  email: z
    .string()
    .max(320)
    .transform((s) => s.toLowerCase().trim()),
  password,
});
export async function makeSession(db: Knex, user: User, res: Response) {
  const token = randomBytes(32).toString('base64url'),
    csrfToken = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + 7 * 86_400_000);
  await db('sessions').insert({
    token_hash: hash(token),
    user_id: user.id,
    csrf_token: csrfToken,
    expires_at: expires.toISOString(),
  });
  res.cookie('sat_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires,
  });
  return { user, csrfToken };
}
export function authentication(db: Knex) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = req.cookies?.sat_session;
    if (token) {
      const session = await db('sessions')
        .join('users', 'users.id', 'sessions.user_id')
        .where('sessions.token_hash', hash(token))
        .where('expires_at', '>', now())
        .select('users.*', 'csrf_token', 'token_hash')
        .first();
      if (session) {
        Object.assign(req, {
          user: publicUser(session),
          csrfToken: session.csrf_token,
          sessionHash: session.token_hash,
        });
      }
    }
    next();
  };
}
export function authenticated(req: Request, _res: Response, next: NextFunction) {
  if (!(req as AuthRequest).user) throw new ApiError(401, 'Sign in to continue');
  next();
}
export function roles(...allowed: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    authenticated(req, _res, () => {});
    if (!allowed.includes((req as AuthRequest).user.role))
      throw new ApiError(403, 'You do not have permission for this action');
    next();
  };
}
export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin'),
    expected = process.env.APP_ORIGIN || `${req.protocol}://${req.get('host')}`;
  if (origin && origin !== expected) throw new ApiError(403, 'Request origin is not allowed');
  // All session-authenticated mutation requests require the token, including logout.
  if ((req as AuthRequest).user && req.get('x-csrf-token') !== (req as AuthRequest).csrfToken)
    throw new ApiError(403, 'Invalid CSRF token');
  if (!origin && req.get('sec-fetch-site') === 'cross-site')
    throw new ApiError(403, 'Cross-site request is not allowed');
  next();
}
export async function createUser(db: Knex, input: z.infer<typeof registerSchema>, role = 'student') {
  if (await db('users').where({ email: input.email }).first())
    throw new ApiError(409, 'An account with this email already exists');
  const user = {
    id: randomUUID(),
    email: input.email,
    name: input.name,
    password_hash: await bcrypt.hash(input.password, 12),
    role,
    created_at: now(),
  };
  await db('users').insert(user);
  return publicUser(user);
}
