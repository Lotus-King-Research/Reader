import {test, expect} from '@playwright/test';
import {URL_PATH, setup, opened, frames, readAt, topOf, id} from './place-fixture.mjs';

test('reopening a text returns to the passage where reading stopped', async ({page}) => {
  await setup(page); await page.goto(URL_PATH); await opened(page);
  await readAt(page, 61);
  // Reopen the plain address: a reload would keep the hash that follows reading.
  await page.goto('about:blank'); await page.goto(URL_PATH); await opened(page);
  await expect(page.locator('#toast-text')).toHaveText('Back at Chapter 4.');
  await expect.poll(async () => Math.abs(await topOf(page, 61) - 95)).toBeLessThan(30);
  await page.locator('#toast-action').click();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
});

test('following a link to a passage keeps the reader\'s own place', async ({page}) => {
  await setup(page); await page.goto(URL_PATH); await opened(page);
  await readAt(page, 61);
  await page.goto('about:blank');
  await page.goto(URL_PATH + '#md-' + id(10).toLowerCase()); await opened(page);
  await expect(page.locator('#toast-text')).toHaveText('Opened at the linked passage.');
  await page.evaluate(() => scrollBy(0, 120)); await frames(page);
  await page.goto('about:blank');
  await page.goto(URL_PATH); await opened(page);
  await expect.poll(async () => Math.abs(await topOf(page, 61) - 95)).toBeLessThan(30);
});

test('the linked-passage notice offers the way back', async ({page}) => {
  await setup(page); await page.goto(URL_PATH); await opened(page);
  await readAt(page, 81);
  await page.goto('about:blank');
  await page.goto(URL_PATH + '#md-' + id(5).toLowerCase()); await opened(page);
  await page.locator('#toast-action').click();
  await expect.poll(async () => Math.abs(await topOf(page, 81) - 95)).toBeLessThan(30);
});

test('changing the type size keeps the passage being read in place', async ({page}) => {
  await setup(page); await page.goto(URL_PATH); await opened(page);
  await readAt(page, 47);
  const before = await topOf(page, 47);
  await page.click('#settings-trigger');
  await page.locator('#font-size').fill('25'); await page.locator('#font-size').dispatchEvent('change');
  await page.keyboard.press('Escape'); await frames(page);
  expect(Math.abs(await topOf(page, 47) - before)).toBeLessThan(8);
});

test('a narrower window keeps the passage being read in place', async ({page}) => {
  await setup(page); await page.goto(URL_PATH); await opened(page);
  await readAt(page, 52);
  const before = await topOf(page, 52), size = page.viewportSize();
  await page.setViewportSize({width:Math.round(size.width * .8), height:size.height}); await frames(page); await frames(page);
  expect(Math.abs(await topOf(page, 52) - before)).toBeLessThan(6);
});

test('the bookmark always moves to the current place, and Undo puts it back', async ({page}) => {
  await setup(page); await page.goto(URL_PATH); await opened(page);
  await readAt(page, 21); await page.locator('#bookmark-button').click();
  await expect(page.locator('#toast-text')).toHaveText('Bookmarked.');
  await expect(page.locator('#bookmark-button')).toHaveAttribute('aria-label', 'Bookmark this place');
  await readAt(page, 21); await page.locator('#bookmark-button').click();
  await expect(page.locator('#toast-text')).toHaveText('Bookmark moved here.');
  await expect(page.locator('#bookmark-button')).toHaveClass(/bookmark-set/);
  await readAt(page, 90); await page.locator('#bookmark-button').click();
  await page.locator('#toast-action').click();
  await readAt(page, 3);
  if (await page.locator('#mobile-menu').isVisible()) await page.click('#mobile-menu');
  await expect(page.locator('#resume-label')).toHaveText('Bookmark · Chapter 2');
  await page.locator('#resume-button').click();
  await expect.poll(async () => Math.abs(await topOf(page, 21) - 95)).toBeLessThan(30);
});

test('the collection card shows where reading stopped and continues there', async ({page}) => {
  await setup(page); await page.goto(URL_PATH); await opened(page);
  await readAt(page, 101);
  await page.goto('about:blank'); await page.goto('/');
  const card = page.locator('[data-work="place-text"]');
  await expect(card.locator('.work-card-continue')).toHaveText(/^Chapter 6 · \d+% read$/);
  await expect(card.locator('.work-card-bottom')).toHaveText('Continue reading');
  await card.click(); await opened(page);
  await expect.poll(async () => Math.abs(await topOf(page, 101) - 95)).toBeLessThan(30);
});

test('focusing toolbar controls never moves the page', async ({page}) => {
  await setup(page); await page.goto(URL_PATH); await opened(page);
  await readAt(page, 47);
  const before = await page.evaluate(() => scrollY);
  const moved = await page.evaluate(() => [...document.querySelectorAll('.toolbar button')].filter(b => b.getClientRects().length).map(b => { b.focus(); return Math.round(scrollY); }));
  expect(moved.length).toBeGreaterThan(2);
  for (const y of moved) expect(Math.abs(y - before)).toBeLessThan(2);
});
