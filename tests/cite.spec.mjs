import {test, expect} from '@playwright/test';
import {URL_PATH, setup, opened, readAt, id} from './place-fixture.mjs';

const section = (page, n) => page.locator(`#md-${id(n).toLowerCase()}`);
const paragraph = (page, n) => section(page, n).locator('.english-passage p');
// Parallel workers share the system clipboard, so each page gets its own.
async function privateClipboard(page) {
  await page.addInitScript(() => {
    const store = {};
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {
      async write(items) { for (const key of Object.keys(store)) delete store[key]; for (const item of items) for (const type of item.types) store[type] = await (await item.getType(type)).text(); },
      async writeText(text) { for (const key of Object.keys(store)) delete store[key]; store['text/plain'] = text; },
      async read() { return [{types: Object.keys(store), getType: async type => new Blob([store[type]])}]; },
      async readText() { return store['text/plain'] || ''; }
    }});
    // What the page put on the clipboard during a browser Copy.
    window.addEventListener('copy', event => { const text = event.clipboardData?.getData('text/plain'); if (text) { store['text/plain'] = text; store['text/html'] = event.clipboardData.getData('text/html'); } });
  });
}
async function open(page) {
  await privateClipboard(page);
  await setup(page); await page.goto(URL_PATH); await opened(page);
}
async function select(page, from, to = from) {
  await page.evaluate(([a, b]) => {
    const first = document.querySelector(`#md-${a} .english-passage p`), last = document.querySelector(`#md-${b} .english-passage p`);
    const range = document.createRange(); range.setStart(first.firstChild, 0); range.setEnd(last.lastChild, last.lastChild.textContent.length);
    getSelection().removeAllRanges(); getSelection().addRange(range);
  }, [id(from).toLowerCase(), id(to).toLowerCase()]);
}
async function menu(page, n) {
  const box = await paragraph(page, n).boundingBox();
  await paragraph(page, n).dispatchEvent('contextmenu', {button: 2, clientX: box.x + 20, clientY: box.y + 10});
  await expect(page.locator('#selection-menu')).toBeVisible();
}
const clipboard = page => page.evaluate(async () => {
  const items = await navigator.clipboard.read(), out = {};
  for (const item of items) for (const type of item.types) out[type] = await (await item.getType(type)).text();
  return out;
});

test('Copy with citation gives both languages, the passage ID, the edition and a link', async ({page, context}) => {
  await open(page); await readAt(page, 5);
  await select(page, 5); await menu(page, 5);
  await page.locator('#selection-cite').click();
  await expect(page.locator('#toast-text')).toHaveText('Copied with citation.');
  const copied = await clipboard(page);
  expect(copied['text/plain']).toMatch(/^“Passage 5 of the specimen[^”]*”\n\nཚིག་5 དང་པོ།/);
  expect(copied['text/plain']).toContain('— Place specimen, PL-000005. Paired edition place-paired-v1 · translation place-translation-v1 · source place-golden-v1.');
  expect(copied['text/plain']).toMatch(/\?work=place-text&file=paired%2Ftranslation\.md#PL-000005$/);
  expect(copied['text/html']).toContain('<blockquote lang="en">');
  expect(copied['text/html']).toContain('<blockquote lang="bo">');
  expect(copied['text/html']).toContain('<cite>Place specimen</cite>');
});

test('a citation across passages names the first and last passage', async ({page, context}) => {
  await open(page); await readAt(page, 5);
  await select(page, 5, 7); await menu(page, 6);
  await page.locator('#selection-cite').click();
  const copied = await clipboard(page);
  expect(copied['text/plain']).toContain('Place specimen, PL-000005–PL-000007.');
  expect(copied['text/plain']).toContain('ཚིག་7');
});

test('Copy link points at the selected passage', async ({page, context}) => {
  await open(page); await readAt(page, 12);
  await select(page, 12); await menu(page, 12);
  await page.locator('#selection-link').click();
  await expect(page.locator('#toast-text')).toHaveText('Link copied.');
  expect((await clipboard(page))['text/plain']).toMatch(/#PL-000012$/);
});

test('copied text leaves the note markers behind, from the menu and from the browser', async ({page, context}) => {
  await open(page);
  await page.locator('#notes-toggle').evaluate(button => button.click());
  await expect(paragraph(page, 3).locator('.reader-note-marker')).toBeVisible();
  await readAt(page, 3); await select(page, 3); await menu(page, 3);
  await page.locator('#selection-copy').click();
  await expect.poll(async () => (await clipboard(page))['text/plain']).toBe('Passage 3 of the specimen sets out a long enough line of English that it wraps across the measure and gives the page real height to scroll through.');
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await page.evaluate(() => { const p = document.querySelector('#md-pl-000003 .english-passage p'); const range = document.createRange(); range.selectNodeContents(p); getSelection().removeAllRanges(); getSelection().addRange(range); });
  await page.evaluate(() => document.execCommand('copy'));
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Passage 3 of the specimen sets out a long enough line of English that it wraps across the measure and gives the page real height to scroll through.');
});

test('Suggest a correction opens a prefilled GitHub issue for the passage', async ({page, context}) => {
  await open(page);
  await context.route('https://github.com/**', route => route.fulfill({body: 'ok'}));
  await readAt(page, 9); await select(page, 9); await menu(page, 9);
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.locator('#selection-correction').click()]);
  const url = new URL(popup.url());
  expect(url.origin + url.pathname).toBe('https://github.com/Lotus-King-Research/Example-Text/issues/new');
  expect(url.searchParams.get('title')).toBe('Correction: PL-000009');
  expect(url.searchParams.get('body')).toContain('> Passage 9 of the specimen');
  expect(url.searchParams.get('body')).toContain('Edition: paired edition place-paired-v1');
});

test('a linked passage is washed on arrival; a missing one says so', async ({page, context}) => {
  await setup(page);
  await page.goto(URL_PATH + '#PL-000030'); await opened(page);
  await expect(section(page, 30)).toHaveClass(/arrival-wash/);
  await page.goto('about:blank');
  await page.goto(URL_PATH + '#PL-999999'); await opened(page);
  await expect(page.locator('#toast-text')).toHaveText('PL-999999 is not in this edition. Back at Chapter 2.');
  await page.goto('about:blank');
  await page.addInitScript(() => localStorage.clear());
  await page.goto(URL_PATH + '#PL-999999'); await opened(page);
  await expect(page.locator('#toast-text')).toHaveText('PL-999999 is not in this edition. The text opens at the beginning.');
});

test('on touch screens the menu docks above the footer and follows the selection', async ({page, context}, info) => {
  test.skip(info.project.name !== 'mobile', 'touch layout');
  await open(page); await readAt(page, 20);
  await select(page, 20);
  const menuBox = page.locator('#selection-menu');
  await expect(menuBox).toBeVisible();
  const box = await menuBox.boundingBox(), footer = await page.locator('.reading-footer').boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(footer.y + 1);
  expect(box.x).toBeLessThan(12);
  await page.evaluate(() => scrollBy(0, 40));
  await expect(menuBox).toBeVisible();
  await page.evaluate(() => getSelection().removeAllRanges());
  await expect(menuBox).toBeHidden();
});
