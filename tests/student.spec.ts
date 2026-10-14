import { test, expect, type Page, type Locator, type APIRequestContext } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Attempt, Result, Question, ImportPreview } from '../shared/types';
import { emptyResponse } from '../shared/types';
import ExcelJS from 'exceljs';

const screenshots = resolve('docs/screenshots');
test.beforeAll(() => mkdirSync(screenshots, { recursive: true }));

async function register(page: Page, name = 'Jordan Practice') {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Create an account', exact: true })).toBeVisible();
  if (name === 'Jordan Practice') await screenshot(page, 'auth-desktop.png');
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Email address').fill(`student-${randomUUID()}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill(`Study-${randomUUID()}`);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Good to see you/ })).toBeVisible();
}

async function screenshot(page: Page, name: string, fullPage = false) {
  await page.screenshot({ path: resolve(screenshots, name), fullPage, animations: 'disabled' });
}

async function saved(page: Page) {
  await expect(page.locator('.test-footer [role="status"]')).toHaveText('All changes saved');
}

async function enableHighlights(page: Page) {
  const button = page.getByRole('button', { name: 'Highlights & Notes', exact: true });
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(button).toHaveCSS('border-bottom-width', '3px');
  await expect(button).toHaveCSS('border-bottom-color', 'rgb(0, 0, 0)');
}

async function reopenNotes(page: Page) {
  const button = page.getByRole('button', { name: 'Highlights & Notes', exact: true });
  if ((await button.getAttribute('aria-pressed')) === 'true') await button.click();
  await enableHighlights(page);
}

async function attempt(page: Page, id: string): Promise<Attempt> {
  const response = await page.request.get(`/api/attempts/${id}`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

async function selectProseWithMouse(page: Page, prose: Locator) {
  await prose.scrollIntoViewIfNeeded();
  const coordinates = await prose.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let text: Text | null = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if ((node.textContent?.trim().length || 0) >= 25 && !node.parentElement?.closest('.katex')) {
        text = node as Text;
        break;
      }
    }
    if (!text) throw new Error('No selectable prose was found.');
    const start = document.createRange();
    start.setStart(text, 0);
    start.setEnd(text, 1);
    const end = document.createRange();
    end.setStart(text, 23);
    end.setEnd(text, 24);
    const a = start.getBoundingClientRect(),
      b = end.getBoundingClientRect();
    return { x1: a.left + 1, y1: a.top + a.height / 2, x2: b.right - 1, y2: b.top + b.height / 2 };
  });
  // Coordinates are measured from real text. Selection itself uses mouse events.
  await page.mouse.move(coordinates.x1, coordinates.y1);
  await page.mouse.down();
  await page.mouse.move(coordinates.x2, coordinates.y2, { steps: 12 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.getSelection()?.toString().trim().length || 0)).toBeGreaterThan(5);
}

async function completeModule(page: Page, questionCount: number) {
  for (let index = 0; index < questionCount; index++) {
    await expect(page.getByRole('button', { name: 'Question menu', exact: true })).toContainText(
      `Question ${index + 1} of ${questionCount}`,
    );
    const numeric = page.getByRole('textbox', { name: 'Numeric answer', exact: true });
    if (await numeric.count()) await numeric.fill('0');
    else await page.getByRole('radio', { name: 'Answer A', exact: true }).check();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: 'Check Your Work', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Submit module', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Submit this module?', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm submit', exact: true }).click();
}

test('complete adaptive SAT, persist tools, print report, inspect mistakes and retry', async ({ page }) => {
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await register(page);
  await screenshot(page, 'dashboard-desktop.png', true);
  await page.getByRole('button', { name: 'Take a full practice test', exact: true }).click();
  await expect(page).toHaveURL(/\/test\/[a-z0-9-]+$/);
  const id = page.url().split('/').at(-1)!;
  await expect(
    page.getByRole('heading', { name: 'Section I, Module 1: Reading and Writing', exact: true }),
  ).toBeVisible();
  const initial = await attempt(page, id);
  expect(initial.module?.questionCount).toBe(27);
  expect(initial.module?.durationSeconds).toBe(1920);
  const firstQuestion = initial.module!.questions![0]!;
  expect(firstQuestion.correctAnswer).toBeUndefined();
  expect(firstQuestion.explanation).toBeUndefined();
  await screenshot(page, 'player-reading-desktop.png');
  const notes = page.getByRole('complementary', { name: 'Highlights & Notes panel', exact: true });
  const annotation = page.getByRole('toolbar', { name: 'Highlights & Notes', exact: true });
  await expect(page.getByRole('button', { name: 'Highlights & Notes', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await selectProseWithMouse(page, page.locator('.passage-content .rich-text'));
  await expect(annotation).toHaveCount(0);
  expect((await attempt(page, id)).responses[firstQuestion.id]?.highlights ?? []).toHaveLength(0);
  await enableHighlights(page);
  await expect(notes).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Highlights & Notes', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(
    page.getByRole('separator', { name: 'Resize passage and question panels', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('separator', { name: 'Resize notes panel', exact: true })).toHaveCount(0);

  await page.getByRole('radio', { name: 'Answer A', exact: true }).check();
  const eliminatorIconText = page
    .getByRole('button', { name: 'Option eliminator', exact: true })
    .locator('svg text');
  await expect(eliminatorIconText).toHaveCSS('fill', 'rgb(30, 30, 30)');
  await page.getByRole('button', { name: 'Option eliminator', exact: true }).click();
  await expect(eliminatorIconText).toHaveCSS('fill', 'rgb(255, 255, 255)');
  await page.getByRole('button', { name: 'Eliminate choice A', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Answer A', exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Restore choice A', exact: true })).toBeVisible();
  await screenshot(page, 'eliminator.png');
  await page.getByRole('button', { name: 'Mark for Review', exact: true }).click();
  await selectProseWithMouse(page, page.locator('.passage-content .rich-text'));
  await expect(annotation).toBeVisible();
  const paletteBounds = await annotation.locator('.annotation-palette').boundingBox();
  expect(paletteBounds?.height).toBeGreaterThanOrEqual(60);
  expect(paletteBounds?.height).toBeLessThanOrEqual(76);
  expect(paletteBounds?.width).toBeGreaterThanOrEqual(300);
  expect(paletteBounds?.width).toBeLessThanOrEqual(440);
  expect(paletteBounds!.x).toBeGreaterThanOrEqual(0);
  expect(paletteBounds!.x + paletteBounds!.width).toBeLessThanOrEqual(1440);
  await annotation.getByRole('button', { name: 'Highlight yellow', exact: true }).click();
  await expect(notes).toHaveCount(0);
  await screenshot(page, 'annotation-toolbar.png');
  await annotation.getByRole('button', { name: 'Add note', exact: true }).click();
  await expect(notes).toBeVisible();
  await expect(annotation).toHaveCount(0);
  const railBounds = await notes.boundingBox();
  expect(railBounds!.width).toBe(280);
  expect(railBounds!.x).toBeGreaterThan(350);
  expect(railBounds!.x + railBounds!.width).toBeLessThan(1100);
  await expect(notes.getByRole('separator', { name: 'Resize notes panel', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Highlights & Notes', exact: true }).locator('.highlights-notes-icon'),
  ).toHaveCount(1);
  const attachedNote = notes.getByRole('textbox', { name: /^Note for / }).first();
  await expect(attachedNote).toBeFocused();
  await attachedNote.fill('The evidence supports the main idea.');
  await saved(page);
  await expect(page.getByRole('dialog', { name: 'Highlights & Notes', exact: true })).toHaveCount(0);
  await screenshot(page, 'annotation-note.png');
  await screenshot(page, 'notes-sidebar.png');
  await notes.getByRole('button', { name: 'Close notes panel', exact: true }).click();
  await expect(notes).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Highlights & Notes', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.passage-content mark')).toHaveCount(1);
  await page.getByRole('button', { name: 'Highlights & Notes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Highlights & Notes', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.locator('.passage-content mark').click();
  await expect(annotation).toHaveCount(0);
  await expect(notes).toHaveCount(0);
  expect((await attempt(page, id)).responses[firstQuestion.id]?.highlights[0]?.note).toBe(
    'The evidence supports the main idea.',
  );
  await enableHighlights(page);
  await expect(notes).toBeVisible();
  await expect(page.getByRole('button', { name: 'Highlights & Notes', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(attachedNote).toHaveValue('The evidence supports the main idea.');
  await expect(page.getByRole('dialog', { name: 'Highlights & Notes', exact: true })).toHaveCount(0);
  await screenshot(page, 'highlights-notes-icon.png');
  await notes.getByRole('button', { name: 'Close notes panel', exact: true }).click();
  await saved(page);

  await page.getByRole('button', { name: 'Question menu', exact: true }).click();
  const navigator = page.getByRole('dialog', { name: 'Question navigation', exact: true });
  await expect(
    navigator.getByRole('button', { name: 'Question 1, answered, marked for review, current', exact: true }),
  ).toBeVisible();
  await screenshot(page, 'player-question-menu.png');
  await navigator.getByRole('button', { name: 'Question 2, unanswered', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await saved(page);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Highlights & Notes', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(notes).toHaveCount(0);
  await expect(page.getByRole('radio', { name: 'Answer A', exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Mark for Review', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.answer-choice.eliminated')).toHaveCount(1);
  await expect(page.locator('.passage-content mark')).toHaveCount(1);
  const resumed = await attempt(page, id);
  expect(resumed.module?.deadline).toBe(initial.module?.deadline);
  expect(resumed.responses[firstQuestion.id]?.highlights[0]?.note).toBe(
    'The evidence supports the main idea.',
  );
  expect(resumed.responses[firstQuestion.id]?.highlights[0]?.noteAttached).toBe(true);
  expect(resumed.responses[firstQuestion.id]?.note).toBe('');
  await enableHighlights(page);
  await expect(attachedNote).toHaveValue('The evidence supports the main idea.');
  await notes.getByRole('button', { name: 'Close notes panel', exact: true }).click();

  await completeModule(page, 27);
  await expect(
    page.getByRole('heading', { name: 'Section I, Module 2: Reading and Writing', exact: true }),
  ).toBeVisible();
  const routedRw = await attempt(page, id);
  expect(['higher', 'lower']).toContain(routedRw.module?.route);
  expect(routedRw.modules[0]?.status).toBe('closed');
  await completeModule(page, 27);
  await expect(page.getByRole('heading', { name: 'Practice Test Break', exact: true })).toBeVisible();
  await expect(page.locator('.break-countdown')).toContainText('Remaining Break Time');
  await screenshot(page, 'player-break.png');
  // The normal ten-minute break is created. Practice expressly permits ending it early.
  await page.getByRole('button', { name: 'Resume Testing', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Section II, Module 1: Math', exact: true })).toBeVisible();
  expect((await attempt(page, id)).module?.durationSeconds).toBe(2100);
  await page.getByRole('button', { name: 'Calculator', exact: true }).click();
  const calculator = page.getByRole('dialog', { name: 'Calculator', exact: true });
  await calculator.getByRole('textbox', { name: 'Calculator expression' }).fill('sqrt(81)+2^3');
  await calculator.getByRole('textbox', { name: 'Calculator expression' }).press('Enter');
  await expect(calculator.locator('output')).toHaveText('17');
  await calculator.getByRole('slider', { name: 'Calculator panel width' }).focus();
  await calculator.getByRole('slider', { name: 'Calculator panel width' }).press('Home');
  await expect(calculator).toHaveCSS('width', '300px');
  await screenshot(page, 'player-math-calculator.png');
  await page.getByRole('button', { name: 'Close calculator', exact: true }).click();
  await page.getByRole('button', { name: 'Math reference', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Math Reference', exact: true })).toBeVisible();
  await screenshot(page, 'player-math-reference.png');
  await page.getByRole('button', { name: 'Close Math Reference', exact: true }).click();
  await completeModule(page, 22);
  await expect(page.getByRole('heading', { name: 'Section II, Module 2: Math', exact: true })).toBeVisible();
  expect(['higher', 'lower']).toContain((await attempt(page, id)).module?.route);
  await completeModule(page, 22);
  await expect(page).toHaveURL(`/results/${id}`);
  await expect(page.getByRole('heading', { name: 'Knowledge and Skills', exact: true })).toBeVisible();
  await expect(page.locator('.seven-bands')).toHaveCount(8);
  await expect(page.locator('.seven-bands span')).toHaveCount(56);
  const resultResponse = await page.request.get(`/api/attempts/${id}/result`);
  expect(resultResponse.ok()).toBeTruthy();
  const result: Result = await resultResponse.json();
  expect(result.total).toBe(98);
  expect(result.scoreLabel).toBe('Estimated SAT Score');
  expect(result.totalScore).toBeGreaterThanOrEqual(400);
  expect(result.totalScore).toBeLessThanOrEqual(1600);
  expect(result.review.length).toBe(98);
  await screenshot(page, 'score-report-desktop.png', true);

  await page.evaluate(() => {
    window.print = () => {
      document.documentElement.dataset.printInvoked = 'true';
    };
  });
  await page.getByRole('button', { name: 'Print report', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-print-invoked', 'true');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(page.locator('.score-report')).toBeVisible();
  await screenshot(page, 'score-report-print.png', true);
  await page.pdf({ path: resolve(screenshots, 'score-report-a4.pdf'), format: 'A4', printBackground: true });
  await page.pdf({
    path: resolve(screenshots, 'score-report-letter.pdf'),
    format: 'Letter',
    printBackground: true,
  });
  for (const filename of ['score-report-a4.pdf', 'score-report-letter.pdf']) {
    const pdf = readFileSync(resolve(screenshots, filename)).toString('latin1');
    expect(
      (pdf.match(/\/Type\s*\/Page\b/g) || []).length,
      `${filename} must fit its summary on one page`,
    ).toBe(1);
  }
  await page.emulateMedia({ media: 'screen' });

  await page.getByRole('button', { name: 'Incorrect', exact: true }).click();
  await page.getByRole('button', { name: 'Review', exact: true }).first().click();
  const review = page.getByRole('dialog', { name: 'Question review', exact: true });
  await expect(review.getByRole('heading', { name: 'The reasoning', exact: true })).toBeVisible();
  await expect(review.locator('.answer-summary')).toContainText('Correct:');
  const bookmarkRequest = page.waitForResponse(
    (response) => response.url().includes('/api/bookmarks/') && response.request().method() === 'POST',
  );
  await review.getByRole('button', { name: 'Save question', exact: true }).click();
  const bookmarkResponse = await bookmarkRequest;
  expect(bookmarkResponse.ok(), await bookmarkResponse.text()).toBeTruthy();
  expect(await bookmarkResponse.json()).toEqual({ bookmarked: true });
  const bookmarkId = bookmarkResponse.url().split('/').at(-1);
  expect(
    (await (await page.request.get('/api/bookmarks')).json()).some(
      (question: Question) => question.id === bookmarkId,
    ),
  ).toBeTruthy();
  await review.getByRole('button', { name: 'Retry question', exact: true }).click();
  await expect(page).toHaveURL(/\/test\/[a-z0-9-]+$/);
  await completeModule(page, 1);
  await expect(page).toHaveURL(/\/results\/[a-z0-9-]+$/);
  await page.getByRole('link', { name: 'Mistake journal', exact: true }).click();
  await expect(page.locator('.error-row').first()).toBeVisible();
  await page.locator('.error-row .question-link').first().click();
  const journal = page.getByRole('dialog', { name: 'A closer look at your mistake', exact: true });
  const setReason = page.waitForResponse(
    (response) => response.url().includes('/api/errors/') && response.request().method() === 'PUT',
  );
  await journal
    .getByRole('combobox', { name: 'What got in the way?', exact: true })
    .selectOption('Concept gap');
  expect((await setReason).ok()).toBeTruthy();
  const clearReason = page.waitForResponse(
    (response) => response.url().includes('/api/errors/') && response.request().method() === 'PUT',
  );
  await journal.getByRole('combobox', { name: 'What got in the way?', exact: true }).selectOption('');
  expect((await clearReason).ok()).toBeTruthy();
  await journal.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('link', { name: 'Progress & history', exact: true }).click();
  await expect(page.getByRole('img', { name: /SAT score history/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View report', exact: true })).toHaveCount(2);
  expect(browserErrors).toEqual([]);
});

test('offline autosave reconnects and practice pause survives reload', async ({ page, context }) => {
  await register(page, 'Riley Review');
  const me = await (await page.request.get('/api/me')).json();
  const response = await page.request.post('/api/attempts', {
    headers: { 'X-CSRF-Token': me.csrfToken },
    data: { mode: 'practice', section: 'rw', count: 2, seed: 'offline-review-contract' },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const created: Attempt = await response.json();
  await page.goto(`/test/${created.id}`);
  await expect(page.getByRole('radio', { name: 'Answer B', exact: true })).toBeVisible();
  await context.setOffline(true);
  await page.getByRole('radio', { name: 'Answer B', exact: true }).check();
  await page.getByRole('button', { name: 'Mark for Review', exact: true }).click();
  await expect(page.locator('.test-footer [role="status"]')).toContainText('offline');
  await context.setOffline(false);
  await saved(page);
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Answer B', exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Mark for Review', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'More tools', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Pause practice', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your practice is paused', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your practice is paused', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resume practice', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Answer B', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'More tools', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: /Line reader/ }).click();
  await expect(page.locator('.line-reader-shade')).toBeVisible();
  await page.keyboard.press('Alt+Shift+L');
  await expect(page.locator('.line-reader-shade')).toHaveCount(0);
  await page.keyboard.press('Control+Alt+G');
  await expect(page.getByRole('dialog', { name: 'Question navigation', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Question navigation', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 1024, height: 768 });
  await screenshot(page, 'player-reading-tablet.png');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test('administrator bank versions, manual/random blueprints, import formats and server permissions', async ({
  request,
  playwright,
}) => {
  const login = await request.post('/api/auth/login', {
    data: { email: process.env.PLAYWRIGHT_ADMIN_EMAIL, password: process.env.PLAYWRIGHT_ADMIN_PASSWORD },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
  const admin = await login.json();
  expect(admin.user.role).toBe('admin');
  const adminHeaders = { 'X-CSRF-Token': admin.csrfToken };
  const unique = randomUUID();
  const original = {
    publicId: `E2E-${unique}`,
    section: 'math',
    domainId: 'math-algebra',
    skillId: 'math-algebra-1',
    type: 'mcq',
    difficulty: 'easy',
    passage: '',
    stem: 'What is six multiplied by seven?',
    choices: [
      { id: 'A', text: '42', rationale: 'Six groups of seven equals forty-two.' },
      { id: 'B', text: '41', rationale: 'This is one less than the product.' },
      { id: 'C', text: '43', rationale: 'This is one more than the product.' },
      { id: 'D', text: '13', rationale: 'This adds the two numbers instead of multiplying.' },
    ],
    correctAnswer: 'A',
    explanation: 'Multiplication gives $6\\times7=42$.',
    license: 'CC0-1.0; original E2E educational fixture.',
    source: 'E2E original authors',
    status: 'published',
  };
  const createdResponse = await request.post('/api/questions', { headers: adminHeaders, data: original });
  expect(createdResponse.status(), await createdResponse.text()).toBe(201);
  const created: Question = await createdResponse.json();
  expect(created.version).toBe(1);
  const oldAttemptResponse = await request.post('/api/attempts', {
    headers: adminHeaders,
    data: { mode: 'practice', questionIds: [created.id], count: 1 },
  });
  expect(oldAttemptResponse.ok(), await oldAttemptResponse.text()).toBeTruthy();
  const oldAttempt: Attempt = await oldAttemptResponse.json();
  const updatedInput = {
    ...original,
    stem: 'What is seven multiplied by six? <script>alert("unsafe")</script>',
    choices: [
      { id: 'A', text: '41', rationale: 'One less.' },
      { id: 'B', text: '42', rationale: 'Correct product.' },
      ...original.choices.slice(2),
    ],
    correctAnswer: 'B',
  };
  const updateResponse = await request.put(`/api/questions/${created.id}`, {
    headers: adminHeaders,
    data: updatedInput,
  });
  expect(updateResponse.ok(), await updateResponse.text()).toBeTruthy();
  const updated: Question = await updateResponse.json();
  expect(updated.version).toBe(2);
  expect(updated.stem).not.toContain('<script');
  const versions = await (await request.get(`/api/questions/${created.id}/versions`)).json();
  expect(versions.map((version: { version: number }) => version.version).sort()).toEqual([1, 2]);
  const saveOld = await request.patch(`/api/attempts/${oldAttempt.id}`, {
    headers: adminHeaders,
    data: {
      moduleId: oldAttempt.module!.id,
      responses: { [created.id]: { ...emptyResponse(), answer: 'A' } },
    },
  });
  expect(saveOld.ok(), await saveOld.text()).toBeTruthy();
  const finishOld = await request.post(`/api/attempts/${oldAttempt.id}/finish-module`, {
    headers: adminHeaders,
    data: { moduleId: oldAttempt.module!.id },
  });
  expect(finishOld.ok(), await finishOld.text()).toBeTruthy();
  const oldResult: Result = await (await request.get(`/api/attempts/${oldAttempt.id}/result`)).json();
  expect(oldResult.correct).toBe(1);
  expect(oldResult.review[0]?.question.version).toBe(1);
  const locked = await request.patch(`/api/attempts/${oldAttempt.id}`, {
    headers: adminHeaders,
    data: {
      moduleId: oldAttempt.module!.id,
      responses: { [created.id]: { ...emptyResponse(), answer: 'B' } },
    },
  });
  expect(locked.status()).toBe(409);

  const bank = await (await request.get('/api/questions?section=math&pageSize=3')).json();
  const other = bank.items.find((question: Question) => question.id !== created.id) as Question;
  expect(other.id).toBeTruthy();
  const blueprint = {
    title: `Manual E2E ${unique}`,
    description: 'Original manual workflow verification',
    kind: 'custom',
    published: true,
    seed: 'manual-e2e',
    routingThreshold: 0.65,
    routingModelVersion: 'internal-test-v1',
    modules: [
      {
        section: 'math',
        index: 1,
        route: 'mixed',
        count: 2,
        durationSeconds: 60,
        questionIds: [created.id, other.id],
      },
    ],
  };
  const manualResponse = await request.post('/api/blueprints', { headers: adminHeaders, data: blueprint });
  expect(manualResponse.status(), await manualResponse.text()).toBe(201);
  const manual = await manualResponse.json();
  const manualAttemptResponse = await request.post('/api/attempts', {
    headers: adminHeaders,
    data: { mode: 'practice', blueprintId: manual.id, seed: 'manual-assembly' },
  });
  expect(manualAttemptResponse.ok(), await manualAttemptResponse.text()).toBeTruthy();
  const manualAttempt: Attempt = await manualAttemptResponse.json();
  expect(manualAttempt.module?.questions?.map((question) => question.id)).toEqual([created.id, other.id]);
  const randomResponse = await request.post('/api/blueprints', {
    headers: adminHeaders,
    data: {
      ...blueprint,
      title: `Random E2E ${unique}`,
      modules: [{ ...blueprint.modules[0], count: 5, questionIds: [] }],
    },
  });
  expect(randomResponse.ok(), await randomResponse.text()).toBeTruthy();
  const random = await randomResponse.json();
  const generate = async () => {
    const response = await request.post('/api/attempts', {
      headers: adminHeaders,
      data: { mode: 'practice', blueprintId: random.id, seed: 'repeatable-e2e-seed' },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json() as Promise<Attempt>;
  };
  const randomA = await generate(),
    randomB = await generate();
  expect(randomA.module?.questions?.map((question) => question.id)).toEqual(
    randomB.module?.questions?.map((question) => question.id),
  );

  const importQuestion = {
    ...original,
    publicId: `IMPORT-${unique}`,
    stem: `An original E2E product question: what is 6 times 7? Fixture ${unique}.`,
  };
  const previewResponse = await request.post('/api/imports/preview', {
    headers: adminHeaders,
    multipart: {
      scope: 'global',
      file: {
        name: 'questions.json',
        mimeType: 'application/json',
        buffer: Buffer.from(
          JSON.stringify([
            importQuestion,
            { ...importQuestion, publicId: `INVALID-${unique}`, explanation: '' },
            updated,
          ]),
        ),
      },
    },
  });
  expect(previewResponse.ok(), await previewResponse.text()).toBeTruthy();
  const preview: ImportPreview = await previewResponse.json();
  expect(preview.valid).toBe(1);
  expect(preview.invalid).toBe(1);
  expect(preview.duplicates).toBeGreaterThanOrEqual(1);
  const beforeConfirm = await (await request.get(`/api/questions?q=IMPORT-${unique}`)).json();
  expect(beforeConfirm.total).toBe(0);
  const confirmation = await request.post(`/api/imports/${preview.id}/confirm`, {
    headers: adminHeaders,
    data: { skipDuplicates: true },
  });
  expect(confirmation.ok(), await confirmation.text()).toBeTruthy();
  expect(await confirmation.json()).toMatchObject({ imported: 1, skipped: 2 });
  expect((await (await request.get(`/api/questions?q=IMPORT-${unique}`)).json()).total).toBe(1);

  const csvTemplate = await request.get('/api/imports/template?format=csv');
  expect(csvTemplate.ok()).toBeTruthy();
  const csvPreview = await request.post('/api/imports/preview', {
    headers: adminHeaders,
    multipart: {
      scope: 'private',
      file: {
        name: 'questions.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from((await csvTemplate.text()).replace('YOUR-001', `CSV-${unique}`)),
      },
    },
  });
  expect(csvPreview.ok(), await csvPreview.text()).toBeTruthy();
  expect((await csvPreview.json()).invalid).toBe(0);
  const workbook = new ExcelJS.Workbook(),
    sheet = workbook.addWorksheet('Questions');
  const xlsxRow = {
    ...importQuestion,
    publicId: `XLSX-${unique}`,
    stem: `An original spreadsheet item ${unique}.`,
    choices: JSON.stringify(importQuestion.choices),
  };
  sheet.addRow(Object.keys(xlsxRow));
  sheet.addRow(Object.values(xlsxRow));
  const xlsxPreview = await request.post('/api/imports/preview', {
    headers: adminHeaders,
    multipart: {
      scope: 'private',
      file: {
        name: 'questions.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      },
    },
  });
  expect(xlsxPreview.ok(), await xlsxPreview.text()).toBeTruthy();
  expect(await xlsxPreview.json()).toMatchObject({ valid: 1, invalid: 0 });
  const exportResponse = await request.get('/api/questions/export');
  expect(exportResponse.ok()).toBeTruthy();
  expect(
    (await exportResponse.json()).some((question: Question) => question.publicId === importQuestion.publicId),
  ).toBeTruthy();

  const studentRequest: APIRequestContext = await playwright.request.newContext({
    baseURL: 'http://127.0.0.1:5173',
  });
  try {
    const registration = await studentRequest.post('/api/auth/register', {
      data: {
        email: `permission-${unique}@example.com`,
        name: 'Permission Student',
        password: `Study-${randomUUID()}`,
      },
    });
    expect(registration.ok(), await registration.text()).toBeTruthy();
    const student = await registration.json(),
      studentHeaders = { 'X-CSRF-Token': student.csrfToken };
    expect((await studentRequest.get('/api/users')).status()).toBe(403);
    expect(
      (await studentRequest.post('/api/blueprints', { headers: studentHeaders, data: blueprint })).status(),
    ).toBe(403);
    expect(
      (
        await studentRequest.put(`/api/questions/${created.id}`, { headers: studentHeaders, data: updated })
      ).status(),
    ).toBe(403);
    expect(
      (await studentRequest.delete(`/api/questions/${created.id}`, { headers: studentHeaders })).status(),
    ).toBe(403);
    expect(
      (await studentRequest.post('/api/attempts', { data: { mode: 'practice', count: 1 } })).status(),
    ).toBe(403);
    expect((await studentRequest.get(`/api/attempts/${oldAttempt.id}`)).status()).toBe(404);
    const privateResponse = await studentRequest.post('/api/questions', {
      headers: studentHeaders,
      data: {
        ...original,
        publicId: `PRIVATE-${unique}`,
        stem: `Student's original private item ${unique}.`,
      },
    });
    expect(privateResponse.ok(), await privateResponse.text()).toBeTruthy();
    expect((await privateResponse.json()).ownerId).toBe(student.user.id);
  } finally {
    await studentRequest.dispose();
  }
  const archived = await request.delete(`/api/questions/${created.id}`, { headers: adminHeaders });
  expect(archived.ok(), await archived.text()).toBeTruthy();
  expect(await archived.json()).toMatchObject({ status: 'archived', version: 3 });
});

test('annotations cross formatting and original chart supports zoom, pan and numeric tutor feedback', async ({
  page,
}) => {
  await register(page, 'Casey Evidence');
  const me = await (await page.request.get('/api/me')).json();
  const headers = { 'X-CSRF-Token': me.csrfToken };
  const id = randomUUID();
  const content = {
    publicId: `RICH-${id}`,
    section: 'rw',
    domainId: 'rw-information',
    skillId: 'rw-information-1',
    type: 'mcq',
    difficulty: 'medium',
    passage:
      '<p>The research team gathered <strong>reliable evidence from repeated measurements</strong> before drawing its conclusion.</p>',
    stem: 'Which choice describes the researchers’ process?',
    choices: [
      'Gathering evidence before concluding.',
      'Guessing without observations.',
      'Ignoring measurements.',
      'Repeating a conclusion without evidence.',
    ].map((text, index) => ({
      id: 'ABCD'[index],
      text,
      rationale:
        index === 0
          ? 'The passage explicitly describes evidence collection.'
          : 'This conflicts with the passage.',
    })),
    correctAnswer: 'A',
    explanation: 'They gathered reliable evidence before drawing a conclusion.',
    license: 'CC0-1.0; original browser test content.',
    source: 'Original test authors',
    status: 'published',
    private: true,
  };
  const questionResponse = await page.request.post('/api/questions', { headers, data: content });
  expect(questionResponse.ok(), await questionResponse.text()).toBeTruthy();
  const question: Question = await questionResponse.json();
  const createdResponse = await page.request.post('/api/attempts', {
    headers,
    data: { mode: 'practice', questionIds: [question.id], count: 1 },
  });
  expect(createdResponse.ok(), await createdResponse.text()).toBeTruthy();
  const created: Attempt = await createdResponse.json();
  await page.goto(`/test/${created.id}`);
  const prose = page.locator('.passage-content .rich-text');
  await expect(prose.locator('strong')).toBeVisible();
  await enableHighlights(page);
  const coordinates = await prose.evaluate((element) => {
    const first = element.querySelector('p')!.firstChild as Text;
    const strong = element.querySelector('strong')!.firstChild as Text;
    const start = document.createRange(),
      end = document.createRange();
    start.setStart(first, 5);
    start.setEnd(first, 6);
    end.setStart(strong, 13);
    end.setEnd(strong, 14);
    const a = start.getBoundingClientRect(),
      b = end.getBoundingClientRect();
    return { x1: a.left + 1, y1: a.top + a.height / 2, x2: b.right - 1, y2: b.top + b.height / 2 };
  });
  await page.mouse.move(coordinates.x1, coordinates.y1);
  await page.mouse.down();
  await page.mouse.move(coordinates.x2, coordinates.y2, { steps: 12 });
  await page.mouse.up();
  const annotation = page.getByRole('toolbar', { name: 'Highlights & Notes', exact: true });
  const notes = page.getByRole('complementary', { name: 'Highlights & Notes panel', exact: true });
  await expect(annotation).toBeVisible();
  await annotation.getByRole('button', { name: 'Highlight yellow', exact: true }).click();
  await expect(notes).toHaveCount(0);
  await annotation.getByRole('button', { name: 'Add note', exact: true }).click();
  const firstNote = notes.getByRole('textbox', { name: /^Note for / }).first();
  await expect(notes).toBeVisible();
  await expect(firstNote).toBeFocused();
  await expect(firstNote).toHaveValue('');
  await expect(annotation).toHaveCount(0);
  await saved(page);
  expect((await attempt(page, created.id)).responses[question.id]?.highlights[0]).toMatchObject({
    note: '',
    noteAttached: true,
  });
  await page.reload();
  await expect(notes).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Highlights & Notes', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await enableHighlights(page);
  await expect(notes).toBeVisible();
  await expect(page.getByRole('button', { name: 'Highlights & Notes', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(firstNote).toHaveValue('');
  await firstNote.fill('Two formatting spans share one annotation.');
  await notes.getByRole('button', { name: 'Close notes panel', exact: true }).click();
  await expect(prose.locator('mark')).toHaveCount(2);
  await saved(page);

  for (const [color, style] of [
    ['yellow', 'solid'],
    ['blue', 'dashed'],
    ['pink', 'dotted'],
  ] as const) {
    await prose.locator('mark').first().focus();
    await prose.locator('mark').first().press('Enter');
    await expect(annotation).toBeVisible();
    await annotation.getByRole('button', { name: `Highlight ${color}`, exact: true }).click();
    await annotation.getByRole('button', { name: 'Underline options', exact: true }).click();
    const item = page.getByRole('menuitemradio', {
      name: `${style[0].toUpperCase()}${style.slice(1)} underline`,
      exact: true,
    });
    await expect(item).toBeVisible();
    if (style === 'dashed') await screenshot(page, 'annotation-underline-menu.png');
    await item.click();
    await page.keyboard.press('Escape');
    await saved(page);
    await page.reload();
    await enableHighlights(page);
    await notes.getByRole('button', { name: 'Close notes panel', exact: true }).click();
    await expect(prose.locator('mark')).toHaveCount(2);
    const highlights = (await attempt(page, created.id)).responses[question.id]?.highlights;
    expect(highlights).toHaveLength(1);
    expect(highlights?.[0]).toMatchObject({
      color,
      underlineStyle: style,
      note: 'Two formatting spans share one annotation.',
      noteAttached: true,
    });
    await expect(prose.locator(`mark.highlight-${color}`)).toHaveCount(2);
    await expect(prose.locator('mark').first()).toHaveCSS('text-decoration-style', style);
  }

  await prose.locator('mark').first().focus();
  await prose.locator('mark').first().press('Enter');
  await annotation.getByRole('button', { name: 'Edit note', exact: true }).click();
  await expect(firstNote).toBeFocused();
  await expect(firstNote).toHaveValue('Two formatting spans share one annotation.');
  await firstNote.fill('Edited after reload.');
  await notes.getByRole('button', { name: 'Close notes panel', exact: true }).click();
  await saved(page);
  expect((await attempt(page, created.id)).responses[question.id]?.highlights[0]?.note).toBe(
    'Edited after reload.',
  );

  // A separate range owns a separate colored quote and note; deleting a note keeps its highlight.
  const secondCoordinates = await prose.evaluate((element) => {
    const text = element.querySelector('p')!.lastChild as Text;
    const start = document.createRange(),
      end = document.createRange();
    start.setStart(text, 2);
    start.setEnd(text, 3);
    end.setStart(text, 22);
    end.setEnd(text, 23);
    const a = start.getBoundingClientRect(),
      b = end.getBoundingClientRect();
    return { x1: a.left + 1, y1: a.top + a.height / 2, x2: b.right - 1, y2: b.top + b.height / 2 };
  });
  await page.mouse.move(secondCoordinates.x1, secondCoordinates.y1);
  await page.mouse.down();
  await page.mouse.move(secondCoordinates.x2, secondCoordinates.y2, { steps: 12 });
  await page.mouse.up();
  await expect(annotation).toBeVisible();
  await annotation.getByRole('button', { name: 'Highlight blue', exact: true }).click();
  await annotation.getByRole('button', { name: 'Add note', exact: true }).click();
  const noteFields = notes.getByRole('textbox', { name: /^Note for / });
  await expect(noteFields).toHaveCount(2);
  await expect(noteFields.nth(1)).toBeFocused();
  await noteFields.nth(1).fill('A second range has independent context.');
  await expect(noteFields.first()).toHaveValue('Edited after reload.');
  await saved(page);
  const twoHighlights = (await attempt(page, created.id)).responses[question.id]?.highlights;
  expect(twoHighlights).toHaveLength(2);
  expect(twoHighlights?.[0]).toMatchObject({
    color: 'pink',
    noteAttached: true,
    note: 'Edited after reload.',
  });
  expect(twoHighlights?.[1]).toMatchObject({
    color: 'blue',
    noteAttached: true,
    note: 'A second range has independent context.',
  });
  const cards = notes.locator('.highlight-note-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toHaveClass(/note-color-pink/);
  await expect(cards.nth(1)).toHaveClass(/note-color-blue/);
  await expect(cards.first().locator('.note-quote')).toHaveText(twoHighlights![0]!.text);
  await expect(cards.nth(1).locator('.note-quote')).toHaveText(twoHighlights![1]!.text);
  expect(twoHighlights![0]!.text).not.toBe(twoHighlights![1]!.text);
  expect(
    await cards
      .first()
      .locator('.note-card-heading')
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  ).not.toBe(
    await cards
      .nth(1)
      .locator('.note-card-heading')
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  );
  await screenshot(page, 'notes-sidebar-multiple.png');

  const resize = notes.getByRole('separator', { name: 'Resize notes panel', exact: true });
  const passagePanel = page.locator('#test-passage-panel');
  const questionPanel = page.locator('#test-question-panel');
  await expect(
    page.getByRole('separator', { name: 'Resize passage and question panels', exact: true }),
  ).toHaveCount(0);
  await expect(resize).toHaveAttribute('aria-valuenow', '280');
  await expect(resize).toHaveAttribute('aria-orientation', 'vertical');
  const passageBefore = (await passagePanel.boundingBox())!;
  const questionBefore = (await questionPanel.boundingBox())!;
  const railBefore = (await notes.boundingBox())!;
  const cardBefore = (await cards.first().boundingBox())!;
  expect(Math.abs(passageBefore.width - questionBefore.width)).toBeLessThan(2);
  const grip = resize.locator('.notes-resize-grip');
  await expect(grip).toBeVisible();
  const handleBefore = (await grip.boundingBox())!;
  const targetBefore = (await resize.boundingBox())!;
  expect(handleBefore.width).toBe(16);
  expect(handleBefore.height).toBe(30);
  expect(targetBefore.width).toBe(28);
  expect(targetBefore.height).toBe(44);
  expect(handleBefore.x).toBeGreaterThanOrEqual(railBefore.x + railBefore.width + 4);
  expect(handleBefore.x + handleBefore.width).toBeLessThanOrEqual(questionBefore.x + 36);
  expect(handleBefore.x).toBeGreaterThanOrEqual(cardBefore.x + cardBefore.width);
  await screenshot(page, 'notes-resize-handle.png');
  await page.mouse.move(handleBefore.x + handleBefore.width / 2, handleBefore.y + handleBefore.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    handleBefore.x + handleBefore.width / 2 + 50,
    handleBefore.y + handleBefore.height / 2,
    { steps: 12 },
  );
  await page.mouse.up();
  const passageDragged = (await passagePanel.boundingBox())!;
  const questionDragged = (await questionPanel.boundingBox())!;
  const railDragged = (await notes.boundingBox())!;
  const cardDragged = (await cards.first().boundingBox())!;
  const handleDragged = (await grip.boundingBox())!;
  expect(railDragged.width - railBefore.width).toBeGreaterThan(90);
  expect(cardDragged.width - cardBefore.width).toBeGreaterThan(90);
  expect(passageBefore.width - passageDragged.width).toBeGreaterThan(45);
  expect(questionBefore.width - questionDragged.width).toBeGreaterThan(45);
  expect(Math.abs(passageDragged.width - questionDragged.width)).toBeLessThan(2);
  expect(handleDragged.x - handleBefore.x).toBeGreaterThan(45);
  const draggedWidth = Number(await resize.getAttribute('aria-valuenow'));
  expect(draggedWidth).toBeGreaterThan(370);
  await screenshot(page, 'notes-panel-resized.png');
  await resize.focus();
  await resize.press('ArrowLeft');
  expect(Number(await resize.getAttribute('aria-valuenow'))).toBe(draggedWidth - 20);
  const leftWidth = Number(await resize.getAttribute('aria-valuenow'));
  await resize.press('Shift+ArrowRight');
  expect(Number(await resize.getAttribute('aria-valuenow'))).toBe(leftWidth + 60);
  await resize.press('Home');
  expect(await resize.getAttribute('aria-valuenow')).toBe(await resize.getAttribute('aria-valuemin'));
  await resize.press('End');
  expect(await resize.getAttribute('aria-valuenow')).toBe(await resize.getAttribute('aria-valuemax'));
  await grip.dblclick();
  await expect(resize).toHaveAttribute('aria-valuenow', '280');
  const resetHandle = (await grip.boundingBox())!;
  await page.mouse.move(resetHandle.x + resetHandle.width / 2, resetHandle.y + resetHandle.height / 2);
  await page.mouse.down();
  await page.mouse.move(resetHandle.x + resetHandle.width / 2 + 50, resetHandle.y + resetHandle.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
  const savedWidth = await resize.getAttribute('aria-valuenow');
  const savedRailWidth = (await notes.boundingBox())!.width;
  const savedCardWidth = (await cards.first().boundingBox())!.width;
  await page.reload();
  await expect(notes).toHaveCount(0);
  await enableHighlights(page);
  await expect(resize).toHaveAttribute('aria-valuenow', savedWidth!);
  await expect(noteFields).toHaveCount(2);
  await expect(noteFields.first()).toHaveValue('Edited after reload.');
  await expect(noteFields.nth(1)).toHaveValue('A second range has independent context.');
  expect((await notes.boundingBox())!.width).toBe(savedRailWidth);
  expect((await cards.first().boundingBox())!.width).toBe(savedCardWidth);
  expect(
    Math.abs((await passagePanel.boundingBox())!.width - (await questionPanel.boundingBox())!.width),
  ).toBeLessThan(2);
  await notes.getByRole('button', { name: 'Close notes panel', exact: true }).click();
  await expect(resize).toHaveCount(0);
  expect(
    Math.abs((await passagePanel.boundingBox())!.width - (await questionPanel.boundingBox())!.width),
  ).toBeLessThan(2);
  await reopenNotes(page);
  await expect(resize).toHaveAttribute('aria-valuenow', savedWidth!);
  expect((await notes.boundingBox())!.width).toBe(savedRailWidth);
  expect((await cards.first().boundingBox())!.width).toBe(savedCardWidth);

  await page.setViewportSize({ width: 820, height: 900 });
  await expect(notes).toBeVisible();
  const tabletRail = (await notes.boundingBox())!;
  expect(tabletRail.width).toBeGreaterThanOrEqual(160);
  expect(tabletRail.width).toBeLessThanOrEqual(480);
  expect(tabletRail.x).toBeGreaterThanOrEqual(0);
  expect(tabletRail.x + tabletRail.width).toBeLessThanOrEqual(820);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await screenshot(page, 'notes-sidebar-tablet.png');
  await page.setViewportSize({ width: 1440, height: 960 });
  await notes.getByRole('button', { name: 'Delete note 1', exact: true }).click();
  await expect(noteFields).toHaveCount(1);
  await expect(noteFields.first()).toHaveValue('A second range has independent context.');
  await expect(prose.locator('mark')).toHaveCount(3);
  await saved(page);
  const afterDeleteNote = (await attempt(page, created.id)).responses[question.id]?.highlights;
  expect(afterDeleteNote).toHaveLength(2);
  expect(afterDeleteNote?.[0]).toMatchObject({ color: 'pink', noteAttached: false, note: '' });
  expect(afterDeleteNote?.[1]).toMatchObject({
    color: 'blue',
    noteAttached: true,
    note: 'A second range has independent context.',
  });
  await notes.getByRole('button', { name: 'Close notes panel', exact: true }).click();
  await page.reload();
  await enableHighlights(page);
  await expect(noteFields).toHaveCount(1);
  await expect(noteFields.first()).toHaveValue('A second range has independent context.');
  await expect(prose.locator('mark')).toHaveCount(3);
  await notes.getByRole('button', { name: 'Close notes panel', exact: true }).click();
  await page.setViewportSize({ width: 500, height: 900 });
  await expect(resize).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 960 });
  await reopenNotes(page);
  await notes.getByRole('button', { name: 'Delete note 1', exact: true }).click();
  await expect(notes).toHaveCount(0);
  await expect(prose.locator('mark')).toHaveCount(3);
  await page.getByRole('button', { name: 'Highlights & Notes', exact: true }).click();
  await expect(notes).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Highlights & Notes', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await saved(page);
  expect(
    (await attempt(page, created.id)).responses[question.id]?.highlights.every(
      (h) => !h.noteAttached && !h.note,
    ),
  ).toBeTruthy();
  await prose.locator('mark').first().click();
  await expect(annotation).toHaveCount(0);
  await enableHighlights(page);
  for (let remaining = 2; remaining > 0; remaining--) {
    await prose.locator('mark').first().click();
    await annotation.getByRole('button', { name: 'Delete highlight', exact: true }).click();
  }
  await expect(prose.locator('mark')).toHaveCount(0);
  await saved(page);

  const chartResponse = await page.request.post('/api/questions', {
    headers,
    data: {
      publicId: `CHART-${id}`,
      section: 'math',
      domainId: 'math-data',
      skillId: 'math-data-1',
      type: 'spr',
      difficulty: 'medium',
      passage: '',
      stem: 'The original chart shows 12 oak, 18 pine and 24 maple seedlings. What fraction are pine?',
      choices: [],
      acceptedAnswers: ['1/3'],
      explanation: 'Pine accounts for $18/(12+18+24)=1/3$ of the seedlings.',
      images: ['/assets/seedling-chart.svg'],
      license: 'CC0-1.0; original chart fixture.',
      source: 'Original test authors',
      status: 'published',
      private: true,
    },
  });
  expect(chartResponse.ok(), await chartResponse.text()).toBeTruthy();
  const chart: Question = await chartResponse.json();
  const tutorResponse = await page.request.post('/api/attempts', {
    headers,
    data: { mode: 'tutor', questionIds: [chart.id], count: 1 },
  });
  expect(tutorResponse.ok(), await tutorResponse.text()).toBeTruthy();
  const tutor: Attempt = await tutorResponse.json();
  await page.goto(`/test/${tutor.id}`);
  const enlarge = page.locator('.question-content [aria-label^="Enlarge image:"]').first();
  await expect(enlarge).toBeVisible();
  await enlarge.focus();
  await enlarge.press('Enter');
  const viewer = page.getByRole('dialog', { name: 'Question image viewer', exact: true });
  await expect(viewer).toBeVisible();
  await viewer.getByRole('button', { name: 'Zoom image in', exact: true }).click();
  await viewer.getByRole('button', { name: 'Zoom image in', exact: true }).click();
  const viewport = viewer.locator('.viewer-viewport');
  const box = await viewport.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width * 0.75, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.25, box!.y + box!.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await screenshot(page, 'question-image-viewer.png');
  await viewer.getByRole('button', { name: 'Reset image zoom', exact: true }).click();
  expect(await viewport.evaluate((element) => element.scrollLeft)).toBe(0);
  await expect(viewer.locator('.viewer-toolbar')).toContainText('100%');
  await viewer.getByRole('button', { name: 'Close image viewer', exact: true }).click();
  await page.getByRole('textbox', { name: 'Numeric answer', exact: true }).fill('2/6');
  await page.getByRole('button', { name: 'Check answer', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Correct', exact: true })).toBeVisible();
  await expect(page.locator('.tutor-feedback')).toContainText('1/3');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Submit module', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm submit', exact: true }).click();
  await expect(page).toHaveURL(`/results/${tutor.id}`);
  expect((await (await page.request.get(`/api/attempts/${tutor.id}/result`)).json()).correct).toBe(1);
});

test('only one browser tab writes an attempt until explicit takeover', async ({ page, context }) => {
  await register(page, 'Taylor Continuity');
  const me = await (await page.request.get('/api/me')).json();
  const createdResponse = await page.request.post('/api/attempts', {
    headers: { 'X-CSRF-Token': me.csrfToken },
    data: { mode: 'practice', section: 'rw', count: 2, seed: 'two-tab-continuity' },
  });
  expect(createdResponse.ok(), await createdResponse.text()).toBeTruthy();
  const created: Attempt = await createdResponse.json();
  await page.goto(`/test/${created.id}`);
  await page.getByRole('radio', { name: 'Answer A', exact: true }).check();
  await saved(page);
  const second = await context.newPage();
  await second.goto(`/test/${created.id}`);
  await expect(
    second.getByRole('alertdialog', { name: 'Test open in another window', exact: true }),
  ).toBeVisible();
  await expect(second.getByRole('radio', { name: 'Answer A', exact: true })).toHaveCount(0);
  await second.getByRole('button', { name: 'Continue in this window', exact: true }).click();
  await expect(second.getByRole('radio', { name: 'Answer A', exact: true })).toBeChecked();
  await expect(
    page.getByRole('alertdialog', { name: 'Test open in another window', exact: true }),
  ).toBeVisible();
  await second.getByRole('radio', { name: 'Answer B', exact: true }).check();
  await saved(second);
  // Cover an old window's periodic persistence tick, not just the immediate lock.
  await second.waitForTimeout(11_000);
  const firstQuestion = created.module!.questions![0]!;
  expect((await attempt(second, created.id)).responses[firstQuestion.id]?.answer).toBe('B');
  await second.reload();
  await expect(second.getByRole('radio', { name: 'Answer B', exact: true })).toBeChecked();
  await expect(
    second.getByRole('alertdialog', { name: 'Test open in another window', exact: true }),
  ).toHaveCount(0);
  await second.close();
  await page.getByRole('button', { name: 'Continue in this window', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Answer B', exact: true })).toBeChecked();
});

test('student authors, previews, versions and imports private questions through the UI', async ({ page }) => {
  await register(page, 'Morgan Author');
  await page.getByRole('link', { name: 'Question library', exact: true }).click();
  await page.getByRole('button', { name: 'Add question', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Author a question', exact: true });
  const unique = randomUUID();
  await editor.getByRole('combobox', { name: 'Section', exact: true }).selectOption('math');
  await editor
    .getByRole('textbox', { name: 'Passage / context', exact: true })
    .fill('<p>A student checks an original multiplication equation.</p>');
  await editor
    .getByRole('textbox', { name: 'Question stem', exact: true })
    .fill(`If $3x=12$, what is $x$? Original UI fixture ${unique}.`);
  for (const [index, value] of ['4', '3', '12', '36'].entries()) {
    const letter = 'ABCD'[index]!;
    await editor.getByRole('textbox', { name: `Choice ${letter}`, exact: true }).fill(value);
    await editor
      .getByRole('textbox', { name: `Rationale ${letter}`, exact: true })
      .fill(
        index === 0 ? 'Dividing twelve by three gives four.' : 'Substitution does not satisfy the equation.',
      );
  }
  await editor
    .getByRole('textbox', { name: 'Full explanation', exact: true })
    .fill('Divide both sides by three: $x=12/3=4$.');
  await editor
    .getByLabel('Copyright / license / provenance', { exact: true })
    .fill('CC0-1.0; original browser authoring fixture.');
  await editor.getByRole('combobox', { name: 'Status', exact: true }).selectOption('published');
  await expect(editor.getByRole('combobox', { name: 'Visibility', exact: true })).toHaveValue('private');
  await editor.getByRole('button', { name: 'Student preview', exact: true }).click();
  await expect(editor.getByRole('button', { name: 'Save question', exact: true })).toHaveCount(0);
  await expect(editor.locator('.question-review .katex').first()).toBeVisible();
  await expect(editor.getByRole('heading', { name: 'The reasoning', exact: true })).toBeVisible();
  await screenshot(page, 'question-editor-student-preview.png');
  await editor.getByRole('button', { name: 'Edit content', exact: true }).click();
  const createPromise = page.waitForResponse(
    (response) => response.url().endsWith('/api/questions') && response.request().method() === 'POST',
  );
  await editor.getByRole('button', { name: 'Create question', exact: true }).click();
  const createResponse = await createPromise;
  expect(createResponse.status(), await createResponse.text()).toBe(201);
  const created: Question = await createResponse.json();
  expect(created.ownerId).toBeTruthy();
  expect(created.status).toBe('published');
  await expect(editor).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Search questions', exact: true }).fill(created.publicId);
  const createdRow = page.getByRole('row').filter({ hasText: created.publicId });
  await expect(createdRow).toContainText('private');
  await createdRow.getByRole('button', { name: 'Edit', exact: true }).click();
  const versionEditor = page.getByRole('dialog', {
    name: `Edit ${created.publicId} · version 2`,
    exact: true,
  });
  await versionEditor
    .getByRole('textbox', { name: 'Full explanation', exact: true })
    .fill('Updated explanation: divide $3x=12$ by three to get $x=4$.');
  const versionPromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/questions/${created.id}`) && response.request().method() === 'PUT',
  );
  await versionEditor.getByRole('button', { name: 'Save new version', exact: true }).click();
  const versionResponse = await versionPromise;
  expect(versionResponse.ok(), await versionResponse.text()).toBeTruthy();
  expect((await versionResponse.json()).version).toBe(2);
  await expect(versionEditor).toHaveCount(0);

  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const importer = page.getByRole('dialog', { name: 'Import your question collection', exact: true });
  await expect(importer).toContainText('Up to 5 MB');
  const templatePromise = page.waitForEvent('download');
  await importer.getByRole('button', { name: 'JSON', exact: true }).click();
  expect((await templatePromise).suggestedFilename()).toBe('pathwise-template.json');
  const imported = {
    publicId: `UI-IMPORT-${unique}`,
    section: 'math',
    domainId: 'math-algebra',
    skillId: 'math-algebra-1',
    type: 'mcq',
    difficulty: 'easy',
    passage: '',
    stem: `What is the result of $2+5$? Original import fixture ${unique}.`,
    choices: [
      { id: 'A', text: '7', rationale: 'Adding two and five gives seven.' },
      { id: 'B', text: '3', rationale: 'This subtracts instead of adding.' },
      { id: 'C', text: '10', rationale: 'This multiplies instead of adding.' },
      { id: 'D', text: '25', rationale: 'This joins the digits.' },
    ],
    correctAnswer: 'A',
    explanation: '$2+5=7$.',
    license: 'CC0-1.0; original UI import fixture.',
    source: 'Original authors',
    status: 'published',
  };
  await importer.locator('input[type="file"]').setInputFiles({
    name: 'original-questions.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify([
        imported,
        {
          ...imported,
          publicId: `UI-INVALID-${unique}`,
          stem: `A malformed original fixture ${unique}.`,
          explanation: '',
        },
      ]),
    ),
  });
  await importer.getByRole('button', { name: 'Parse & preview', exact: true }).click();
  await expect(importer.locator('.import-totals')).toContainText('1 valid');
  await expect(importer.locator('.import-totals')).toContainText('1 invalid');
  expect((await (await page.request.get(`/api/questions?q=${imported.publicId}`)).json()).total).toBe(0);
  await screenshot(page, 'question-import-preview.png');
  await importer.getByRole('button', { name: 'Confirm valid questions', exact: true }).click();
  await expect(importer.getByRole('heading', { name: 'Your import is saved.', exact: true })).toBeVisible();
  await expect(importer.locator('.import-report')).toContainText('1 imported · 1 skipped');
  await importer.getByRole('button', { name: 'Back to library', exact: true }).click();
  await expect(importer).toHaveCount(0);
  const restored = await (await page.request.get(`/api/questions?q=${imported.publicId}`)).json();
  expect(restored.total).toBe(1);
  expect(restored.items[0].ownerId).toBe(created.ownerId);
  await page.getByRole('textbox', { name: 'Search questions', exact: true }).fill(created.publicId);
  await expect(createdRow).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  const archivePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/questions/${created.id}`) && response.request().method() === 'DELETE',
  );
  await createdRow.getByRole('button', { name: `Archive ${created.publicId}`, exact: true }).click();
  const archiveResponse = await archivePromise;
  expect(archiveResponse.ok(), await archiveResponse.text()).toBeTruthy();
  expect(await archiveResponse.json()).toMatchObject({ status: 'archived', version: 3 });
});
