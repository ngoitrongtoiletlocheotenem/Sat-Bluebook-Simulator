import 'dotenv/config';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';

const origin = process.env.APP_ORIGIN || 'http://127.0.0.1:3001';
const health = await fetch(`${origin}/api/health`);
assert.equal(health.status, 200);
assert.equal((await health.json()).status, 'ok');
const page = await fetch(`${origin}/`);
assert.equal(page.status, 200);
const html = await page.text();
assert.match(html, /Pathwise/);
const script = html.match(/src="([^"]+\.js)"/)?.[1];
assert.ok(script, 'Built entry script was not found');
assert.equal((await fetch(`${origin}${script}`)).status, 200);
assert.equal((await fetch(`${origin}/api/taxonomy`)).status, 200);
assert.equal((await fetch(`${origin}/api/me`)).status, 200);
assert.equal((await fetch(`${origin}/api/questions`)).status, 401);
const result = { origin, health: 'ok', builtPage: 'ok', builtScript: 'ok', guestAuthorization: 'ok' };
if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  const login = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
  });
  assert.equal(login.status, 200);
  const session = await login.json();
  assert.equal(session.user.role, 'admin');
  const cookie = login.headers
    .getSetCookie()
    .map((s) => s.split(';')[0])
    .join('; ');
  const headers = { Cookie: cookie };
  const bank = await fetch(`${origin}/api/questions`, { headers });
  assert.equal(bank.status, 200);
  const questions = await bank.json();
  assert.ok(questions.total >= 352);
  const blueprints = await fetch(`${origin}/api/blueprints`, { headers });
  assert.equal(blueprints.status, 200);
  assert.ok((await blueprints.json()).some((b) => b.kind === 'full'));
  const dashboard = await fetch(`${origin}/api/dashboard`, { headers });
  assert.equal(dashboard.status, 200);
  const history = (await dashboard.json()).history;
  assert.ok(Array.isArray(history), 'Saved session history must be readable.');
  if (process.env.SMOKE_EXPECT_EMPTY_HISTORY === 'true') {
    assert.equal(history.length, 0, 'A fresh deployment must start with empty history.');
  }
  const logout = await fetch(`${origin}/api/auth/logout`, {
    method: 'POST',
    headers: { ...headers, Origin: origin, 'X-CSRF-Token': session.csrfToken },
  });
  assert.equal(logout.status, 200);
  Object.assign(result, {
    adminAuthentication: 'ok',
    questions: questions.total,
    blueprint: 'ok',
    historyPersistence: 'ok',
    completedSessions: history.length,
  });
}
writeFileSync('data/deployment-smoke.json', `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
