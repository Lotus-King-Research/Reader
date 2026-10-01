import {test, expect} from '@playwright/test';
import {mockCatalog} from './catalog-fixture.mjs';

const repository = 'Lotus-King-Research/Example-Text';
const config = {works:[{id:'place-text',repository,title:'Place specimen',englishUrl:`https://github.com/${repository}/blob/main/paired/translation.md`,sourceUrl:`https://github.com/${repository}/blob/main/paired/source.md`,sourceLanguage:'bo'}]};
const id = n => 'PL-' + String(n).padStart(6, '0');
function manuscript(side) {
  const source = side === 'source';
  const front = `---\nschema: paired-text/2\ntext-id: place-specimen\npaired-edition: place-paired-v1\nsource-edition: place-golden-v1\n${source ? 'edition: place-golden-v1' : 'translation-edition: place-translation-v1'}\nlanguage: ${source ? 'bo' : 'en'}\n---\n\n# ${source ? 'དཔེ་ཆ།' : 'Place specimen'}`;
  const chapters = [];
  for (let c = 0; c < 6; c++) {
    const pairs = [];
    for (let n = c * 20 + 1; n <= c * 20 + 20; n++) {
      const body = source ? `ཚིག་${n} དང་པོ། ཚིག་གཉིས་པ། ཚིག་གསུམ་པ།` : `Passage ${n} of the specimen sets out a long enough line of English that it wraps across the measure and gives the page real height to scroll through.`;
      pairs.push(`<!-- pair: ${id(n)}${source ? ' | format: prose' : ''} -->\n${body}\n<!-- /pair -->`);
    }
    chapters.push(`## ${source ? 'ལེའུ་' + (c + 1) : 'Chapter ' + (c + 1)}\n\n${pairs.join('\n\n')}`);
  }
  return `${front}\n\n${chapters.join('\n\n')}`;
}
const URL_PATH = '/?work=place-text&file=paired%2Ftranslation.md';
async function setup(page) {
  const state = await mockCatalog(page, {configuration:config});
  state.files['Example-Text'] = {'paired/translation.md':manuscript('english'),'paired/source.md':manuscript('source')};
  return state;
}
async function opened(page) {
  await expect(page.locator('body')).not.toHaveClass(/loading/);
  await expect(page.locator('#manuscript')).toContainText('Passage 1 of the specimen');
}
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
// Puts a passage's first line just under the reading line, as a reader would.
async function readAt(page, n) {
  await page.evaluate(target => { const el = document.querySelector(`#md-${target} .english-passage p`); scrollTo(0, scrollY + el.getBoundingClientRect().top - 95); }, id(n).toLowerCase());
  await frames(page);
}
const topOf = (page, n) => page.evaluate(target => document.querySelector(`#md-${target} .english-passage p`).getBoundingClientRect().top, id(n).toLowerCase());

test('reopening a text returns to the passage where reading stopped', async ({page}) => {
  await setup(page); await page.goto(URL_PATH); await opened(page);
  await readAt(page, 61);
  await page.reload(); await opened(page);
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
  expect(Math.abs(await topOf(page, 47) - before)).toBeLessThan(4);
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
