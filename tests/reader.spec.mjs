import {mockCatalog} from './catalog-fixture.mjs';
import {test, expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const sample = await readFile(new URL('./fixtures/sample.md', import.meta.url), 'utf8');
const app = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const crcTable = Uint32Array.from({length:256}, (_,n) => { let c=n; for(let i=0;i<8;i++) c=(c&1)?0xedb88320^(c>>>1):c>>>1; return c>>>0; });
function crc32(data) { let crc=0xffffffff; for(const b of data) crc=crcTable[(crc^b)&255]^(crc>>>8); return (crc^0xffffffff)>>>0; }
function unzipStored(bytes) {
  const files = {}, names = []; let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const method=bytes.readUInt16LE(offset+8), size=bytes.readUInt32LE(offset+18), nameLength=bytes.readUInt16LE(offset+26), extra=bytes.readUInt16LE(offset+28);
    expect(method).toBe(0); expect(extra).toBe(0);
    const name=bytes.subarray(offset+30,offset+30+nameLength).toString();
    const start=offset+30+nameLength+extra, data=bytes.subarray(start,start+size);
    expect(crc32(data)).toBe(bytes.readUInt32LE(offset+14));
    files[name]=data.toString('utf8'); names.push(name); offset=start+size;
  }
  expect(names[0]).toBe('mimetype'); expect(files.mimetype).toBe('application/epub+zip');
  expect(bytes.readUInt32LE(offset)).toBe(0x02014b50);
  return files;
}
async function load(page, text=sample) {
  await page.setInputFiles('#file-input', {name:'sample.md',mimeType:'text/markdown',buffer:Buffer.from(text)});
  await expect(page.locator('#manuscript')).toBeVisible();
}
async function source(page) {
  if (await page.locator('#mobile-menu').isVisible() && await page.locator('#mobile-menu').getAttribute('aria-expanded') !== 'true') await page.click('#mobile-menu');
  await page.click('#source-button');
}
async function epubDialog(page) { await source(page); await page.click('#export-epub'); await expect(page.locator('#epub-dialog')).toBeVisible(); }
async function epubDownload(page, info, name='sample') {
  const result=page.waitForEvent('download'); await page.click('#epub-save'); const download=await result;
  const output=info.outputPath(name+'.epub'); await download.saveAs(output);
  return {files:unzipStored(await readFile(output)), filename:download.suggestedFilename(), output};
}
async function xml(page, text) {
  return page.evaluate(value => {
    const doc=new DOMParser().parseFromString(value,'application/xml');
    const ids=[...doc.querySelectorAll('[id]')].map(el=>el.id);
    const broken=[...doc.querySelectorAll('a[href^="#"]')].map(a=>a.getAttribute('href').slice(1)).filter(id=>!ids.includes(id));
    return {error:doc.querySelector('parsererror')?.textContent || '', ids, broken, text:doc.documentElement.textContent};
  },text);
}
test.beforeEach(async ({page}) => { await mockCatalog(page);
  if (process.env.LUKIJA_TEST_CONTENT) await page.setContent(app);
  else await page.goto('/');
});
test('welcome discovers public works without downloading manuscripts', async ({page}) => {
  const requests=[]; page.on('request',r=>requests.push(r.url()));
  await expect(page.locator('#welcome')).toBeVisible();
  await page.waitForTimeout(100);
  expect(requests.filter(url=>/raw\.githubusercontent|\/git\/blobs\//.test(url))).toEqual([]);
  await expect(page.locator('#load-message')).toBeHidden();
});
test('export is disabled until a manuscript is loaded', async ({page}) => {
  await expect(page.locator('#source-button')).toBeHidden(); await expect(page.locator('#export-epub')).toBeDisabled();
});
test('root text, quoted voices and ordinary terms remain distinct', async ({page}) => {
  await load(page);
  await expect(page.locator('#manuscript .citation-block')).toHaveCount(2);
  await expect(page.locator('#manuscript .citation-source').first()).toContainText('Lie Yukou says:');
  await expect(page.locator('#manuscript .root-resumption').first()).toContainText('root text resumes');
  await expect(page.locator('#manuscript .citation-block')).not.toContainText(['quoted term','quoted term']);
});
test('original source is byte-for-byte unchanged', async ({page}) => {
  await load(page); await source(page); await expect(page.locator('#source-textarea')).toHaveValue(sample);
});
test('EPUB is a complete package with well-formed XML', async ({page},info) => {
  await load(page); await epubDialog(page); const {files}=await epubDownload(page,info);
  expect(Object.keys(files)).toHaveLength(8);
  for(const [name,value] of Object.entries(files)) if(/\.(xml|opf|xhtml|ncx)$/.test(name)) expect((await xml(page,value)).error,name).toBe('');
  expect(files['EPUB/package.opf']).toContain('version="3.0"');
  expect(files['EPUB/package.opf']).toContain('properties="nav"');
  expect(files['EPUB/title.xhtml']).toContain('href="nav.xhtml"');
  expect(files['EPUB/toc.ncx']).toContain('navPoint');
});
test('EPUB keeps citations, repeated-note backlinks, Chinese and tables', async ({page},info) => {
  await load(page); await epubDialog(page); const {files}=await epubDownload(page,info,'notes');
  const content=files['EPUB/content.xhtml'], parsed=await xml(page,content);
  expect(parsed.broken).toEqual([]); expect(new Set(parsed.ids).size).toBe(parsed.ids.length);
  expect((content.match(/epub:type="noteref"/g)||[])).toHaveLength(2);
  expect((content.match(/role="doc-backlink"/g)||[])).toHaveLength(2);
  expect((content.match(/class="citation-block"/g)||[])).toHaveLength(2);
  expect(content).toContain('Cited passage'); expect(content).toContain('xml:lang="zh-Hant"');
  expect(content).toContain('<ruby>'); expect(content).toContain('<table');
  expect(content).toContain('[x]'); expect(content).not.toContain('<input');
  expect(content).not.toContain('<details'); expect(content).toContain('An editorial observation');
  expect(content).not.toContain('section-link'); expect(content).not.toContain('data-reader-ui');
});
test('EPUB navigation targets real content IDs', async ({page},info) => {
  await load(page); await epubDialog(page); const {files}=await epubDownload(page,info,'navigation');
  const ids=(await xml(page,files['EPUB/content.xhtml'])).ids;
  for(const match of files['EPUB/nav.xhtml'].matchAll(/content.xhtml#([^"]+)/g)) expect(ids).toContain(match[1]);
});
test('export metadata is editable and XML-escaped', async ({page},info) => {
  await load(page); await epubDialog(page);
  await expect(page.locator('#epub-author')).toHaveValue('Example editor');
  await page.fill('#epub-book-title','Heaven & Earth <A reading>'); await page.fill('#epub-author','Editor "A" & B'); await page.fill('#epub-language','zh-Hant');
  const {files}=await epubDownload(page,info,'metadata');
  expect((await xml(page,files['EPUB/package.opf'])).error).toBe('');
  expect(files['EPUB/package.opf']).toContain('Heaven &amp; Earth &lt;A reading&gt;');
  expect(files['EPUB/package.opf']).toContain('<dc:language>zh-Hant</dc:language>');
});
test('turning automatic citation formatting off is respected in EPUB', async ({page},info) => {
  await load(page); await page.click('#settings-trigger'); await page.uncheck('#auto-citations'); await page.press('#auto-citations','Escape');
  await epubDialog(page); const {files}=await epubDownload(page,info,'citations-off');
  expect((files['EPUB/content.xhtml'].match(/class="citation-block"/g)||[])).toHaveLength(1);
});
test('linked images are disclosed and do not cause export network requests', async ({page},info) => {
  await page.route('https://example.org/test.png',route=>route.abort());
  await load(page,'# Image specimen\n\n![A diagram](https://example.org/test.png)'); await epubDialog(page);
  await expect(page.locator('#epub-image-note')).toContainText('not embedded');
  const requests=[]; page.on('request',r=>requests.push(r.url()));
  const {files}=await epubDownload(page,info,'image-links');
  expect(requests).toEqual([]); expect(files['EPUB/content.xhtml']).toContain('A diagram — view image online');
  expect(files['EPUB/content.xhtml']).not.toContain('<img'); expect(files['EPUB/title.xhtml']).toContain('not embedded');
});
test('malicious manuscript markup is not exported', async ({page},info) => {
  await load(page,'# Safety specimen\n\n<script>window.INJECTED=true</script>\n\n<a href="javascript:alert(1)" onclick="alert(1)">Text</a>\n\n<iframe src="https://example.org"></iframe>');
  expect(await page.evaluate(()=>window.INJECTED)).toBeUndefined(); await epubDialog(page);
  const {files}=await epubDownload(page,info,'safe'); const content=files['EPUB/content.xhtml'];
  expect(content).not.toMatch(/javascript:|onclick|<script|<iframe/);
});
test('a plain manuscript without authored headings exports', async ({page},info) => {
  await load(page,'A plain manuscript without headings.'); await epubDialog(page);
  const {files}=await epubDownload(page,info,'plain'); expect((await xml(page,files['EPUB/nav.xhtml'])).error).toBe('');
});
test('EPUB can be created without internet', async ({page,context},info) => {
  await load(page); await epubDialog(page); await context.setOffline(true);
  const {files}=await epubDownload(page,info,'offline'); expect(files['EPUB/content.xhtml']).toContain('Lie Yukou');
});
test('offline HTML reading copies retain EPUB export', async ({page},info) => {
  await load(page); await source(page); const result=page.waitForEvent('download'); await page.click('#export-reader');
  const d=await result, path=info.outputPath('reading-copy.html'); await d.saveAs(path);
  const copy=await readFile(path,'utf8'); await page.goto('about:blank'); await page.setContent(copy);
  await expect(page.locator('#manuscript')).toBeVisible(); await epubDialog(page);
  const {files}=await epubDownload(page,info,'roundtrip'); expect(files['EPUB/content.xhtml']).toContain('Lie Yukou');
});
test('export filenames remain portable for long Unicode titles', async ({page},info) => {
  await load(page); await epubDialog(page); await page.fill('#epub-book-title','天地'.repeat(150));
  const {filename}=await epubDownload(page,info,'filename'); expect(Buffer.byteLength(filename)).toBeLessThanOrEqual(185); expect(filename).toMatch(/\.epub$/);
});
test('export errors are visible and the export control recovers', async ({page}) => {
  await load(page); await epubDialog(page); await page.evaluate(()=>window.LukijaEPUB={build(){throw new Error('Test failure');}});
  await page.click('#epub-save'); await expect(page.locator('#epub-error')).toContainText('Test failure'); await expect(page.locator('#epub-save')).toBeEnabled();
});
test('reader and EPUB dialog do not overflow the viewport', async ({page}) => {
  await load(page); await epubDialog(page);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1)).toBe(true);
  const box=await page.locator('#epub-dialog').boundingBox(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x+box.width).toBeLessThanOrEqual(page.viewportSize().width+1);
});
test('specimen exports are explicitly labelled as specimens', async ({page},info) => {
  await page.click('#settings-trigger'); await page.click('#demo-button'); await expect(page.locator('#manuscript')).toBeVisible(); await epubDialog(page);
  const {files}=await epubDownload(page,info,'specimen'); expect(files['EPUB/title.xhtml']).toContain('not a translation');
});
