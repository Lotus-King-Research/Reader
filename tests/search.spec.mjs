import {test, expect} from '@playwright/test';
import {mockCatalog} from './catalog-fixture.mjs';
import {URL_PATH, setup, opened} from './place-fixture.mjs';

const repository = 'Lotus-King-Research/Example-Text';
const config = {works:[{id:'search-text',repository,title:'Search specimen',englishUrl:`https://github.com/${repository}/blob/main/paired/translation.md`,sourceUrl:`https://github.com/${repository}/blob/main/paired/source.md`,sourceLanguage:'bo'}]};
const units = [
  {id:'SE-000001',format:'h3',english:'The first reply',source:'དྲིས་ལན་དང་པོ།'},
  {id:'SE-000002',format:'verse',english:'Like the wind in the reeds,\nthe mind moves.',source:'རླུང་ལྟར།\nསེམས་འགྱུ།'},
  {id:'SE-000003',format:'prose',english:'As Śāntideva taught, patience is the finest austerity.[^n1]',source:'བཟོད་པ་ཱི་དཀའ་ཐུབ༌མཆོག'},
  {id:'SE-000004',format:'prose',english:'A plain closing line.',source:'རྫོགས་སོ།'}
];
function manuscript(side) {
  const source = side === 'source';
  const front = `---\nschema: paired-text/2\ntext-id: search-specimen\npaired-edition: search-paired-v1\nsource-edition: search-golden-v1\n${source ? 'edition: search-golden-v1' : 'translation-edition: search-translation-v1'}\nlanguage: ${source ? 'bo' : 'en'}\n---`;
  const body = units.map(unit => `<!-- pair: ${unit.id}${source ? ` | format: ${unit.format}` : ''} -->\n${source ? unit.source : unit.english}\n<!-- /pair -->`).join('\n\n');
  return `${front}\n\n# ${source ? 'དཔེ་ཆ།' : 'Search specimen'}\n\n## ${source ? 'ལེའུ།' : 'Chapter 1'}\n\n${body}${source ? '' : '\n\n[^n1]: A note.'}`;
}
async function open(page) {
  const state = await mockCatalog(page, {configuration:config});
  state.files['Example-Text'] = {'paired/translation.md':manuscript('english'),'paired/source.md':manuscript('source')};
  await page.goto('/?work=search-text&file=paired%2Ftranslation.md');
  await expect(page.locator('body')).not.toHaveClass(/loading/);
  await expect(page.locator('#manuscript')).toContainText('A plain closing line.');
}
async function search(page, query) {
  if (!(await page.locator('#search-dialog').getAttribute('open') !== null)) await page.keyboard.press('/');
  await page.locator('#search-input').fill(query);
}
const results = page => page.locator('#search-results li:not(.search-more)');

test('results are labelled in English, even for a passage found in Tibetan', async ({page}) => {
  await open(page);
  await search(page, 'དྲིས་ལན');
  await expect(results(page)).toHaveCount(1);
  await expect(results(page).first().locator('.result-section')).toHaveText('The first reply');
  await expect(results(page).first().locator('.result-excerpt')).toHaveAttribute('lang', 'bo');
  await search(page, 'སེམས');
  await expect(results(page).first().locator('.result-section')).toHaveText('The first reply');
});

test('verse lines are joined with a slash and note markers are not part of the text', async ({page}) => {
  await open(page);
  await search(page, 'reeds, / the mind');
  await expect(results(page)).toHaveCount(1);
  await expect(results(page).first().locator('.result-excerpt')).toHaveText('Like the wind in the reeds, / the mind moves.');
  await search(page, 'austerity');
  await expect(results(page).first().locator('.result-excerpt')).toHaveText(/austerity\.$/);
});

test('Latin search ignores diacritics and keeps the highlight on the written form', async ({page}) => {
  await open(page);
  await search(page, 'shantideva'); await expect(results(page)).toHaveCount(0);
  await search(page, 'santideva');
  await expect(results(page)).toHaveCount(1);
  await expect(results(page).first().locator('mark')).toHaveText('Śāntideva');
});

test('Tibetan search folds the spellings of the same syllables and ignores a final tsheg or shad', async ({page}) => {
  await open(page);
  // The passage spells the long vowel precomposed (U+0F73) and uses a non-breaking tsheg (U+0F0C).
  await search(page, 'ཱི'); await expect(results(page)).toHaveCount(1);
  await search(page, 'དཀའ་ཐུབ་མཆོག'); await expect(results(page)).toHaveCount(1);
  await expect(results(page).first().locator('mark')).toHaveText('དཀའ་ཐུབ༌མཆོག');
  await search(page, 'རྫོགས་སོ་'); await expect(results(page)).toHaveCount(1);
  await search(page, 'རླུང་ལྟར།'); await expect(results(page)).toHaveCount(1);
});

test('long result lists show more on request instead of stopping at sixty', async ({page}) => {
  await setup(page); await page.goto(URL_PATH); await opened(page);
  await search(page, 'gives the page real height');
  await expect(page.locator('#search-count')).toHaveText('120 passages');
  await expect(results(page)).toHaveCount(60);
  await page.locator('.search-more-button').click();
  await expect(results(page)).toHaveCount(120);
  await expect(page.locator('.search-more-button')).toHaveCount(0);
  await expect(results(page).nth(60).locator('button')).toBeFocused();
});
