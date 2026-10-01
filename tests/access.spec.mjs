import {test, expect} from '@playwright/test';
import {URL_PATH, setup, opened, readAt} from './place-fixture.mjs';

// Visible text set in its own element below 11px, excluding note superscripts.
const smallText = page => page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => {
  if (el.closest('sup,.reader-note-marker')) return false;
  if (![...el.childNodes].some(node => node.nodeType === 3 && node.textContent.trim())) return false;
  const box = el.getBoundingClientRect(), style = getComputedStyle(el);
  return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && parseFloat(style.fontSize) < 11;
}).map(el => el.tagName + (el.id ? '#' + el.id : '') + '.' + el.className + ' ' + getComputedStyle(el).fontSize));
function luminance(rgb) {
  const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
  return .2126 * r + .7152 * g + .0722 * b;
}
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };

test('no interface label is set below 11px', async ({page}) => {
  await setup(page, {sections: true}); await page.goto(URL_PATH); await opened(page);
  await readAt(page, 30);
  expect(await smallText(page)).toEqual([]);
  await page.click('#settings-trigger');
  expect(await smallText(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await page.goto('/'); await expect(page.locator('[data-work="place-text"]')).toBeVisible();
  expect(await smallText(page)).toEqual([]);
});

test('control borders stand out from the page at 3:1 in every palette', async ({page}) => {
  await setup(page); await page.goto(URL_PATH); await opened(page);
  await page.click('#settings-trigger');
  for (const theme of ['paper', 'mist', 'ink']) {
    await page.locator(`.theme-choice[data-theme="${theme}"]`).click();
    const [border, panel] = await page.locator('.theme-choice[data-theme="auto"]').evaluate(el => [getComputedStyle(el).borderTopColor, getComputedStyle(el.closest('dialog')).backgroundColor]);
    expect(contrast(border, panel), theme).toBeGreaterThanOrEqual(3);
    const [muted, paper] = await page.evaluate(() => { const s = getComputedStyle(document.documentElement); return [s.getPropertyValue('--muted'), s.getPropertyValue('--paper')]; });
    const toRGB = hex => `rgb(${parseInt(hex.trim().slice(1, 3), 16)}, ${parseInt(hex.trim().slice(3, 5), 16)}, ${parseInt(hex.trim().slice(5, 7), 16)})`;
    expect(contrast(toRGB(muted), toRGB(paper)), theme + ' muted text').toBeGreaterThanOrEqual(4.5);
  }
});

test('touch targets are full size and fields do not make phones zoom', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile', 'touch');
  await setup(page); await page.goto(URL_PATH); await opened(page);
  for (const box of await page.locator('.toolbar .icon-button:visible').evaluateAll(els => els.map(el => el.getBoundingClientRect()).map(r => ({w: r.width, h: r.height}))))
    { expect(box.w).toBeGreaterThanOrEqual(44); expect(box.h).toBeGreaterThanOrEqual(44); }
  await page.keyboard.press('/');
  expect(await page.locator('#search-input').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
});

test('the phone drawer holds focus and returns it, with the page behind it inert', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile', 'drawer');
  await setup(page); await page.goto(URL_PATH); await opened(page);
  await page.click('#mobile-menu');
  expect(await page.evaluate(() => document.querySelector('.shell').inert)).toBe(true);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.querySelector('.shell').inert)).toBe(false);
  await expect(page.locator('#mobile-menu')).toBeFocused();
});

test('headings, landmarks and labels say one thing each', async ({page}) => {
  await setup(page, {sections: true}); await page.goto(URL_PATH); await opened(page);
  const levelOne = await page.evaluate(() => [...document.querySelectorAll('h1,[role="heading"]')].filter(el => el.getClientRects().length && (el.getAttribute('aria-level') || el.tagName.slice(1)) === '1').length);
  expect(levelOne).toBe(1);
  const section = page.locator('#manuscript h2 .section-link').first();
  await expect(section).toHaveAttribute('aria-hidden', 'true');
  await expect(section).toHaveAttribute('tabindex', '-1');
  await expect(page.locator('[aria-labelledby="collection-heading"]')).toHaveCount(1);
  await expect(page.locator('#focus-button')).toHaveAttribute('aria-label', 'Focus mode');
  await page.locator('#focus-button').click();
  await expect(page.locator('#focus-button')).toHaveAttribute('aria-label', 'Focus mode');
  await expect(page.locator('#focus-button')).toHaveAttribute('aria-pressed', 'true');
});

test('in forced colours the current contents entry is still marked', async ({page}, info) => {
  test.skip(info.project.name !== 'desktop', 'sidebar');
  await page.emulateMedia({forcedColors: 'active'});
  await setup(page, {sections: true}); await page.goto(URL_PATH); await opened(page);
  await readAt(page, 25);
  const current = page.locator('#toc a[aria-current="location"]');
  expect(await current.evaluate(el => getComputedStyle(el).textDecorationLine)).toBe('underline');
});
