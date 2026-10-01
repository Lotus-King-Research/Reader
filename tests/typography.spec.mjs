import {test, expect} from '@playwright/test';
import {mockCatalog} from './catalog-fixture.mjs';

const repository = 'Lotus-King-Research/Example-Text';
const config = {works:[{id:'typeset-text',repository,title:'Typeset specimen',englishUrl:`https://github.com/${repository}/blob/main/paired/translation.md`,sourceUrl:`https://github.com/${repository}/blob/main/paired/source.md`,sourceLanguage:'bo'}]};
const units = [
  {id:'TY-000001',format:'prose',english:'༄༅།',source:'༄༅།'},
  {id:'TY-000002',format:'h1',english:'Here is the specimen title.',source:'དཔེ་ཆའི་མཚན།'},
  {id:'TY-000003',format:'verse',english:"The teacher's words are spoken,\nand the students' minds rest.",source:'ཚིགས་བཅད་དང་པོ།\nཚིགས་བཅད་གཉིས་པ།'},
  {id:'TY-000004',format:'prose',english:'The reading ya bzhi [ཡ་བཞི་; sense unresolved] is kept as written.',source:'ཡ་བཞི།'}
];
function manuscript(side) {
  const source = side === 'source';
  const front = `---\nschema: paired-text/2\ntext-id: typeset-specimen\npaired-edition: typeset-paired-v2\nsource-edition: typeset-golden-v1\n${source ? 'edition: typeset-golden-v1' : 'translation-edition: typeset-translation-v1'}\nlanguage: ${source ? 'bo' : 'en'}\n---`;
  const body = units.map(unit => `<!-- pair: ${unit.id}${source ? ` | format: ${unit.format}` : ''} -->\n${source ? unit.source : unit.english}\n<!-- /pair -->`).join('\n\n');
  return `${front}\n\n# ${source ? 'དཔེ་ཆ།' : 'Typeset specimen'}\n\n## ${source ? 'ལེའུ།' : 'Chapter 1'}\n\n${body}`;
}
async function open(page) {
  const state = await mockCatalog(page, {configuration:config});
  state.files['Example-Text'] = {'paired/translation.md':manuscript('english'),'paired/source.md':manuscript('source')};
  await page.goto('/?work=typeset-text&file=paired%2Ftranslation.md');
  await expect(page.locator('body')).not.toHaveClass(/loading/);
  await expect(page.locator('#manuscript')).toContainText('Here is the specimen title.');
}
const section = (page, id) => page.locator(`#md-${id.toLowerCase()}`);

test('verse lines wrap with a hanging indent in both languages', async ({page}) => {
  await open(page);
  for (const side of ['.english-passage', '.source-passage']) {
    const indent = await section(page, 'TY-000003').locator(`${side} p`).evaluate(p => getComputedStyle(p).textIndent);
    expect(indent).toMatch(/hanging/); expect(indent).toMatch(/each-line/);
  }
});

test('head marks are ornaments and title lines stay out of the top level of the contents', async ({page}) => {
  await open(page);
  await expect(section(page, 'TY-000001').locator('.english-passage p')).toHaveClass(/tibetan-sign/);
  await expect(section(page, 'TY-000001').locator('.source-passage p')).toHaveClass(/tibetan-sign/);
  const title = section(page, 'TY-000002').locator('.english-passage h1');
  expect(await title.evaluate(h => getComputedStyle(h).textAlign)).toBe('center');
  const sizes = await page.evaluate(() => ({title:parseFloat(getComputedStyle(document.querySelector('#md-ty-000002 h1')).fontSize), chapter:parseFloat(getComputedStyle(document.querySelector('#manuscript h2')).fontSize)}));
  expect(sizes.title).toBeLessThan(sizes.chapter);
  await expect(page.locator('#toc li').filter({hasText:'Here is the specimen title.'})).toHaveClass('sub');
});

test('Tibetan inside an English line is tagged as a run, not the whole paragraph', async ({page}) => {
  await open(page);
  const paragraph = section(page, 'TY-000004').locator('.english-passage p');
  await expect(paragraph).not.toHaveAttribute('lang', 'bo');
  await expect(paragraph.locator('span[lang="bo"]')).toHaveText('ཡ་བཞི་');
});

test('apostrophes are typographic on the page and search still matches the typed form', async ({page}) => {
  await open(page);
  await expect(section(page, 'TY-000003').locator('.english-passage')).toContainText('The teacher’s words');
  await expect(section(page, 'TY-000003').locator('.english-passage')).toContainText('students’ minds');
  await page.keyboard.press('/');
  await page.locator('#search-input').fill("teacher's words");
  await expect(page.locator('#search-count')).toHaveText('1 passage');
});

test('print uses its own type size, not the screen setting', async ({page}) => {
  await open(page);
  await page.click('#settings-trigger');
  await page.locator('#font-size').fill('26'); await page.locator('#font-size').dispatchEvent('change');
  await page.keyboard.press('Escape');
  const screenSize = await page.locator('#manuscript').evaluate(el => getComputedStyle(el).fontSize);
  expect(screenSize).toBe('26px');
  await page.emulateMedia({media:'print'});
  const printSize = await page.locator('#manuscript').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  expect(printSize).toBeCloseTo(14.67, 1);
});
