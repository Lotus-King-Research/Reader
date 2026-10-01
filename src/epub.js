/* Lukija EPUB export. Browser-only, no dependencies, no network access.
 * EPUB 3 package + EPUB 2 NCX fallback; ZIP entries use the STORE method.
 * Export operates on a clone of the already-sanitized reading DOM.
 */
(() => {
  'use strict';
  const XHTML = 'http://www.w3.org/1999/xhtml';
  const EPUB = 'http://www.idpf.org/2007/ops';
  const XML = 'http://www.w3.org/XML/1998/namespace';
  const encoder = new TextEncoder();
  const crcTable = Uint32Array.from({length: 256}, (_, n) => {
    let c = n;
    for (let i = 0; i < 8; i++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const clean = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '\ufffd');
  const escapeXML = value => clean(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  const validLanguage = value => /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(value || '') ? value : 'en';
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  function zip(entries, date) {
    const local = [], directory = [];
    let offset = 0, directoryLength = 0;
    const year = Math.max(1980, Math.min(2107, date.getUTCFullYear()));
    const dosDate = ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
    const dosTime = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1);
    for (const [name, content] of entries) {
      const path = encoder.encode(name), data = content instanceof Uint8Array ? content : encoder.encode(content);
      const crc = crc32(data);
      const header = new Uint8Array(30 + path.length), h = new DataView(header.buffer);
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
      h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true); h.setUint32(14, crc, true);
      h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, path.length, true);
      header.set(path, 30); local.push(header, data);
      const central = new Uint8Array(46 + path.length), c = new DataView(central.buffer);
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true); c.setUint32(16, crc, true);
      c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, path.length, true);
      c.setUint32(42, offset, true); central.set(path, 46); directory.push(central);
      offset += header.length + data.length; directoryLength += central.length;
      if (offset > 100 * 1024 * 1024) throw new Error('This EPUB exceeds the 100 MB export limit. Export a smaller manuscript.');
    }
    const end = new Uint8Array(22), e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true);
    e.setUint32(12, directoryLength, true); e.setUint32(16, offset, true);
    return new Blob([...local, ...directory, end], {type: 'application/epub+zip'});
  }
  const CSS = `
@charset "UTF-8";
html { color-scheme: light dark; }
body { font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif; line-height: 1.7; margin: 5%; }
h1,h2,h3,h4,h5,h6 { font-weight: normal; line-height: 1.3; text-align: left; page-break-after: avoid; break-after: avoid; }
h1 { font-size: 2em; margin: 1em 0 .8em; }
h2 { font-size: 1.5em; margin: 2em 0 1em; }
h3 { font-size: 1.2em; margin: 1.5em 0 .7em; }
p { margin: 0 0 1em; orphans: 3; widows: 3; }
a { text-decoration: underline; }
[lang|="zh"] { font-family: "Songti SC", "Songti TC", "Noto Serif CJK TC", "Noto Serif CJK SC", "PMingLiU", serif; line-height: 1.9; }
[lang|="bo"] { font-family: "Noto Serif Tibetan", "Noto Sans Tibetan", serif; line-height: 2; }
blockquote { margin: 1.3em 0 1.3em 1em; padding: .3em 0 .3em 1em; border-left: 2px solid #9e3c2c; }
figure.citation-block { margin: 1.7em 0 1.7em .6em; padding: .4em 0 .4em 1em; border-left: 2px solid #9e3c2c; }
.citation-attribution { margin-bottom: .8em; page-break-after: avoid; break-after: avoid; }
.citation-label { display: block; font-family: sans-serif; font-size: .65em; letter-spacing: .12em; text-transform: uppercase; margin-bottom: .5em; }
.citation-source { font-size: .92em; font-weight: bold; }
.citation-text { margin: 0; padding: 0; border: 0; }
.citation-text p:last-child { margin-bottom: 0; }
.annotation, .commentary { font-size: .9em; padding-left: 1em; border-left: 1px solid currentColor; }
.footnotes { font-size: .88em; border-top: 1px solid currentColor; margin-top: 3em; padding-top: 1em; }
.footnotes li { margin-bottom: 1em; }
.footnote-ref { font-size: .8em; }
.footnote-back { font-family: sans-serif; font-size: .85em; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: .85em; }
code,kbd,samp { font-family: monospace; }
table { border-collapse: collapse; width: 100%; margin: 1.4em 0; font-size: .85em; }
th,td { padding: .45em .6em; border-bottom: 1px solid currentColor; vertical-align: top; text-align: left; }
th { font-weight: bold; }
.align-center { text-align: center; } .align-right { text-align: right; }
img { max-width: 100%; height: auto; }
hr { border: 0; border-top: 1px solid currentColor; margin: 2em 0; }
.titlepage { text-align: center; padding-top: 18%; page-break-after: always; }
.titlepage h1 { text-align: center; }
.edition { font-family: sans-serif; font-size: .7em; letter-spacing: .15em; text-transform: uppercase; }
.export-notice { font-size: .85em; margin-top: 2em; }
.image-reference { font-size: .9em; font-style: italic; }
nav ol { padding-left: 1.3em; } nav li { margin: .6em 0; }
`;
  function xhtml(title, language, body) {
    const lang = escapeXML(language);
    return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="${XHTML}" xmlns:epub="${EPUB}" lang="${lang}" xml:lang="${lang}"><head><meta charset="utf-8"/><title>${escapeXML(title)}</title><link rel="stylesheet" type="text/css" href="styles.css"/></head><body>${body}</body></html>`;
  }
  function normalizedBody(root, language) {
    // A document without a browsing context cannot load cloned image URLs.
    const inert = document.implementation.createHTMLDocument('');
    const body = inert.importNode(root, true);
    body.querySelectorAll('.section-link, [data-reader-ui]:not(.citation-label), [hidden], script, style, button, iframe, object, embed, link, meta').forEach(el => el.remove());
    // Search highlights and scrolling containers are screen furniture, not book content.
    body.querySelectorAll('.table-scroll').forEach(el => el.replaceWith(...el.childNodes));
    body.querySelectorAll('details').forEach(el => {
      const section = inert.createElement('div');
      for (const attr of ['id', 'class', 'lang', 'dir']) if (el.hasAttribute(attr)) section.setAttribute(attr, el.getAttribute(attr));
      el.replaceWith(section); section.append(...el.childNodes);
    });
    body.querySelectorAll('summary').forEach(el => {
      const p = inert.createElement('p'), strong = inert.createElement('strong');
      strong.append(...el.childNodes); p.append(strong); el.replaceWith(p);
    });
    body.querySelectorAll('input').forEach(el => el.replaceWith(inert.createTextNode(el.checked ? '[x] ' : '[ ] ')));
    const ids = new Map(), used = new Set();
    let sequence = 0;
    body.querySelectorAll('[id]').forEach(el => {
      const old = el.id;
      // Conservative XML IDs also work in older EPUB implementations.
      const id = `p-${++sequence}`;
      if (!ids.has(old)) ids.set(old, id);
      el.id = id; used.add(id);
    });
    let imageCount = 0;
    body.querySelectorAll('img').forEach(img => {
      imageCount++;
      const span = inert.createElement('span'); span.className = 'image-reference';
      if (img.id) span.id = img.id;
      const alt = img.getAttribute('alt') || 'Image';
      const link = inert.createElement('a');
      const src = img.getAttribute('src') || '';
      if (/^https?:\/\//i.test(src)) {
        link.href = src; link.textContent = `${alt} — view image online`; span.append(link);
      } else span.textContent = `[${alt}: image not included]`;
      img.replaceWith(span);
    });
    body.querySelectorAll('a').forEach(a => {
      const local = a.getAttribute('data-local-link');
      const href = a.getAttribute('href') || '';
      if (local) { a.removeAttribute('href'); a.setAttribute('title', `Local manuscript link: ${local}`); }
      else if (href.startsWith('#')) {
        let target; try { target = decodeURIComponent(href.slice(1)); } catch (_) { target = href.slice(1); }
        if (ids.has(target)) a.setAttribute('href', `#${ids.get(target)}`);
        else a.removeAttribute('href'); // Never emit broken in-book references.
      } else if (!/^(https?:|mailto:)/i.test(href)) a.removeAttribute('href');
      if (a.classList.contains('footnote-ref') && a.hasAttribute('href')) {
        a.setAttributeNS(EPUB, 'epub:type', 'noteref'); a.setAttribute('role', 'doc-noteref');
      }
      if (a.classList.contains('footnote-back') && a.hasAttribute('href')) a.setAttribute('role', 'doc-backlink');
    });
    body.querySelectorAll('.footnotes').forEach(el => { el.setAttributeNS(EPUB, 'epub:type', 'endnotes'); el.setAttribute('role', 'doc-endnotes'); });
    body.querySelectorAll('li[data-note]').forEach(el => el.setAttributeNS(EPUB, 'epub:type', 'endnote'));
    const headings = [];
    body.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(el => {
      if (!el.id) { do { el.id = `p-${++sequence}`; } while (used.has(el.id)); used.add(el.id); }
      headings.push({id: el.id, text: el.textContent.trim() || 'Untitled section', level: Number(el.tagName.slice(1))});
    });
    const keep = new Set(['id','class','lang','dir','href','title','role','aria-label','colspan','rowspan','scope','start','reversed','value']);
    // Serialize into a genuinely namespaced XML document, not HTML with string replacements.
    const doc = document.implementation.createDocument(XHTML, 'div', null);
    function copy(node, parent) {
      if (node.nodeType === Node.TEXT_NODE) { parent.appendChild(doc.createTextNode(clean(node.textContent))); return; }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = doc.createElementNS(XHTML, node.localName.toLowerCase());
      for (const a of node.attributes) {
        if (a.namespaceURI === EPUB) el.setAttributeNS(EPUB, 'epub:' + a.localName, a.value);
        else if (keep.has(a.name)) {
          if (a.name === 'lang') {
            const lang = validLanguage(a.value); el.setAttribute('lang', lang); el.setAttributeNS(XML, 'xml:lang', lang);
          } else el.setAttribute(a.name, clean(a.value));
        }
      }
      if (el.hasAttribute('aria-label') && !el.hasAttribute('role') && ['span','div','p'].includes(el.localName)) el.removeAttribute('aria-label');
      parent.appendChild(el);
      for (const child of node.childNodes) copy(child, el);
    }
    for (const node of body.childNodes) copy(node, doc.documentElement);
    const serializer = new XMLSerializer();
    return {html: [...doc.documentElement.childNodes].map(el => serializer.serializeToString(el)).join(''), headings, imageCount};
  }
  function navList(headings) {
    const root = [], stack = [{level: 0, children: root}];
    for (const heading of headings) {
      while (stack.length > 1 && stack.at(-1).level >= heading.level) stack.pop();
      const item = {...heading, children: []}; stack.at(-1).children.push(item); stack.push(item);
    }
    const render = list => `<ol>${list.map(h => `<li><a href="content.xhtml#${escapeXML(h.id)}">${escapeXML(h.text)}</a>${h.children.length ? render(h.children) : ''}</li>`).join('')}</ol>`;
    return render(root);
  }
  function build({root, title = 'Untitled manuscript', author = '', language = 'en', source = '', identifier = '', date = new Date(), specimen = false}) {
    if (!root || typeof root.cloneNode !== 'function') throw new TypeError('An already-sanitized manuscript DOM is required.');
    title = clean(title).trim().slice(0, 500) || 'Untitled manuscript';
    author = clean(author).trim().slice(0, 500); language = validLanguage(language);
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new TypeError('A valid export date is required.');
    const uuid = globalThis.crypto?.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const bytes = new Uint8Array(1); globalThis.crypto.getRandomValues(bytes); const r = bytes[0] & 15;
      return (c === 'x' ? r : (r & 3) | 8).toString(16);
    });
    identifier = identifier || `urn:uuid:${uuid}`;
    source = /^https?:\/\//i.test(source) ? source : '';
    const content = normalizedBody(root, language), headings = content.headings;
    const modified = date.toISOString().replace(/\.\d{3}Z$/, 'Z');
    const esc = escapeXML;
    const notice = specimen ? '<p class="export-notice">Typography specimen only. This is not a translation of the source work.</p>' : '';
    const images = content.imageCount ? `<p class="export-notice">${content.imageCount} image${content.imageCount === 1 ? ' is' : 's are'} represented by descriptive links. Linked images are not embedded and require an internet connection.</p>` : '';
    const titlepage = xhtml(title, language, `<section epub:type="titlepage" class="titlepage"><p class="edition">Reader · Reading edition</p><h1>${esc(title)}</h1>${author ? `<p>${esc(author)}</p>` : ''}${notice}${images}<p><a href="nav.xhtml">Contents</a></p>${source ? `<p class="export-notice"><a href="${esc(source)}">Manuscript source</a></p>` : ''}</section>`);
    const navigation = xhtml('Contents · ' + title, language, `<nav epub:type="toc" id="toc" role="doc-toc"><h1>Contents</h1>${headings.length ? navList(headings) : '<ol><li><a href="content.xhtml">' + esc(title) + '</a></li></ol>'}</nav><nav epub:type="landmarks" hidden="hidden"><h2>Guide</h2><ol><li><a epub:type="titlepage" href="title.xhtml">Title page</a></li><li><a epub:type="bodymatter" href="content.xhtml">Start reading</a></li></ol></nav>`);
    const points = headings.length ? headings : [{text: title, id: ''}];
    const ncx = `<?xml version="1.0" encoding="UTF-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${esc(language)}"><head><meta name="dtb:uid" content="${esc(identifier)}"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head><docTitle><text>${esc(title)}</text></docTitle><navMap>${points.map((h,i) => `<navPoint id="nav-${i+1}" playOrder="${i+1}"><navLabel><text>${esc(h.text)}</text></navLabel><content src="content.xhtml${h.id ? '#' + esc(h.id) : ''}"/></navPoint>`).join('')}</navMap></ncx>`;
    const opf = `<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${esc(language)}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">${esc(identifier)}</dc:identifier><dc:title>${esc(title)}</dc:title><dc:language>${esc(language)}</dc:language>${author ? `<dc:creator>${esc(author)}</dc:creator>` : ''}${source ? `<dc:source>${esc(source)}</dc:source>` : ''}<meta property="dcterms:modified">${modified}</meta><meta property="rendition:layout">reflowable</meta><meta property="rendition:orientation">auto</meta><meta property="rendition:spread">auto</meta></metadata><manifest><item id="title" href="title.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="content" href="content.xhtml" media-type="application/xhtml+xml"/><item id="css" href="styles.css" media-type="text/css"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine toc="ncx"><itemref idref="title"/><itemref idref="nav" linear="no"/><itemref idref="content"/></spine></package>`;
    const entries = [
      ['mimetype', 'application/epub+zip'],
      ['META-INF/container.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'],
      ['EPUB/package.opf', opf], ['EPUB/title.xhtml', titlepage], ['EPUB/nav.xhtml', navigation],
      ['EPUB/content.xhtml', xhtml(title, language, `<main epub:type="bodymatter">${content.html}</main>`)],
      ['EPUB/styles.css', CSS], ['EPUB/toc.ncx', ncx]
    ];
    return {blob: zip(entries, date), imageCount: content.imageCount, title, identifier};
  }
  globalThis.LukijaEPUB = Object.freeze({build});
})();
