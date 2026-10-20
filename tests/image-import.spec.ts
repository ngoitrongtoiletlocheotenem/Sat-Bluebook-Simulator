import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { ImportPreview, Question } from '../shared/types';

// Original 1 x 1 PNG fixture; the browser must decode it after upload.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64',
);

async function register(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await page.getByLabel('Your name').fill('Image import author');
  await page.getByLabel('Email address').fill(`images-${randomUUID()}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill(`Study-${randomUUID()}`);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Good to see you/ })).toBeVisible();
  await page.goto('/bank');
}

function originalQuestion(images = '') {
  const unique = randomUUID();
  return {
    publicId: `ROW-IMAGE-${unique}`,
    section: 'math',
    domainId: 'math-algebra',
    skillId: 'math-algebra-1',
    type: 'mcq',
    difficulty: 'easy',
    stem: `What is $2+2$? Original image import fixture ${unique}.`,
    choiceA: '4',
    choiceB: '3',
    choiceC: '5',
    choiceD: '6',
    correctAnswer: 'A',
    explanation: 'Adding two and two gives four.',
    images,
    license: 'CC0-1.0; original browser test question and image fixtures.',
    source: 'Original test authors',
  };
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function openPreview(
  page: Page,
  question: ReturnType<typeof originalQuestion> | ReturnType<typeof originalQuestion>[],
) {
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const importer = page.getByRole('dialog', { name: 'Import your question collection', exact: true });
  const questions = Array.isArray(question) ? question : [question];
  const csv = [
    Object.keys(questions[0]!).map(csvCell).join(','),
    ...questions.map((row) => Object.values(row).map(csvCell).join(',')),
  ].join('\r\n');
  await importer.getByLabel('Upload question file', { exact: true }).setInputFiles({
    name: 'original-image-question.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  const parsed = page.waitForResponse(
    (response) => response.url().endsWith('/api/imports/preview') && response.request().method() === 'POST',
  );
  await importer.getByRole('button', { name: 'Parse & preview', exact: true }).click();
  const response = await parsed;
  expect(response.ok(), await response.text()).toBeTruthy();
  return { importer, preview: (await response.json()) as ImportPreview };
}

test('repair an invalid image for one parsed row and import the rendered question', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await register(page);
  await expect(page.getByRole('button', { name: 'Images & graphs', exact: true })).toHaveCount(0);
  const question = originalQuestion(JSON.stringify(['C:\\Users\\student\\Downloads\\original-graph.png']));
  const { importer, preview } = await openPreview(page, question);
  expect(preview.valid).toBe(0);
  expect(preview.invalid).toBe(1);
  await expect(importer.getByText('Add images or graphs to your questions', { exact: true })).toHaveCount(0);
  await expect(importer.locator('.import-totals')).toContainText('1 invalid');
  await importer.getByRole('button', { name: `Repair images for ${question.publicId}`, exact: true }).click();
  await expect(
    importer.getByRole('heading', { name: `Images for ${question.publicId}`, exact: true }),
  ).toBeVisible();
  await importer.getByRole('button', { name: 'Remove image 1', exact: true }).click();
  await importer.getByLabel('Upload replacement images', { exact: true }).setInputFiles({
    name: 'replacement-graph.png',
    mimeType: 'image/png',
    buffer: png,
  });
  const uploadedImage = importer.getByRole('img', { name: 'Question image 1', exact: true });
  await expect(uploadedImage).toBeVisible();
  await expect
    .poll(() => uploadedImage.evaluate((element: HTMLImageElement) => element.naturalWidth))
    .toBe(1);
  const imageUrl = await uploadedImage.getAttribute('src');
  expect(imageUrl).toMatch(/^\/uploads\/[^/]+\.png$/);
  await page.screenshot({
    path: testInfo.outputPath('row-image-repair-desktop.png'),
    animations: 'disabled',
  });
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/imports/${preview.id}/rows/${preview.rows[0]!.row}/images`) &&
      response.request().method() === 'PATCH',
  );
  await importer.getByRole('button', { name: 'Save images', exact: true }).click();
  const savedResponse = await saved;
  expect(savedResponse.ok(), await savedResponse.text()).toBeTruthy();
  const repaired: ImportPreview = await savedResponse.json();
  expect(repaired.valid).toBe(1);
  expect(repaired.invalid).toBe(0);
  expect(repaired.rows[0]!.question.images).toEqual([imageUrl]);
  expect(repaired.rows[0]!.question.stem).toBe(question.stem);
  expect(repaired.rows[0]!.question.correctAnswer).toBe(question.correctAnswer);
  await expect(importer.locator('.import-totals')).toContainText('1 valid');
  await expect(importer.locator('.import-totals')).toContainText('0 invalid');
  await importer.getByRole('button', { name: 'Confirm valid questions', exact: true }).click();
  await expect(importer.locator('.import-report')).toContainText('1 imported · 0 skipped');
  await importer.getByRole('button', { name: 'Back to library', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search questions', exact: true }).fill(question.publicId);
  await page.getByRole('button', { name: `Preview ${question.publicId}`, exact: true }).click();
  const rendered = page
    .getByRole('dialog', { name: question.publicId, exact: true })
    .locator(`img[src="${imageUrl}"]`);
  await expect(rendered).toBeVisible();
  await expect.poll(() => rendered.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1);
  expect(errors).toEqual([]);
});

test('text-only questions import without an image preparation step', async ({ page }) => {
  await register(page);
  const question = originalQuestion();
  const { importer, preview } = await openPreview(page, question);
  expect(preview.valid).toBe(1);
  expect(preview.invalid).toBe(0);
  await expect(importer.getByLabel('Upload replacement images', { exact: true })).toHaveCount(0);
  await expect(
    importer.getByRole('button', { name: `Attach images for ${question.publicId}`, exact: true }),
  ).toBeVisible();
  await expect(importer.getByRole('button', { name: 'Confirm valid questions', exact: true })).toBeEnabled();
  await importer.getByRole('button', { name: 'Confirm valid questions', exact: true }).click();
  await expect(importer.locator('.import-report')).toContainText('1 imported · 0 skipped');
  const response = await page.request.get(`/api/questions?q=${question.publicId}`);
  const imported: { items: Question[] } = await response.json();
  expect(imported.items[0]!.images).toEqual([]);
});

test('manual image changes survive upload failure and cancel leaves the parsed row unchanged', async ({
  page,
}, testInfo) => {
  await register(page);
  const originalImage = '/assets/seedling-chart.svg';
  const question = originalQuestion(JSON.stringify([originalImage]));
  const { importer, preview } = await openPreview(page, question);
  expect(preview.valid).toBe(1);
  await importer.getByRole('button', { name: `Edit images for ${question.publicId}`, exact: true }).click();
  const firstImage = importer.getByRole('img', { name: 'Question image 1', exact: true });
  await expect(firstImage).toHaveAttribute('src', originalImage);

  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let uploads = 0;
  await page.route('**/api/assets', async (route) => {
    if (route.request().method() === 'POST') {
      uploads++;
      await gate;
    }
    await route.continue();
  });
  try {
    const input = importer.getByLabel('Upload replacement images', { exact: true });
    await input.setInputFiles({ name: 'optional-original-graph.png', mimeType: 'image/png', buffer: png });
    await expect.poll(() => uploads).toBe(1);
    for (const name of ['Close dialog', 'Save images', 'Cancel image changes', 'Confirm valid questions']) {
      await expect(importer.getByRole('button', { name, exact: true })).toBeDisabled();
    }
    await page.keyboard.press('Escape');
    await expect(importer).toBeVisible();
    release();
    const secondImage = importer.getByRole('img', { name: 'Question image 2', exact: true });
    await expect
      .poll(() => secondImage.evaluate((element: HTMLImageElement) => element.naturalWidth))
      .toBe(1);
    const addedUrl = await secondImage.getAttribute('src');
    await input.setInputFiles({
      name: 'invalid.png',
      mimeType: 'image/png',
      buffer: Buffer.from('not a PNG image'),
    });
    await expect(importer.getByRole('alert')).toContainText(/PNG.*JPEG.*WebP/i);
    await expect(firstImage).toHaveAttribute('src', originalImage);
    await expect(secondImage).toHaveAttribute('src', addedUrl!);
    await expect(importer.getByRole('img', { name: /^Question image \d+$/ })).toHaveCount(2);
    await page.setViewportSize({ width: 390, height: 844 });
    await importer
      .getByRole('heading', { name: `Images for ${question.publicId}`, exact: true })
      .scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    expect(await importer.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBeTruthy();
    await page.screenshot({
      path: testInfo.outputPath('row-image-repair-mobile.png'),
      animations: 'disabled',
    });
    await importer.getByRole('button', { name: 'Cancel image changes', exact: true }).click();
    await expect(
      importer.getByRole('heading', { name: `Images for ${question.publicId}`, exact: true }),
    ).toHaveCount(0);
    await importer.getByRole('button', { name: 'Confirm valid questions', exact: true }).click();
    await expect(importer.locator('.import-report')).toContainText('1 imported · 0 skipped');
    const response = await page.request.get(`/api/questions?q=${question.publicId}`);
    const imported: { items: Question[] } = await response.json();
    expect(imported.items[0]!.images).toEqual([originalImage]);
  } finally {
    release();
  }
});

test('a failed fourth image is detected and can be removed before confirmation', async ({ page }) => {
  await register(page);
  const prefix = `https://figures.pathwise.invalid/${randomUUID()}`;
  const images = [1, 2, 3, 4].map((number) => `${prefix}/figure-${number}.png`);
  await page.route(`${prefix}/**`, async (route) => {
    if (route.request().url() === images[3]) await route.abort();
    else await route.fulfill({ status: 200, contentType: 'image/png', body: png });
  });
  const question = originalQuestion(JSON.stringify(images));
  const { importer, preview } = await openPreview(page, question);
  expect(preview.valid).toBe(1);
  await expect(
    importer.getByRole('img', { name: `Imported image 4 for ${question.publicId}`, exact: true }),
  ).toHaveCount(1);
  const repair = importer.getByRole('button', {
    name: `Repair images for ${question.publicId}`,
    exact: true,
  });
  await expect(repair).toBeVisible();
  await expect(importer.getByRole('button', { name: 'Confirm valid questions', exact: true })).toBeDisabled();
  await repair.click();
  await importer.getByRole('button', { name: 'Remove image 4', exact: true }).click();
  await importer.getByRole('button', { name: 'Save images', exact: true }).click();
  await expect(
    importer.getByRole('heading', { name: `Images for ${question.publicId}`, exact: true }),
  ).toHaveCount(0);
  await expect(
    importer.getByRole('button', { name: `Edit images for ${question.publicId}`, exact: true }),
  ).toBeVisible();
  await expect(importer.getByRole('button', { name: 'Confirm valid questions', exact: true })).toBeEnabled();
});

test('unavailable images in skipped duplicate and invalid rows do not block valid questions', async ({
  page,
}) => {
  await register(page);
  const brokenImage = `https://figures.pathwise.invalid/${randomUUID()}/unavailable.png`;
  await page.route(brokenImage, (route) => route.abort());
  const duplicate = originalQuestion(JSON.stringify([brokenImage]));
  const me = await (await page.request.get('/api/me')).json();
  const headers = { 'X-CSRF-Token': me.csrfToken };
  const seedResponse = await page.request.post('/api/imports/preview', {
    headers,
    multipart: {
      scope: 'private',
      file: {
        name: 'original-duplicate-image-question.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify([duplicate])),
      },
    },
  });
  expect(seedResponse.ok(), await seedResponse.text()).toBeTruthy();
  const seeded: ImportPreview = await seedResponse.json();
  expect(seeded.valid).toBe(1);
  const confirmed = await page.request.post(`/api/imports/${seeded.id}/confirm`, {
    headers,
    data: { skipDuplicates: true, scope: 'private' },
  });
  expect(confirmed.ok(), await confirmed.text()).toBeTruthy();
  const valid = originalQuestion();
  const invalid = { ...originalQuestion(JSON.stringify([brokenImage])), explanation: '' };
  const { importer, preview } = await openPreview(page, [duplicate, invalid, valid]);
  expect(preview.valid).toBe(1);
  expect(preview.invalid).toBe(1);
  expect(preview.duplicates).toBe(1);
  await expect(
    importer.getByRole('button', { name: `Repair images for ${duplicate.publicId}`, exact: true }),
  ).toBeVisible();
  await expect(importer.getByRole('button', { name: 'Confirm valid questions', exact: true })).toBeEnabled();
  await importer.getByRole('button', { name: 'Confirm valid questions', exact: true }).click();
  await expect(importer.locator('.import-report')).toContainText('1 imported · 2 skipped');
});
