import {test, expect} from '@playwright/test';
import {manuscript} from './place-fixture.mjs';

const file = (name, text) => ({name, mimeType: 'text/markdown', buffer: Buffer.from(text)});
async function choose(page, files, opening = 'Passage 1 of the specimen') {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles(files);
  await expect(page.locator('body')).not.toHaveClass(/loading/);
  await expect(page.locator('#manuscript')).toContainText(opening);
}

test('two files of one paired text open together, in either order, and say how well they paired', async ({page}) => {
  await choose(page, [file('bo.md', manuscript('source')), file('en.md', manuscript('english'))]);
  await expect(page.locator('#manuscript .source-passage')).toHaveCount(120);
  await expect(page.locator('#toast-text')).toHaveText('120 of 120 passages paired · paired edition place-paired-v1 · translation place-translation-v1 · source place-golden-v1.');
  await page.evaluate(() => { const p = document.querySelector('#md-pl-000004 .english-passage p'); scrollTo(0, p.getBoundingClientRect().top + scrollY - 95); });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.keyboard.press('t');
  await expect(page.locator('#md-pl-000004 .source-passage')).toBeVisible();
});

test('files that are not two halves of one text still open on their own', async ({page}) => {
  const other = manuscript('source').replace('text-id: place-specimen', 'text-id: another-text');
  // Unpaired files open in name order, so the Tibetan file comes first.
  await choose(page, [file('en.md', manuscript('english')), file('bo.md', other)], 'ཚིག་1 དང་པོ');
  await expect(page.locator('#manuscript .source-passage')).toHaveCount(0);
  await expect(page.locator('#toast-text')).toHaveText('2 texts opened locally.');
});
