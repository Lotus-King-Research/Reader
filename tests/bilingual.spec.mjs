import {test, expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

const repository = 'Lotus-King-Research/Example-Text';
const englishPath = 'translation/en.md', sourcePath = 'source/bo.md';
const github = path => `https://github.com/${repository}/blob/main/${path}`;
const english = '# The example text\n\n## The opening\n\nEnglish opening passage.\n\n## The conclusion\n\nEnglish concluding passage.';
const tibetan = '# དཔེ་ཆ།\n\n## དང་པོ།\n\nདང་པོའི་བོད་ཡིག།\n\n## གཉིས་པ།\n\nགཉིས་པའི་བོད་ཡིག།';
const sha = text => {const bytes = Buffer.from(text); return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');};

async function pairedFixture(page, options = {}) {
  const state = {files:{[englishPath]:options.english ?? english,[sourcePath]:options.source ?? tibetan},sourceStatus:options.sourceStatus ?? 200,requests:[]};
  const config = {works:[{id:'paired-text',repository,title:'Example text',originalTitle:'དཔེ་ཆ།',englishUrl:github(englishPath),sourceUrl:github(sourcePath),sourceLanguage:'bo',...(options.sections ? {sections:options.sections} : {})}]};
  await page.addInitScript(value => {window.READER_CONFIG = value;}, config);
  await page.route(/^https:\/\/api\.github\.com\/repos\/Lotus-King-Research\/Example-Text\//, async route => {
    const url = new URL(route.request().url()); state.requests.push(url.href);
    const prefix = `/repos/${repository}/contents/`;
    if (url.pathname.startsWith(prefix)) {
      const path = decodeURIComponent(url.pathname.slice(prefix.length));
      if (path === sourcePath && state.sourceStatus !== 200) return route.fulfill({status:state.sourceStatus,contentType:'application/json',body:'{"message":"Source unavailable"}'});
      const text = state.files[path];
      if (text === undefined) return route.fulfill({status:404,contentType:'application/json',body:'{"message":"Not found"}'});
      return route.fulfill({contentType:'application/json',body:JSON.stringify({type:'file',path,name:path.split('/').pop(),sha:sha(text),size:Buffer.byteLength(text)})});
    }
    if (url.pathname.includes('/git/blobs/')) {
      const digest = url.pathname.split('/').pop(), text = Object.values(state.files).find(value => sha(value) === digest);
      return route.fulfill({status:text === undefined ? 404 : 200,contentType:'text/plain',body:text ?? 'Missing blob'});
    }
    return route.fulfill({status:404,contentType:'application/json',body:'{"message":"Unexpected fixture request"}'});
  });
  await page.route(/^https:\/\/raw\.githubusercontent\.com\/Lotus-King-Research\/Example-Text\/main\//, async route => {
    const url = new URL(route.request().url()); state.requests.push(url.href);
    const path = decodeURIComponent(url.pathname.split('/').slice(4).join('/'));
    const status = path === sourcePath ? state.sourceStatus : 200, text = state.files[path];
    return route.fulfill({status:text === undefined ? 404 : status,contentType:'text/markdown',body:status === 200 ? text ?? 'Missing file' : 'Source unavailable'});
  });
  await page.goto('/?work=paired-text&file=translation%2Fen.md');
  await expect(page.locator('#manuscript')).toBeVisible();
  await expect(page.locator('body')).not.toHaveClass(/loading/);
  await expect(page.locator('#manuscript')).toContainText('English opening passage.');
  return state;
}
const sections = page => page.locator('#manuscript .parallel-section');
async function sourceDialog(page) {
  if (await page.locator('#mobile-menu').isVisible() && await page.locator('#mobile-menu').getAttribute('aria-expanded') !== 'true') await page.click('#mobile-menu');
  await page.click('#source-button');
}

// Fixtures are synthetic bilingual passages, not translations.
test('a configured repository opens both texts and a section switch affects only that section', async ({page}) => {
  const state = await pairedFixture(page);
  await expect(sections(page)).toHaveCount(2);
  for (const section of await sections(page).all()) await expect(section.locator('.english-passage')).toBeVisible();
  const first = sections(page).nth(0), second = sections(page).nth(1);
  await first.locator('.section-language-toggle').click();
  await expect(first.locator('.section-language-toggle')).toHaveAttribute('aria-pressed','true');
  await expect(first.locator('.english-passage')).toBeHidden();
  await expect(first.locator('.source-passage')).toBeVisible();
  await expect(first.locator('.source-passage')).toContainText('དང་པོའི་བོད་ཡིག།');
  await expect(second.locator('.english-passage')).toBeVisible();
  await expect(second.locator('.source-passage')).toBeHidden();
  await expect(second.locator('.section-language-toggle')).toHaveAttribute('aria-pressed','false');
  await first.locator('.section-language-toggle').click();
  await expect(first.locator('.english-passage')).toBeVisible();
  expect(state.requests.some(url => url.includes(sourcePath))).toBe(true);
});

test('the toolbar and T shortcut switch the active section', async ({page}) => {
  await pairedFixture(page);
  const first = sections(page).nth(0), second = sections(page).nth(1);
  await first.locator('.section-language-toggle').focus();
  await page.locator('#language-toggle').click();
  await expect(first.locator('.source-passage')).toBeVisible();
  await expect(second.locator('.english-passage')).toBeVisible();
  await page.keyboard.press('t');
  await expect(first.locator('.english-passage')).toBeVisible();
  await expect(second.locator('.source-passage')).toBeHidden();
});

test('T does not toggle a passage while typing in reader search', async ({page}) => {
  await pairedFixture(page);
  await page.keyboard.press('/');
  await expect(page.locator('#search-input')).toBeVisible();
  await page.locator('#search-input').press('t');
  await expect(page.locator('#search-input')).toHaveValue('t');
  for (const section of await sections(page).all()) await expect(section.locator('.section-language-toggle')).toHaveAttribute('aria-pressed','false');
});

test('Tibetan passages carry their language and Noto Sans Tibetan font', async ({page}) => {
  await pairedFixture(page);
  const first = sections(page).nth(0);
  await first.locator('.section-language-toggle').click();
  await expect(first.locator('.source-passage')).toHaveAttribute('lang','bo');
  const family = await first.locator('.source-passage').evaluate(element => getComputedStyle(element).fontFamily);
  expect(family).toContain('Noto Sans Tibetan');
  const loadedFaces = await page.evaluate(async () => (await document.fonts.load('16px \"Noto Sans Tibetan\"','བོད།')).length);
  expect(loadedFaces).toBeGreaterThan(0);
  await expect(page.locator('#title-content h1')).toHaveText('The example text');
  await expect(page.locator('#manuscript h1')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('stable heading IDs align reordered source sections', async ({page}) => {
  await pairedFixture(page, {
    english:'# The example text\n\n<h2 id="opening">The opening</h2>\n\nEnglish opening passage.\n\n<h2 id="conclusion">The conclusion</h2>\n\nEnglish concluding passage.',
    source:'# དཔེ་ཆ།\n\n<h2 id="conclusion">གཉིས་པ།</h2>\n\nགཉིས་པའི་བོད་ཡིག།\n\n<h2 id="opening">དང་པོ།</h2>\n\nདང་པོའི་བོད་ཡིག།'
  });
  const first = sections(page).nth(0);
  await first.locator('.section-language-toggle').click();
  await expect(first.locator('.source-passage')).toContainText('དང་པོའི་བོད་ཡིག།');
  await expect(first.locator('.source-passage')).not.toContainText('གཉིས་པའི་བོད་ཡིག།');
});

test('an explicit section map aligns texts with different heading structures', async ({page}) => {
  await pairedFixture(page, {
    english:'# The example text\n\n<h2 id="english-first">The opening</h2>\n\nEnglish opening passage.\n\n<h2 id="english-last">The conclusion</h2>\n\nEnglish concluding passage.',
    source:'# དཔེ་ཆ།\n\n<h3 id="tibetan-last">གཉིས་པ།</h3>\n\nགཉིས་པའི་བོད་ཡིག།\n\n<h2 id="tibetan-first">དང་པོ།</h2>\n\nདང་པོའི་བོད་ཡིག།',
    sections:[{english:'english-first',source:'tibetan-first'},{english:'english-last',source:'tibetan-last'}]
  });
  const first = sections(page).nth(0), second = sections(page).nth(1);
  await first.locator('.section-language-toggle').click();
  await expect(first.locator('.source-passage')).toContainText('དང་པོའི་བོད་ཡིག།');
  await second.locator('.section-language-toggle').click();
  await expect(second.locator('.source-passage')).toContainText('གཉིས་པའི་བོད་ཡིག།');
});

test('unsafe ordinal alignment leaves English readable with an explicit status', async ({page}) => {
  await pairedFixture(page, {source:'# དཔེ་ཆ།\n\n## དང་པོ།\n\nདང་པོའི་བོད་ཡིག།\n\n### གཉིས་པ།\n\nགཉིས་པའི་བོད་ཡིག།'});
  await expect(page.locator('#paired-status')).toContainText(/align|match|mapping/i);
  expect(await sections(page).locator('.section-language-toggle').evaluateAll(buttons => buttons.every(button => button.disabled))).toBe(true);
  await expect(page.locator('#language-toggle')).toBeHidden();
  await expect(page.locator('#manuscript')).toContainText('English concluding passage.');
});

test('a source with an extra section does not pair passages by ordinal position', async ({page}) => {
  await pairedFixture(page, {source:tibetan + '\n\n## གསུམ་པ།\n\nབོད་ཡིག་གི་ས་བཅད།'});
  await expect(page.locator('#paired-status')).toContainText(/align|match|mapping/i);
  await expect(page.locator('#language-toggle')).toBeHidden();
  await expect(page.locator('#manuscript')).toContainText('English concluding passage.');
});

test('an unavailable Tibetan source does not prevent opening English', async ({page}) => {
  await pairedFixture(page, {sourceStatus:404});
  await expect(page.locator('#paired-status')).toContainText(/unavailable|could not|removed/i);
  await expect(page.locator('#manuscript')).toContainText('English concluding passage.');
  await expect(page.locator('#language-toggle')).toBeHidden();
  await expect(page.locator('#manuscript .source-passage')).toHaveCount(0);
});

test('rapid language switches preserve the passage position', async ({page}) => {
  const longEnglish = english.replace('English opening passage.','English opening passage.\n\n' + 'A paragraph that fixes the section reading position.\n\n'.repeat(55));
  const longTibetan = tibetan.replace('དང་པོའི་བོད་ཡིག།','དང་པོའི་བོད་ཡིག།\n\n' + 'བོད་ཡིག་དཔེ་ཆའི་སྐད་ཡིག།\n\n'.repeat(8));
  await pairedFixture(page, {english:longEnglish,source:longTibetan});
  await page.evaluate(() => window.scrollTo(0,900));
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(800);
  const before = await page.evaluate(() => scrollY);
  for (let n = 0; n < 8; n++) {
    await page.keyboard.press('t');
    await expect(sections(page).nth(0).locator('.section-language-toggle')).toHaveAttribute('aria-pressed',String(n % 2 === 0));
    await expect(sections(page).nth(1).locator('.english-passage')).toBeVisible();
  }
  await expect(sections(page).nth(0).locator('.english-passage')).toBeVisible();
  await expect.poll(async () => Math.abs(await page.evaluate(() => scrollY) - before)).toBeLessThan(30);
});

test('a local unpaired manuscript remains unchanged', async ({page}) => {
  await pairedFixture(page);
  const local = '# Private local text\n\n## One section\n\nOriginal local words.\n';
  await page.setInputFiles('#file-input',{name:'local.md',mimeType:'text/markdown',buffer:Buffer.from(local)});
  await expect(page.locator('#title-content h1')).toHaveText('Private local text');
  await expect(page.locator('#manuscript')).toContainText('Original local words.');
  await expect(page.locator('#manuscript .parallel-section, #manuscript .source-passage')).toHaveCount(0);
  await sourceDialog(page);
  await expect(page.locator('#source-textarea')).toHaveValue(local);
});

test('the offline reading copy retains both languages and switches without GitHub', async ({page,context}, info) => {
  const state = await pairedFixture(page);
  await sourceDialog(page);
  const downloaded = page.waitForEvent('download'); await page.click('#export-reader');
  const path = info.outputPath('paired-reading-copy.html'); await (await downloaded).saveAs(path);
  const copy = await readFile(path,'utf8'), before = state.requests.length;
  expect(copy).toContain('དང་པོའི་བོད་ཡིག།');
  await page.goto('about:blank');
  await context.setOffline(true); await page.setContent(copy);
  await expect(page.locator('#manuscript')).toBeVisible();
  await expect(sections(page)).toHaveCount(2);
  await sections(page).nth(1).locator('.section-language-toggle').click();
  await expect(sections(page).nth(1).locator('.source-passage')).toBeVisible();
  await expect(sections(page).nth(1).locator('.source-passage')).toContainText('གཉིས་པའི་བོད་ཡིག།');
  expect(state.requests.length).toBe(before);
});

test('reordered stable IDs prevent ordinal fallback for unidentified sections', async ({page}) => {
  await pairedFixture(page, {
    english:'# The example text\n\n<h2 id="opening">The opening</h2>\n\nEnglish opening passage.\n\n## Unmapped English section\n\nEnglish without an established counterpart.\n\n<h2 id="conclusion">The conclusion</h2>\n\nEnglish concluding passage.',
    source:'# དཔེ་ཆ།\n\n<h2 id="conclusion">གཉིས་པ།</h2>\n\nགཉིས་པའི་བོད་ཡིག།\n\n## འབྲེལ་མེད།\n\nངེས་མེད་ཀྱི་ས་བཅད།\n\n<h2 id="opening">དང་པོ།</h2>\n\nདང་པོའི་བོད་ཡིག།'
  });
  await expect(sections(page)).toHaveCount(3);
  await expect(sections(page).nth(1).locator('.section-language-toggle, .source-passage')).toHaveCount(0);
  await expect(sections(page).nth(1).locator('.section-pair-unavailable')).toContainText('alignment unavailable');
  await expect(page.locator('#paired-status')).toContainText('Some sections need an alignment map.');
  await sections(page).nth(0).locator('.section-language-toggle').click();
  await expect(sections(page).nth(0).locator('.source-passage')).toContainText('དང་པོའི་བོད་ཡིག།');
  await sections(page).nth(2).locator('.section-language-toggle').click();
  await expect(sections(page).nth(2).locator('.source-passage')).toContainText('གཉིས་པའི་བོད་ཡིག།');
});

test('an unmatched active section cannot toggle an earlier paired passage', async ({page}) => {
  await pairedFixture(page, {
    english:'# The example text\n\n<h2 id="opening">The opening</h2>\n\nEnglish opening passage.\n\n## Unmapped English section\n\n' + 'English without an established counterpart.\n\n'.repeat(50) + '\n\n<h2 id="conclusion">The conclusion</h2>\n\nEnglish concluding passage.',
    source:'# དཔེ་ཆ།\n\n<h2 id="opening">དང་པོ།</h2>\n\nདང་པོའི་བོད་ཡིག།\n\n<h2 id="conclusion">གཉིས་པ།</h2>\n\nགཉིས་པའི་བོད་ཡིག།'
  });
  const first = sections(page).nth(0), unmatched = sections(page).nth(1);
  await unmatched.evaluate(section => window.scrollTo({top:scrollY + section.getBoundingClientRect().top - 100,behavior:'instant'}));
  await expect.poll(() => unmatched.evaluate(section => Math.round(section.getBoundingClientRect().top))).toBe(100);
  await expect(page.locator('#language-toggle')).toBeHidden();
  await page.keyboard.press('t');
  await expect(first.locator('.section-language-toggle')).toHaveAttribute('aria-pressed','false');
  await expect(first.locator('.source-passage')).toBeHidden();
  await expect(unmatched.locator('.english-passage')).toBeVisible();
  await expect(page.locator('#language-toggle')).toBeHidden();
});
