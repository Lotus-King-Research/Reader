import {test} from 'node:test';
import assert from 'node:assert/strict';
import {countWords} from '../../src/words.js';

test('counts the English a reader reads', () => {
  assert.equal(countWords('One two three.'), 3);
  assert.equal(countWords("The teacher's words — well-known, ten-fold."), 5);
  assert.equal(countWords('Śāntideva taught Mañjuśrī.'), 3, 'Sanskrit diacritics stay inside one word');
});

test('leaves out front matter, markup, pair markers and Tibetan', () => {
  const text = '---\nschema: paired-text/2\ntext-id: x\n---\n\n# A title\n\n<!-- pair: X-000001 -->\nHere are <em>five</em> English words.\n<!-- /pair -->\n\n<a id="x-000002"></a>\nབོད་ཡིག་གི་ཚིག';
  assert.equal(countWords(text), 7);
});

test('leaves out notes, note references and links to note files, but keeps link text', () => {
  const text = [
    'A passage with a note.[^n1] [N-001](../notes/LEGACY-NOTES.md#n-001) [F001](../translations/NOTES.md#f001)',
    '',
    'Earlier notes: [N-001](../notes/LEGACY-NOTES.md#n-001).',
    '',
    'See [the source](https://example.org/source) here. ![A figure](figure.png)',
    '',
    '## Golden-source footnotes and endnotes',
    '',
    '[^n1]: **G-U00001 — U00001**',
    '',
    '    A long critical note that is not part of the translation.',
    '',
    '    **Evidence:** [reading](../reading.md)',
    '',
    'A closing line.'
  ].join('\n');
  // "A passage with a note." (5) + "See the source here." (4) + "A closing line." (3)
  assert.equal(countWords(text), 12);
});

test('stays fast on a long text', () => {
  const passage = '<!-- pair: X-000001 -->\nThe stanza runs on with words, and the words go on, line after line.\n<!-- /pair -->\n\n';
  const text = passage.repeat(9000) + '[^a]: A note.\n\n    More of the note.\n';
  const start = performance.now(); const count = countWords(text);
  assert.equal(count, 14 * 9000);
  assert.ok(performance.now() - start < 60, 'well within a request budget');
});
