import {test, expect} from '@playwright/test';
import {mockCatalog} from './catalog-fixture.mjs';

const repository = 'Lotus-King-Research/Example-Text';
const config = {works:[{id:'layout-text',repository,title:'Layout specimen',englishUrl:`https://github.com/${repository}/blob/main/paired/translation.md`,sourceUrl:`https://github.com/${repository}/blob/main/paired/source.md`,sourceLanguage:'bo'}]};
const units = [
  ['LA-000001', 'prose', '༄༅། [N-001](../notes/LEGACY-NOTES.md#n-001)', '༄༅།'],
  ['LA-000002', 'h1', 'Here is the centred title line of the specimen.[^a]', 'མཚན།'],
  ['LA-000003', 'verse', 'The first line of the stanza ends here,[^b]\nthe second line follows it,\nand the third closes.', 'ཚིག་དང་པོ།\nཚིག་གཉིས་པ།\nཚིག་གསུམ་པ།'],
  ['LA-000004', 'prose', 'A sentence carries a note[^c] in its middle and runs on long enough to wrap across the measure of the page, so that any change in width would move its words. [N-002](../notes/LEGACY-NOTES.md#n-002)', 'ཚིག'],
  ['LA-000005', 'prose', 'A closing line.\n\n[^d]', 'རྫོགས།'],
  ['LA-000006', 'prose', 'A passage that ends in a long run of earlier notes, wider than any margin. [N-A001](../notes/LEGACY-NOTES.md#n-a001) [N-A007](../notes/LEGACY-NOTES.md#n-a007) [N-A008](../notes/LEGACY-NOTES.md#n-a008) [N-A010](../notes/LEGACY-NOTES.md#n-a010)', 'ཚིག']
];
function manuscript(side) {
  const source = side === 'source';
  const front = `---\nschema: paired-text/2\ntext-id: layout-specimen\npaired-edition: layout-paired-v1\nsource-edition: layout-golden-v1\n${source ? 'edition: layout-golden-v1' : 'translation-edition: layout-translation-v1'}\nlanguage: ${source ? 'bo' : 'en'}\n---`;
  const body = units.map(([id, format, english, tibetan]) => `<!-- pair: ${id}${source ? ` | format: ${format}` : ''} -->\n${source ? tibetan : english}\n<!-- /pair -->`).join('\n\n');
  return `${front}\n\n# ${source ? 'དཔེ་ཆ།' : 'Layout specimen'}\n\n## ${source ? 'ལེའུ།' : 'Chapter 1'}\n\n${body}${source ? '' : '\n\n## Translation notes\n\n[^a]: Note a.\n\n[^b]: Note b.\n\n[^c]: Note c.\n\n[^d]: Note d.'}`;
}
// The position of every character of the text, leaving out the markers themselves.
const layout = page => page.evaluate(() => {
  const out = [], walker = document.createTreeWalker(document.getElementById('manuscript'), NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.trim() || node.parentElement.closest('.reader-note-marker,.note-tail,sup,.footnotes,[hidden],.section-link,[data-notes-heading]')) continue;
    const range = document.createRange();
    for (const at of [0, node.textContent.length - 1]) {
      range.setStart(node, at); range.setEnd(node, at + 1);
      const box = range.getBoundingClientRect(); if (box.width || box.height) out.push([Math.round(box.left * 2) / 2, Math.round((box.top + scrollY) * 2) / 2]);
    }
  }
  return out;
});

test('turning notes on reveals the markers and moves no word', async ({page}) => {
  const state = await mockCatalog(page, {configuration:config});
  state.files['Example-Text'] = {'paired/translation.md':manuscript('english'),'paired/source.md':manuscript('source')};
  await page.goto('/?work=layout-text&file=paired%2Ftranslation.md');
  await expect(page.locator('#manuscript')).toContainText('A closing line.');
  await page.locator('#source-hint-dismiss').click();
  // The page's arrival animation moves everything slightly until it ends.
  await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))));
  const markers = page.locator('#manuscript .reader-note-marker');
  await expect(markers.first()).toBeHidden();
  const before = await layout(page);
  expect(before.length).toBeGreaterThan(10);
  await page.locator('#notes-toggle').evaluate(button => button.click());
  await expect(markers.first()).toBeVisible();
  expect(await layout(page)).toEqual(before);
  // Markers that end their line take no room; the one inside the sentence keeps its room.
  await expect(page.locator('#md-la-000004 .note-tail')).toHaveCount(1);
  await expect(page.locator('#md-la-000004 .english-passage p > .reader-note-marker')).toHaveCount(1);
  await page.locator('#notes-toggle').evaluate(button => button.click());
  expect(await layout(page)).toEqual(before);
});

test('with notes hidden, their heading goes too, and the end of the text says how to show them', async ({page}) => {
  const state = await mockCatalog(page, {configuration:config});
  state.files['Example-Text'] = {'paired/translation.md':manuscript('english'),'paired/source.md':manuscript('source')};
  await page.goto('/?work=layout-text&file=paired%2Ftranslation.md');
  await expect(page.locator('#manuscript')).toContainText('A closing line.');
  const heading = page.locator('#manuscript h2', {hasText: 'Translation notes'});
  await expect(heading).toHaveCount(1);
  await expect(heading).toBeHidden();
  await expect(page.locator('#toc a', {hasText: 'Translation notes'})).toHaveCount(0);
  await expect(page.locator('#notes-invite')).toBeVisible();
  await expect(page.locator('#notes-invite-text')).toHaveText('Translation notes are hidden.');
  await page.locator('#notes-invite-button').click();
  await expect(heading).toBeVisible();
  await expect(page.locator('#manuscript .footnotes')).toBeVisible();
  await expect(page.locator('#toc a', {hasText: 'Translation notes'})).toHaveCount(1);
  await expect(page.locator('#notes-invite')).toBeHidden();
  await expect(page.locator('#notes-toggle')).toHaveAttribute('aria-pressed', 'true');
});

test('a run of markers too wide for the margin keeps its room, so nothing overflows or moves', async ({page}) => {
  const state = await mockCatalog(page, {configuration:config});
  state.files['Example-Text'] = {'paired/translation.md':manuscript('english'),'paired/source.md':manuscript('source')};
  await page.goto('/?work=layout-text&file=paired%2Ftranslation.md');
  await expect(page.locator('#manuscript')).toContainText('wider than any margin');
  await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))));
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  const before = await layout(page);
  await page.locator('#notes-toggle').evaluate(button => button.click());
  expect(await layout(page)).toEqual(before);
  expect(await overflow()).toBeLessThanOrEqual(0);
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  for (const box of await page.locator('#md-la-000006 .legacy-note-ref').evaluateAll(links => links.map(link => link.getBoundingClientRect().right)))
    expect(box).toBeLessThanOrEqual(width);
});
