import {test, expect} from '@playwright/test';
import {URL_PATH, setup, opened, frames, readAt, topOf, id} from './place-fixture.mjs';

const section = (page, n) => page.locator(`#md-${id(n).toLowerCase()}`);
const settled = page => page.evaluate(() => new Promise(resolve => { let last = -1, still = 0; const tick = () => { if (scrollY === last && ++still > 3) return resolve(); if (scrollY !== last) still = 0; last = scrollY; requestAnimationFrame(tick); }; tick(); }));
const nearReadingLine = async (page, n) => expect.poll(async () => Math.abs(await topOf(page, n) - 95)).toBeLessThan(60);

test('the address follows reading and a reload lands on the same passage', async ({page}) => {
  await setup(page); await page.goto(URL_PATH); await opened(page);
  await readAt(page, 47);
  await expect(page).toHaveURL(/#PL-000047$/);
  await page.reload(); await opened(page);
  await nearReadingLine(page, 47);
  await readAt(page, 2); await page.evaluate(() => scrollTo(0, 0));
  await expect(page).not.toHaveURL(/#/);
});

test('pair IDs resolve in any case, with or without the md- prefix', async ({page}) => {
  await setup(page);
  for (const hash of ['#pl-000030', '#PL-000030', '#md-pl-000030', '#md-PL-000030']) {
    await page.goto('about:blank'); await page.goto(URL_PATH + hash); await opened(page);
    await expect.poll(() => section(page, 30).evaluate(el => Math.round(el.getBoundingClientRect().top))).toBeLessThan(200);
    await expect.poll(() => section(page, 30).evaluate(el => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(60);
  }
});

test('contents jumps replace the address; search jumps add one, and Back returns', async ({page}) => {
  await setup(page); await page.goto(URL_PATH); await opened(page);
  await readAt(page, 12); await expect(page).toHaveURL(/#PL-000012$/);
  const length = await page.evaluate(() => history.length);
  if (await page.locator('#mobile-menu').isVisible()) await page.click('#mobile-menu');
  await page.locator('#toc a').filter({hasText:'Chapter 5'}).click();
  await expect(page).toHaveURL(/#md-chapter-5$/);
  expect(await page.evaluate(() => history.length)).toBe(length);
  await settled(page);
  await readAt(page, 33); await expect(page).toHaveURL(/#PL-000033$/);
  await page.keyboard.press('/');
  await page.locator('#search-input').fill('Passage 110 of');
  await page.locator('#search-results button').first().click();
  await expect(page).toHaveURL(/#PL-000110$/);
  await page.goBack();
  await expect(page).toHaveURL(/#PL-000033$/);
  await expect.poll(() => section(page, 33).evaluate(el => Math.round(el.getBoundingClientRect().top))).toBeLessThan(200);
});

test('T switches the passage being read and keeps focus on it', async ({page}) => {
  await setup(page); await page.goto(URL_PATH); await opened(page);
  await readAt(page, 8);
  const before = await topOf(page, 8);
  await page.keyboard.press('t');
  await expect(section(page, 8).locator('.source-passage')).toBeVisible();
  await expect(section(page, 8).locator('.english-passage')).toBeHidden();
  await expect(section(page, 8)).toBeFocused();
  await expect(page.locator('#announcer')).toHaveText('Tibetan shown for this passage.');
  expect(Math.abs(await section(page, 8).evaluate(el => el.getBoundingClientRect().top) - (before - 0))).toBeLessThan(40);
  await page.keyboard.press('t');
  await expect(section(page, 8).locator('.english-passage')).toBeVisible();
});

test('the menu key opens the passage menu without a selection', async ({page}) => {
  await setup(page); await page.goto(URL_PATH); await opened(page);
  await readAt(page, 15);
  await page.keyboard.press('Shift+F10');
  await expect(page.locator('#selection-menu')).toBeVisible();
  await expect(page.locator('#selection-copy')).toBeFocused();
  await expect(page.locator('#selection-language')).toHaveText('Show Tibetan');
  await page.locator('#selection-language').click();
  await expect(section(page, 15).locator('.source-passage')).toBeVisible();
  await expect(section(page, 15)).toBeFocused();
});

test('switched passages are remembered for the edition, and Show all in English resets them', async ({page}) => {
  await setup(page); await page.goto(URL_PATH); await opened(page);
  await readAt(page, 5); await page.keyboard.press('t');
  await expect(section(page, 5).locator('.source-passage')).toBeVisible();
  await readAt(page, 9); await page.keyboard.press('t');
  await expect(section(page, 9).locator('.source-passage')).toBeVisible();
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter(key => key.includes('switched:')).map(key => JSON.parse(localStorage[key]).length))).toEqual([2]);
  await page.reload(); await opened(page);
  await expect(section(page, 5).locator('.source-passage')).toBeVisible();
  await expect(section(page, 9).locator('.source-passage')).toBeVisible();
  await expect(section(page, 6).locator('.english-passage')).toBeVisible();
  const hairline = await section(page, 5).locator('.source-passage').evaluate(el => getComputedStyle(el, '::before').width);
  expect(hairline).toBe('1px');
  await page.click('#settings-trigger');
  await expect(page.locator('#switched-count')).toHaveText('2 passages are shown in Tibetan.');
  await page.locator('#show-all-english').click();
  await expect(page.locator('#switched-group')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(section(page, 5).locator('.english-passage')).toBeVisible();
  await page.reload(); await opened(page);
  await expect(section(page, 5).locator('.english-passage')).toBeVisible();
});

test('single-key shortcuts can be turned off', async ({page}) => {
  await setup(page); await page.goto(URL_PATH); await opened(page);
  await page.click('#settings-trigger');
  await page.locator('#single-key-shortcuts').uncheck();
  await page.keyboard.press('Escape');
  await readAt(page, 4); await page.keyboard.press('t'); await page.keyboard.press('/');
  await expect(section(page, 4).locator('.english-passage')).toBeVisible();
  await expect(page.locator('#search-dialog')).not.toHaveAttribute('open', '');
  await page.keyboard.press('Control+k');
  await expect(page.locator('#search-dialog')).toHaveAttribute('open', '');
});

test('a one-time note says the Tibetan is there, until dismissed', async ({page}) => {
  await setup(page); await page.goto(URL_PATH); await opened(page);
  await expect(page.locator('#source-hint')).toBeVisible();
  await expect(page.locator('#source-hint-text')).toContainText('Every passage has its Tibetan beside it.');
  await page.locator('#source-hint-dismiss').click();
  await expect(page.locator('#source-hint')).toBeHidden();
  await page.reload(); await opened(page);
  await expect(page.locator('#source-hint')).toBeHidden();
});
