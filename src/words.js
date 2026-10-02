// How many words a translation is: the English a reader reads, without front matter,
// markup, pair markers, note definitions, note references or links to note files.
// Shared by the edge Worker (for collection cards) and the page, so both agree.
export function countWords(markdown) {
  let text = String(markdown || '').replace(/\r\n?/g, '\n');
  text = text.replace(/^﻿?---\n[\s\S]*?\n---(?:\n|$)/, '');
  // Note definitions run until the next line that is neither blank nor indented. They are
  // often most of a file, so they go first and every later pass scans less.
  text = text.replace(/^ {0,3}\[\^[^\]\n]+\]:.*(?:\n(?:[ \t]*\n)*(?: {4}|\t).*)*/gm, ' ');
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');
  text = text.replace(/^(?:#{1,6}\s+Golden[-\s]source footnotes|Earlier notes:).*$/gim, ' ');
  text = text.replace(/\[\^[^\]\n]+\]/g, ' ');
  text = text.replace(/\[[^\]\n]*\]\([^)\s]*(?:LEGACY-)?NOTES\.md[^)\s]*\)/gi, ' ');
  text = text.replace(/!\[[^\]\n]*\]\([^)\n]*\)/g, ' ');
  text = text.replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, '$1');
  text = text.replace(/<[^>\n]+>/g, ' ');
  // Latin letters (with the extended ranges that carry Sanskrit diacritics) and digits;
  // explicit ranges are several times faster than Unicode script properties here.
  const word = /[A-Za-z0-9\u00C0-\u024F\u1E00-\u1EFF]+(?:['’.-][A-Za-z0-9\u00C0-\u024F\u1E00-\u1EFF]+)*/g;
  let count = 0;
  while (word.exec(text)) count++;
  return count;
}
