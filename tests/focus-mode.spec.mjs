import {test, expect} from '@playwright/test';
import {URL_PATH, setup, opened, readAt} from './place-fixture.mjs';

const toolbarShown = page => page.locator('.toolbar').evaluate(el => el.getBoundingClientRect().bottom > 10 && getComputedStyle(el).opacity === '1');

test('focus mode lets the toolbar and footer step away and keeps a hairline of progress', async ({page}) => {
  await setup(page); await page.goto(URL_PATH); await opened(page);
  await readAt(page, 30);
  await page.keyboard.press('f');
  await expect(page.locator('body')).toHaveClass(/focus-mode/);
  await page.mouse.move(400, 500);
  await expect.poll(() => toolbarShown(page)).toBe(false);
  await expect.poll(() => page.locator('.reading-footer').evaluate(el => Math.round(innerHeight - el.getBoundingClientRect().top))).toBeLessThanOrEqual(4);
  await expect(page.locator('#progress-fill')).toBeAttached();
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).not.toHaveClass(/focus-mode/);
  await expect.poll(() => toolbarShown(page)).toBe(true);
});

test('the top edge and keyboard focus bring the toolbar back', async ({page}, info) => {
  test.skip(info.project.name !== 'desktop', 'pointer');
  await setup(page); await page.goto(URL_PATH); await opened(page);
  await readAt(page, 30); await page.keyboard.press('f'); await page.mouse.move(400, 500);
  await expect.poll(() => toolbarShown(page)).toBe(false);
  await page.mouse.move(400, 20);
  await expect.poll(() => toolbarShown(page)).toBe(true);
  await page.mouse.move(400, 500);
  await expect.poll(() => toolbarShown(page)).toBe(false);
  await page.keyboard.press('Tab');
  await page.locator('#search-trigger').focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  await expect.poll(() => toolbarShown(page)).toBe(true);
});

test('on a phone, scrolling up brings back the toolbar with its menu button', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile', 'touch');
  await setup(page); await page.goto(URL_PATH); await opened(page);
  await readAt(page, 30); await page.locator('#focus-button').click();
  await page.evaluate(() => scrollBy(0, 200));
  await expect.poll(() => toolbarShown(page)).toBe(false);
  await page.evaluate(() => scrollBy(0, -120));
  await expect.poll(() => toolbarShown(page)).toBe(true);
  await expect(page.locator('#mobile-menu')).toBeVisible();
});
