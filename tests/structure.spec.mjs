import {test, expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {mockCatalog} from './catalog-fixture.mjs';

const repository = 'Lotus-King-Research/Example-Text';
const englishPath = 'paired/translation.md', sourcePath = 'paired/source.md';
const config = {works:[{id:'structured-text',repository,title:'Structured specimen',englishUrl:`https://github.com/${repository}/blob/main/${englishPath}`,sourceUrl:`https://github.com/${repository}/blob/main/${sourcePath}`,sourceLanguage:'bo'}]};
const units = [
  {id:'V2-000001',format:'h1',english:'English source-defined title',source:'བོད་ཡིག་གི་མཚན་བྱང་།'},
  {id:'V2-000002',format:'h2',english:'English source-defined chapter',source:'བོད་ཡིག་གི་ལེའུ།'},
  {id:'V2-000003',format:'h3',english:'English source-defined subsection',source:'བོད་ཡིག་གི་ས་བཅད།'},
  {id:'V2-000004',format:'prose',english:'English prose opening.\nEnglish prose continues on the next source line and remains an ordinary paragraph without inferred quotation layers or a decorative initial letter.\nA teacher says: “These synthetic words should remain plain prose.”',source:'བོད་ཡིག་གི་ལྷུག་མ།\nལྷུག་མའི་ཚིག་གཉིས་པ།'},
  {id:'V2-000005',format:'verse',english:'English verse line one.\nEnglish verse line two.\nEnglish verse line three.',source:'བོད་ཡིག་གི་ཚིགས་བཅད་དང་པོ།\nཚིགས་བཅད་གཉིས་པ།\nཚིགས་བཅད་གསུམ་པ།'}
];
function pairBlock(side, unit, {anchors=false,notes=false}={}) {
  const anchor = anchors ? `<a id="${unit.id.toLowerCase()}"></a>\n\n` : '';
  const marker = side==='source' ? `${unit.id} | golden: U${unit.id.slice(-6)} | role: main_text | format: ${unit.format}` : unit.id;
  const reference = notes && (side==='source' ? unit.format==='verse' : unit.format==='prose') ? `[^${side==='source'?'bo':'en'}-note]` : '';
  return `${anchor}<!-- pair: ${marker} -->\n${unit[side==='source'?'source':'english']}${reference}\n<!-- /pair -->`;
}
function manuscript(side, options={}) {
  const source = side==='source';
  const metadata = `---\nschema: paired-text/2\ntext-id: structured-specimen\npaired-edition: specimen-paired-v2\nsource-edition: specimen-golden-v1\n${source?'edition: specimen-golden-v1':'translation-edition: specimen-translation-v1'}\nlanguage: ${source?'bo':'en'}\n---`;
  const notes = options.notes ? `\n\n[^${source?'bo':'en'}-note]: ${source?'བོད་ཡིག་གི་མཆན་འགྲེལ།':'English structured endnote.'}` : '';
  return `${metadata}\n\n# ${source?'དཔེ་ཆ།':'English fixture masthead'}\n\n## ${source?'ལེའུ་དང་པོ།':'Outer chapter'}\n\n${options.preface || ''}${units.map(unit=>pairBlock(side,unit,options)).join('\n\n')}${options.tail || ''}${notes}`;
}
async function fixture(page, options={}) {
  const state = await mockCatalog(page,{configuration:config});
  state.files['Example-Text'] = {[englishPath]:options.english ?? manuscript('english',options),[sourcePath]:options.source ?? manuscript('source',options)};
  await page.goto('/?work=structured-text&file=paired%2Ftranslation.md'+(options.hash || ''));
  await expect(page.locator('#manuscript')).toBeVisible();
  await expect(page.locator('body')).not.toHaveClass(/loading/);
  await expect(page.locator('#manuscript')).toContainText('English prose opening.');
  return state;
}
const pair = (page,id) => page.locator(`#md-${id.toLowerCase()}`);
async function selectMenu(page, passage) {
  await passage.scrollIntoViewIfNeeded();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await passage.evaluate(element=>{
    const text = element.querySelector('p,h1,h2,h3') || element;
    const range = document.createRange(); range.selectNodeContents(text);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  });
  await passage.dispatchEvent('contextmenu',{button:2,clientX:160,clientY:180});
  await expect(page.locator('#selection-menu')).toBeVisible();
}
async function switchPair(page, unit) {
  const section = pair(page,unit.id), english = await section.locator('.english-passage').isVisible();
  await selectMenu(page,section.locator(english?'.english-passage':'.source-passage'));
  await expect(page.locator('#selection-language')).toHaveText(english?'Show Tibetan':'Show English');
  await page.locator('#selection-language').click();
  await expect(section.locator(english?'.source-passage':'.english-passage')).toBeVisible();
}
async function sourceDialog(page) {
  if(await page.locator('#mobile-menu').isVisible() && await page.locator('#mobile-menu').getAttribute('aria-expanded')!=='true') {
    const box=await page.locator('#mobile-menu').boundingBox(); await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
  }
  await page.locator('#source-button').click();
}
function storedZipEntry(bytes,wanted) {
  let offset=0;
  while(offset+30<=bytes.length && bytes.readUInt32LE(offset)===0x04034b50) {
    const method=bytes.readUInt16LE(offset+8),size=bytes.readUInt32LE(offset+18),nameLength=bytes.readUInt16LE(offset+26),extraLength=bytes.readUInt16LE(offset+28);
    const name=bytes.subarray(offset+30,offset+30+nameLength).toString('utf8'),start=offset+30+nameLength+extraLength;
    expect(method).toBe(0); expect(start+size).toBeLessThanOrEqual(bytes.length);
    if(name===wanted)return bytes.subarray(start,start+size).toString('utf8');
    offset=start+size;
  }
  throw new Error(`Missing EPUB entry: ${wanted}`);
}

// All passages are synthetic and exercise the publication format, not translation accuracy.
for(const anchors of [false,true]) {
  test(`paired-text/2 inherits source formats with ${anchors?'publisher anchors':'comments alone'}`,async({page})=>{
    await fixture(page,{anchors});
    await expect(page.locator('#manuscript .parallel-section')).toHaveCount(5);
    await expect(page.locator('#manuscript > h2')).toHaveCount(1);
    await expect(page.locator('#manuscript .citation-block, #manuscript .drop-cap')).toHaveCount(0);
    await expect(page.locator('#notes-toggle')).toBeHidden();
    for(const unit of units) {
      const section=pair(page,unit.id),english=section.locator('.english-passage'),source=section.locator('.source-passage');
      await expect(section).toHaveCount(1); await expect(section).toHaveAttribute('data-format',unit.format);
      await expect(english).toHaveAttribute('data-format',unit.format); await expect(source).toHaveAttribute('data-format',unit.format);
      await expect(english).toBeVisible(); await expect(source).toBeHidden();
      if(unit.format.startsWith('h')) {
        await expect(english.locator(unit.format)).toHaveCount(1); await expect(source.locator(unit.format)).toHaveCount(1);
        await expect(english.locator(unit.format)).toContainText(unit.english);
      } else if(unit.format==='verse') {
        await expect(english.locator('br')).toHaveCount(2); await expect(source.locator('br')).toHaveCount(2);
      } else {
        await expect(english.locator('br,h1,h2,h3')).toHaveCount(0); await expect(source.locator('br,h1,h2,h3')).toHaveCount(0);
      }
      await switchPair(page,unit);
      await expect(source).toContainText(unit.source.split('\n')[0]); await expect(source).toHaveAttribute('lang','bo');
      for(const other of units.filter(other=>other.id!==unit.id))await expect(pair(page,other.id).locator('.english-passage')).toBeVisible();
      await switchPair(page,unit); await expect(english).toBeVisible();
      await expect(pair(page,unit.id)).toHaveCount(1);
    }
    const ids=await page.locator('#manuscript [id]').evaluateAll(elements=>elements.map(element=>element.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
}

test('paired-text/2 generated heading anchors remain stable through a deep link and language switches',async({page})=>{
  const preface='Introductory English prose outside all pairs.\n\n'.repeat(30),tail='\n\n## Editorial material\n\n'+'English trailing prose outside all pairs.\n\n'.repeat(30);
  await fixture(page,{preface,tail,hash:'#v2-000003'});
  const heading=pair(page,'V2-000003');
  await expect(heading).toHaveCount(1); await expect(heading.locator('.english-passage h3')).toBeVisible();
  await expect.poll(()=>heading.evaluate(element=>element.getBoundingClientRect().top)).toBeGreaterThanOrEqual(70);
  await expect.poll(()=>heading.evaluate(element=>element.getBoundingClientRect().top)).toBeLessThan(page.viewportSize().height/2);
  await switchPair(page,units[2]); await expect(heading.locator('.source-passage h3')).toBeVisible();
  await expect(page).toHaveURL(/#v2-000003$/); await expect(heading).toHaveCount(1);
  await switchPair(page,units[2]); await expect(heading.locator('.english-passage h3')).toBeVisible();
});

const invalidPairs = [
  ['missing source format',source=>source.replace(' | format: verse','')],
  ['unsupported source format',source=>source.replace('format: verse','format: table')],
  ['duplicate source format',source=>source.replace('format: verse','format: verse | format: prose')],
  ['malformed source format',source=>source.replace('format: verse','format verse')],
  ['different schema',source=>source.replace('schema: paired-text/2','schema: paired-text/1')],
  ['different source edition',source=>source.replace('edition: specimen-golden-v1\nlanguage: bo','edition: other-golden-v1\nlanguage: bo')],
  ['different text-id',source=>source.replace('text-id: structured-specimen','text-id: other-specimen')],
  ['different paired edition',source=>source.replace('paired-edition: specimen-paired-v2','paired-edition: other-paired-v2')],
  ['missing pair',source=>source.replace(pairBlock('source',units[2])+'\n\n','')],
  ['duplicate pair ID',source=>source.replace('pair: V2-000005','pair: V2-000004')],
  ['different pair ID',source=>source.replace('pair: V2-000005','pair: V2-999999')],
  ['pair order mismatch',source=>source.replace(pairBlock('source',units[3])+'\n\n'+pairBlock('source',units[4]),pairBlock('source',units[4])+'\n\n'+pairBlock('source',units[3]))],
  ['orphan source closing marker',source=>source.replace('<!-- pair: V2-000001','<!-- /pair -->\n\n<!-- pair: V2-000001')]
];
for(const [reason,mutate] of invalidPairs) {
  test(`paired-text/2 leaves English readable for ${reason}`,async({page})=>{
    await fixture(page,{source:mutate(manuscript('source'))});
    await expect(page.locator('#paired-status')).toBeVisible();
    await expect(page.locator('#paired-status')).toContainText(/source|format|edition|pair|schema/i);
    await expect(page.locator('#manuscript .source-passage')).toHaveCount(0);
    for(const unit of units)await expect(page.locator('#manuscript')).toContainText(unit.english.split('\n')[0]);
    await selectMenu(page,page.locator('#manuscript p').filter({hasText:'English prose opening.'}).first());
    await expect(page.locator('#selection-copy')).toBeVisible(); await expect(page.locator('#selection-language')).toBeHidden();
  });
}
for(const field of ['source-edition','translation-edition','text-id']) {
  test(`paired-text/2 leaves English readable without required translation ${field}`,async({page})=>{
    const english=manuscript('english').replace(new RegExp(`^${field}:.*\\n`,'m'),'');
    await fixture(page,{english});
    await expect(page.locator('#paired-status')).toBeVisible(); await expect(page.locator('#manuscript .source-passage')).toHaveCount(0);
    await expect(page.locator('#manuscript')).toContainText('English verse line three.');
  });
}

test('paired-text/2 notes stay optional and attach to the visible language without changing stanza lines',async({page})=>{
  await fixture(page,{notes:true});
  await expect(page.locator('#notes-toggle')).toBeVisible(); await expect(page.locator('#notes-toggle')).toHaveAttribute('aria-pressed','false');
  for(const notes of await page.locator('#manuscript .footnotes').all())await expect(notes).toBeHidden();
  await switchPair(page,units[4]);
  const verse=pair(page,units[4].id).locator('.source-passage');
  await expect(verse.locator('br')).toHaveCount(2); await expect(verse.locator('.footnote-ref')).toBeHidden();
  await page.locator('#notes-toggle').click(); await verse.locator('.footnote-ref').click();
  await expect(page.locator('#note-content')).toContainText('བོད་ཡིག་གི་མཆན་འགྲེལ།');
  await page.locator('#note-dialog [data-close]').click();
  await expect(page.locator('#manuscript .source-footnotes')).toBeVisible(); await expect(page.locator('#manuscript .footnotes:not(.source-footnotes)')).toBeVisible();
});

test('paired-text/2 offline copies retain inherited headings and explicit verse breaks in both languages',async({page,context},info)=>{
  const state=await fixture(page);
  await sourceDialog(page);
  const download=page.waitForEvent('download'); await page.locator('#export-reader').click();
  const path=info.outputPath('structured-reader.html'); await(await download).saveAs(path);
  const html=await readFile(path,'utf8'),requests=state.requests.length;
  await page.goto('about:blank'); await context.setOffline(true); await page.setContent(html);
  await expect(page.locator('#manuscript')).toBeVisible();
  for(const unit of units.slice(0,3)) {
    await expect(pair(page,unit.id).locator(`.english-passage ${unit.format}`)).toBeVisible();
    await switchPair(page,unit); await expect(pair(page,unit.id).locator(`.source-passage ${unit.format}`)).toBeVisible();
  }
  await expect(pair(page,units[4].id).locator('.english-passage br')).toHaveCount(2);
  await switchPair(page,units[4]); await expect(pair(page,units[4].id).locator('.source-passage br')).toHaveCount(2);
  expect(state.requests.length).toBe(requests);
});

test('paired-text/2 EPUB preserves selected semantic headings, verse breaks and endnote targets',async({page},info)=>{
  await fixture(page,{notes:true});
  await switchPair(page,units[0]); await switchPair(page,units[4]);
  await sourceDialog(page); await page.locator('#export-epub').click();
  const download=page.waitForEvent('download'); await page.locator('#epub-save').click();
  const path=info.outputPath('structured-reader.epub'); await(await download).saveAs(path);
  const content=storedZipEntry(await readFile(path),'EPUB/content.xhtml');
  const shape=await page.evaluate(value=>{
    const doc=new DOMParser().parseFromString(value,'application/xml');
    const sections=[...doc.querySelectorAll('.parallel-section')];
    const section=id=>sections[Number(id.slice(-6))-1];
    const ids=new Set([...doc.querySelectorAll('[id]')].map(element=>element.id));
    return {error:doc.querySelector('parsererror')?.textContent || '',h1:section('V2-000001')?.querySelector('.source-passage h1')?.textContent,h2:section('V2-000002')?.querySelector('.english-passage h2')?.textContent,h3:section('V2-000003')?.querySelector('.english-passage h3')?.textContent,verseBreaks:section('V2-000005')?.querySelectorAll('.source-passage br').length,proseBreaks:section('V2-000004')?.querySelectorAll('br').length,language:section('V2-000005')?.querySelector('.source-passage')?.getAttribute('lang'),sourceNotes:doc.querySelector('.source-footnotes')?.textContent,englishNotes:doc.querySelector('.footnotes:not(.source-footnotes)')?.textContent,brokenNotes:[...doc.querySelectorAll('a[role="doc-noteref"]')].filter(link=>!ids.has(link.getAttribute('href').slice(1))).length};
  },content);
  expect(shape.error).toBe(''); expect(shape.h1).toContain(units[0].source); expect(shape.h2).toContain(units[1].english); expect(shape.h3).toContain(units[2].english);
  expect(shape.verseBreaks).toBe(2); expect(shape.proseBreaks).toBe(0); expect(shape.language).toBe('bo');
  expect(shape.sourceNotes).toContain('བོད་ཡིག་གི་མཆན་འགྲེལ།'); expect(shape.englishNotes).toContain('English structured endnote.'); expect(shape.brokenNotes).toBe(0);
  expect(content).not.toContain('English verse line one.'); expect(content).not.toContain(units[0].english);
});


test('paired-text/2 source formats override English marker hints and Markdown heading guesses',async({page})=>{
  const english=manuscript('english').replace(/<!-- pair: (V2-\d+) -->/g,'<!-- pair: $1 | format: prose -->').replace('English prose opening.','## English prose opening.');
  await fixture(page,{english});
  for(const unit of units) {
    const body=pair(page,unit.id).locator('.english-passage');
    await expect(body).toHaveAttribute('data-format',unit.format);
    if(unit.format.startsWith('h'))await expect(body.locator(unit.format)).toHaveCount(1);
  }
  const prose=pair(page,units[3].id).locator('.english-passage');
  await expect(prose.locator('h1,h2,h3,br')).toHaveCount(0); await expect(prose.locator('p')).toContainText(['English prose opening.']);
  await expect(pair(page,units[4].id).locator('.english-passage br')).toHaveCount(2);
});


test('paired-text/2 before-pair markers alone delimit all formats and preserve external chapter headings',async({page})=>{
  const implicit=side=>manuscript(side).replace(/^<!-- \/pair -->\n?/gm,'').replace('<!-- pair: V2-000003',`## ${side==='source'?'ལེའུ་གཉིས་པ།':'Another outer chapter'}\n\n<!-- pair: V2-000003`);
  await fixture(page,{english:implicit('english'),source:implicit('source')});
  await expect(page.locator('#paired-status')).toBeHidden();
  await expect(page.locator('#manuscript .parallel-section')).toHaveCount(5); await expect(page.locator('#manuscript > h2')).toHaveCount(2);
  await expect(pair(page,units[1].id)).not.toContainText('Another outer chapter');
  for(const unit of units)await expect(pair(page,unit.id)).toHaveAttribute('data-format',unit.format);
  await expect(pair(page,units[4].id).locator('.english-passage br')).toHaveCount(2);
  await switchPair(page,units[4]); await expect(pair(page,units[4].id).locator('.source-passage br')).toHaveCount(2);
  await switchPair(page,units[2]); await expect(pair(page,units[2].id).locator('.source-passage h3')).toBeVisible();
});

test('paired-text/2 accepts mixed explicit and implicit pair endings',async({page})=>{
  const mixed=side=>{
    let index=0; return manuscript(side).replace(/<!-- \/pair -->/g,marker=>index++%2===(side==='source'?0:1)?'':marker);
  };
  await fixture(page,{english:mixed('english'),source:mixed('source')});
  await expect(page.locator('#paired-status')).toBeHidden(); await expect(page.locator('#manuscript .source-passage')).toHaveCount(5);
  for(const unit of units){await switchPair(page,unit);await expect(pair(page,unit.id).locator('.source-passage')).toContainText(unit.source.split('\n')[0]);}
});


test('paired-text/2 MD work codes retain the sanitizer prefix and switch canonical heading and verse pairs',async({page})=>{
  await fixture(page,{english:manuscript('english').replace(/V2-/g,'MD-'),source:manuscript('source').replace(/V2-/g,'MD-')});
  await expect(page.locator('#paired-status')).toBeHidden(); await expect(page.locator('#manuscript .source-passage')).toHaveCount(5);
  const heading={...units[0],id:'MD-000001'},verse={...units[4],id:'MD-000005'};
  await expect(pair(page,heading.id)).toHaveCount(1); await expect(pair(page,heading.id).locator('.english-passage h1')).toHaveAttribute('id','english-md-md-000001');
  await switchPair(page,heading); await expect(pair(page,heading.id).locator('.source-passage h1')).toHaveAttribute('id','source-md-md-000001');
  await switchPair(page,verse); await expect(pair(page,verse.id).locator('.source-passage br')).toHaveCount(2);
  await switchPair(page,heading); await expect(pair(page,heading.id).locator('.english-passage h1')).toBeVisible();
  await expect(page.locator('#md-md-000001')).toHaveCount(1); await expect(page.locator('#md-000001')).toHaveCount(0);
});
test('paired-text/2 hides the citation setting, which cannot change its layout', async ({page}) => {
  await fixture(page);
  await page.click('#settings-trigger');
  await expect(page.locator('#settings-dialog')).toBeVisible();
  await expect(page.locator('#auto-citations')).toBeHidden();
});
