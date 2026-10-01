import {test, expect} from '@playwright/test';
import {mockCatalog} from './catalog-fixture.mjs';

const repository = 'Lotus-King-Research/Example-Text';
const config = {works:[{id:'notes-text',repository,title:'Notes specimen',englishUrl:`https://github.com/${repository}/blob/main/paired/translation.md`,sourceUrl:`https://github.com/${repository}/blob/main/paired/source.md`,sourceLanguage:'bo'}]};
const legacy = `# Earlier translation notes

<a id="n-001"></a>
## N-001 — Sanskrit transcription / title

[Read the original note, unchanged](../drafts/REVIEW-NOTES.md#n-001)

Current golden-source updates: [G-U00002](ENDNOTES.md#g-u00002)

<a id="n-002"></a>
## N-002 — Ritual syllables

Another note.
`;
const golden = `[^G-U00002]: **G-U00002 — U00002**

    The compact foreign-script title is not fully deciphered.

    **Supplied e-text:** \`"རཏྣ།"\`

    **Previous English, preserved:** \`"Here is the title."\`

    **Earlier translation notes:** [N-001](../notes/LEGACY-NOTES.md#n-001).

    **Confidence / limit:** Unresolved component retained, not deciphered

    **Evidence:** [golden reading](../diplomatic/reading.md#u00002)

    **Paired locations:** [NO-000002](#no-000002)`;
function manuscript(side) {
  const source = side === 'source';
  const front = `---\nschema: paired-text/2\ntext-id: notes-specimen\npaired-edition: notes-paired-v1\nsource-edition: notes-golden-v1\n${source ? 'edition: notes-golden-v1' : 'translation-edition: notes-translation-v1'}\nlanguage: ${source ? 'bo' : 'en'}\n---`;
  const pairs = [
    ['NO-000001', 'prose', 'An opening line.', 'ཚིག་དང་པོ།'],
    ['NO-000002', 'prose', 'Here is the title. [N-001](../notes/LEGACY-NOTES.md#n-001)\n\n[^G-U00002]', 'མཚན།']
  ].map(([id, format, english, tibetan]) => `<!-- pair: ${id}${source ? ` | format: ${format}` : ''} -->\n${source ? tibetan : english}\n<!-- /pair -->`).join('\n\n');
  return `${front}\n\n# ${source ? 'དཔེ་ཆ།' : 'Notes specimen'}\n\n## ${source ? 'ལེའུ།' : 'Chapter 1'}\n\n${pairs}${source ? '' : '\n\n## Golden-source footnotes and endnotes\n\n' + golden}`;
}
async function open(page) {
  const state = await mockCatalog(page, {configuration:config});
  state.files['Example-Text'] = {'paired/translation.md':manuscript('english'),'paired/source.md':manuscript('source'),'notes/LEGACY-NOTES.md':legacy};
  await page.goto('/?work=notes-text&file=paired%2Ftranslation.md');
  await expect(page.locator('body')).not.toHaveClass(/loading/);
  await expect(page.locator('#manuscript')).toContainText('Here is the title.');
  await page.locator('#notes-toggle').evaluate(button => button.click());
  return state;
}

test('an earlier translation note opens beside the text, with its source on GitHub', async ({page}) => {
  await open(page);
  await page.locator('#manuscript .legacy-note-ref').first().click();
  await expect(page.locator('#note-dialog')).toBeVisible();
  await expect(page.locator('#note-title')).toHaveText('N-001 — Sanskrit transcription / title');
  await expect(page.locator('#note-content')).toContainText('Current golden-source updates');
  await expect(page.locator('#note-content')).not.toContainText('Another note.');
  await expect(page.locator('#note-source')).toHaveAttribute('href', 'https://github.com/Lotus-King-Research/Example-Text/blob/main/notes/LEGACY-NOTES.md#n-001');
  await expect(page.locator('#note-content a', {hasText: 'Read the original note'})).toHaveAttribute('href', 'https://github.com/Lotus-King-Research/Example-Text/blob/main/drafts/REVIEW-NOTES.md#n-001');
  await expect(page.locator('#note-jump')).toBeHidden();
  await expect(page).toHaveURL(/work=notes-text/);
  // The golden-source update is the note in this text.
  await page.locator('#note-content a', {hasText: 'G-U00002'}).click();
  await expect(page.locator('#note-title')).toHaveText('G-U00002 — U00002');
});

test('a golden critical note shows its comment and confidence, with sources and review in a disclosure', async ({page}) => {
  await open(page);
  await page.locator('#manuscript a.footnote-ref').first().click();
  await expect(page.locator('#note-title')).toHaveText('G-U00002 — U00002');
  const content = page.locator('#note-content');
  await expect(content.locator('> p').first()).toHaveText('The compact foreign-script title is not fully deciphered.');
  await expect(content.locator('.note-field .note-field-label', {hasText: 'Confidence / limit'})).toBeVisible();
  const details = content.locator('details.note-provenance');
  await expect(details).not.toHaveAttribute('open', '');
  await expect(details.locator('dt')).toHaveText(['Supplied e-text', 'Previous English, preserved', 'Evidence', 'Paired locations']);
  await details.locator('summary').click();
  await expect(details.locator('dd a', {hasText: 'golden reading'})).toHaveAttribute('href', 'https://github.com/Lotus-King-Research/Example-Text/blob/main/diplomatic/reading.md#u00002');
  await expect(page.locator('#note-jump')).toBeVisible();
  // From a golden note to the earlier note it supersedes, in the same panel.
  await content.locator('.note-field a', {hasText: 'N-001'}).click();
  await expect(page.locator('#note-title')).toHaveText('N-001 — Sanskrit transcription / title');
});

test('an earlier note that cannot be reached still offers GitHub', async ({page}) => {
  const state = await open(page);
  delete state.files['Example-Text']['notes/LEGACY-NOTES.md'];
  await page.locator('#manuscript .legacy-note-ref').first().click();
  await expect(page.locator('#note-content')).toContainText('can still be read on GitHub');
  await expect(page.locator('#note-source')).toBeVisible();
});

test('a note in NOTES.md, linked as a GitHub page, opens from its heading to the next note', async ({page}) => {
  const state = await mockCatalog(page, {configuration:config});
  const english = manuscript('english').replace('An opening line.', 'An opening line. [F001](../translations/NOTES.md#f001)');
  state.files['Example-Text'] = {'paired/translation.md':english,'paired/source.md':manuscript('source'),
    'translations/NOTES.md':'# Translation notes\n\n## F001\n\n- Location: U00001.\n- Category: source reading.\n\n## F002\n\n- Location: U00002.\n'};
  await page.goto('/?work=notes-text&file=paired%2Ftranslation.md');
  await expect(page.locator('#manuscript')).toContainText('An opening line.');
  await page.locator('#notes-toggle').evaluate(button => button.click());
  const link = page.locator('#manuscript .legacy-note-ref', {hasText: 'F001'});
  await expect(link).toHaveAttribute('href', 'https://github.com/Lotus-King-Research/Example-Text/blob/main/translations/NOTES.md#f001');
  await link.click();
  await expect(page.locator('#note-title')).toHaveText('F001');
  await expect(page.locator('#note-content')).toContainText('Category: source reading.');
  await expect(page.locator('#note-content')).not.toContainText('U00002');
  await expect(page.locator('#note-source')).toHaveAttribute('href', 'https://github.com/Lotus-King-Research/Example-Text/blob/main/translations/NOTES.md#f001');
});
