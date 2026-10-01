import {test, expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

const repository = 'Lotus-King-Research/Example-Text';
const englishPath = 'translation/en.md', sourcePath = 'source/bo.md';
const github = path => `https://github.com/${repository}/blob/main/${path}`;
const english = '# The example text\n\n## The opening\n\nEnglish opening passage.\n\n## The conclusion\n\nEnglish concluding passage.';
const tibetan = '# དཔེ་ཆ།\n\n## དང་པོ།\n\nདང་པོའི་བོད་ཡིག།\n\n## གཉིས་པ།\n\nགཉིས་པའི་བོད་ཡིག།';
const sha = text => {const bytes = Buffer.from(text); return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');};


function storedZipEntry(bytes, wanted) {
  let offset = 0;
  while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    const method = bytes.readUInt16LE(offset + 8), size = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26), extraLength = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30,offset + 30 + nameLength).toString('utf8');
    const start = offset + 30 + nameLength + extraLength;
    expect(method).toBe(0);
    expect(start + size).toBeLessThanOrEqual(bytes.length);
    if (name === wanted) return bytes.subarray(start,start + size).toString('utf8');
    offset = start + size;
  }
  throw new Error(`EPUB entry missing: ${wanted}`);
}

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

test('EPUB exports the selected language for each section and places endnotes last', async ({page}, info) => {
  const englishWithNote = english.replace('English concluding passage.','English concluding passage.[^english-note]') + '\n\n[^english-note]: English concluding endnote.';
  await pairedFixture(page, {english:englishWithNote});
  await sections(page).nth(0).locator('.section-language-toggle').click();
  await expect(sections(page).nth(0).locator('.source-passage')).toBeVisible();
  await expect(sections(page).nth(1).locator('.english-passage')).toBeVisible();
  await sourceDialog(page); await page.click('#export-epub');
  await expect(page.locator('#epub-dialog')).toBeVisible();
  const downloaded = page.waitForEvent('download'); await page.click('#epub-save');
  const path = info.outputPath('mixed-language-reading.epub'); await (await downloaded).saveAs(path);
  const content = storedZipEntry(await readFile(path),'EPUB/content.xhtml');
  expect(content).toContain('དང་པོའི་བོད་ཡིག།');
  expect(content).not.toContain('English opening passage.');
  expect(content).toContain('English concluding passage.');
  expect(content).not.toContain('གཉིས་པའི་བོད་ཡིག།');
  const document = await page.evaluate(value => {
    const parsed = new DOMParser().parseFromString(value,'application/xml');
    const source = parsed.querySelector('.source-passage'), notes = parsed.querySelector('.footnotes');
    const ids = [...parsed.querySelectorAll('[id]')].map(element => element.id);
    return {error:parsed.querySelector('parsererror')?.textContent ?? '',language:source?.getAttribute('lang'),xmlLanguage:source?.getAttributeNS('http://www.w3.org/XML/1998/namespace','lang'),notesLast:(parsed.querySelector('main') || parsed.querySelector('body')).lastElementChild === notes,notes:notes?.textContent,brokenReferences:[...parsed.querySelectorAll('a[href^="#"]')].filter(link => !ids.includes(link.getAttribute('href').slice(1))).length};
  }, content);
  expect(document.error).toBe('');
  expect(document.language).toBe('bo'); expect(document.xmlLanguage).toBe('bo');
  expect(document.notesLast).toBe(true); expect(document.notes).toContain('English concluding endnote.');
  expect(document.brokenReferences).toBe(0);
});

test('mixed-language reading retains Tibetan endnotes, popup and EPUB targets', async ({page}, info) => {
  const sourceNote = 'བོད་ཡིག་གི་མཆན་འགྲེལ།';
  const englishNote = 'English concluding endnote.';
  const englishWithNote = english.replace('English concluding passage.','English concluding passage.[^english-note]') + `\n\n[^english-note]: ${englishNote}`;
  const sourceWithNote = tibetan.replace('དང་པོའི་བོད་ཡིག།','དང་པོའི་བོད་ཡིག།[^source-note]') + `\n\n[^source-note]: ${sourceNote}`;
  await pairedFixture(page, {english:englishWithNote,source:sourceWithNote});
  const sourceNotes = page.locator('#manuscript .source-footnotes');
  const englishNotes = page.locator('#manuscript .footnotes:not(.source-footnotes)');
  await expect(sourceNotes).toBeHidden(); await expect(englishNotes).toBeVisible();
  await sections(page).nth(0).locator('.section-language-toggle').click();
  await expect(sourceNotes).toBeVisible(); await expect(sourceNotes).toHaveAttribute('lang','bo');
  await expect(englishNotes).toBeVisible();
  // Source endnotes depend on every visible passage, including one before the final section.
  await sections(page).nth(1).locator('.section-language-toggle').click();
  await expect(sourceNotes).toBeVisible(); await expect(englishNotes).toBeHidden();
  await sections(page).nth(1).locator('.section-language-toggle').click();
  await expect(sourceNotes).toBeVisible(); await expect(englishNotes).toBeVisible();
  await sections(page).nth(0).locator('.source-passage .footnote-ref').click();
  await expect(page.locator('#note-dialog')).toBeVisible();
  await expect(page.locator('#note-content')).toContainText(sourceNote);
  await expect(page.locator('#note-content')).not.toContainText(englishNote);
  await page.locator('#note-dialog [data-close]').click();
  await sourceDialog(page); await page.click('#export-epub');
  const downloaded = page.waitForEvent('download'); await page.click('#epub-save');
  const path = info.outputPath('mixed-language-endnotes.epub'); await (await downloaded).saveAs(path);
  const content = storedZipEntry(await readFile(path),'EPUB/content.xhtml');
  const document = await page.evaluate(value => {
    const parsed = new DOMParser().parseFromString(value,'application/xml');
    const sourceNotes = parsed.querySelector('.source-footnotes'), englishNotes = parsed.querySelector('.footnotes:not(.source-footnotes)');
    const sourceRef = parsed.querySelector('.source-passage a[role="doc-noteref"]'), englishRef = parsed.querySelector('.english-passage a[role="doc-noteref"]');
    const target = reference => reference && parsed.getElementById(reference.getAttribute('href').slice(1));
    const sourceTarget = target(sourceRef), englishTarget = target(englishRef);
    const tail = [...parsed.querySelector('main').children].slice(-2);
    return {error:parsed.querySelector('parsererror')?.textContent ?? '',sourceLanguage:sourceNotes?.getAttribute('lang'),sourceXmlLanguage:sourceNotes?.getAttributeNS('http://www.w3.org/XML/1998/namespace','lang'),englishLanguage:englishNotes?.closest('[lang]')?.getAttribute('lang'),sourceTarget:sourceTarget?.textContent,englishTarget:englishTarget?.textContent,sourceTargetInNotes:sourceTarget?.closest('.source-footnotes') === sourceNotes,englishTargetInNotes:englishTarget?.closest('.footnotes') === englishNotes,notesLast:tail.length === 2 && tail.every(element => element.classList.contains('footnotes')),englishPassages:parsed.querySelectorAll('.english-passage').length,sourcePassages:parsed.querySelectorAll('.source-passage').length};
  }, content);
  expect(document.error).toBe('');
  expect(document.sourceLanguage).toBe('bo'); expect(document.sourceXmlLanguage).toBe('bo');
  expect(document.englishLanguage).toBe('en');
  expect(document.sourceTarget).toContain(sourceNote); expect(document.sourceTargetInNotes).toBe(true);
  expect(document.englishTarget).toContain(englishNote); expect(document.englishTargetInNotes).toBe(true);
  expect(document.notesLast).toBe(true);
  expect(document.englishPassages).toBe(1); expect(document.sourcePassages).toBe(1);
});

const anchorEnglish = '---\nschema: paired-text/1\nlanguage: en\n---\n# The example text\n\n## Chapter 1\n\n<a id="dtg-000001"></a>\n\nEnglish opening passage.\n\n<a id="dtg-000002"></a>\n\nEnglish middle passage, with a second paragraph.\n\nAnother English paragraph in the same anchored passage.\n\n## Chapter 2\n\n<a id="dtg-000003"></a>\n\nEnglish concluding passage.\n\n## Editorial notes\n\nEnglish editorial material outside the aligned passages.';
const anchorSource = '---\nschema: paired-text/1\nlanguage: bo\n---\n# དཔེ་ཆ།\n\n## ལེའུ་དང་པོ།\n\n<a id="dtg-000001"></a>\n\nདང་པོའི་བོད་ཡིག།[^source-note]\n\nདང་པོའི་ས་བཅད་གཞན་པ།\n\n<a id="dtg-000002"></a>\n\nབར་མའི་བོད་ཡིག།\n\n## ལེའུ་གཉིས་པ།\n\n<a id="dtg-000003"></a>\n\nགཉིས་པའི་བོད་ཡིག།\n\n[^source-note]: བོད་ཡིག་གི་མཆན་འགྲེལ།';

// This schema matches public paired-text/1 block anchors without snapshotting a manuscript.
test('paired-text/1 aligns anchored passages independently of chapter and note headings', async ({page}) => {
  await pairedFixture(page, {english:anchorEnglish,source:anchorSource});
  await expect(sections(page)).toHaveCount(3);
  await expect(sections(page).locator('.section-language-toggle')).toHaveCount(3);
  await expect(sections(page).locator('h2')).toHaveCount(0);
  await expect(page.locator('#manuscript > h2')).toHaveCount(3);
  await expect(page.locator('#manuscript')).toContainText('English editorial material outside the aligned passages.');
  const first = sections(page).nth(0), middle = sections(page).nth(1), last = sections(page).nth(2);
  await middle.locator('.section-language-toggle').click();
  await expect(middle.locator('.source-passage')).toContainText('བར་མའི་བོད་ཡིག།');
  await expect(middle.locator('.english-passage')).toBeHidden();
  await expect(first.locator('.english-passage')).toBeVisible();
  await expect(last.locator('.english-passage')).toBeVisible();
  await first.locator('.section-language-toggle').click();
  await expect(first.locator('.source-passage')).toContainText('དང་པོའི་ས་བཅད་གཞན་པ།');
  await expect(page.locator('#manuscript .source-footnotes')).toBeVisible();
  await first.locator('.source-passage .footnote-ref').click();
  await expect(page.locator('#note-content')).toContainText('བོད་ཡིག་གི་མཆན་འགྲེལ།');
});

test('paired-text/1 missing source anchors never pair a different passage by order', async ({page}) => {
  const missingMiddle = anchorSource.replace('<a id="dtg-000002"></a>\n\nབར་མའི་བོད་ཡིག།\n\n','');
  await pairedFixture(page, {english:anchorEnglish,source:missingMiddle});
  await expect(sections(page)).toHaveCount(3);
  await expect(sections(page).locator('.section-language-toggle')).toHaveCount(2);
  const middle = sections(page).nth(1), last = sections(page).nth(2);
  await expect(middle.locator('.section-language-toggle, .source-passage')).toHaveCount(0);
  await expect(middle.locator('.english-passage')).toContainText('English middle passage');
  await last.locator('.section-language-toggle').click();
  await expect(last.locator('.source-passage')).toContainText('གཉིས་པའི་བོད་ཡིག།');
  await expect(last.locator('.source-passage')).not.toContainText('དང་པོའི་བོད་ཡིག།');
});

test('paired-text/1 empty anchor deep links survive language switching', async ({page}) => {
  const longEnglish = anchorEnglish.replace('English opening passage.','English opening passage.\n\n' + 'An English paragraph before the linked passage.\n\n'.repeat(35)).replace('English concluding passage.','English concluding passage.\n\n' + 'An English paragraph after the linked passage.\n\n'.repeat(35));
  await pairedFixture(page, {english:longEnglish,source:anchorSource});
  await page.goto('/?work=paired-text&file=translation%2Fen.md#dtg-000002');
  const linked = page.locator('#md-dtg-000002');
  await expect(linked).toHaveCount(1);
  await expect(linked).toHaveClass(/parallel-section/);
  await expect.poll(() => linked.evaluate(element => Math.round(element.getBoundingClientRect().top))).toBeGreaterThanOrEqual(70);
  await expect.poll(() => linked.evaluate(element => Math.round(element.getBoundingClientRect().top))).toBeLessThanOrEqual(page.viewportSize().height / 2);
  const before = await linked.evaluate(element => element.getBoundingClientRect().top);
  await linked.locator('.section-language-toggle').click();
  await expect(page.locator('#language-toggle')).toHaveText('English');
  await expect(linked.locator('.source-passage')).toContainText('བར་མའི་བོད་ཡིག།');
  await expect(page.locator('#md-dtg-000002')).toHaveCount(1);
  await expect.poll(async () => Math.abs(await linked.evaluate(element => element.getBoundingClientRect().top) - before)).toBeLessThan(3);
  await linked.locator('.section-language-toggle').click();
  await expect(linked.locator('.english-passage')).toContainText('Another English paragraph in the same anchored passage.');
  await expect(page.locator('#md-dtg-000002')).toHaveCount(1);
});

for (const field of ['paired-edition','text-id']) {
  test(`paired-text/1 rejects a mismatched ${field} before language switching`, async ({page}) => {
    const englishMismatch = anchorEnglish.replace('schema: paired-text/1',`schema: paired-text/1\n${field}: english-revision`);
    const sourceMismatch = anchorSource.replace('schema: paired-text/1',`schema: paired-text/1\n${field}: different-source-revision`);
    await pairedFixture(page, {english:englishMismatch,source:sourceMismatch});
    await expect(page.locator('#paired-status')).toContainText(/paired editions do not match/i);
    await expect(page.locator('#language-toggle')).toBeHidden();
    await expect(page.locator('#manuscript .source-passage')).toHaveCount(0);
    await expect(page.locator('#manuscript')).toContainText('English concluding passage.');
  });
}
