import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { Attempt } from '../shared/types';

async function setup(page: Page, mode: 'practice' | 'tutor' = 'practice') {
  const signup = await page.request.post('/api/auth/register', {
    data: {
      name: 'Revision learner',
      email: `revision-${randomUUID()}@example.test`,
      password: `Study-${randomUUID()}`,
    },
  });
  expect(signup.status()).toBe(201);
  const { csrfToken } = await signup.json();
  const response = await page.request.post('/api/attempts', {
    headers: { 'X-CSRF-Token': csrfToken },
    data: { mode, section: 'rw', count: 2 },
  });
  expect(response.status()).toBe(201);
  return response.json() as Promise<Attempt>;
}
async function saved(page: Page) {
  await expect(page.locator('.test-footer [role="status"]')).toHaveText('All changes saved');
}
async function latest(page: Page, id: string): Promise<Attempt> {
  return (await page.request.get(`/api/attempts/${id}`)).json();
}
const disableWebLocks = () =>
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });

test('independent devices reject stale writes and restore offline pending state without overwriting', async ({
  page,
  context,
  browser,
}) => {
  await page.addInitScript(disableWebLocks);
  const created = await setup(page);
  const otherContext = await browser.newContext({ storageState: await context.storageState() });
  await otherContext.addInitScript(disableWebLocks);
  let first = page;
  const second = await otherContext.newPage();
  try {
    await Promise.all([first.goto(`/test/${created.id}`), second.goto(`/test/${created.id}`)]);
    await first.getByRole('radio', { name: 'Answer A', exact: true }).check();
    await saved(first);
    await second.getByRole('radio', { name: 'Answer B', exact: true }).check();
    await expect(second.getByText(/Saved state changed or this module closed/)).toBeVisible();
    await expect(second.getByRole('radio', { name: 'Answer A', exact: true })).toBeChecked();
    expect((await latest(second, created.id)).responses[created.module!.questions![0]!.id]!.answer).toBe('A');
    // A deliberate edit after reconciliation uses the current revision and succeeds.
    await second.getByRole('radio', { name: 'Answer B', exact: true }).check();
    await saved(second);
    await first.reload();
    await expect(first.getByRole('radio', { name: 'Answer B', exact: true })).toBeChecked();
    await context.setOffline(true);
    await first.getByRole('radio', { name: 'Answer C', exact: true }).check();
    await expect
      .poll(() =>
        first.evaluate(
          (id) => JSON.parse(localStorage.getItem(`sat-attempt-pending:${id}`) || 'null')?.responses,
          created.id,
        ),
      )
      .toBeTruthy();
    await first.close();
    await second.getByRole('radio', { name: 'Answer D', exact: true }).check();
    await saved(second);
    await context.setOffline(false);
    first = await context.newPage();
    await first.goto(`/test/${created.id}`);
    await expect(first.getByText(/Saved state changed since these local edits/)).toBeVisible();
    await expect(first.getByRole('radio', { name: 'Answer D', exact: true })).toBeChecked();
    expect(
      await first.evaluate((id) => localStorage.getItem(`sat-attempt-pending:${id}`), created.id),
    ).toBeNull();
    expect((await latest(first, created.id)).responses[created.module!.questions![0]!.id]!.answer).toBe('D');
  } finally {
    await context.setOffline(false);
    await otherContext.close();
  }
});

test('lost save acknowledgement reconciles safely and an unaccepted save can retry after refresh', async ({
  page,
}) => {
  await page.addInitScript(disableWebLocks);
  const created = await setup(page);
  const endpoint = `**/api/attempts/${created.id}`;
  let accepted = false;
  await page.route(endpoint, async (route) => {
    if (route.request().method() !== 'PATCH' || accepted) return route.continue();
    accepted = true;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    // The SQL commit succeeded, but the browser never receives its acknowledgement.
    await route.abort('failed');
  });
  await page.goto(`/test/${created.id}`);
  await page.getByRole('radio', { name: 'Answer A', exact: true }).check();
  await expect(page.locator('.test-footer [role="status"]')).toHaveText(
    'Saved on this device · waiting to reconnect',
  );
  expect((await latest(page, created.id)).responses[created.module!.questions![0]!.id]!.answer).toBe('A');
  await page.unroute(endpoint);
  await page.reload();
  await expect(page.getByText(/Saved state changed since these local edits/)).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Answer A', exact: true })).toBeChecked();
  await page.route(endpoint, async (route) =>
    route.request().method() === 'PATCH' ? route.abort('failed') : route.continue(),
  );
  await page.getByRole('radio', { name: 'Answer B', exact: true }).check();
  await expect(page.locator('.test-footer [role="status"]')).toHaveText(
    'Saved on this device · waiting to reconnect',
  );
  await page.unroute(endpoint);
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Answer B', exact: true })).toBeChecked();
  await saved(page);
  expect((await latest(page, created.id)).responses[created.module!.questions![0]!.id]!.answer).toBe('B');
});

test('tutor and pause acknowledgements serialize with periodic saves without Web Locks', async ({ page }) => {
  await page.addInitScript(disableWebLocks);
  const created = await setup(page, 'tutor');
  await page.goto(`/test/${created.id}`);
  await page.getByRole('radio', { name: 'Answer A', exact: true }).check();
  await saved(page);
  await page.clock.install();
  const conflicts: string[] = [];
  page.on('response', (response) => {
    if (response.status() === 409) conflicts.push(response.url());
  });
  for (const action of ['tutor', 'pause'] as const) {
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    const endpoint = `**/api/attempts/${created.id}/${action}`;
    let savesDuringAction = 0;
    const countSave = (request: import('@playwright/test').Request) => {
      if (request.method() === 'PATCH' && request.url().endsWith(`/api/attempts/${created.id}`))
        savesDuringAction++;
    };
    await page.route(endpoint, async (route) => {
      started();
      await gate;
      await route.continue();
    });
    if (action === 'tutor') await page.getByRole('button', { name: 'Check answer', exact: true }).click();
    else {
      await page.getByRole('button', { name: 'More tools', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Pause practice', exact: true }).click();
    }
    await waiting;
    page.on('request', countSave);
    await page.clock.runFor(11000);
    expect(savesDuringAction).toBe(0);
    release();
    if (action === 'tutor') await expect(page.locator('.tutor-feedback')).toBeVisible();
    else await expect(page.getByRole('button', { name: 'Resume practice', exact: true })).toBeVisible();
    page.off('request', countSave);
    await page.unroute(endpoint);
    await page.clock.runFor(11000);
  }
  await page.getByRole('button', { name: 'Resume practice', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Answer A', exact: true })).toBeChecked();
  await page.clock.runFor(11000);
  await saved(page);
  expect(conflicts).toEqual([]);
});
