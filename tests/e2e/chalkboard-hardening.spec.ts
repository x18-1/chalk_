import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { openClassroom, signIn } from './support/chalkboard';

const HARDENING_CLASSROOM = '傅里叶变换入门';

test('has no automatically detectable serious accessibility violations', async ({ page }) => {
  await signIn(page);
  await openClassroom(page, HARDENING_CLASSROOM);

  const results = await new AxeBuilder({ page })
    .include('main')
    // Generated/imported lesson colors are content-contract concerns; this
    // gate covers the Chalk application chrome and excludes lesson canvases.
    .exclude('[class*="sceneThumbnail"]')
    .exclude('[class*="slideCanvasInner"]')
    .analyze();

  const violations = results.violations.filter((violation) =>
    violation.impact === 'critical' || violation.impact === 'serious');
  expect(violations, violations.map((violation) =>
    `${violation.id}: ${violation.help} (${violation.nodes.map((node) => node.target.join(' ')).join(', ')})`).join('\n'))
    .toEqual([]);
});

test('keeps core classroom controls available at 200 percent text scaling', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page);
  await openClassroom(page, HARDENING_CLASSROOM);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });

  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible();
  await expect(page.getByRole('complementary', { name: '课程场景' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('disables decorative Chalkboard motion when reduced motion is requested', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page);
  await page.route('**/classrooms', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.continue();
  });
  await page.goto('/chalkboard');

  await expect(page.locator('[class*="importSpinner"]').first()).toHaveCSS('animation-name', 'none');
});

test('keeps keyboard navigation actionable after a Scene transition', async ({ page }) => {
  await signIn(page);
  await openClassroom(page, HARDENING_CLASSROOM);

  const secondScene = page.getByRole('complementary', { name: '课程场景' }).getByRole('button').nth(1);
  await secondScene.focus();
  await expect(secondScene).toBeFocused();

  // With no active Discussion Round the transition is immediate; keyboard
  // focus must still remain on an actionable control after the Scene changes.
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.matches('button, a, input, textarea, select, [tabindex]'))).toBe(true);
});
