import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

// Exercise the actual built app and external API with an isolated assessment DB.
// Neither the configured browser API key nor request URLs are recorded.
const origin = 'http://127.0.0.1:3002';
const apiScript = /https:\/\/www\.desmos\.com\/api\/v[\d.]+\/calculator\.js(?:\?.*)?$/;
const runtimeDirectory = resolve('.runtime');
const evidenceDirectory = resolve('docs/screenshots');
mkdirSync(runtimeDirectory, { recursive: true });
mkdirSync(evidenceDirectory, { recursive: true });
assert.ok(process.env.VITE_DESMOS_API_KEY, 'Configure VITE_DESMOS_API_KEY before running this check.');

function sanitized(message) {
  let text = String(message).replace(/([?&]apiKey=)[^\s&"'<>]+/gi, '$1[redacted]');
  if (process.env.VITE_DESMOS_API_KEY) text = text.split(process.env.VITE_DESMOS_API_KEY).join('[redacted]');
  return text;
}

let server;
let browser;
let serverOutput = '';
let diagnosticPage;
const diagnostics = [];
const results = {
  researchedDate: '2026-10-09',
  source: 'built application with real Desmos API',
  origin,
  checks: {},
};

async function waitForHealth() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null)
      throw new Error(`Isolated server exited: ${sanitized(serverOutput.slice(-1600))}`);
    try {
      const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok && (await response.json()).status === 'ok') return;
    } catch {
      // Initialization includes migrations and original seed data.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error('Isolated server did not become healthy within 30 seconds.');
}

async function newMathSession(context, name) {
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.setDefaultNavigationTimeout(30_000);
  await page.goto(origin);
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Email address').fill(`desmos-${randomUUID()}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill(`Practice-${randomUUID()}`);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Good to see you/ })).toBeVisible();
  const session = await (await page.request.get(`${origin}/api/me`)).json();
  const response = await page.request.post(`${origin}/api/attempts`, {
    headers: { 'X-CSRF-Token': session.csrfToken },
    data: { mode: 'practice', section: 'math', count: 2, seed: 'desmos-live-smoke' },
  });
  assert.equal(response.status(), 201, 'Create a real Math attempt with session CSRF protection.');
  const attempt = await response.json();
  await page.goto(`${origin}/test/${attempt.id}`);
  await expect(page.getByRole('button', { name: 'Calculator', exact: true })).toBeVisible();
  return page;
}

async function assertRealCalculator(page) {
  const calculator = page.getByRole('dialog', { name: 'Calculator', exact: true });
  await expect(calculator.getByText('Desmos Graphing Calculator', { exact: true })).toBeVisible();
  await expect(calculator.locator('iframe.desmos-frame')).toHaveAttribute('sandbox', 'allow-scripts');
  assert.equal(
    await page.evaluate(() => typeof window.Desmos),
    'undefined',
    'Desmos must stay inside its calculator frame.',
  );
  const frame = calculator.frameLocator('iframe.desmos-frame');
  const native = frame.locator('#calculator');
  await expect(native).toBeVisible({ timeout: 30_000 });
  await expect(native.locator('canvas').first()).toBeVisible();
  assert.ok(await native.evaluate(() => typeof window.Desmos?.GraphingCalculator === 'function'));
  return { calculator, native };
}

async function canvasFingerprint(native) {
  const snapshot = await native
    .locator('canvas')
    .evaluateAll((canvases) => canvases.map((canvas) => canvas.toDataURL()).join('|'));
  return createHash('sha256').update(snapshot).digest('hex');
}

try {
  let occupied = false;
  try {
    await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) });
    occupied = true;
  } catch {
    // Only this script's child process owns the test listener.
  }
  assert.equal(occupied, false, 'Port 3002 is already in use; preserve the existing service.');
  server = spawn(process.execPath, ['dist-server/index.js'], {
    cwd: process.cwd(),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: '3002',
      APP_ORIGIN: origin,
      SQLITE_PATH: resolve(runtimeDirectory, `desmos-smoke-${randomUUID()}.sqlite`),
      DATABASE_URL: '',
      ADMIN_EMAIL: '',
      ADMIN_PASSWORD: '',
      SEED_SAMPLE_DATA: 'true',
    },
  });
  server.stdout.on('data', (chunk) => {
    serverOutput += sanitized(chunk.toString());
  });
  server.stderr.on('data', (chunk) => {
    serverOutput += sanitized(chunk.toString());
  });
  await waitForHealth();
  const mainPolicy = (await fetch(origin)).headers.get('content-security-policy') || '';
  assert.ok(mainPolicy, 'The built application must send its main Content Security Policy.');
  assert.doesNotMatch(mainPolicy, /unsafe-eval/, 'Runtime evaluation must remain disabled in the main app.');
  const calculatorPolicy =
    (await fetch(`${origin}/desmos-calculator.html`)).headers.get('content-security-policy') || '';
  assert.match(calculatorPolicy, /script-src[^;]+www\.desmos\.com/);
  assert.match(calculatorPolicy, /script-src[^;]+unsafe-eval/);
  results.checks.mainCspEvalDisallowed = true;
  results.checks.calculatorCspIsolated = true;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const failures = [];
  const page = await newMathSession(context, 'Desmos Practice');
  diagnosticPage = page;
  page.on('pageerror', (error) => failures.push(sanitized(error.message)));
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.push(sanitized(message.text()));
    if (/Content Security Policy|Refused to .*worker/i.test(message.text()))
      failures.push(sanitized(message.text()));
  });
  page.on('requestfailed', (request) => {
    const address = new URL(request.url());
    diagnostics.push(
      `${address.origin}${address.pathname}: ${request.failure()?.errorText || 'request failed'}`,
    );
  });
  const scriptResponse = page.waitForResponse(
    (response) => apiScript.test(response.url()) && !(response.status() >= 300 && response.status() < 400),
    {
      timeout: 30_000,
    },
  );
  await page.getByRole('button', { name: 'Calculator', exact: true }).click();
  const external = await scriptResponse;
  assert.equal(external.status(), 200, 'The actual Desmos calculator API script must return HTTP 200.');
  const resolvedVersion = new URL(external.url()).pathname.match(/\/api\/v([\d.]+)\//)?.[1];
  let originalRequest = external.request();
  while (originalRequest.redirectedFrom()) originalRequest = originalRequest.redirectedFrom();
  const loadedVersion = new URL(originalRequest.url()).pathname.match(/\/api\/v([\d.]+)\//)?.[1];
  assert.equal(loadedVersion, process.env.VITE_DESMOS_API_VERSION || '1.12');
  const { calculator, native } = await assertRealCalculator(page);
  const beforeExpression = await canvasFingerprint(native);
  // Use the real expression editor; no constructor or scoring stubs are installed.
  const field = native.locator('.dcg-mq-editable-field').first();
  await expect(field).toBeVisible();
  await field.click();
  await page.keyboard.type('y=x^2');
  await page.keyboard.press('ArrowRight');
  await expect(native.locator('.dcg-expressionitem').first()).toContainText('y');
  const expressionText = await native.locator('.dcg-expressionitem').first().innerText();
  assert.match(expressionText, /x/);
  await expect.poll(() => canvasFingerprint(native)).not.toBe(beforeExpression);
  await page.screenshot({ path: resolve(evidenceDirectory, 'desmos-real.png'), animations: 'disabled' });
  const slider = calculator.getByRole('slider', { name: 'Calculator panel width', exact: true });
  await slider.focus();
  await slider.press('Home');
  await expect(calculator).toHaveCSS('width', '300px');
  await expect(native).toBeVisible();
  await page.screenshot({ path: resolve(evidenceDirectory, 'desmos-resized.png'), animations: 'disabled' });
  await calculator.getByRole('button', { name: 'Close calculator', exact: true }).click();
  await expect(calculator).toHaveCount(0);
  await page.getByRole('button', { name: 'Calculator', exact: true }).click();
  await assertRealCalculator(page);
  await calculator.getByRole('button', { name: 'Close calculator', exact: true }).click();
  assert.deepEqual(failures, [], 'Real Desmos use should produce no page errors or CSP violations.');
  Object.assign(results.checks, {
    realScriptHttp200: true,
    apiVersion: loadedVersion,
    resolvedApiVersion: resolvedVersion,
    realEditorInput: true,
    graphRendersExpression: true,
    graphCanvas: true,
    resize: true,
    closeReopen: true,
    csp: 'passed',
  });
  await context.close();

  const recoveryContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await recoveryContext.route(apiScript, (route) => route.abort('failed'));
  const recovery = await newMathSession(recoveryContext, 'Recovery Practice');
  await recovery.getByRole('button', { name: 'Calculator', exact: true }).click();
  const recoveryCalculator = recovery.getByRole('dialog', { name: 'Calculator', exact: true });
  await expect(recoveryCalculator.getByRole('button', { name: 'Retry Desmos', exact: true })).toBeVisible();
  await recoveryCalculator
    .getByRole('textbox', { name: 'Calculator expression', exact: true })
    .fill('sqrt(81)+2^3');
  await recoveryCalculator
    .getByRole('textbox', { name: 'Calculator expression', exact: true })
    .press('Enter');
  await expect(recoveryCalculator.locator('output')).toHaveText('17');
  await recovery.screenshot({
    path: resolve(evidenceDirectory, 'desmos-fallback.png'),
    animations: 'disabled',
  });
  await recoveryContext.unroute(apiScript);
  const retryResponse = recovery.waitForResponse(
    (response) => apiScript.test(response.url()) && !(response.status() >= 300 && response.status() < 400),
    {
      timeout: 30_000,
    },
  );
  await recoveryCalculator.getByRole('button', { name: 'Retry Desmos', exact: true }).click();
  assert.equal((await retryResponse).status(), 200);
  await assertRealCalculator(recovery);
  Object.assign(results.checks, {
    networkFailureFallback: true,
    fallbackNumericalResult: 17,
    retryLoadsRealDesmos: true,
  });
  await recoveryContext.close();
  writeFileSync(resolve(runtimeDirectory, 'desmos-smoke.json'), `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify(results, null, 2));
} catch (error) {
  console.error(sanitized(error instanceof Error ? error.message : error));
  if (diagnosticPage && !diagnosticPage.isClosed()) {
    const state = await diagnosticPage
      .locator('.calculator-panel')
      .innerText()
      .catch(() => 'Calculator unavailable');
    diagnostics.push(sanitized(state.slice(0, 1200)));
    const calculatorFrame = diagnosticPage
      .frames()
      .find((frame) => frame.url().includes('/desmos-calculator.html'));
    if (calculatorFrame) {
      const frameState = await calculatorFrame
        .locator('#calculator')
        .evaluate((element) => ({
          classes: [
            ...new Set([...element.querySelectorAll('[class]')].map((node) => node.getAttribute('class'))),
          ].slice(0, 50),
          fields: [...element.querySelectorAll('textarea,input,[role="textbox"]')]
            .slice(0, 12)
            .map((node) => ({
              tag: node.tagName,
              name: node.getAttribute('aria-label'),
              class: node.getAttribute('class'),
            })),
        }))
        .catch(() => null);
      if (frameState) diagnostics.push(JSON.stringify(frameState));
    }
    await diagnosticPage
      .screenshot({
        path: resolve(evidenceDirectory, 'desmos-failure-diagnostic.png'),
        animations: 'disabled',
      })
      .catch(() => {});
  }
  if (diagnostics.length) console.error(JSON.stringify({ diagnostics: diagnostics.slice(-10) }, null, 2));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([
      new Promise((resolveExit) => server.once('exit', resolveExit)),
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5000)),
    ]);
    if (server.exitCode === null) server.kill('SIGKILL');
  }
}
