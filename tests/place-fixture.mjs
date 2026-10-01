import {expect} from '@playwright/test';
import {mockCatalog} from './catalog-fixture.mjs';

// A long paired text: six chapters of twenty prose passages, PL-000001 to PL-000120.
const repository = 'Lotus-King-Research/Example-Text';
const config = {works:[{id:'place-text',repository,title:'Place specimen',englishUrl:`https://github.com/${repository}/blob/main/paired/translation.md`,sourceUrl:`https://github.com/${repository}/blob/main/paired/source.md`,sourceLanguage:'bo'}]};
export const id = n => 'PL-' + String(n).padStart(6, '0');
export function manuscript(side) {
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
export const URL_PATH = '/?work=place-text&file=paired%2Ftranslation.md';
export async function setup(page) {
  const state = await mockCatalog(page, {configuration:config});
  state.files['Example-Text'] = {'paired/translation.md':manuscript('english'),'paired/source.md':manuscript('source')};
  return state;
}
export async function opened(page) {
  await expect(page.locator('body')).not.toHaveClass(/loading/);
  await expect(page.locator('#manuscript')).toContainText('Passage 1 of the specimen');
}
export const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
// Puts a passage's first line just under the reading line, as a reader would.
export async function readAt(page, n) {
  await page.evaluate(target => { const el = document.querySelector(`#md-${target} .english-passage p`); scrollTo(0, scrollY + el.getBoundingClientRect().top - 95); }, id(n).toLowerCase());
  await frames(page);
}
export const topOf = (page, n) => page.evaluate(target => document.querySelector(`#md-${target} .english-passage p`).getBoundingClientRect().top, id(n).toLowerCase());

