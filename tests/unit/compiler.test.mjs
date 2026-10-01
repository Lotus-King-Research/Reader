import {test} from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {loadCompiler} from './load-compiler.mjs';

const compile = await loadCompiler();

// A synthetic paired-text/2 translation shaped like a long published edition:
// many short verse passages, references throughout, every definition at the end.
function edition(pairs) {
  const lines = ['---', 'schema: paired-text/2', 'text-id: synthetic', 'language: en', '---', '', '# Synthetic edition', '', '## Chapter 1', ''];
  for (let i = 1; i <= pairs; i++) {
    const id = 'SYN-' + String(i).padStart(6, '0');
    lines.push(`<!-- pair: ${id} -->`, `Line one of passage ${i},`, `line two of passage ${i}.[^n${i % 200}]`, '<!-- /pair -->', '');
  }
  for (let n = 0; n < 200; n++) lines.push(`[^n${n}]: Note ${n} explains a reading.`, '');
  return lines.join('\n');
}

function fastest(source, runs = 3) {
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const start = performance.now(); compile(source); best = Math.min(best, performance.now() - start);
  }
  return best;
}

test('parsing cost grows linearly with manuscript length', () => {
  compile(edition(200)); // Warm up the JIT.
  const small = fastest(edition(1500)), large = fastest(edition(3000));
  // Quadratic scanning made this ratio about 4; linear parsing keeps it near 2.
  assert.ok(large / small < 2.8, `3,000 passages took ${large.toFixed(0)} ms against ${small.toFixed(0)} ms for 1,500`);
});

test('footnote definitions at the end of a long edition still render as linked notes', () => {
  const result = compile(edition(300));
  assert.equal(result.structures.length, 300);
  assert.equal(result.noteCount, 200);
  assert.match(result.html, /<a class="footnote-ref" href="#fn-1" id="fnref-1-1"/);
  assert.match(result.html, /<li id="fn-200" data-note="200"><p>Note 0 explains a reading\.<\/p>/);
});

test('a definition that directly follows a paragraph line still ends that paragraph', () => {
  const result = compile('A paragraph that cites a note.[^a]\n[^a]: The note body.\n\nNext paragraph.');
  assert.match(result.html, /<p>A paragraph that cites a note\.<sup>/);
  assert.doesNotMatch(result.html, /\[\^a\]:/);
  assert.match(result.html, /<li id="fn-1" data-note="1"><p>The note body\.<\/p>/);
  assert.match(result.html, /<p>Next paragraph\.<\/p>/);
});

test('indented multi-paragraph notes keep all of their paragraphs', () => {
  const result = compile('Text.[^long]\n\n[^long]: First paragraph.\n\n    Second paragraph.\n');
  assert.match(result.html, /<li id="fn-1" data-note="1"><p>First paragraph\.<\/p>\n<p>Second paragraph\.<\/p>/);
});
