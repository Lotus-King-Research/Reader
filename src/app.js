/* Reader · a collection of independent reading rooms.
   Published works are discovered from their public repositories at runtime.
   No translation snapshots or credentials are embedded in the reader. */
(() => {
'use strict';
const CONFIG = Object.freeze({
  owner: '',
  repository: '', // Optional public source; no book is configured by default.
  branch: 'main',
  directory: 'translation',
  initialFile: '',
  autoLoad: false,
  title: 'Reader',
  manifest: 'reader-manifest.json',
  maximumBytes: 4 * 1024 * 1024,
  fetchTimeout: 12000,
  parseTimeout: 6500, // Plus parsePerMegabyte for each megabyte of source.
  parsePerMegabyte: 8000,
  storagePrefix: 'padma-reader:v1:' // Legacy key preserves existing preferences and bookmarks; never stores manuscripts.
});
const $ = id => document.getElementById(id);
const $$ = selector => [...document.querySelectorAll(selector)];
const appTemplate = '<!doctype html>\n' + document.documentElement.outerHTML;
const rawBase = CONFIG.owner && CONFIG.repository ? `https://raw.githubusercontent.com/${CONFIG.owner}/${CONFIG.repository}/${CONFIG.branch}/` : null;
const githubBase = rawBase ? `https://github.com/${CONFIG.owner}/${CONFIG.repository}/blob/${CONFIG.branch}/` : null;
const apiDirectory = rawBase ? `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repository}/contents/${CONFIG.directory}?ref=${encodeURIComponent(CONFIG.branch)}` : null;
const naturalSort = new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'});
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const defaults = { theme: 'paper', size: innerWidth < 601 ? 18 : 20, measure: 720, leading: 1.88, citations: true, notes: false };
const state = { view: 'collection', readingPosition: null, readingHeadings: [], current: null, library: [], headings: [], search: [], settings: {...defaults}, busy: false,
  loadId: 0, controller: null, parser: null, activeHeading: null, progress: 0, minutes: 0,
  bookmark: null, canStore: true, restoring: false, lastSave: 0, toastTimer: null,
  loadedFromURL: false, discovered: false, noteTarget: null, navigationToken: 0 };

function storageRead(key, fallback = null) {
  try { const v = localStorage.getItem(CONFIG.storagePrefix + key); return v === null ? fallback : JSON.parse(v); }
  catch (_) { return fallback; }
}
function storageWrite(key, value) {
  try { localStorage.setItem(CONFIG.storagePrefix + key, JSON.stringify(value)); return true; }
  catch (_) { state.canStore = false; return false; }
}
function storageRemove(key) {
  try { localStorage.removeItem(CONFIG.storagePrefix + key); return true; } catch (_) { return false; }
}
function hashText(s) {
  let hash = 2166136261;
  for (let i = 0; i < s.length; i++) { hash ^= s.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(36);
}
function textElement(tag, text, className = '') {
  const el = document.createElement(tag); el.textContent = text;
  if (className) el.className = className;
  return el;
}
function icon(name) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('class', 'icon'); el.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#i-' + name); el.append(use); return el;
}
function announce(text) { $('announcer').textContent = text; }
function notify(text, actionText = '', action = null, duration = 5500) {
  clearTimeout(state.toastTimer); $('toast-text').textContent = text;
  $('toast-action').hidden = !actionText;
  $('toast-action').textContent = actionText;
  $('toast-action').onclick = () => { $('toast').hidden = true; action?.(); };
  $('toast').hidden = false;
  if (duration) state.toastTimer = setTimeout(() => { $('toast').hidden = true; }, duration);
}
function showError(text, retry = true) {
  $('load-message-text').textContent = text; $('retry-button').hidden = !retry; $('load-message').hidden = false;
}
function syncModalState() { document.body.classList.toggle('dialog-open', !!document.querySelector('dialog[open]')); }
function openDialog(id) {
  closeNav(false);
  const dialog = $(id);
  document.querySelectorAll('dialog[open]').forEach(other => { if (other !== dialog) other.close(); });
  if (!dialog.open) dialog.showModal();
  syncModalState();
}
function closeDialog(id) { $(id).close(); syncModalState(); }
$$('dialog').forEach(dialog => {
  dialog.addEventListener('close', syncModalState);
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
  });
  dialog.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => dialog.close()));
});
function syncSidebarAccess() {
  $('sidebar').inert = document.body.classList.contains('focus-mode') || (innerWidth<=920 && !document.body.classList.contains('nav-open'));
}
function openNav() {
  document.body.classList.remove('focus-mode'); syncFocus();
  document.body.classList.add('nav-open'); $('mobile-menu').setAttribute('aria-expanded', 'true');
  if (innerWidth <= 920) { $('sidebar').setAttribute('role', 'dialog'); $('sidebar').setAttribute('aria-modal', 'true'); }
  syncSidebarAccess(); $('close-nav').focus({preventScroll:true});
}
function closeNav(returnFocus = true) {
  const wasOpen = document.body.classList.contains('nav-open');
  document.body.classList.remove('nav-open'); $('mobile-menu').setAttribute('aria-expanded', 'false');
  $('sidebar').removeAttribute('role'); $('sidebar').removeAttribute('aria-modal');
  syncSidebarAccess(); if (wasOpen && returnFocus) $('mobile-menu').focus({preventScroll:true});
}
$('mobile-menu').addEventListener('click', openNav);
$('close-nav').addEventListener('click', () => closeNav());
$('mobile-backdrop').addEventListener('click', () => closeNav());
$('sidebar').addEventListener('keydown', e => {
  if (!document.body.classList.contains('nav-open') || e.key !== 'Tab') return;
  const controls = [...$('sidebar').querySelectorAll('a[href],button:not([disabled])')].filter(el => el.offsetParent !== null);
  const first = controls[0], last = controls.at(-1);
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

/* The bundled Marked parser is run in a disposable Worker when possible.
   A constrained synchronous fallback covers browsers that block blob workers.
   Definitions are lexed as Markdown, including indented multi-paragraph notes. */
function createCompiler(marked) {
  let definitions, ordered, counts;
  const escape = text => String(text).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  function noteNumber(label) { if (!ordered.includes(label)) ordered.push(label); return ordered.indexOf(label) + 1; }
  // Marked 4 drains its inline queue with Array#shift, which copies the rest of the
  // queue on every call and becomes quadratic for long manuscripts. Walk it by index
  // instead; the order, and therefore the output, is unchanged.
  marked.Lexer.prototype.lex = function lex(src) {
    src = src.replace(/\r\n|\r/g, '\n');
    this.blockTokens(src, this.tokens);
    for (let i = 0; i < this.inlineQueue.length; i++) this.inlineTokens(this.inlineQueue[i].src, this.inlineQueue[i].tokens);
    this.inlineQueue = [];
    return this.tokens;
  };
  marked.use({ gfm: true, breaks: false, mangle: false, smartypants: false,
    headerIds: true,
    extensions: [
      { name: 'readerNoteDefinition', level: 'block',
        // Marked uses start() only to cut the current paragraph, and a paragraph
        // ends at the first blank line. Scanning the whole remaining document at
        // every block made parsing quadratic in the length of the manuscript.
        start(src) { const end = src.search(/\n[ \t]*\n/); const m = /^ {0,3}\[\^[^\]\n]+\]:/m.exec(end < 0 ? src : src.slice(0, end)); return m?.index; },
        tokenizer(src) {
          const first = /^ {0,3}\[\^([^\]\n]+)\]:[^\S\n]*([^\n]*)(?:\n|$)/.exec(src);
          if (!first) return;
          const label = first[1].trim().toLowerCase();
          let raw = first[0], body = first[2], rest = src.slice(raw.length);
          while (rest.length) {
            let m = /^(?: {4}|\t)([^\n]*)(?:\n|$)/.exec(rest);
            if (m) { body += '\n' + m[1]; raw += m[0]; rest = rest.slice(m[0].length); continue; }
            m = /^(?:[ \t]*\n)+(?= {4}|\t)/.exec(rest);
            if (m) { body += '\n' + m[0].replace(/[ \t]/g, ''); raw += m[0]; rest = rest.slice(m[0].length); continue; }
            break;
          }
          const token = {type: 'readerNoteDefinition', raw, label, text: body, tokens: []};
          // Register before tokenizing to make self-references finite.
          if (!definitions.has(label)) definitions.set(label, token);
          token.tokens = this.lexer.blockTokens(body);
          return token;
        }, renderer() { return ''; }, childTokens: ['tokens']
      },
      { name: 'readerNoteReference', level: 'inline',
        start(src) { return src.indexOf('[^'); },
        tokenizer(src) {
          const m = /^\[\^([^\]\n]+)\]/.exec(src);
          if (m) return {type:'readerNoteReference', raw:m[0], label:m[1].trim().toLowerCase()};
        },
        renderer(token) {
          if (!definitions.has(token.label)) return escape(token.raw);
          const n = noteNumber(token.label), occurrence = (counts.get(token.label) || 0) + 1;
          counts.set(token.label, occurrence);
          return `<sup><a class="footnote-ref" href="#fn-${n}" id="fnref-${n}-${occurrence}" data-footnote="${n}" aria-label="Read note ${n}">${n}</a></sup>`;
        }
      }
    ]
  });
  return function compile(source) {
    definitions = new Map(); ordered = []; counts = new Map();
    let body = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    let frontmatter = '', metadata = {}, lineOffset = 0;
    const front = /^---[ \t]*\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(body);
    if (front) {
      lineOffset = front[0].split('\n').length - 1;
      frontmatter = front[1]; body = body.slice(front[0].length);
      for (const line of frontmatter.split('\n')) {
        const match = /^([A-Za-z][\w-]*):[ \t]*(.+)$/.exec(line);
        if (match) metadata[match[1].toLowerCase()] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
      }
    }
    const structures=[]; let structureError='', structureErrorLine=0;
    // Name the exact file line, so a publisher can fix a misaligned edition directly.
    const fail=(message,line)=>{if(!structureError){structureError=message;structureErrorLine=line;}};
    if(metadata.schema==='paired-text/2'){
      let open=null,line=lineOffset+1,scanned=0;const seen=new Map();
      const markers=/^[ \t]*<!--\s*(pair\s*:[^\n]*|\/pair)\s*-->[ \t]*$/gm;
      for(const marker of body.matchAll(markers)){
        for(;scanned<marker.index;scanned++)if(body.charCodeAt(scanned)===10)line++;
        const value=marker[1].trim();
        if(value==='/pair'){
          if(!open)fail(`The closing pair marker at line ${line} has no opening pair.`,line);
          if(open)open.delimited=true;open=null;continue;
        }
        const fields=value.replace(/^pair\s*:\s*/,'').split('|').map(field=>field.trim());
        const id=fields.shift(),formats=fields.filter(field=>/^format\s*:/.test(field));
        if(!/^[A-Za-z][A-Za-z0-9._:-]{0,199}$/.test(id))fail(`The pair ID “${id.slice(0,80)}” at line ${line} is invalid.`,line);
        if(seen.has(id.toLowerCase()))fail(`Pair ID ${id} at line ${line} repeats the pair at line ${seen.get(id.toLowerCase())}.`,line);
        else seen.set(id.toLowerCase(),line);
        open={id,line,format:formats[0]?.replace(/^format\s*:\s*/,'') || '',formatCount:formats.length,delimited:false};structures.push(open);
      }
      if(!structures.length)fail('This paired-text edition contains no pair markers.',0);
      // Pair comments are the canonical identity; publisher HTML anchors are optional.
      body=body.replace(/(?:^[ \t]*<a[ \t]+id=["'][^"'\n]*["'][ \t]*><\/a>[ \t]*\n\s*)?^[ \t]*<!--\s*pair\s*:\s*([A-Za-z][A-Za-z0-9._:-]{0,199})(?:[ \t]*\|[^\n]*|[ \t]*)-->[ \t]*$/gm,(_,id)=>'\n\n<a id="'+id.toLowerCase()+'"></a>\n\n');
      body=body.replace(/^[ \t]*<!--\s*\/pair\s*-->[ \t]*$/gm,'\n\n<span class="reader-pair-end"></span>\n\n');
      // The generic standard needs only start markers; explicit /pair is optional.
      const records=new Map(structures.map(pair=>[pair.id.toLowerCase(),pair])),lines=[];
      let active=null,hasContent=false;
      const endPair=()=>{lines.push('', '<span class="reader-pair-end"></span>', '');active=null;hasContent=false;};
      for(const line of body.split('\n')){
        const anchor=/^<a id="([^"]+)"><\/a>$/.exec(line);
        if(anchor && records.has(anchor[1])){if(active)endPair();active=records.get(anchor[1]);hasContent=false;}
        else if(line==='<span class="reader-pair-end"></span>'){active=null;hasContent=false;}
        else if(active && !active.delimited && hasContent && /^(?: {0,3}#{1,6}\s+|[ \t]*<h[1-6](?:[ \t]|>))/i.test(line))endPair();
        else if(active && line.trim())hasContent=true;
        lines.push(line);
      }
      if(active)endPair();body=lines.join('\n');
    }
    let html = marked.parse(body);
    // Do not silently discard unused definitions.
    for (const label of definitions.keys()) noteNumber(label);
    if (ordered.length > 1500) throw new Error('This text has more than 1,500 footnotes. Split it into smaller files.');
    if (ordered.length) {
      const notes = [];
      for (let i = 0; i < ordered.length && i < 1500; i++) {
        const label = ordered[i];
        notes.push({label, n:i+1, content:marked.parser(definitions.get(label).tokens)});
      }
      html += '<section class="footnotes" aria-label="Endnotes"><h2 id="notes">Notes</h2><ol>';
      for (const note of notes) {
        const count = counts.get(note.label) || 0;
        const backs = Array.from({length:count}, (_,j) => `<a class="footnote-back" href="#fnref-${note.n}-${j+1}" aria-label="Back to reference ${note.n}${count>1 ? ', occurrence '+(j+1):''}">↩${count>1 ? j+1:''}</a>`).join(' ');
        const unused = count ? '' : `<p><em>Unreferenced note: [^${escape(note.label)}]</em></p>`;
        html += `<li id="fn-${note.n}" data-note="${note.n}">${unused}${note.content}${backs}</li>`;
      }
      html += '</ol></section>';
    }
    return {html, metadata, frontmatter, structures, structureError, structureErrorLine, noteCount:ordered.length};
  };
}
let mainCompiler = null;
function parseMarkdown(source, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Cancelled', 'AbortError'));
    let worker, timer, blobURL;
    const finish = (error, result) => {
      clearTimeout(timer); worker?.terminate();
      if (blobURL) URL.revokeObjectURL(blobURL);
      signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(result);
    };
    const abort = () => finish(new DOMException('Cancelled', 'AbortError'));
    const fallback = () => {
      worker?.terminate(); if (blobURL) { URL.revokeObjectURL(blobURL); blobURL = null; }
      if (source.length > CONFIG.maximumBytes) return finish(new Error('This browser blocks background parsing. Open the reader in a browser with Web Worker support, or split this large text into smaller files.'));
      // Parsing is linear, so even a full-size manuscript parses on the main thread.
      setTimeout(() => {
        if (signal?.aborted) return;
        try { mainCompiler ||= createCompiler(window.marked); finish(null, mainCompiler(source)); }
        catch (error) { finish(error); }
      }, 0);
    };
    signal?.addEventListener('abort', abort, {once:true});
    try {
      const engine = $('markdown-engine').textContent;
      const workerCode = engine + '\nconst compile = (' + createCompiler.toString() + ')(self.marked);\nself.onmessage = e => { try { self.postMessage({ok:true, result:compile(e.data)}); } catch(error) { self.postMessage({ok:false, error:String(error.message || error)}); } };';
      blobURL = URL.createObjectURL(new Blob([workerCode], {type:'application/javascript'}));
      worker = new Worker(blobURL);
      timer = setTimeout(() => finish(new Error('This text took too long to parse. Check for unusually complex Markdown or split it into smaller volumes.')), CONFIG.parseTimeout + CONFIG.parsePerMegabyte * source.length / 1048576);
      worker.onmessage = event => event.data.ok ? finish(null,event.data.result) : finish(new Error(event.data.error));
      worker.onerror = () => fallback();
      worker.postMessage(source);
    } catch (_) { fallback(); }
  });
}

/* Rebuild parsed HTML with a narrow vocabulary. Nothing from a manuscript is
   inserted into the live DOM as unsanitized HTML. Unsafe elements are discarded,
   IDs are namespaced, and every link/image URL is normalized and checked. */
function safeURL(value, base, image = false) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) return null;
  value = value.trim();
  if (!image && value.startsWith('#')) return value;
  try {
    const url = new URL(value, base || location.href);
    if (url.username || url.password) return null;
    if (url.protocol === 'http:' || url.protocol === 'https:' || (!image && url.protocol === 'mailto:')) return url.href;
  } catch (_) {}
  return null;
}
function safeDOM(html, base) {
  const template = document.createElement('template'); template.innerHTML = html;
  const allowed = new Set('P H1 H2 H3 H4 H5 H6 BLOCKQUOTE UL OL LI STRONG EM B I S DEL A BR HR CODE PRE TABLE THEAD TBODY TFOOT TR TH TD CAPTION IMG FIGURE FIGCAPTION SUP SUB SPAN DIV SECTION ASIDE SMALL MARK ABBR CITE Q DL DT DD DETAILS SUMMARY RUBY RT RP WBR KBD SAMP INPUT'.split(' '));
  const drop = new Set('SCRIPT STYLE IFRAME FRAME OBJECT EMBED SVG MATH FORM BUTTON TEXTAREA SELECT OPTION LINK META BASE AUDIO VIDEO SOURCE NOSCRIPT TEMPLATE CANVAS'.split(' '));
  const classes = new Set(['footnotes','footnote-ref','footnote-back','parallel','source-text','translation','annotation','commentary','root-text','align-center','align-right','reader-pair-end']);
  const frag = document.createDocumentFragment(); const ids = new Map(), usedIds = new Set(); let nodeCount = 0;
  function copy(node, parent, depth = 0) {
    if (++nodeCount > 180000 || depth > 100) throw new Error('This text is too structurally complex to display safely. Split it into smaller files.');
    if (node.nodeType === Node.TEXT_NODE) { parent.append(document.createTextNode(node.textContent)); return; }
    if (node.nodeType !== Node.ELEMENT_NODE || drop.has(node.tagName)) return;
    if (!allowed.has(node.tagName)) { for (const child of node.childNodes) copy(child,parent,depth+1); return; }
    if (node.tagName === 'INPUT' && node.getAttribute('type') !== 'checkbox') return;
    const el = document.createElement(node.tagName.toLowerCase());
    for (const className of node.classList) if (classes.has(className)) el.classList.add(className);
    const id = node.getAttribute('id');
    if (id) {
      const clean = 'md-' + id.replace(/[^\p{L}\p{N}_:.-]/gu,'-').slice(0,200);
      let unique = clean, n = 1;
      while (usedIds.has(unique)) unique = clean + '-' + n++;
      usedIds.add(unique);
      if (!ids.has(id)) ids.set(id,unique);
      el.id = unique;
    }
    for (const attr of ['title','aria-label']) if (node.hasAttribute(attr)) el.setAttribute(attr,node.getAttribute(attr).slice(0,1200));
    const lang = node.getAttribute('lang'); if (lang && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(lang)) el.lang = lang;
    const dir = node.getAttribute('dir'); if (['rtl','ltr','auto'].includes(dir)) el.dir = dir;
    if (['TH','TD'].includes(node.tagName)) {
      const align = node.getAttribute('align'); if (['center','right'].includes(align)) el.classList.add('align-'+align);
      for (const attr of ['colspan','rowspan']) { const n = Number(node.getAttribute(attr)); if (n >= 1 && n <= 100) el.setAttribute(attr,String(n)); }
      if (node.tagName === 'TH') el.setAttribute('scope', node.getAttribute('scope') === 'row' ? 'row':'col');
    }
    if (node.tagName === 'OL') { const start = Number(node.getAttribute('start')); if (Number.isInteger(start) && start >= 0 && start < 100000 && node.hasAttribute('start')) el.start = start; }
    if (node.tagName === 'DETAILS' && node.hasAttribute('open')) el.open = true;
    if (node.tagName === 'INPUT') { el.type = 'checkbox'; el.disabled = true; el.checked = node.hasAttribute('checked'); }
    if (node.tagName === 'A') {
      const rawHref = node.getAttribute('href');
      const localLink = rawHref !== null && !base && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(rawHref) && /\.(md|markdown|txt)(?:#[^\s]*)?$/i.test(rawHref);
      const href = rawHref === null ? null : localLink ? '#' : safeURL(rawHref,base);
      if (localLink) el.dataset.localLink = rawHref;
      if (href) {
        el.setAttribute('href',href);
        if (!href.startsWith('#')) { el.target = '_blank'; el.rel = 'noopener noreferrer'; }
      }
      const note = node.getAttribute('data-footnote'); if (note && /^\d{1,5}$/.test(note)) el.dataset.footnote = note;
    }
    if (node.tagName === 'LI') { const note = node.getAttribute('data-note'); if (note && /^\d{1,5}$/.test(note)) el.dataset.note = note; }
    if (node.tagName === 'IMG') {
      const src = safeURL(node.getAttribute('src'),base,true);
      const alt = node.getAttribute('alt') || '';
      if (!src) { parent.append(textElement('span',alt ? '[Image: '+alt+']':'[Local image unavailable]','muted')); return; }
      el.src = src; el.alt = alt; el.loading = 'lazy'; el.decoding = 'async'; el.referrerPolicy = 'no-referrer';
    }
    for (const child of node.childNodes) copy(child,el,depth+1);
    parent.append(el);
  }
  for (const node of template.content.childNodes) copy(node,frag);
  for (const a of frag.querySelectorAll('a[href^="#"]')) {
    let key = a.getAttribute('href').slice(1); try { key = decodeURIComponent(key); } catch (_) {}
    a.setAttribute('href','#'+(ids.get(key) || ('md-'+key.replace(/[^\p{L}\p{N}_:.-]/gu,'-'))));
  }
  return frag;
}
function chineseDominant(text) {
  const han = text.match(/\p{Script=Han}/gu)?.length || 0;
  const letters = text.match(/[\p{L}\p{N}]/gu)?.length || 1;
  return han >= 3 && han / letters > .6;
}
/* Reading layers. Work only on the sanitized DOM, never the Markdown source.
   Balanced quotation marks plus a reporting cue are evidence of a quotation,
   not verification of its source. Ambiguous or unfinished passages stay intact. */
const CITATION_EXCLUDE = 'blockquote,figure,li,td,th,pre,code,figcaption,summary,.footnotes,.annotation,.commentary,.root-text';
const REPORTING_CUE = /\b(?:says?|said|writes?|wrote|states?|stated|declares?|declared|explains?|explained|observes?|observed|remarks?|remarked|asks?|asked|answers?|answered|replies|replied|records?|recorded|teaches?|taught|reads?|read|puts? it|tells? us|has it)(?:\s+(?:thus|as follows))?\s*[:：,，]?\s*$/iu;
const QUOTE_PAIRS = new Map([['“','”'],['‘','’'],['"','"'],["'","'"],['「','」'],['『','』'],['«','»']]);

function attributionStart(text, end, floor = 0) {
  // At most the current paragraph, or a preceding attribution-only paragraph.
  let start = text.lastIndexOf('\n\n', Math.max(0,end-1));
  start = Math.max(floor,start < 0 ? 0 : start+2);
  if (!text.slice(start,end).trim() && start > floor) {
    const previous = text.lastIndexOf('\n\n',start-3);
    start = Math.max(floor,previous < 0 ? 0 : previous+2);
  }
  let tail = text.slice(start,end);
  // Stop at a sentence/semicolon boundary, not at initials or common titles.
  const boundaries = /[。！？!?;；]|\.(?=\s|$)/gu;
  let match;
  while ((match=boundaries.exec(tail))) {
    if (match[0] === '.') {
      const word = tail.slice(0,match.index).match(/([\p{L}]+)$/u)?.[1] || '';
      if (word.length === 1 || /^(?:Mr|Mrs|Ms|Dr|Prof|St|Sr|Jr|vol|ch)$/i.test(word)) continue;
    }
    start += match.index+1; tail = text.slice(start,end); boundaries.lastIndex=0;
  }
  const whitespace = tail.match(/^\s*/)[0].length; start+=whitespace; tail=tail.slice(whitespace);
  if (!tail.trim() || tail.length > 240 || tail.trim().split(/\s+/).length > 30) return null;
  const cue = REPORTING_CUE.exec(tail);
  const namedEnglish = cue && /[\p{L}\p{N}]/u.test(tail.slice(0,cue.index));
  const chinese = /[\p{Script=Han}《》〈〉][\s\S]{0,90}(?:曰|云|雲|言|說|说|道)\s*[:：,，]?\s*$/u.test(tail);
  const anonymous = /^(?:It is (?:said|written|recorded)|As (?:it is )?(?:said|written|recorded))\s*[:：,，]?\s*$/iu.test(tail);
  const according = /^(?:According to|As (?:cited|quoted|recorded|written) in)\s+[^:：]{1,160}[:：]\s*$/iu.test(tail);
  return namedEnglish || chinese || anonymous || according ? start : null;
}

function quotationSpans(text) {
  const result=[], stack=[];
  const isWord = c => !!c && /[\p{L}\p{N}]/u.test(c);
  let paragraphStart=0;
  for (let i=0;i<text.length;i++) {
    if (text[i]==='\n' && text[i-1]==='\n') paragraphStart=i+1;
    const c=text[i], top=stack[stack.length-1];
    if ((c==="'" || c==='’') && isWord(text[i-1]) && isWord(text[i+1])) continue;
    if (top && c===top.close) {
      // A repeated opening mark at the beginning of a paragraph continues an
      // English multi-paragraph quotation, including straight double quotes.
      if (c==='"' && i>top.start && paragraphStart>top.start && !text.slice(paragraphStart,i).trim()) continue;
      stack.pop();
      if (!stack.length) result.push({start:top.start,end:i+1});
      continue;
    }
    if (!QUOTE_PAIRS.has(c)) continue;
    if ((c==='"' || c==="'") && (isWord(text[i-1]) || !text[i+1] || /\s/.test(text[i+1]))) continue;
    if (top && c===top.open && paragraphStart>top.start && !text.slice(paragraphStart,i).trim()) continue;
    if (stack.length>=20) return []; // Do not guess at pathologically nested input.
    stack.push({open:c,close:QUOTE_PAIRS.get(c),start:i});
  }
  return result;
}

function paragraphMap(paragraphs) {
  let text='', mask=''; const parts=[], notes=[];
  for (const node of paragraphs) {
    if (parts.length) {text+='\n\n';mask+='\n\n';}
    const start=text.length, offsets=new WeakMap(); let local=0;
    function index(child,ignored=false) {
      const a=local;
      if (child.nodeType===Node.TEXT_NODE) {
        const value=child.textContent; text+=value; mask+=ignored ? value.replace(/[^\n]/g,' ') : value; local+=value.length;
      } else if (child.nodeType===Node.ELEMENT_NODE) {
        const hidden = ignored || child.matches('code,kbd,samp,rt,rp,q,.footnote-ref');
        for (const sub of child.childNodes) index(sub,hidden);
        if (child.matches('sup') && child.querySelector('.footnote-ref')) notes.push({start:start+a,end:start+local});
      }
      offsets.set(child,{start:a,end:local});
    }
    index(node); parts.push({node,start,end:text.length,offsets});
  }
  return {text,mask,parts,notes};
}

function sliceParagraph(part, from, to) {
  const a=Math.max(0,from-part.start), b=Math.min(part.end-part.start,to-part.start);
  if (b<=a) return null;
  function copy(node) {
    const pos=part.offsets.get(node); if (!pos) return null;
    if (pos.start===pos.end) {
      return pos.start>=a && (pos.start<b || (pos.start===b && b===part.end-part.start)) ? node.cloneNode(true) : null;
    }
    if (pos.end<=a || pos.start>=b) return null;
    if (node.nodeType===Node.TEXT_NODE) return document.createTextNode(node.textContent.slice(Math.max(0,a-pos.start),Math.min(node.textContent.length,b-pos.start)));
    if (pos.start>=a && pos.end<=b) return node.cloneNode(true);
    const clone=node.cloneNode(false);
    for (const child of node.childNodes) {const sub=copy(child);if (sub) clone.append(sub);}
    return clone;
  }
  return copy(part.node);
}
function appendParagraphSlices(target, map, from, to, inline=false, resume=false) {
  for (const part of map.parts) {
    if (part.end<=from || part.start>=to) continue;
    const p=sliceParagraph(part,from,to); if (!p) continue;
    if (!p.textContent.trim() && !p.querySelector('img,br')) continue;
    if (inline) {
      const span=document.createElement('span');
      if (p.id) span.id=p.id;
      if (p.lang) span.lang=p.lang;
      span.append(...p.childNodes);target.append(span);
    } else {
      if (resume) p.classList.add('root-resumption');
      target.append(p);
    }
  }
}
function citationFigure(source, quote, kind='automatic') {
  const figure=document.createElement('figure');figure.className='citation-block';figure.dataset.citationKind=kind;
  const caption=document.createElement('figcaption');caption.className='citation-attribution';
  const label=textElement('span',source?.textContent.trim() ? 'Cited passage' : 'Quoted passage','citation-label');
  label.dataset.readerUi='';label.setAttribute('aria-hidden','true');caption.append(label);
  if (source?.textContent.trim()) {
    source.classList.add('citation-source');caption.append(source);
    if (chineseDominant(source.textContent)) source.lang='zh';
  }
  figure.setAttribute('aria-label',source?.textContent.trim() ? 'Cited passage' : 'Quoted passage');
  quote.classList.add('citation-text');figure.append(caption,quote);return figure;
}
function extendQuotationEnd(map,end) {
  // Keep immediately following note references and terminal punctuation with
  // the quotation; never absorb the author's next sentence.
  let changed=true;
  while (changed) {
    changed=false;
    const punctuation=/^[.!?。！？](?![.!?。！？])/.exec(map.text.slice(end));
    if (punctuation) {end+=punctuation[0].length;changed=true;}
    const note=map.notes.find(note=>note.start>=end && note.start-end<12 && /^[ \t]*$/.test(map.text.slice(end,note.start)));
    if (note) {end=note.end;changed=true;}
  }
  return end;
}
function formatParagraphRun(paragraphs) {
  const map=paragraphMap(paragraphs), spans=quotationSpans(map.mask), found=[]; let floor=0;
  for (const span of spans) {
    const end=extendQuotationEnd(map,span.end);
    const start=attributionStart(map.mask,span.start,floor);
    const first=map.parts.find(p=>p.start<=span.start && p.end>span.start);
    const last=map.parts.find(p=>p.start<end && p.end>=end);
    // No named attribution: only a complete, substantial standalone quotation.
    const standalone=first && last && !map.mask.slice(first.start,span.start).trim() && !map.mask.slice(end,last.end).trim()
      && (map.text.slice(span.start,span.end).split(/\s+/).length>=8 || (map.text.slice(span.start,span.end).match(/\p{Script=Han}/gu)?.length || 0)>=12);
    if ((start!==null || standalone) && end-span.start<=150000) {
      found.push({start:start ?? span.start,body:span.start,end});floor=end;
    } else floor=span.end;
  }
  // Bound the cost of slicing a single unusually dense manuscript paragraph.
  if (!found.length || found.length>300 || map.text.length*found.length>12000000) return;
  const output=document.createDocumentFragment();let cursor=0;
  for (const item of found) {
    appendParagraphSlices(output,map,cursor,item.start,false,cursor>0);
    const source=document.createElement('span');
    appendParagraphSlices(source,map,item.start,item.body,true);
    const quote=document.createElement('blockquote');
    appendParagraphSlices(quote,map,item.body,item.end);
    output.append(citationFigure(source,quote));cursor=item.end;
  }
  appendParagraphSlices(output,map,cursor,map.text.length,false,true);
  // Split inline elements can carry an authored ID. Retain each ID only once.
  const ids=new Set();output.querySelectorAll('[id]').forEach(el=>{if(ids.has(el.id))el.removeAttribute('id');else ids.add(el.id);});
  paragraphs[0].before(output);paragraphs.forEach(p=>p.remove());
}
function formatAuthoredBlockquotes(fragment) {
  const quotes=[...fragment.querySelectorAll('blockquote')].filter(q=>!q.parentElement?.closest('blockquote,figure,.footnotes,.annotation,.commentary,.root-text'));
  for (const quote of quotes) {
    if (/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.test(quote.textContent)) continue;
    let source=document.createElement('span');
    const first=quote.querySelector(':scope > p');
    // An attribution may be authored outside the > block, or on its first line.
    const previous=quote.previousElementSibling;
    if (previous?.tagName==='P' && !previous.matches('.root-text,.annotation,.commentary')) {
      const map=paragraphMap([previous]), start=attributionStart(map.mask,map.text.length);
      if (start!==null) {
        const remaining=document.createDocumentFragment();
        appendParagraphSlices(remaining,map,0,start);
        appendParagraphSlices(source,map,start,map.text.length,true);
        const retained=new Set([...remaining.querySelectorAll('[id]')].map(el=>el.id));
        source.querySelectorAll('[id]').forEach(el=>{if(retained.has(el.id))el.removeAttribute('id');});
        previous.replaceWith(remaining);
      }
    }
    if (!source.textContent.trim() && first) {
      const map=paragraphMap([first]); const spans=quotationSpans(map.mask);
      const opener=spans[0]?.start;
      const start=attributionStart(map.mask,opener ?? map.text.length);
      if (start!==null && !map.mask.slice(0,start).trim()) {
        const cut=opener ?? map.text.length;
        appendParagraphSlices(source,map,start,cut,true);
        const remainder=sliceParagraph(map.parts[0],cut,map.text.length);
        if (remainder?.textContent.trim()) first.replaceWith(remainder);else first.remove();
      }
    }
    const anchor=document.createTextNode('');quote.before(anchor);
    const figure=citationFigure(source,quote,'authored');anchor.replaceWith(figure);
    const ids=new Set();figure.querySelectorAll('[id]').forEach(el=>{if(ids.has(el.id))el.removeAttribute('id');else ids.add(el.id);});
  }
}
function formatCitationLayers(fragment) {
  // Explicit Markdown quotation blocks are always honored, even with automatic
  // recognition off. Tables, lists, notes and marked root text are not inferred.
  formatAuthoredBlockquotes(fragment);
  if (!state.settings.citations) return;
  const processed=new WeakSet();
  const eligible=p=>p?.tagName==='P' && p.textContent.trim() && !p.closest(CITATION_EXCLUDE);
  for (const p of fragment.querySelectorAll('p')) {
    if (processed.has(p) || !eligible(p)) continue;
    const run=[p];processed.add(p);let next=p.nextElementSibling;
    while (eligible(next)) {
      let gap=run[run.length-1].nextSibling, clean=true;
      while (gap && gap!==next) {if(gap.textContent.trim())clean=false;gap=gap.nextSibling;}
      if (!clean) break;
      run.push(next);processed.add(next);next=next.nextElementSibling;
    }
    formatParagraphRun(run);
  }
}
function citationLayersApply(entry=state.current) { return entry?.metadata?.schema !== 'paired-text/2'; }
function syncCitationSetting() { $('auto-citations').closest('.settings-group').hidden = !citationLayersApply(); }
function rebuildCitationLayers() {
  // paired-text/2 never infers citations, so toggling the setting cannot change the page.
  if (state.view !== 'reading' || !state.current || !citationLayersApply() || !state.sourceFragment || state.renderedCitations===state.settings.citations) return;
  const position=currentPosition(),sourceSections=new Set(state.parallel?.pairs.filter(pair=>pair.sourceVisible).map(pair=>pair.section.id) || []);
  const fragment=state.sourceFragment.cloneNode(true);
  prepareContent(fragment,state.current.metadata || {},state.current);
  if (state.parallelFragment) state.parallel=pairSections(fragment,state.parallelFragment.cloneNode(true),state.current);
  state.parallel?.pairs.forEach(pair=>{if(sourceSections.has(pair.section.id))pair.show(true,false,true);});
  markApparatus(fragment);$('manuscript').replaceChildren(fragment);state.renderedCitations=state.settings.citations;
  buildOutline();buildSearchIndex();restorePosition(position);
  announce(state.settings.citations ? 'Attributed quotations are separated from the main text.' : 'Automatic citation formatting is off. Authored blockquotes are retained.');
}

function tagTibetanRuns(root) {
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT), nodes=[];
  while (walker.nextNode()) {
    const node=walker.currentNode, tagged=node.parentElement?.closest('[lang]');
    if (/[\u0f00-\u0fff]/.test(node.data) && !(tagged && root.contains(tagged))) nodes.push(node);
  }
  for (const node of nodes) {
    const parts=document.createDocumentFragment(); let last=0;
    for (const match of node.data.matchAll(/[\u0f00-\u0fff](?:[\u0f00-\u0fff\s]*[\u0f00-\u0fff])?/g)) {
      if (match.index>last) parts.append(node.data.slice(last,match.index));
      const span=document.createElement('span'); span.lang='bo'; span.textContent=match[0]; parts.append(span);
      last=match.index+match[0].length;
    }
    if (last<node.data.length) parts.append(node.data.slice(last));
    node.replaceWith(parts);
  }
}
// Display only: typewriter apostrophes inside English words become typographic ones.
// Search treats both forms alike; code, Tibetan and Chinese are left untouched.
function typographicApostrophes(root) {
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:node=>node.data.includes("'") && !node.parentElement?.closest('code,pre,kbd,samp,[lang|="bo"],[lang|="zh"]') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT});
  const nodes=[]; while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) node.data=node.data.replace(/(\p{L})'(\p{L})/gu,'$1’$2').replace(/(\p{L}s)'(?=[\s.,;:!?)\]]|$)/gu,'$1’');
}
/* Editorial apparatus written by the translators stays word for word, but is set as
   apparatus: a bracketed label such as "[Source heading: …]" becomes a small label
   above the heading, safety notes stand on their own labelled line, and whole-paragraph
   placeholders are quiet ruled notes. Brackets stay in the DOM for search. */
const APPARATUS_HEADING=/^\[(Source heading|Source annotation):\s*([\s\S]+?)\]$/;
function navLabel(text) { const match=APPARATUS_HEADING.exec(String(text).trim()); return match ? match[2].replace(/\.$/,'') : text; }
function bracketPart(text) { const span=textElement('span',text,'ap-br'); span.setAttribute('aria-hidden','true'); return span; }
function markApparatus(root) {
  for (const heading of root.querySelectorAll('h1,h2,h3,h4')) {
    if (heading.closest('.source-passage') || heading.querySelector('.apparatus-label')) continue;
    const match=/^\[(Source heading|Source annotation):\s*/.exec(heading.textContent);
    const first=[...heading.childNodes].find(node => node.nodeType===3 && node.data.trim());
    const last=[...heading.childNodes].reverse().find(node => node.nodeType===3 && node.data.trim());
    if (!match || !first?.data.trimStart().startsWith(match[0].trimEnd()) || !/\]\s*$/.test(last?.data || '')) continue;
    const lead=first.data.length-first.data.trimStart().length;
    first.data=first.data.slice(lead+match[0].length);
    first.before(bracketPart('['),textElement('span',match[1],'apparatus-label'),bracketPart(': '));
    const close=last.data.lastIndexOf(']'); last.data=last.data.slice(0,close)+last.data.slice(close+1); last.after(bracketPart(']'));
  }
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:node=>/\[Editorial (?:safety )?note:/.test(node.data) && !node.parentElement?.closest('.source-passage,.apparatus-inline') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT});
  const notes=[]; while (walker.nextNode()) notes.push(walker.currentNode);
  for (const node of notes) {
    const parts=document.createDocumentFragment(); let last=0;
    for (const match of node.data.matchAll(/\[(Editorial (?:safety )?note):\s*([^\]]+)\]/g)) {
      if (match.index>last) parts.append(node.data.slice(last,match.index));
      const note=document.createElement('span'); note.className='apparatus-inline';
      note.append(bracketPart('['),textElement('span',match[1],'apparatus-label'),bracketPart(': '),match[2],bracketPart(']'));
      parts.append(note); last=match.index+match[0].length;
    }
    if (last<node.data.length) parts.append(node.data.slice(last));
    node.replaceWith(parts);
  }
  for (const p of root.querySelectorAll('p')) {
    if (p.closest('.source-passage,.footnotes')) continue;
    const visible=[...p.childNodes].filter(node => !(node.nodeType===1 && node.matches('sup'))).map(node => node.textContent).join('').trim();
    if (/^\[(?:Source annotation|Joined source fragment|Unresolved source|Provisional source caption)\b[\s\S]*\]$/.test(visible)) p.classList.add('apparatus-block');
  }
}
function prepareContent(fragment, metadata, descriptor) {
  const first = fragment.querySelector('h1');
  const title = first?.textContent.trim() || metadata.title || descriptor.title || 'Untitled text';
  // Move the first H1 into the page masthead only when it begins the document.
  const firstMeaningful = [...fragment.childNodes].find(node => node.nodeType === 1 || node.textContent.trim());
  if (first && firstMeaningful === first) first.remove();
  if(metadata.schema!=='paired-text/2')formatCitationLayers(fragment);
  const headingIds = new Set();
  fragment.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((heading,index) => {
    let baseId = heading.id || 'md-'+heading.textContent.toLowerCase().replace(/[^\p{L}\p{N} _-]/gu,'').replace(/\s+/g,'-').slice(0,160) || 'md-section';
    let id = baseId, n = 1; while (headingIds.has(id)) id = baseId+'-'+n++;
    heading.id = id; headingIds.add(id);
    heading.dataset.headingText = heading.textContent;
  });
  fragment.querySelectorAll('p,blockquote,h1,h2,h3,h4,li,td,th').forEach(el => {
    if (el.lang) return;
    const text=el.textContent, tibetan=/[\u0f00-\u0fff]/.test(text);
    // Tag a whole element only when it is Tibetan; in mixed lines tag the Tibetan runs,
    // so English labels keep the book face and screen readers switch voice per run.
    if (tibetan && (text.match(/\p{Script=Latin}/gu) || []).length < 3) el.lang='bo';
    else if (tibetan) tagTibetanRuns(el);
    else if (chineseDominant(text)) el.lang = 'zh';
  });
  // A paragraph of head marks alone (yig mgo, shad) is an ornament for the passage it opens.
  fragment.querySelectorAll('p').forEach(p => {
    const visible=[...p.childNodes].filter(node => !(node.nodeType===1 && node.matches('sup'))).map(node => node.textContent).join('');
    if (/^[\u0f01-\u0f14\s]+$/.test(visible) && visible.trim()) p.classList.add('tibetan-sign');
  });
  typographicApostrophes(fragment);
  fragment.querySelectorAll('table').forEach(table => {
    const wrap = document.createElement('div'); wrap.className = 'table-scroll'; wrap.tabIndex = 0;
    wrap.setAttribute('role','region'); wrap.setAttribute('aria-label',table.querySelector('caption')?.textContent || 'Scrollable table');
    table.replaceWith(wrap); wrap.append(table);
  });
  fragment.querySelectorAll('blockquote').forEach(quote => {
    const firstP = quote.querySelector(':scope > p');
    const firstNode = firstP?.firstChild;
    if (!firstNode || firstNode.nodeType !== 3) return;
    const alert = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/.exec(firstNode.textContent);
    if (alert) { firstNode.textContent = firstNode.textContent.slice(alert[0].length); firstP.prepend(textElement('span',alert[1],'alert-label')); }
  });
  // Only the first plain, substantial English opening paragraph receives a drop cap.
  const opening = [...fragment.children].find(el => el.tagName === 'P');
  if (metadata.schema!=='paired-text/2' && opening && !opening.classList.contains('root-resumption') && opening.textContent.length > 120 && !chineseDominant(opening.textContent) && /^[A-Za-z]/.test(opening.textContent) && opening.firstChild?.nodeType === 3) opening.classList.add('lead-paragraph','drop-cap');
  return {title, titleNode: first && firstMeaningful === first ? first : null};
}

function volumeNumber(path = '') { const match = /(?:juan|volume|vol)[-_\s]?(\d+)/i.exec(path); return match ? Number(match[1]) : null; }
function hanNumber(n) {
  const values = ['〇','一','二','三','四','五','六','七','八','九'];
  if (n < 10) return values[n]; if (n < 20) return '十'+(n % 10 ? values[n%10]:'');
  if (n < 100) return values[Math.floor(n/10)]+'十'+(n%10 ? values[n%10]:''); return String(n);
}
function fileLabel(path) {
  const n = volumeNumber(path); if (n !== null) return 'Part '+String(n).padStart(2,'0');
  let name=path.split('/').pop() || 'Text';
  try { name=decodeURIComponent(name); } catch (_) {}
  return name.replace(/\.(md|markdown|txt)$/i,'').replace(/[-_]/g,' ');
}
function cleanPath(path) {
  if (typeof path !== 'string') throw new Error('Invalid text path.');
  const normalized = path.replace(/^\.\//,'');
  if (normalized.startsWith('/') || normalized.includes('\\') || normalized.split('/').some(part => part === '..') || !/\.(md|markdown|txt)$/i.test(normalized)) throw new Error('Choose a relative Markdown path inside this project.');
  return normalized;
}
function fromProject(path) {
  path = cleanPath(path);
  const number = volumeNumber(path);
  return { id:'repo:'+path, path, title:fileLabel(path), number, kind:'repository', sourceURL:rawBase ? rawBase+path : null, githubURL:githubBase ? githubBase+path : null };
}
function fromURL(input) {
  const published = catalog.identify(input); if (published) return published;
  const safe = safeURL(input,location.href);
  if (!safe || !/^https?:\/\//.test(safe)) throw new Error('Use an http(s) Markdown URL, without credentials.');
  let url = new URL(safe); const section = url.hash; url.hash = '';
  const parts = url.pathname.split('/').filter(Boolean);
  let githubURL = null;
  if (url.hostname === 'github.com' && parts[2] === 'blob' && parts.length >= 5) {
    githubURL = url.href;
    url = new URL('https://raw.githubusercontent.com/'+[parts[0],parts[1],...parts.slice(3)].join('/'));
  } else if (url.hostname === 'github.com') throw new Error('Use a GitHub file URL containing /blob/, not a repository or directory URL.');
  if (rawBase && url.href.startsWith(rawBase)) { const desc = fromProject(decodeURIComponent(url.href.slice(rawBase.length).split('?')[0])); desc.section = section; return desc; }
  return { id:'url:'+url.href, title:fileLabel(url.pathname), number:volumeNumber(url.pathname), path:url.pathname, kind:'url', sourceURL:url.href, githubURL, section };
}
// Published works are grouped independently of temporary, locally opened manuscripts.
let catalog;
try {catalog=ReaderCatalog.create(syncCatalog);} catch(error) {catalog=ReaderCatalog.create(syncCatalog,{works:[]});setTimeout(()=>showError('Reader configuration: '+error.message,false),0);}
let catalogActive=false,catalogTimer=null;
function catalogCard(work) {
  const li=document.createElement('li'),button=document.createElement('button');
  button.type='button';button.className='work-card published-card';button.dataset.work=work.id;
  button.append(textElement('span','English · '+languageName(work.sourceLanguage || 'bo'),'work-card-kicker'));
  const original=textElement('span',work.originalTitle || '', 'work-card-original');original.lang=work.sourceLanguage || 'bo';button.append(original);
  button.append(textElement('span',work.title,'work-card-title'),textElement('span',work.description,'work-card-detail'));
  const extent=storageRead('extent:'+work.id), version=/v\d[\w.-]*$/i.exec(extent?.edition || '')?.[0];
  if (extent?.passages>1) button.append(textElement('span',[extent.passages.toLocaleString('en')+' passages',version ? 'Edition '+version : ''].filter(Boolean).join(' · '),'work-card-extent'));
  // Where the reader stopped (position and section label only; never text).
  const last=storageRead('last:'+work.id), known=last && (work.english.kind==='file' || !work.volumes.length || work.volumes.some(file=>file.path===last.path));
  const continuing=known && last.progress>.025, finished=continuing && last.progress>=.985;
  if (continuing) {
    const bar=document.createElement('span'), fill=document.createElement('span');
    bar.className='work-card-progress'; bar.setAttribute('aria-hidden','true'); fill.style.transform=`scaleX(${Math.min(1,last.progress)})`; bar.append(fill);
    button.append(bar, textElement('span', finished ? 'Read to the end' : `${last.label ? last.label+' · ' : ''}${Math.round(last.progress*100)}% read`, 'work-card-continue'));
  }
  const status=work.error ? 'Source unavailable · Try again' : work.pending ? 'Finding editions…' : work.stale ? (work.stale.state==='unverified' ? 'Not checked with GitHub · may not be the latest' : 'Saved copy · may not be the latest') : '';
  button.append(textElement('span',status,'work-card-status'));
  const foot=textElement('span',continuing && !finished ? 'Continue reading' : finished ? 'Read again' : work.english.kind==='file' || work.volumes.length===1 ? 'Read' : work.checkedAt ? 'Read first edition' : 'Show editions','work-card-bottom');foot.append(icon('arrow'));button.append(foot);
  button.addEventListener('click',()=>showWork(work.id,continuing && !finished ? last.path : li.querySelector('select')?.value));li.append(button);
  if(work.english.kind==='directory' && work.volumes.length>1){
    const label=textElement('label','Edition','edition-picker'),select=document.createElement('select');select.dataset.editions=work.id;select.setAttribute('aria-label','Edition of '+work.title);
    for(const file of work.volumes){const option=textElement('option',catalog.descriptor(work.id,file.path).title);option.value=file.path;select.append(option);}
    select.value=work.volumes.find(file=>file.path===state.current?.path)?.path || work.volumes[0].path;
    select.addEventListener('change',()=>openEntry(catalog.descriptor(work.id,select.value)));label.append(select);li.append(label);
  }
  return li;
}
function filterCollection() {
  const query=$('collection-search').value.trim().toLocaleLowerCase();let visible=0;
  for(const card of $('published-work-list').children){const work=catalog.works.find(w=>w.id===card.querySelector('button')?.dataset.work);const haystack=[card.textContent,work?.owner,work?.repository].join(' ').toLocaleLowerCase();card.hidden=!!query && !haystack.includes(query);if(!card.hidden)visible++;}
  $('collection-no-results').hidden=!query || !!visible;
}
$('collection-search').addEventListener('input',filterCollection);
function syncCatalog() {
  for (const work of catalog.works) {
    if (!work.checkedAt || work.error) continue;
    const prior=new Map(state.library.filter(e=>e.catalogId===work.id).map(e=>[e.path,e]));
    state.library=state.library.filter(e=>e.catalogId!==work.id);
    for (const file of work.volumes) {
      const next=catalog.descriptor(work.id,file.path), old=prior.get(file.path);
      state.library.push(old?.revision===next.revision && old?.sourceRevision===next.sourceRevision ? {...old,...next,title:old.title} : next);
    }
  }
  renderCollection();
  if ($('library-dialog').open) renderLibrary();
  syncRevisionNotice(); syncNextJuan();
}
async function showWork(id,path) {
  const work=catalog.get(id);closeDialog('library-dialog');
  if(work.english.kind==='file' || work.volumes.length){await openEntry(collectionDescriptor(id,path));return;}
  // Discover a directory's editions inline, without opening a second card dialog.
  state.controller?.abort();const loadId=++state.loadId;setBusy(true,'Finding editions…');
  const ok=await catalog.refresh(id,{force:true,onProgress:event=>{if(loadId===state.loadId)loadingProgress(5+event.progress*85,'Finding editions…');}});
  if(loadId!==state.loadId)return;setBusy(false);renderCollection();
  if(!ok){showError(work.error || 'The editions could not be found.',false);return;}
  if(work.volumes.length===1)await openEntry(collectionDescriptor(id));
  else if(!work.volumes.length)showError('No editions have been published in this directory.',false);
  else {
    closeNav(false);showCollection({updateURL:false,focus:false});
    $('published-work-list').querySelector(`[data-editions="${CSS.escape(work.id)}"]`)?.focus();
  }
}
$('refresh-catalog').addEventListener('click',()=>catalog.refreshAll({force:true}));
// One quiet line under the title: which edition, whether it is verified, and how long it is.
function syncProvenance() {
  const current=state.current; if (!current) return;
  const edition=workIdentity(current).edition, version=/v\d[\w.-]*$/i.exec(edition)?.[0];
  $('source-kind').textContent=current.kind==='specimen' ? 'Design specimen' : current.kind==='embedded' ? 'Offline reading copy' : ['local','paste'].includes(current.kind) ? 'Local text' : edition ? 'Edition '+(version || edition) : 'Public text';
  $('source-kind').title=edition || '';
  const passages=state.parallel?.total || 0;
  $('reading-estimate').textContent=[passages>1 ? passages.toLocaleString('en')+' passages' : '',`About ${state.minutes} min read`].filter(Boolean).join(' · ');
  const status=$('source-status');
  if (current.kind==='catalog') {
    const revisions=[current.revision,current.sourceRevision].filter(Boolean).map(sha=>sha.slice(0,7)).join(' · ');
    status.textContent=(current.stale ? (current.stale.state==='unverified' ? 'Not checked with GitHub' : 'Saved copy') : 'Verified')+(revisions ? ' · '+revisions : '');
    status.title=[current.revision ? 'English revision '+current.revision : '',current.sourceRevision ? sourceLanguageLabel()+' revision '+current.sourceRevision : ''].filter(Boolean).join('\n');
  } else { status.textContent=current.kind==='specimen' ? 'Not source text' : ['local','paste','embedded'].includes(current.kind) ? 'Opened locally' : 'Loaded from source'; status.removeAttribute('title'); }
}
// A saved or unverified copy is readable, but the reader must know it may be out of date.
function staleMessage(stale) {
  if (stale.state==='unverified') return 'GitHub is limiting requests, so this copy has not been checked against its published revision. It may not be the latest version.';
  const when=stale.savedAt ? new Date(stale.savedAt).toLocaleString([],{dateStyle:'medium',timeStyle:'short'}) : '';
  return `GitHub could not be reached, so this is Reader’s saved copy${when ? ', last confirmed current on '+when : ''}. It may not be the latest version.`;
}
function latestChanged(work,latest,current) {
  return !!latest && !work.stale && (latest.sha!==current.revision || (latest.sourceFile?.sha || '')!==(current.sourceRevision || ''));
}
function syncRevisionNotice() {
  const current=state.current, notice=$('revision-notice'); notice.hidden=true; notice.classList.remove('stale-notice'); $('stale-badge').hidden=true;
  if (current?.kind!=='catalog' || state.view!=='reading') return;
  const work=catalog.get(current.catalogId), latest=work.volumes.find(f=>f.path===current.path);
  if (work.pending) return;
  // A live check that finds the same revision confirms the open copy is current.
  if (latest && !work.stale && !work.error && !latestChanged(work,latest,current) && current.stale) { current.stale=null; syncProvenance(); }
  if (latestChanged(work,latest,current)) {
    $('revision-message').textContent='The English or source text has changed. Your current passage has not been changed.';
    $('revision-load').textContent='Load latest'; notice.hidden=false;
  } else if (current.stale) {
    $('revision-message').textContent=staleMessage(current.stale);
    $('revision-load').textContent='Check again'; notice.classList.add('stale-notice'); notice.hidden=false;
    const badge=$('stale-badge'); badge.textContent=current.stale.state==='unverified' ? 'Not checked' : 'Saved copy'; badge.title=staleMessage(current.stale); badge.hidden=false;
  } else if (work.error) {
    $('revision-message').textContent='The latest source could not be checked. Your open revision is unchanged. '+work.error;
    $('revision-load').textContent='Check again'; notice.hidden=false;
  } else if (work.checkedAt && !latest) {
    $('revision-message').textContent='This volume is no longer listed on GitHub. You are reading the copy already open in this session.';
    $('revision-load').textContent='Check again'; notice.hidden=false;
  }
}
$('stale-badge').addEventListener('click',()=>{
  const current=state.current; if (!current?.stale) return;
  notify(staleMessage(current.stale),'Check again',()=>catalog.refresh(current.catalogId,{force:true}),12000);
});
$('revision-load').addEventListener('click',async()=>{
  const current=state.current; if (current?.kind!=='catalog') return;
  const work=catalog.get(current.catalogId), file=work.volumes.find(f=>f.path===current.path);
  if (!latestChanged(work,file,current)) {await catalog.refresh(work.id,{force:true}); return;}
  const position=currentPosition();
  const ok=await loadDocument(catalog.descriptor(work.id,current.path),{updateURL:false});
  if (ok && state.current?.id===current.id) restorePosition(position);
});
function syncNextJuan() {
  const current=state.current; $('next-juan').hidden=true;
  if (current?.kind!=='catalog') return;
  const work=catalog.get(current.catalogId), at=work.volumes.findIndex(f=>f.path===current.path);
  const next=at<0 ? null : work.volumes[at+1]; if (!next) return;
  $('next-juan').hidden=false; $('next-juan').textContent='Next · '+catalog.descriptor(work.id,next.path).title;
}
$('next-juan').addEventListener('click',()=>{
  const current=state.current; if (current?.kind!=='catalog') return;
  const work=catalog.get(current.catalogId), at=work.volumes.findIndex(f=>f.path===current.path), next=work.volumes[at+1];
  if (at>=0 && next) openEntry(catalog.descriptor(work.id,next.path));
});
function refreshOpenWorks(options) {
  for(const work of catalog.works)if(work.id===state.current?.catalogId)catalog.refresh(work.id,options);
}
function startCatalog() {
  if (catalogActive || !/^https?:$/.test(location.protocol)) return;
  catalogActive=true;
  catalogTimer=setInterval(()=>{if (!document.hidden && navigator.onLine) refreshOpenWorks();},catalog.interval);
}
window.addEventListener('focus',()=>{if (catalogActive && !document.hidden) refreshOpenWorks();});
window.addEventListener('online',()=>{if (catalogActive) refreshOpenWorks({force:true});});
document.addEventListener('visibilitychange',()=>{if (catalogActive && !document.hidden) refreshOpenWorks();});
function collectionDescriptor(id,path) {
  const work=catalog.get(id);
  return catalog.descriptor(id,path || work.volumes[0]?.path || work.english?.path || '');
}

function addToLibrary(descriptor) {
  const i = state.library.findIndex(item => item.id === descriptor.id);
  if (i < 0) state.library.push(descriptor); else state.library[i] = {...state.library[i],...descriptor};
  state.library.sort((a,b) => naturalSort.compare(a.path || a.filename || a.title,b.path || b.filename || b.title));
}
// Work identity comes from this manuscript only.
function workIdentity(entry) {
  const m = entry.metadata || {};
  const pick = (...values) => values.find(v => typeof v === 'string' && v.trim())?.trim() || '';
  return {
    work: pick(m.work_title, m['work-title'], m.work, entry.workTitle),
    chinese: pick(m.original_title, m.tibetan_title, m.title_bo, entry.originalTitle, m.chinese_title, m['chinese-title'], m.title_zh, m['title-zh'], entry.chineseTitle, chineseDominant(entry.title || '') ? entry.title : ''),
    romanization: pick(m.romanization, m.pinyin),
    author: pick(m.author), translator: pick(m.translator), edition: pick(m['paired-edition'],m.edition,m['translation-edition'],m.source_edition,m.base_edition)
  };
}
function readingLabel(entry) { return entry.kind==='embedded' && entry.readingTitle ? entry.readingTitle : entry.kind==='catalog' && catalog.get(entry.catalogId).english.kind==='file' ? entry.workTitle : entry.kind==='catalog' ? entry.workTitle+' · '+fileLabel(entry.path) : entry.title; }
function renderWorkIdentity(entry, titleNode = null) {
  const identity = workIdentity(entry), specimen = entry.kind === 'specimen', title = entry.title || 'Untitled text';
  const heading = titleNode || textElement('h1', title);
  if(entry.kind==='catalog' && catalog.get(entry.catalogId).english.kind==='file')heading.textContent=entry.workTitle;
  heading.classList.add('volume-title'); heading.id ||= 'volume-title';
  if (/[\u0f00-\u0fff]/.test(title))heading.lang='bo';else if (chineseDominant(title)) heading.lang = 'zh';
  const part = entry.number ? fileLabel(entry.path || entry.filename || '') : '';
  const kicker = specimen ? 'Typography specimen · not a translation' : [identity.work !== title ? identity.work : '', part].filter(Boolean).join(' · ') || 'The text';
  $('title-content').replaceChildren(textElement('div', kicker, 'volume-kicker'));
  if (identity.chinese && identity.chinese !== title) {
    const original = textElement('p', identity.chinese, 'work-original-title');
    original.lang = entry.sourceLanguage || (/[\u0f00-\u0fff]/.test(identity.chinese) ? 'bo' : 'zh'); $('title-content').append(original);
  }
  $('title-content').append(heading);
  if (identity.romanization && identity.romanization !== title) $('title-content').append(textElement('p', identity.romanization, 'roman-title'));
  const credit = [identity.author, identity.translator ? 'Translation: ' + identity.translator : ''].filter(Boolean).join(' · ');
  if (credit) $('title-content').append(textElement('p', credit, 'work-credit'));
  $('manuscript').setAttribute('aria-labelledby', heading.id);
  const hanTitle = identity.chinese;
  $('bookplate-text').textContent = hanTitle && [...hanTitle].length <= 12 ? hanTitle : 'བོད་ཡིག';
  $('edition-han').lang=entry.sourceLanguage || (/[\u0f00-\u0fff]/.test(hanTitle)?'bo':'zh');
  $('edition-han').textContent = hanTitle || ''; $('edition-han').title = hanTitle;
  $('edition-label').textContent = specimen ? 'An interface specimen, not source text' : identity.edition || 'The text';
  $('toolbar-room').textContent = 'Reader';
  $('toolbar-volume').textContent = readingLabel(entry); $('toolbar-volume').title = readingLabel(entry);
  $('toc-label').textContent = 'In this text'; document.title = readingLabel(entry) + ' · Reader';
}
function setView(view) {
  state.view=view;document.body.dataset.view=view;const reading=view==='reading';$('welcome').hidden=reading;
  if(!reading){$('revision-notice').hidden=true;$('stale-badge').hidden=true;}
  $('paired-status').hidden=!reading || !state.current?.sourceError;
  ['book-header','manuscript','manuscript-end'].forEach(id=>$(id).hidden=!reading);
  if(reading)$('collection-link').removeAttribute('aria-current');else $('collection-link').setAttribute('aria-current','page');
  $('bookmark-button').disabled=!reading || state.current?.kind==='specimen';syncNotesToggle();
}
function showCollection(options = {}) {
  if (state.view === 'reading') {
    savePosition(true); state.readingPosition = currentPosition(); state.readingHeadings = state.headings;
  }
  // Cancel pending loads when navigating home.
  state.controller?.abort(); ++state.loadId; setBusy(false);
  closeNav(false); document.body.classList.remove('focus-mode'); syncFocus();
  document.querySelectorAll('dialog[open]').forEach(d => d.close());
  $('load-message').hidden = true; $('toast').hidden = true;
  setView('collection'); state.headings = []; state.activeHeading = null;
  $('toolbar-room').textContent = 'Reader'; $('toolbar-volume').textContent = 'Collection'; $('toolbar-volume').removeAttribute('title');
  document.title = 'Reader · Collection'; renderCollection();
  if (catalogActive) refreshOpenWorks();
  if (options.updateURL !== false) updateLocation(null, '', false, 'collection');
  window.scrollTo({top: 0, behavior: 'instant'});
  if (options.focus !== false) $('main-content').focus({preventScroll: true});
  updateProgress();
}
function returnToReading(options = {}) {
  if(state.busy){state.controller?.abort();++state.loadId;setBusy(false);}
  if (!state.current) { showLibrary(); return; }
  if (state.view === 'reading') { closeNav(false); return; }
  closeNav(false); setView('reading'); syncCitationSetting(); state.headings = state.readingHeadings; renderOutline();
  $('toolbar-room').textContent = 'Reader';
  $('toolbar-volume').textContent = readingLabel(state.current); $('toolbar-volume').title = readingLabel(state.current);
  document.title = readingLabel(state.current) + ' · Reader'; updateBookmarkUI();
  if (state.readingPosition) restorePosition(state.readingPosition);
  else window.scrollTo({top: 0, behavior: 'instant'});
  rebuildCitationLayers(); syncRevisionNotice(); syncNextJuan();
  if (options.updateURL !== false) updateLocation(state.current);
  if (options.focus !== false) $('main-content').focus({preventScroll: true});
  updateProgress();
}
async function openEntry(entry) {
  closeDialog('library-dialog');
  if (entry.id === state.current?.id && !state.busy) {returnToReading();if(entry.kind==='catalog')catalog.refresh(entry.catalogId);}
  else await loadDocument(entry, {section: entry.section});
}
function workCard(entry) {
  const li = document.createElement('li'), b = document.createElement('button'), identity = workIdentity(entry);
  b.type = 'button'; b.className = 'work-card';
  b.setAttribute('aria-current', String(entry.id === state.current?.id));
  b.append(textElement('span', identity.work || entry.title, 'work-card-title'));
  if (identity.chinese && identity.chinese !== (identity.work || entry.title)) {
    const han = textElement('span', identity.chinese, 'work-card-original'); han.lang = entry.sourceLanguage || (/[\u0f00-\u0fff]/.test(identity.chinese)?'bo':'zh'); b.append(han);
  }
  if (identity.work && identity.work !== entry.title) b.append(textElement('span', entry.title, 'work-card-detail'));
  const origin = entry.verified ? 'Published text' : ['local','paste'].includes(entry.kind) ? 'Local · This session' : entry.kind === 'embedded' ? 'Offline reading copy' : 'Public link · This session';
  b.append(textElement('span', [identity.author, origin].filter(Boolean).join(' · '), 'work-card-detail'));
  const foot = textElement('span', entry.id === state.current?.id ? 'Return to text' : 'Read', 'work-card-bottom');
  foot.append(icon('arrow')); b.append(foot); b.addEventListener('click', () => openEntry(entry)); li.append(b); return li;
}
function renderCollection() {
  const entries = state.library.filter(e => e.kind !== 'specimen');
  const session = entries.filter(e => !e.verified), published = entries.filter(e => e.verified && e.kind !== 'catalog');
  $('session-work-list').replaceChildren(...session.map(workCard));
  $('published-work-list').replaceChildren(...catalog.works.map(catalogCard),...published.map(workCard));
  $('session-section').hidden = !session.length;
  $('session-count').textContent = `${session.length} text${session.length === 1 ? '' : 's'}`;
  $('collection-empty').hidden = !!(catalog.works.length + published.length); $('published-work-list').hidden = !(catalog.works.length + published.length);
  $('refresh-catalog').hidden=!catalog.works.length;
  $('collection-filter').hidden=catalog.works.length<2;
  filterCollection();
  $('published-count').textContent = `${catalog.works.length + published.length} ${catalog.works.length + published.length===1?'work':'works'}`;
  $('refresh-catalog').disabled = catalog.works.some(w=>w.pending);
  $('continue-reading').hidden = !state.current; $('continue-title').textContent = state.current ? readingLabel(state.current) : '';
}
['collection-link','next-volume'].forEach(id => $(id).addEventListener('click', () => showCollection()));
$('home-link').addEventListener('click', event => { event.preventDefault(); showCollection(); });
$('continue-reading').addEventListener('click',()=>returnToReading());

function renderLibrary() {
  renderCollection();
  $('library-list').replaceChildren();
  const list = state.library.filter(item => item.kind !== 'specimen' && item.kind !== 'catalog');
  if (list.length) $('library-list').append(textElement('li','Open in this session','library-group-label'));
  for (const entry of list) {
    const li = document.createElement('li'), button = document.createElement('button');
    button.type = 'button'; button.setAttribute('aria-current', String(entry.id === state.current?.id));
    const numeral = textElement('span',entry.number !== null && entry.number !== undefined ? String(entry.number):'§','library-number'); numeral.setAttribute('aria-hidden','true');
    const text = document.createElement('span'); text.className = 'library-item-text';
    text.append(textElement('span',entry.title,'library-item-title'));
    const sub = entry.kind === 'local' || entry.kind === 'paste' ? 'Local · available in this session' : entry.kind === 'embedded' ? 'Embedded · available offline' : entry.loaded ? 'Previously opened · reloads on selection' : entry.verified ? 'Found in repository' : 'Configured · not yet verified';
    text.append(textElement('span',sub,'library-item-sub'));
    button.append(numeral,text,icon(entry.id === state.current?.id ? 'check':'arrow'));
    button.addEventListener('click',async () => {
      closeDialog('library-dialog');
      await openEntry(entry);
    }); li.append(button); $('library-list').append(li);
  }
}
function showLibrary() { renderLibrary(); $('library-error').hidden = true; openDialog('library-dialog'); }
$('open-welcome').addEventListener('click',showLibrary);

async function fetchText(url,parentSignal,onProgress) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('timeout'), CONFIG.fetchTimeout);
  const abort = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) controller.abort(); else parentSignal?.addEventListener('abort',abort,{once:true});
  try {
    const response = await fetch(url,{signal:controller.signal,credentials:'omit',cache:'no-cache',referrerPolicy:'no-referrer'});
    if (!response.ok) {
      const error = new Error(response.status === 404 ? 'The file could not be found or is not publicly accessible.' : `The server returned HTTP ${response.status}.`);
      error.status = response.status; throw error;
    }
    if (Number(response.headers.get('content-length')) > CONFIG.maximumBytes) throw new Error('This file exceeds the 4 MB limit for a text.');
    if (/text\/html/i.test(response.headers.get('content-type') || '')) throw new Error('That address returned a web page, not Markdown. Use the raw file URL.');
    if (response.body?.getReader) {
      const reader = response.body.getReader(), decoder = new TextDecoder(); let total = 0, text = '';
      while (true) {
        const {done,value} = await reader.read(); if (done) break;
        total += value.byteLength;
        if (total > CONFIG.maximumBytes) { await reader.cancel(); throw new Error('This file exceeds the 4 MB limit for a text.'); }
        text += decoder.decode(value,{stream:true});
        const expected=Number(response.headers.get('content-length')) || 0;
        onProgress?.({stage:'download',progress:expected?Math.min(.98,total/expected):Math.min(.9,total/(total+65536)),loadedBytes:total,totalBytes:expected || null});
      }
      onProgress?.({stage:'ready',progress:1,loadedBytes:total,totalBytes:total});return text+decoder.decode();
    }
    const text = await response.text();
    if (new Blob([text]).size > CONFIG.maximumBytes) throw new Error('This file exceeds the 4 MB limit for a text.');
    return text;
  } catch (error) {
    if (parentSignal?.aborted) throw new DOMException('Cancelled','AbortError');
    if (controller.signal.aborted) throw new Error('The request for the text timed out.');
    throw error;
  } finally { clearTimeout(timeout); parentSignal?.removeEventListener('abort',abort); }
}
async function getSource(descriptor, signal, onProgress) {
  if (descriptor.kind === 'catalog') return catalog.read(descriptor.catalogId,descriptor.path,signal,onProgress,{reuseFresh:catalog.get(descriptor.catalogId).english.kind==='directory' && !!descriptor.checkedAt});
  if (typeof descriptor.text === 'string' && !['repository','url'].includes(descriptor.kind)) return {text:descriptor.text,sourceText:descriptor.sourceText || '',sourceDescriptor:descriptor.sourceDescriptor || null,sourceError:descriptor.sourceError || '',sourceURL:descriptor.renderedBase || descriptor.sourceURL || null};
  if (descriptor.file) return {text:await descriptor.file.text(),sourceURL:null};
  if (descriptor.kind === 'repository' && /^https?:$/.test(location.protocol)) {
    const local = new URL(descriptor.path,new URL('.',location.href)).href;
    try { return {text:await fetchText(local,signal,onProgress),sourceURL:local}; }
    catch (error) { if (signal.aborted || !descriptor.sourceURL) throw error; }
  }
  if (!descriptor.sourceURL) throw new Error("Open this text from a hosted collection, or choose its local Markdown file.");
  return {text:await fetchText(descriptor.sourceURL,signal,onProgress),sourceURL:descriptor.sourceURL};
}
let loadingTimer=null, loadingPercent=0;
function loadingProgress(value,text) {
  if(!state.busy)return;loadingPercent=Math.max(loadingPercent,Math.min(100,Math.round(value)));
  $('loading-progress').setAttribute('aria-valuenow',String(loadingPercent));$('loading-fill').style.transform=`scaleX(${loadingPercent/100})`;$('loading-percent').textContent=loadingPercent+'%';
  if(text)$('loading-text').textContent=text;
}
function setBusy(on,text='Opening the text…') {
  clearTimeout(loadingTimer);state.busy=on;document.body.classList.toggle('loading',on);$('main-content').setAttribute('aria-busy',String(on));
  if(on){loadingPercent=0;$('loading-panel').hidden=false;$('loading-panel').classList.remove('complete');loadingProgress(2,text);announce(text);}
  else {
    $('loading-progress').setAttribute('aria-valuenow','100');$('loading-fill').style.transform='scaleX(1)';$('loading-percent').textContent='100%';
    $('loading-panel').classList.add('complete');loadingTimer=setTimeout(()=>{$('loading-panel').hidden=true;},reduceMotion.matches?0:220);
  }
}
const languageNames=typeof Intl.DisplayNames==='function' ? new Intl.DisplayNames(['en'],{type:'language'}) : null;
function languageName(code) {
  try { const name=languageNames?.of(code); if (name && name.toLowerCase()!==String(code).toLowerCase()) return name; } catch {}
  return code==='bo' ? 'Tibetan' : 'Source';
}
function sourceLanguageLabel() {return languageName(state.current?.sourceLanguage || 'bo');}
function syncNotesToggle() {
  const button=$('notes-toggle');button.hidden=state.view!=='reading' || !$('manuscript').querySelector('.footnote-ref,.legacy-note-ref,.footnotes');
  button.setAttribute('aria-pressed',String(!!state.settings.notes));button.setAttribute('aria-label',state.settings.notes?'Hide endnotes':'Show endnotes');button.title=state.settings.notes?'Hide endnote links':'Show endnote links';
  document.body.dataset.notes=state.settings.notes?'visible':'hidden';
}
function setNotesVisible(visible,persist=true) {
  const changed=state.settings.notes!==!!visible;state.settings.notes=!!visible;state.parallel?.setNotesVisible(!!visible);syncNotesToggle();
  if(persist)storageWrite('settings',state.settings);
  if(changed && state.current && state.view==='reading')buildOutline();
}
$('notes-toggle').addEventListener('click',()=>setNotesVisible(!state.settings.notes));

function revealPassage(el) {
  const notes=el.closest('.footnotes');if(notes){setNotesVisible(true);notes.hidden=false;}
  const pair=state.parallel?.pairs.find(item=>item.section.contains(el));
  if(pair && el.closest('.source-passage'))pair.show(true,false);
  else if(pair && el.closest('.english-passage'))pair.show(false,false);
}
function isPairedSchema(schema){return schema==='paired-text/1' || schema==='paired-text/2';}
function pairSections(fragment,original,candidate) {
  const parallel=ReaderParallel.build(fragment,original,{language:candidate.sourceLanguage || 'bo',sectionMap:candidate.sectionMap || [],anchorAlignment:isPairedSchema(candidate.metadata?.schema),structures:candidate.sourceStructures || [],onToggle:()=>updateProgress()});
  parallel.setNotesVisible(state.settings.notes);return parallel;
}
async function prepareParallel(fragment,candidate,signal) {
  const unpaired=()=>({parallel:isPairedSchema(candidate.metadata?.schema)?pairSections(fragment,document.createDocumentFragment(),{...candidate,sourceStructures:[]}):null,parallelFragment:null});
  if(!candidate.sourceText)return unpaired();
  try {
    const compiled=await parseMarkdown(candidate.sourceText,signal);
    const schema=candidate.metadata?.schema,sourceSchema=compiled.metadata.schema;
    if(isPairedSchema(schema) || isPairedSchema(sourceSchema)){
      if(schema!==sourceSchema)throw new Error('The English and source paired-text schemas do not match.');
      for(const field of ['text-id','paired-edition'])if((candidate.metadata[field] || compiled.metadata[field]) && candidate.metadata[field]!==compiled.metadata[field])throw new Error('The English and source paired editions do not match.');
    }
    if(schema==='paired-text/2'){
      if(candidate.structureError)throw Object.assign(new Error(candidate.structureError),{side:'translation',line:candidate.structureErrorLine});
      if(compiled.structureError)throw Object.assign(new Error(compiled.structureError),{side:'source',line:compiled.structureErrorLine});
      if(!candidate.metadata['text-id'] || !compiled.metadata['text-id'])throw new Error('Both paired-text files must identify their text-id.');
      if(!candidate.metadata['source-edition'] || !compiled.metadata.edition || candidate.metadata['source-edition']!==compiled.metadata.edition || (compiled.metadata['source-edition'] && compiled.metadata['source-edition']!==compiled.metadata.edition))throw new Error('The translation and source edition do not match.');
      if(!candidate.metadata['translation-edition'])throw new Error('The paired translation must identify its translation-edition.');
      if([candidate.metadata.language,compiled.metadata.language].some(language=>!language || !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(language)))throw new Error('Both paired-text files must declare a valid language.');
      const unformatted=compiled.structures.find(pair=>pair.formatCount!==1 || !['prose','verse','h1','h2','h3'].includes(pair.format));
      if(unformatted)throw Object.assign(new Error(`Source pair ${unformatted.id} at line ${unformatted.line} must declare exactly one format: prose, verse, h1, h2, or h3.`),{side:'source',line:unformatted.line});
      const english=candidate.structures,source=compiled.structures;
      if(english.length!==source.length || english.some((pair,index)=>pair.id!==source[index].id)){
        const at=english.findIndex((pair,index)=>pair.id!==source[index]?.id),index=at<0?Math.min(english.length,source.length):at,en=english[index],bo=source[index];
        const where=en && bo ? `At passage ${index+1}, translation line ${en.line} has ${en.id} where source line ${bo.line} has ${bo.id}.`
          : en ? `The translation continues with ${en.id} at line ${en.line} after the source’s last passage.` : `The source continues with ${bo.id} at line ${bo.line} after the translation’s last passage.`;
        throw Object.assign(new Error(`The English and source pair IDs or their order do not match. ${where} The translation has ${english.length} passages and the source ${source.length}.`),en?{side:'translation',line:en.line}:{side:'source',line:bo.line});
      }
      candidate.sourceStructures=compiled.structures;
    }
    const original=safeDOM(compiled.html,candidate.sourceDescriptor?.sourceURL || candidate.sourceTextURL);
    prepareContent(original,compiled.metadata,candidate.sourceDescriptor || candidate);
    const parallelFragment=citationLayersApply(candidate) ? original.cloneNode(true) : null,draft=fragment.cloneNode(true);
    const parallel=pairSections(draft,original,candidate);fragment.replaceChildren(draft);
    return {parallel,parallelFragment};
  } catch(error){if(signal?.aborted)throw error;candidate.sourceError=error.message;candidate.sourceErrorAt=error.line?{side:error.side,line:error.line}:null;candidate.sourceText='';delete candidate.sourceStructures;return unpaired();}
}
async function loadDocument(descriptor, options = {}) {
  savePosition(true); state.controller?.abort();
  const controller = new AbortController(); state.controller = controller;
  const loadId = ++state.loadId; const requestedHash = options.section ?? ''; state.hasMoved = false;
  setBusy(true); $('load-message').hidden = true; $('toast').hidden = true;
  try {
    const result=await getSource(descriptor,controller.signal,event=>{
      if(loadId!==state.loadId)return;
      loadingProgress(5+event.progress*70,event.stage==='metadata'?'Checking the text…':event.stage==='ready'?'Preparing the reading page…':event.phase==='verify'?'Verifying the texts…':'Loading English and Tibetan…');
    });
    loadingProgress(76,'Setting the English text…');
    await new Promise(resolve=>requestAnimationFrame(resolve));
    if (result.descriptor) descriptor={...descriptor,...result.descriptor};
    if (new Blob([result.text]).size > CONFIG.maximumBytes) throw new Error('This file exceeds the 4 MB limit for a text.');
    if (!result.text.trim()) throw new Error('This text is empty. Add text to the Markdown file and reopen it.');
    const compiled = await parseMarkdown(result.text,controller.signal);
    if (loadId !== state.loadId) return false;
    const fragment = safeDOM(compiled.html,result.sourceURL);
    // The pristine copy exists only to rebuild citation layers when that setting changes.
    const sourceFragment = compiled.metadata.schema === 'paired-text/2' ? null : fragment.cloneNode(true);
    const prepared = prepareContent(fragment,compiled.metadata,descriptor);
    const title = prepared.title;
    const candidate = {...descriptor, title, text:result.text, sourceText:result.sourceText || '',sourceDescriptor:result.sourceDescriptor || null,sourceError:result.sourceError || '', renderedBase:result.sourceURL, metadata:compiled.metadata, frontmatter:compiled.frontmatter, structures:compiled.structures, structureError:compiled.structureError, structureErrorLine:compiled.structureErrorLine, loaded:true};
    loadingProgress(85,'Preparing Tibetan passages…');await new Promise(resolve=>requestAnimationFrame(resolve));
    if(loadId!==state.loadId || controller.signal.aborted)return false;
    const paired=await prepareParallel(fragment,candidate,controller.signal);
    markApparatus(fragment);
    if(loadId!==state.loadId || controller.signal.aborted)return false;
    loadingProgress(94,'Finishing the reading page…');await new Promise(resolve=>requestAnimationFrame(resolve));
    if(loadId!==state.loadId || controller.signal.aborted)return false;
    // Publish identity and document together, only after the entire pair is ready.
    if(candidate.kind!=='specimen')addToLibrary(candidate);
    state.current=candidate;state.sourceFragment=sourceFragment;state.parallel=paired.parallel;state.parallelFragment=paired.parallelFragment;state.renderedCitations=state.settings.citations;
    $('manuscript').replaceChildren(fragment);$('manuscript').dataset.alignment=isPairedSchema(candidate.metadata?.schema)?'anchors':'headings';$('manuscript').dataset.schema=candidate.metadata?.schema || '';
    $('paired-status').replaceChildren(candidate.sourceError?'Tibetan source unavailable. '+candidate.sourceError:'');
    const at=candidate.sourceErrorAt, lineURL=at && (at.side==='source' ? candidate.sourceGithubURL || candidate.sourceDescriptor?.githubURL : candidate.githubURL);
    if(lineURL && /^https:\/\/github\.com\//.test(lineURL)){
      const link=textElement('a',`View ${at.side} line ${at.line} on GitHub`);link.href=lineURL.split('#')[0]+'?plain=1#L'+at.line;link.target='_blank';link.rel='noopener noreferrer';
      $('paired-status').append(' ',link);
    }
    setView('reading'); syncCitationSetting();
    renderWorkIdentity(candidate, prepared.titleNode);
    const shortTitle = readingLabel(candidate);
    $('source-button').disabled = false; $('bookmark-button').disabled = candidate.kind === 'specimen';
    const countable = $('manuscript').cloneNode(true);
    countable.querySelectorAll('[data-reader-ui],[hidden]').forEach(el=>el.remove());
    const plainText = countable.textContent;
    const latinWords = (plainText.replace(/\p{Script=Han}/gu,' ').match(/[\p{L}\p{N}]+/gu) || []).length;
    const hanChars = (plainText.match(/\p{Script=Han}/gu) || []).length;
    state.minutes = Math.max(1,Math.ceil(latinWords/200 + hanChars/350));
    syncProvenance();
    // Counts only (never text), so the collection can show each work's extent.
    if (candidate.kind==='catalog') storageWrite('extent:'+candidate.catalogId,{passages:state.parallel?.total || 0,edition:workIdentity(candidate).edition || ''});

    $('end-caption').textContent=candidate.kind === 'specimen' ? 'End of the typography specimen. Open your own text to read.' : `End of ${shortTitle}.`;
    document.title=shortTitle+' · '+CONFIG.title;
    buildOutline(); buildSearchIndex(); updateBookmarkUI(); renderLibrary();
    loadingProgress(100,'Ready to read');setBusy(false);$('manuscript').classList.remove('reader-arriving');void $('manuscript').offsetWidth;$('manuscript').classList.add('reader-arriving');closeNav(false); $('load-message').hidden=true; syncRevisionNotice(); syncNextJuan();
    const position = storageRead('position:'+candidate.id);
    state.restoring=true; window.scrollTo({top:0,behavior:'instant'});
    if (options.updateURL !== false) updateLocation(candidate,'',false);
    state.loadedFromURL=true;
    const resumable = position && position.progress > .025 && position.progress < .985 && candidate.kind !== 'specimen';
    if (requestedHash) {
      requestAnimationFrame(() => {
        goToHash(requestedHash,false); state.restoring=false; updateProgress(); state.place=placeAtReadingLine();
        if (resumable && Math.abs(position.progress-state.progress)>.02) {
          state.holdPlace={y:window.scrollY};
          notify('Opened at the linked passage.','Return to your place',() => restorePosition(position),10000);
        }
      });
    } else {
      state.restoring=false; updateProgress();
      if (resumable) requestAnimationFrame(() => {
        if (loadId!==state.loadId) return;
        restorePosition(position);
        notify(position.label ? `Back at ${position.label}.` : 'Back where you left off.','Start from the beginning',() => { window.scrollTo({top:0,behavior:'instant'}); savePosition(true); },6000);
      });
    }
    announce(`${shortTitle} opened. ${state.headings.length} sections.`);
    return true;
  } catch(error) {
    if (loadId !== state.loadId || error.name === 'AbortError') return false;
    setBusy(false);
    const detail = error instanceof TypeError ? 'The text could not be reached from this browser. This may be a network, privacy, or cross-origin restriction.' : error.message;
    // Published texts come through Reader's own cache, so a retry is the useful advice.
    showError(`${detail} ${descriptor.kind==='catalog' ? 'Try again in a moment.' : 'You can also open a downloaded Markdown file.'}`,true);
    $('source-status').textContent=state.current ? 'Previous text kept' : 'Source unavailable';
    announce('The text could not be loaded.');
    state.retryDescriptor=descriptor;
    return false;
  }
}
$('retry-button').addEventListener('click',() => { if(state.retryDescriptor) loadDocument(state.retryDescriptor); });

async function discoverVolumes() {
  $('refresh-library').disabled=true;
  $('library-status').textContent='Looking for published texts…';
  let manifestError=null;
  try {
    let entries;
    if (/^https?:$/.test(location.protocol)) {
      try {
        const text=await fetchText(new URL(CONFIG.manifest,new URL('.',location.href)).href);
        const json=JSON.parse(text); entries=Array.isArray(json) ? json : json.volumes;
        if (!Array.isArray(entries)) throw new Error('The manifest must be an array or an object with a volumes array.');
        for (const value of entries.slice(0,1000)) {
          const path=typeof value === 'string' ? value : value.path;
          const item=fromProject(path); if (value.title && typeof value.title === 'string') item.title=value.title;
          item.verified=true; addToLibrary(item);
        }
        state.discovered=true;
        $('library-status').textContent=`${entries.length} text${entries.length===1?'':'s'} listed in the local manifest.`;
        renderLibrary(); return;
      } catch(error) { manifestError=error; }
    }
    if (!apiDirectory) throw manifestError || new Error('No published collection is configured.');
    const listing=JSON.parse(await fetchText(apiDirectory));
    if (!Array.isArray(listing)) throw new Error('The repository listing was not available.');
    const files=listing.filter(item=>item.type==='file' && /\.(md|markdown)$/i.test(item.name));
    for (const file of files) { const item=fromProject(file.path); item.verified=true; addToLibrary(item); }
    state.discovered=true;
    $('library-status').textContent=`${files.length} Markdown file${files.length===1?'':'s'} found in ${CONFIG.directory}/. Local imports stay alongside them.`;
    renderLibrary();
  } catch(error) {
    $('library-status').textContent='Repository discovery is unavailable. No additional volumes have been assumed. Import local files, or deploy a reader-manifest.json with the site.';
  } finally { $('refresh-library').disabled=false; }
}
$('refresh-library').addEventListener('click',discoverVolumes);
$('url-form').addEventListener('submit',async e=>{
  e.preventDefault(); $('library-error').hidden=true;
  try {
    const descriptor=fromURL($('url-input').value);
    closeDialog('library-dialog'); addToLibrary(descriptor);
    await loadDocument(descriptor,{section:descriptor.section});
  } catch(error) { $('library-error').textContent=error.message; $('library-error').hidden=false; }
});
function openFilePicker() { $('file-input').click(); }
$('import-library').addEventListener('click',openFilePicker);
async function importFiles(files) {
  const candidates=[...files].filter(file=>/\.(md|markdown|txt)$/i.test(file.name));
  if (!candidates.length) return notify('Choose a .md, .markdown, or .txt file.');
  const entries=[]; const rejected=[];
  for (const file of candidates) {
    if (file.size>CONFIG.maximumBytes) { rejected.push(file.name); continue; }
    const descriptor={ id:'local:'+file.name+':'+file.size+':'+file.lastModified, kind:'local', filename:file.name,
      path:file.name, title:fileLabel(file.name), number:volumeNumber(file.name), file };
    addToLibrary(descriptor); entries.push(descriptor);
  }
  if (!entries.length) return notify('These files exceed the 4 MB limit for a text.');
  entries.sort((a,b)=>naturalSort.compare(a.filename,b.filename));
  closeDialog('library-dialog'); closeNav(false);
  const ok=await loadDocument(entries[0]); renderLibrary();
  if (ok && (entries.length>1 || rejected.length)) notify(`${entries.length} text${entries.length===1?'':'s'} opened locally.${rejected.length ? ' Some oversized files were skipped.':''}`);
}
$('file-input').addEventListener('change',async e=>{ await importFiles(e.target.files); e.target.value=''; });
$('paste-button').addEventListener('click',async()=>{
  const text=$('paste-input').value;
  if (!text.trim()) { $('library-error').textContent='Paste some Markdown first.'; $('library-error').hidden=false; return; }
  if (new Blob([text]).size>CONFIG.maximumBytes) { $('library-error').textContent='This text exceeds the 4 MB limit for a text.'; $('library-error').hidden=false; return; }
  const descriptor={id:'paste:'+hashText(text),kind:'paste',title:'Pasted text',number:null,text};
  closeDialog('library-dialog'); await loadDocument(descriptor);
});
let dragDepth=0;
window.addEventListener('dragenter',e=>{ if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); dragDepth++; $('drop-overlay').hidden=false; } });
window.addEventListener('dragover',e=>{ if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect='copy'; } });
window.addEventListener('dragleave',e=>{ if ([...e.dataTransfer.types].includes('Files')) { dragDepth=Math.max(0,dragDepth-1); if (!dragDepth) $('drop-overlay').hidden=true; } });
window.addEventListener('drop',e=>{ e.preventDefault(); dragDepth=0; $('drop-overlay').hidden=true; if (e.dataTransfer.files.length) importFiles(e.dataTransfer.files); });
window.addEventListener('blur',()=>{ dragDepth=0; $('drop-overlay').hidden=true; });


function buildOutline() {
  $('manuscript').querySelectorAll('.section-link').forEach(link=>link.remove());
  state.headings=[]; let section=0;
  const els=[...$('manuscript').querySelectorAll('h1,h2,h3')].filter(el=>!el.closest('.source-passage,.source-footnotes') && (!el.closest('.footnotes') || state.settings.notes));
  for (const heading of els) {
    const level=heading.closest('.parallel-section[data-format="h1"]') ? 3 : Number(heading.tagName[1]); if (level<=2) section++;
    const text=navLabel(heading.dataset.headingText || heading.textContent);
    const number=String(section || 1).padStart(2,'0');
    if (level===2) heading.dataset.sectionNumber=number;
    const anchor=heading.dataset.sectionAnchor || heading.id;
    state.headings.push({id:anchor,text,level,number});
    const link=document.createElement('a'); link.className='section-link'; link.setAttribute('href','#'+heading.id);
    link.setAttribute('aria-label','Link to section: '+text); link.textContent='§'; heading.append(link);
  }
  renderOutline();
}
function renderOutline() {
  $('toc').replaceChildren(); $('toc-count').textContent=String(state.headings.filter(h=>h.level<=2).length).padStart(2,'0');
  if (!state.headings.length) { $('toc').append(textElement('li','This text has no section headings. Read from the beginning.','toc-empty')); return; }
  state.headings.forEach(heading=>{
    const li=document.createElement('li'), a=document.createElement('a');
    if (heading.level===3) li.className='sub';
    a.href='#'+heading.id; a.dataset.target=heading.id;
    a.append(textElement('span',heading.text));
    a.addEventListener('click',e=>{ e.preventDefault(); closeNav(false); jumpTo(heading.id); });
    li.append(a); $('toc').append(li);
  });
  state.activeHeading=null; updateProgress();
}
function jumpTo(id, options={}) {
  const el=$(id); if (!el) return false;
  revealPassage(el);
  el.scrollIntoView({behavior:reduceMotion.matches || options.instant ? 'instant':'smooth',block:'start'});
  if (options.flash) { el.classList.remove('search-flash'); void el.offsetWidth; el.classList.add('search-flash'); }
  if (options.focus !== false) { el.setAttribute('tabindex','-1'); el.focus({preventScroll:true}); }
  if (state.view === 'reading' && options.history !== false && state.current?.kind !== 'local' && state.current?.kind !== 'paste' && state.current?.kind !== 'specimen') updateLocation(state.current,'#'+id,false);
  return true;
}
function goToHash(hash, update=true) {
  let id=hash.replace(/^#/,''); try { id=decodeURIComponent(id); } catch (_) {}
  return jumpTo($(id) ? id : 'md-'+id,{instant:!update,history:update});
}
function updateLocation(descriptor, hash='', replace=false, view='reading') {
  if (!/^https?:$/.test(location.protocol)) return;
  try {
    const url = new URL(location.href);
    ['file','src','demo','work'].forEach(key => url.searchParams.delete(key));
    if (view === 'reading') {
      if (descriptor?.kind === 'catalog') {url.searchParams.set('work',descriptor.catalogId); url.searchParams.set('file',descriptor.path);}
      else if (descriptor?.kind === 'repository') url.searchParams.set('file',descriptor.path);
      else if (descriptor?.kind === 'url') url.searchParams.set('src',descriptor.sourceURL);
      else if (descriptor?.kind === 'specimen') url.searchParams.set('demo','1');
    }
    url.hash = hash;
    const id = view === 'reading' ? descriptor?.id || null : null;
    if (url.href === location.href && history.state?.view === view && history.state?.id === id) return;
    history[replace ? 'replaceState' : 'pushState']({reader:true,view,id},'',url);
  } catch (_) {}
}
window.addEventListener('popstate', event => {
  const params = new URLSearchParams(location.search), itemId = event.state?.id;
  if (event.state?.view === 'collection' || (!itemId && !params.has('work') && !params.has('file') && !params.has('src') && params.get('demo') !== '1')) {
    showCollection({updateURL:false,focus:false}); return;
  }
  try {
    let descriptor = itemId ? state.library.find(e => e.id === itemId) : null;
    if (!descriptor && itemId === state.current?.id) descriptor = state.current;
    if (!descriptor && params.get('work')) descriptor = collectionDescriptor(params.get('work'),params.get('file'));
    if (!descriptor && params.get('src')) descriptor = fromURL(params.get('src'));
    if (!descriptor && params.get('demo') === '1') descriptor = specimenDescriptor();
    if (!descriptor && params.get('file')) descriptor = fromProject(params.get('file'));
    if (!descriptor) { showCollection({updateURL:false}); return; }
    if (state.current?.id === descriptor.id) {
      returnToReading({updateURL:false,focus:false});
      if (location.hash) goToHash(location.hash,false);
    } else loadDocument(descriptor,{section:location.hash,updateURL:false});
  } catch (error) { showError(error.message,false); }
});

function activeLocation() {
  // Headings are in document order, so the last one above the reading line is
  // found with a binary search: about a dozen layout reads instead of hundreds.
  const target=105, headings=state.headings; let low=0, high=headings.length-1, found=0;
  while (low<=high) {
    const middle=(low+high)>>1, el=$(headings[middle].id);
    if (el && el.getBoundingClientRect().top<=target) { found=middle; low=middle+1; } else high=middle-1;
  }
  return headings[found] || null;
}
const READING_LINE=105;
// The block under the reading line. Its offset survives changes of type size,
// measure, rotation and language far better than a section heading's does.
function placeAtReadingLine() {
  const main=$('manuscript'); if (state.view!=='reading' || !main || main.hidden) return null;
  const box=main.getBoundingClientRect(); if (box.width<=0) return null;
  const x=Math.max(1,Math.min(innerWidth-2,box.left+Math.min(box.width/2,240)));
  for (let y=READING_LINE; y<Math.min(innerHeight,READING_LINE+90); y+=15) {
    let el=document.elementFromPoint(x,y);
    if (!el || !main.contains(el) || el===main) continue;
    el=el.closest('p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,table,figure,dt,dd,hr,section') || el;
    if (!main.contains(el)) continue;
    // A pair section's ID is part of the edition; other IDs are the nearest stable target.
    const keyed=el.closest('section[id]') || el.closest('[id]'); const anchor=keyed && main.contains(keyed) && keyed!==main ? keyed : null;
    return {el, offset:el.getBoundingClientRect().top, anchor:anchor?.id || '', anchorOffset:anchor ? anchor.getBoundingClientRect().top : 0};
  }
  return null;
}
function rendered(el) { return !!el?.isConnected && el.getClientRects().length>0; }
function currentPosition() {
  const heading=activeLocation(); const node=heading ? $(heading.id) : $('book-header'), place=placeAtReadingLine();
  return {progress:state.progress, heading:heading?.id || '', offset:node ? node.getBoundingClientRect().top : 0,
    anchor:place?.anchor || '', anchorOffset:place?.anchorOffset || 0, label:heading ? navLabel(heading.text) : '', at:Date.now()};
}
// Keeps the passage being read where it is while the layout around it changes.
function pinPlace() {
  const place=state.place; if (state.view!=='reading' || !place || !rendered(place.el)) return;
  const delta=place.el.getBoundingClientRect().top-place.offset; if (Math.abs(delta)<1) return;
  state.restoring=true; window.scrollTo({top:Math.max(0,window.scrollY+delta),behavior:'instant'}); state.restoring=false;
}
function savePosition(force=false) {
  if (state.view !== 'reading' || !state.current || state.current.kind==='specimen' || state.restoring || state.busy || !state.hasMoved) return;
  if (!force && Date.now()-state.lastSave<1000) return;
  // Following a link must not overwrite the place the reader left; reading on from it does.
  if (state.holdPlace) { if (Math.abs(window.scrollY-state.holdPlace.y)<innerHeight) return; state.holdPlace=null; }
  state.lastSave=Date.now(); const position=currentPosition();
  storageWrite('position:'+state.current.id,position);
  if (state.current.kind==='catalog') storageWrite('last:'+state.current.catalogId,{path:state.current.path,progress:position.progress,label:position.label,at:position.at});
}
function restorePosition(position) {
  state.restoring=true; state.holdPlace=null;
  const anchor=position.anchor ? $(position.anchor) : null, heading=position.heading ? $(position.heading) : null;
  const top=rendered(anchor) ? window.scrollY+anchor.getBoundingClientRect().top-position.anchorOffset
    : rendered(heading) ? window.scrollY+heading.getBoundingClientRect().top-position.offset
    : position.progress*Math.max(0,document.documentElement.scrollHeight-innerHeight);
  window.scrollTo({top:Math.max(0,top),behavior:'instant'}); state.restoring=false; state.hasMoved=true;
  state.place=placeAtReadingLine(); updateProgress(); savePosition(true);
}
let scrollQueued=false;
function updateProgress() {
  if (state.view !== 'reading') return;
  const length=Math.max(1,document.documentElement.scrollHeight-innerHeight);
  state.progress=Math.max(0,Math.min(1,window.scrollY/length));
  const percent=Math.round(state.progress*100);
  $('progress-fill').style.transform=`scaleX(${state.progress})`;
  if (state.progressPercent!==percent) { state.progressPercent=percent; $('progress-label').textContent=percent+'%'; $('progress-track').setAttribute('aria-valuenow',String(percent)); }
  const active=activeLocation();
  if (state.activeHeading!==active?.id) {
    state.activeHeading=active?.id;
    $('toc').querySelectorAll('a').forEach(a=>{ if (a.dataset.target===active?.id) a.setAttribute('aria-current','location'); else a.removeAttribute('aria-current'); });
    $('footer-section').textContent=active?.text || state.current?.title || '';
  }
  const remaining=state.current ? percent>=99 ? 'End of the text' : `About ${Math.max(1,Math.ceil(state.minutes*(1-state.progress)))} min left` : 'Make yourself at home';
  if ($('remaining').textContent!==remaining) $('remaining').textContent=remaining;
}
window.addEventListener('scroll',()=>{ if (!scrollQueued) { scrollQueued=true; requestAnimationFrame(()=>{ if (!state.restoring && !state.busy && window.scrollY>1) state.hasMoved=true; if (!state.restoring && !document.body.classList.contains('dialog-open')) state.place=placeAtReadingLine() || state.place; updateProgress(); savePosition(); scrollQueued=false; }); } },{passive:true});
window.addEventListener('resize',()=>{ if (innerWidth>920) closeNav(false); syncSidebarAccess(); updateProgress(); });
let readingWidth=0;
new ResizeObserver(entries=>{
  // Only a change of width reflows the text; height changes come from the text itself.
  const width=Math.round(entries[entries.length-1].contentRect.width);
  if (width!==readingWidth) { const first=!readingWidth; readingWidth=width; if (!first) pinPlace(); }
  requestAnimationFrame(updateProgress);
}).observe($('main-content'));
document.fonts?.addEventListener?.('loadingdone',()=>pinPlace());
window.addEventListener('pagehide',()=>savePosition(true));
document.addEventListener('visibilitychange',()=>{ if (document.hidden) savePosition(true); });
function updateBookmarkUI() {
  state.bookmark=state.current ? storageRead('bookmark:'+state.current.id) : null;
  $('bookmark-button').classList.toggle('bookmark-set',!!state.bookmark);
  $('bookmark-button').title=state.bookmark ? 'Move the bookmark here (B)' : 'Bookmark this place (B)';
  $('resume-button').hidden=!state.bookmark;
  $('resume-label').textContent=state.bookmark?.label ? 'Bookmark · '+state.bookmark.label : 'Return to bookmark';
}
function bookmarkPosition() {
  if (state.view !== 'reading' || !state.current || state.current.kind==='specimen') return notify('Open a text to save a bookmark.');
  const old=state.bookmark, position=currentPosition(), key='bookmark:'+state.current.id;
  if (!storageWrite(key,position)) return notify('Browser storage is unavailable. This bookmark could not be saved.');
  updateBookmarkUI(); announce(old ? 'Bookmark moved.' : 'Bookmark saved.');
  notify(old ? 'Bookmark moved here.' : 'Bookmarked.', 'Undo',()=>{ if (old) storageWrite(key,old); else storageRemove(key); updateBookmarkUI(); });
}
$('bookmark-button').addEventListener('click',bookmarkPosition);
$('resume-button').addEventListener('click',()=>{ closeNav(false); if (state.bookmark) restorePosition(state.bookmark); });
function syncFocus() {
  const active=document.body.classList.contains('focus-mode');
  syncSidebarAccess(); $('focus-button').setAttribute('aria-pressed',String(active));
  $('focus-button').setAttribute('aria-label',active ? 'Leave focus mode':'Enter focus mode');
}
function toggleFocus() { if (state.view !== 'reading') return; closeNav(false); document.body.classList.toggle('focus-mode'); syncFocus(); }
$('focus-button').addEventListener('click',toggleFocus);

function buildSearchIndex() {
  state.search=[]; let context=state.current.title; let index=0;
  $('manuscript').querySelectorAll('h1,h2,h3,h4,p,li,td,th,pre,dt,dd,figcaption').forEach(el=>{
    if (/^H[1-4]$/.test(el.tagName)) context=navLabel(el.dataset.headingText || el.textContent.replace(/§$/,'').trim());
    // Avoid duplicate hits for list items and paragraphs inside those items.
    if (el.tagName==='LI' && el.querySelector('p,li')) return;
    const clone=el.cloneNode(true); clone.querySelectorAll('.section-link,.footnote-back,[data-reader-ui]').forEach(a=>a.remove());
    const text=clone.textContent.replace(/\s+/g,' ').trim(); if (!text) return;
    if (!el.id) el.id='passage-'+(++index);
    state.search.push({id:el.id,text,lower:searchForm(text),context});
  });
  $('search-scope').textContent='In '+($('toolbar-volume').textContent || 'this text');
  $('search-input').value=''; renderSearch();
}
function showSearch() {
  if (state.view !== 'reading' || !state.current) return notify('Open a text to search it.','Open library',showLibrary);
  openDialog('search-dialog'); $('search-input').focus(); $('search-input').select(); renderSearch();
}
$('search-trigger').addEventListener('click',showSearch);
let searchTimer;
$('search-input').addEventListener('input',()=>{ clearTimeout(searchTimer); searchTimer=setTimeout(renderSearch,100); });
// Same length as the input, so match offsets stay valid for highlighting.
function searchForm(text) { return text.toLocaleLowerCase().replace(/[’‘]/g,"'"); }
function renderSearch() {
  const query=searchForm($('search-input').value.trim()); $('search-results').replaceChildren();
  if (!query) { $('search-empty').hidden=false; $('search-empty').textContent='Search this text in English or Tibetan.'; $('search-count').textContent='Type to search'; return; }
  const matches=state.search.filter(item=>item.lower.includes(query));
  $('search-count').textContent=`${matches.length} passage${matches.length===1?'':'s'}${matches.length>60?' · first 60 shown':''}`;
  $('search-empty').hidden=!!matches.length;
  if (!matches.length) $('search-empty').textContent='No matching passages. Try a shorter word or a Tibetan syllable.';
  for (const item of matches.slice(0,60)) {
    const at=item.lower.indexOf(query), start=Math.max(0,at-55), end=Math.min(item.text.length,at+query.length+115);
    const li=document.createElement('li'), button=document.createElement('button');
    button.append(textElement('span',item.context,'result-section'));
    const excerpt=document.createElement('span'); excerpt.className='result-excerpt';
    excerpt.append(document.createTextNode((start?'…':'')+item.text.slice(start,at)),textElement('mark',item.text.slice(at,at+query.length)),document.createTextNode(item.text.slice(at+query.length,end)+(end<item.text.length?'…':'')));
    button.append(excerpt); button.addEventListener('click',()=>{ closeDialog('search-dialog'); jumpTo(item.id,{flash:true,history:false}); }); li.append(button); $('search-results').append(li);
  }
}
$('search-input').addEventListener('keydown',e=>{
  if (e.key==='ArrowDown') { e.preventDefault(); $('search-results').querySelector('button')?.focus(); }
  if (e.key==='Enter') $('search-results').querySelector('button')?.click();
});
$('search-results').addEventListener('keydown',e=>{
  if (!['ArrowDown','ArrowUp'].includes(e.key)) return;
  const buttons=[...$('search-results').querySelectorAll('button')], i=buttons.indexOf(document.activeElement);
  e.preventDefault(); if (e.key==='ArrowUp' && i<=0) $('search-input').focus(); else buttons[Math.max(0,Math.min(buttons.length-1,i+(e.key==='ArrowDown'?1:-1)))]?.focus();
});

function applySettings(persist=true) {
  const settings=state.settings;
  settings.citations=settings.citations !== false;
  if (!['paper','mist','ink'].includes(settings.theme)) settings.theme='paper';
  settings.size=Math.max(16,Math.min(28,Number(settings.size)||defaults.size));
  settings.measure=[620,720,840].includes(Number(settings.measure)) ? Number(settings.measure):720;
  settings.leading=Math.max(1.5,Math.min(2.2,Number(settings.leading)||1.88));
  document.documentElement.dataset.theme=settings.theme;
  document.documentElement.style.setProperty('--user-size',settings.size+'px');
  document.documentElement.style.setProperty('--user-measure',settings.measure+'px');
  document.documentElement.style.setProperty('--user-leading',String(settings.leading));
  document.querySelector('meta[name="theme-color"]').content=settings.theme==='ink' ? '#202824':settings.theme==='mist' ? '#edf0ed':'#f5f1e8';
  $('font-size').value=settings.size; $('size-value').textContent=settings.size+' px';
  $('line-height').value=settings.leading; previewSliders();
  $$('.theme-choice').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.theme===settings.theme)));
  $$('[data-measure]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.measure)===settings.measure)));
  $('auto-citations').checked=settings.citations;setNotesVisible(settings.notes,false);
  if (persist) storageWrite('settings',settings);
  rebuildCitationLayers(); pinPlace();
}
$('settings-trigger').addEventListener('click',()=>openDialog('settings-dialog'));
$$('.theme-choice').forEach(b=>b.addEventListener('click',()=>{state.settings.theme=b.dataset.theme;applySettings();}));
$$('[data-measure]').forEach(b=>b.addEventListener('click',()=>{state.settings.measure=Number(b.dataset.measure);applySettings();}));
// Each value change relays out the whole book (hundreds of milliseconds on a phone),
// so dragging previews the value and the book is set once, on release.
function previewSliders() {
  const size=Number($('font-size').value), leading=Number($('line-height').value);
  $('size-value').textContent=size+' px'; $('leading-value').textContent=leading.toFixed(2);
  const preview=document.querySelector('.settings-preview'); if (preview) { preview.style.fontSize=size+'px'; preview.style.lineHeight=String(leading); }
}
$('font-size').addEventListener('input',previewSliders);
$('line-height').addEventListener('input',previewSliders);
$('font-size').addEventListener('change',e=>{state.settings.size=Number(e.target.value);applySettings();});
$('line-height').addEventListener('change',e=>{state.settings.leading=Number(e.target.value);applySettings();});
$('auto-citations').addEventListener('change',e=>{state.settings.citations=e.target.checked;applySettings();});
$('reset-settings').addEventListener('click',()=>{state.settings={...defaults};applySettings();});

function handleManuscriptClick(e) {
  const a=e.target.closest('a[href]'); if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button!==0) return;
  const href=a.getAttribute('href');
  if (a.dataset.localLink) {
    e.preventDefault();
    const [path,section] = a.dataset.localLink.split('#');
    let name=path.split('/').pop(); try { name=decodeURIComponent(name); } catch (_) {}
    const target=state.library.find(item=>item.filename===name);
    if (target) loadDocument(target,{section:section ? '#'+section:''});
    else notify('Open '+name+' in the library first. Local folders are not read automatically.','Open files',openFilePicker);
    return;
  }
  if (a.dataset.footnote) {
    const note=$(href.slice(1)); if (!note) return;
    e.preventDefault(); state.noteTarget=note.id;
    $('note-title').textContent='Note '+a.dataset.footnote;
    const clone=note.cloneNode(true); clone.querySelectorAll('.footnote-back').forEach(el=>el.remove());
    clone.removeAttribute('id'); clone.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));
    $('note-content').replaceChildren(...clone.childNodes); openDialog('note-dialog'); return;
  }
  if (href.startsWith('#')) { e.preventDefault(); goToHash(href); return; }
  try {
    const url=new URL(href);
    if (/\.(md|markdown|txt)$/i.test(url.pathname)) {
      e.preventDefault();
      // Preserve project-relative paths for same-site deployments.
      const siteBase=new URL('.',location.href);
      let descriptor;
      if (url.origin===siteBase.origin && url.pathname.startsWith(siteBase.pathname) && /^https?:$/.test(location.protocol)) descriptor=fromProject(decodeURIComponent(url.pathname.slice(siteBase.pathname.length)));
      else descriptor=fromURL(url.href);
      loadDocument(descriptor,{section:url.hash});
    }
  } catch (_) { /* Regular validated external links retain their browser behavior. */ }
}
$('manuscript').addEventListener('click',handleManuscriptClick);

let selectedPassages=[],selectedCopy='',selectionLanguage=false,selectionScroll=0;
function closeSelectionMenu(){ if ($('selection-menu').hidden && !selectedPassages.length) return; $('selection-menu').hidden=true;selectedPassages=[]; }
function showSelectionMenu(x,y,focus=false) {
  const selection=window.getSelection();if(!selection || selection.isCollapsed || !selection.rangeCount)return false;
  const range=selection.getRangeAt(0),article=$('manuscript');
  if(!article.contains(range.startContainer) || !article.contains(range.endContainer))return false;
  selectedCopy=selection.toString();if(!selectedCopy.trim())return false;
  selectedPassages=(state.parallel?.pairsForRange(range) || []).filter(pair=>!pair.emptySource);
  selectionLanguage=selectedPassages.length>0 && !selectedPassages.every(pair=>pair.sourceVisible);
  const language=$('selection-language');language.hidden=!selectedPassages.length;language.textContent='Show '+(selectionLanguage?sourceLanguageLabel():'English');
  selectionScroll=scrollY;const menu=$('selection-menu');menu.hidden=false;menu.style.left='0px';menu.style.top='0px';
  const bounds=menu.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(x,innerWidth-bounds.width-8))+'px';menu.style.top=Math.max(8,Math.min(y,innerHeight-bounds.height-8))+'px';
  if(focus)$('selection-copy').focus({preventScroll:true});return true;
}
$('manuscript').addEventListener('contextmenu',event=>{
  if(showSelectionMenu(event.clientX,event.clientY)){event.preventDefault();event.stopPropagation();}
});
document.addEventListener('keydown',event=>{
  if(!event.target.matches('input,textarea,select,[contenteditable="true"]') && (event.key==='ContextMenu' || event.shiftKey && event.key==='F10')){
    const selection=window.getSelection(),rect=selection?.rangeCount?selection.getRangeAt(0).getBoundingClientRect():null;
    if(rect && showSelectionMenu(rect.left,rect.bottom,true))event.preventDefault();
  }
});
$('selection-language').addEventListener('click',()=>{
  const pairs=[...selectedPassages],first=pairs[0];
  if(selectionLanguage && first && !first.sourceVisible)first.englishScrollOffset=-first.section.getBoundingClientRect().top;
  const returnOffset=!selectionLanguage?first?.englishScrollOffset:undefined;
  closeSelectionMenu();window.getSelection()?.removeAllRanges();
  // Each non-silent switch forces a whole-book layout; switch silently and measure once.
  pairs.forEach(pair=>pair.show(selectionLanguage,false,true)); updateProgress();
  if(returnOffset!==undefined){window.scrollTo({top:scrollY+first.section.getBoundingClientRect().top+returnOffset,behavior:'instant'});delete first.englishScrollOffset;}
  else if(first && first.section.getBoundingClientRect().bottom<$('toolbar-volume').getBoundingClientRect().bottom+30)first.section.scrollIntoView({block:'start',behavior:'instant'});
  announce((selectionLanguage?sourceLanguageLabel():'English')+' shown for the selected passage'+(pairs.length===1?'': 's')+'.');
});
$('selection-copy').addEventListener('click',async()=>{
  const text=selectedCopy;closeSelectionMenu();
  try {
    if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(text);
    else {const area=document.createElement('textarea');area.value=text;area.style.cssText='position:fixed;opacity:0';document.body.append(area);area.select();if(!document.execCommand('copy'))throw new Error('Copy unavailable');area.remove();}
    announce('Copied.');
  } catch {notify('Copy was unavailable. Use your browser’s Copy command.');}
});
document.addEventListener('pointerdown',event=>{if(!$('selection-menu').contains(event.target))closeSelectionMenu();});
window.addEventListener('scroll',()=>{if(Math.abs(scrollY-selectionScroll)>1)closeSelectionMenu();},{passive:true});
window.addEventListener('resize',closeSelectionMenu);
$('selection-menu').addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();closeSelectionMenu();$('manuscript').focus({preventScroll:true});return;}
  if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();const buttons=[...$('selection-menu').querySelectorAll('button:not([hidden])')],i=buttons.indexOf(document.activeElement);buttons[(i+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}
});
// Touch selection has no right mouse button; the same menu appears after selection.
let touchSelectionTimer;
$('manuscript').addEventListener('touchend',()=>{
  clearTimeout(touchSelectionTimer);touchSelectionTimer=setTimeout(()=>{const selection=window.getSelection();if(selection?.rangeCount && !selection.isCollapsed){const rect=selection.getRangeAt(0).getBoundingClientRect();showSelectionMenu(rect.left,rect.bottom+8);}},180);
},{passive:true});

$('book-header').addEventListener('click',handleManuscriptClick);
$('note-jump').addEventListener('click',()=>{closeDialog('note-dialog');if(state.noteTarget)jumpTo(state.noteTarget,{flash:true});});
$('note-content').addEventListener('click',e=>{
  const a=e.target.closest('a[href^="#"]'); if (!a) return;
  e.preventDefault(); const hash=a.getAttribute('href');closeDialog('note-dialog');goToHash(hash);
});

function showSource() {
  if (!state.current) {
    $('source-textarea').value='No text is open yet.';
    $('source-description').textContent='Open a text to view its original Markdown and export a reading copy.';
  } else {
    $('source-textarea').value=state.current.text;
    $('source-description').textContent=state.current.kind==='specimen' ? 'Typography specimen only. This is not a source text or translation.' : state.current.filename || state.current.path || state.current.title;
  }
  if (state.current?.revision) $('source-description').textContent += ' · File revision '+state.current.revision;
  const sourceLink=state.current?.githubURL;
  if(sourceLink) $('github-link').href=sourceLink; else $('github-link').removeAttribute('href');
  $('github-link').hidden=!sourceLink;
  ['download-markdown','export-reader','export-epub','print-button'].forEach(id=>$(id).disabled=!state.current);
  openDialog('source-dialog');
}
$('source-button').addEventListener('click',showSource);
function download(content,filename,type) {
  const url=URL.createObjectURL(new Blob([content],{type}));
  const a=document.createElement('a'); a.href=url; a.download=filename; document.body.append(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}
$('download-markdown').addEventListener('click',()=>{
  if (!state.current) return;
  const name=state.current.filename || state.current.path?.split('/').pop() || 'text.md';
  download(state.current.text,name,'text/markdown;charset=utf-8');
});
$('export-reader').addEventListener('click',()=>{
  if (!state.current) return;
  const payload={title:state.current.title,text:state.current.text,number:state.current.number || null,
    path:state.current.path || null,sourceURL:state.current.sourceURL || null,githubURL:state.current.githubURL || null,
    originalKind:state.current.kind,readingTitle:readingLabel(state.current),workTitle:state.current.workTitle || '',chineseTitle:state.current.chineseTitle || '',originalTitle:state.current.originalTitle || '',sourceText:state.current.sourceText || '',sourceDescriptor:state.current.sourceDescriptor || null,sourceLanguage:state.current.sourceLanguage || 'bo',sectionMap:state.current.sectionMap || [],revision:state.current.revision || ''};
  const escaped=JSON.stringify(payload).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026');
  const copy=appTemplate.replace(/(<script type="application\/json" id="embedded-manuscript">)[\s\S]*?(<\/script>)/,(_,open,close)=>open+escaped+close);
  // Named after the work, so a saved copy is recognisable among downloads.
  const slug=readingLabel(state.current).normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-+|-+$/g,'').slice(0,80);
  const name=state.current.filename?.replace(/\.[^.]+$/,'') || slug || 'text';
  download(copy,name+'-reading-copy.html','text/html;charset=utf-8');
  notify('Reading copy saved with this text embedded.');
});

let epubExportDocument = null;
$('export-epub').addEventListener('click', () => {
  if (!state.current || state.busy) return;
  const metadata = state.current.metadata || {};
  epubExportDocument = state.current;
  $('epub-book-title').value = readingLabel(state.current) || 'Untitled text';
  $('epub-author').value = typeof metadata.author === 'string' ? metadata.author : '';
  const language = metadata.language || metadata.lang || 'en';
  $('epub-language').value = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(language) ? language : 'en';
  const citations = $('manuscript').querySelectorAll('.citation-block').length;
  const notes = $('manuscript').querySelectorAll('li[data-note]').length;
  $('epub-summary').textContent = `${citations} distinct cited passage${citations === 1 ? '' : 's'} · ${notes} endnote${notes === 1 ? '' : 's'}. Section navigation and the current citation formatting are preserved.`;
  const images = $('manuscript').querySelectorAll('img').length;
  $('epub-image-note').hidden = !images;
  $('epub-image-note').textContent = `${images} linked image${images === 1 ? '' : 's'} will be represented by descriptive links, not embedded. Those links require an internet connection. Text export works offline.`;
  $('epub-error').hidden = true;
  openDialog('epub-dialog');
});
$('epub-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!state.current || state.current !== epubExportDocument || state.busy) {
    $('epub-error').textContent = 'The open text changed. Close this dialog and start the export again.';
    $('epub-error').hidden = false; return;
  }
  const button = $('epub-save'); button.disabled = true; button.setAttribute('aria-busy', 'true');
  $('epub-error').hidden = true;
  try {
    // Snapshot into an inert document: even detached live-document images can fetch.
    const inert = document.implementation.createHTMLDocument('');
    const root = inert.createElement('div');
    const title = $('title-content').querySelector('h1');
    if (title) root.append(inert.importNode(title, true));
    root.append(...inert.importNode($('manuscript'), true).childNodes);
    root.querySelectorAll('.footnote-ref,.legacy-note-ref').forEach(el=>{el.hidden=false;el.closest('sup')?.removeAttribute('hidden');});
    const anySource=state.parallel?.pairs.some(pair=>pair.sourceVisible),anyEnglish=!state.parallel?.pairs.length || state.parallel.pairs.some(pair=>!pair.sourceVisible);
    root.querySelectorAll('.footnotes').forEach(el=>{el.hidden=el.classList.contains('source-footnotes')?!anySource:!anyEnglish;});
    const current = state.current;
    const options = {root, title: $('epub-book-title').value.trim(), author: $('epub-author').value.trim(),
      language: $('epub-language').value.trim(), source: current.githubURL || current.sourceURL || '', specimen: current.kind === 'specimen'};
    await new Promise(resolve => setTimeout(resolve, 30));
    const result = LukijaEPUB.build(options);
    let filename = result.title.normalize('NFKC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/^\.+|\.+$/g, '').trim().slice(0, 120) || 'manuscript';
    while (new TextEncoder().encode(filename).length > 180) filename = Array.from(filename).slice(0, -1).join('');
    download(result.blob, filename + '.epub', 'application/epub+zip');
    closeDialog('epub-dialog');
    notify('EPUB saved. Citations and endnotes are included; your Markdown is unchanged.');
  } catch (error) {
    $('epub-error').textContent = 'The EPUB could not be created: ' + (error.message || 'unknown error');
    $('epub-error').hidden = false;
  } finally { button.disabled = false; button.removeAttribute('aria-busy'); }
});

$('print-button').addEventListener('click',()=>{closeDialog('source-dialog');window.print();});


const SPECIMEN = `# The shape of a reading page

This is an interface specimen, not a translation. Select text and choose Show Tibetan from its context menu. Select the Tibetan and choose Show English to return. The toolbar controls notes, search, appearance, and bookmarks.

## The reading page

A text has its own place on the page. The English translation and Tibetan source can be read in turn, without changing the other sections.[^note]

## A growing collection

Published texts are loaded from the repositories in the reader configuration. Find a work by its title, source title, or repository name.

[^note]: Notes, citations, and local Markdown imports remain available. This specimen does not represent a source work.
`;
const SPECIMEN_SOURCE = `# བོད་ཡིག

བོད་ཡིག

## བོད་ཡིག

བོད་ཡིག བོད་ཡིག

## དཔེ་ཆ།

དཔེ་ཆ། བོད་ཡིག
`;
function specimenDescriptor() {return {id:'specimen',kind:'specimen',title:'The shape of a reading page',number:null,text:SPECIMEN,sourceText:SPECIMEN_SOURCE,sourceLanguage:'bo'};}
$('demo-button').addEventListener('click',()=>{ if ($('settings-dialog').open) closeDialog('settings-dialog'); loadDocument(specimenDescriptor()); });

document.addEventListener('keydown',e=>{
  const editing=e.target.matches('input,textarea,select,[contenteditable="true"]');
  if (e.key==='Escape') {
    if (!$('selection-menu').hidden) {closeSelectionMenu();return;}
    if (document.querySelector('dialog[open]')) return;
    if (document.body.classList.contains('nav-open')) {e.preventDefault();closeNav();return;}
    if (document.body.classList.contains('focus-mode')) {document.body.classList.remove('focus-mode');syncFocus();}
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase()==='k') {e.preventDefault();showSearch();return;}
  if (editing || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('dialog[open]')) return;
  if (e.key==='/') {e.preventDefault();showSearch();}
  else if (e.key.toLowerCase()==='f') {e.preventDefault();toggleFocus();}
  else if (e.key.toLowerCase()==='b') {e.preventDefault();bookmarkPosition();}
  else if (e.key.toLowerCase()==='l') {e.preventDefault();showLibrary();}
});

async function start() {
  const stored=storageRead('settings'); if (stored && typeof stored==='object') state.settings={...defaults,...stored};
  applySettings(false); syncSidebarAccess(); renderLibrary(); setView('collection');
  if(catalog.error)showError(catalog.error,false);
  $('refresh-library').hidden = !apiDirectory;
  $('bookmark-button').disabled=true;
  const params=new URLSearchParams(location.search);
  const embeddedText=$('embedded-manuscript').textContent;
  try {
    if (params.get('demo')==='1') {await loadDocument(specimenDescriptor(),{updateURL:false,section:location.hash});return;}
    if (!params.has('file') && !params.has('src')) {
      const payload=JSON.parse(embeddedText);
      if (payload && typeof payload.text==='string') {
        const desc={...payload,id:'embedded:'+hashText(payload.text),kind:payload.originalKind==='specimen'?'specimen':'embedded'};
        await loadDocument(desc,{updateURL:false,section:location.hash});return;
      }
    }
    startCatalog();
    if (params.has('work')) {await loadDocument(collectionDescriptor(params.get('work'),params.get('file')),{updateURL:false,section:location.hash}); return;}
    if ((!CONFIG.autoLoad || !CONFIG.initialFile) && !params.has('src') && !params.has('file')) { updateLocation(null,'',true,'collection'); return; }
    const descriptor=params.get('src') ? fromURL(params.get('src')) : fromProject(params.get('file') || CONFIG.initialFile);
    await loadDocument(descriptor,{updateURL:false,section:location.hash});
    // Discover only on hosted sites; local files do not generate additional requests.
    if (/^https?:$/.test(location.protocol) && state.current?.kind==='repository') discoverVolumes();
  } catch(error) {setBusy(false);showError(error.message,false);}
}
start();
})();
