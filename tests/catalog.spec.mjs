import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const catalogSource=await readFile(new URL('../src/catalog.js',import.meta.url),'utf8');
import {mockCatalog,blobSHA,names,config} from './catalog-fixture.mjs';
let fixture;
test.beforeEach(async({page})=>{fixture=await mockCatalog(page,{configuration:{works:[]}});await page.goto('/');await page.addScriptTag({content:catalogSource});});
async function create(page,configuration=config) {await page.evaluate(configuration=>window.testCatalog=ReaderCatalog.create(()=>{},configuration),configuration);}
const snapshot=page=>page.evaluate(()=>testCatalog.works.map(({id,title,originalTitle,volumes,error,sourceError})=>({id,title,originalTitle,volumes,error,sourceError})));
test('published config includes Dra Thal Gyur without fetching its manuscripts',async({page})=>{
  const response=await page.request.get('/reader-config.json'),published=await response.json();
  expect(published.works.length).toBeGreaterThan(0);
  expect(published.works[0]).toMatchObject({id:'dra-thal-gyur',repository:'Lotus-King-Translation/Dra-Thal-Gyur',sourceLanguage:'bo'});
  expect(published.works[0].englishUrl).toMatch(/\/paired\/translation\.md$/);
  expect(published.works[0].sourceUrl).toMatch(/\/paired\/source\.md$/);
  await create(page,published);
  const entry=await page.evaluate(()=>testCatalog.descriptor('dra-thal-gyur','paired/translation.md'));
  expect(entry.sourceURL).toBe('https://raw.githubusercontent.com/Lotus-King-Translation/Dra-Thal-Gyur/main/paired/translation.md');
  expect(entry.sourceTextURL).toBe('https://raw.githubusercontent.com/Lotus-King-Translation/Dra-Thal-Gyur/main/paired/source.md');
  expect(fixture.requests).toHaveLength(0);
  await create(page,{works:[]});expect(await snapshot(page)).toEqual([]);
});
test('paired files load independently verified English and Tibetan revisions',async({page})=>{
  await create(page);const result=await page.evaluate(()=>testCatalog.read('paired-text','translation/en.md'));
  expect(result.text).toContain('English opening');expect(result.sourceText).toContain('བོད་ཡིག');expect(result.sourceError).toBe('');
  expect(result.descriptor.revision).toBe(blobSHA(fixture.files[names[0]]['translation/en.md']));
  expect(result.descriptor.sourceRevision).toBe(blobSHA(fixture.files[names[0]]['source/bo.md']));
  expect(result.descriptor.sourceLanguage).toBe('bo');expect(result.descriptor.originalTitle).toBe('དཔེ་ཆ།');expect(result.descriptor.sectionMap).toEqual(config.works[0].sections);
  expect(result.sourceDescriptor.sourceURL).toContain('/source/bo.md');
});
test('recursive directories include nested Markdown and plain text',async({page})=>{
  await create(page);await page.evaluate(()=>testCatalog.refresh('collected-texts'));
  const work=(await snapshot(page))[1];expect(work.volumes.map(file=>file.path)).toEqual(['translation/nested/chapter-2.txt','translation/opening.md']);
  expect(fixture.requests.filter(url=>url.includes('/git/trees/'))).toHaveLength(1);
  const result=await page.evaluate(()=>testCatalog.read('collected-texts','translation/nested/chapter-2.txt'));expect(result.sourceText).toContain('བོད་ཡིག');
});
test('incomplete Git tree listings are rejected without replacing a verified list',async({page})=>{
  await create(page);await page.evaluate(()=>testCatalog.refresh('collected-texts'));fixture.truncated[names[1]]=true;
  expect(await page.evaluate(()=>testCatalog.refresh('collected-texts',{force:true}))).toBe(false);
  const work=(await snapshot(page))[1];expect(work.error).toContain('incomplete');expect(work.volumes).toHaveLength(2);
});
test('new and removed nested texts are discovered without redeploying',async({page})=>{
  await create(page);await page.evaluate(()=>testCatalog.refresh('collected-texts'));delete fixture.files[names[1]]['translation/opening.md'];
  fixture.files[names[1]]['translation/new/chapter.md']='# A new chapter';fixture.files[names[1]]['source/new/chapter.md']='# དཔེ་ཆ།';
  await page.evaluate(()=>testCatalog.refresh('collected-texts',{force:true}));const paths=(await snapshot(page))[1].volumes.map(file=>file.path);
  expect(paths).toContain('translation/new/chapter.md');expect(paths).not.toContain('translation/opening.md');
});
test('changed texts use the latest listed revision and stale raw data falls back to Git blobs',async({page})=>{
  await create(page);fixture.files[names[0]]['translation/en.md']+='\n\nA correction.';fixture.rawOverride='# Old CDN text';
  const result=await page.evaluate(()=>testCatalog.read('paired-text','translation/en.md'));expect(result.text).toContain('A correction.');expect(result.sourceText).toContain('བོད་ཡིག');
  expect(fixture.requests.filter(url=>url.includes('/git/blobs/'))).toHaveLength(2);
});
test('missing source text leaves English available with a disclosed source error',async({page})=>{
  await create(page);delete fixture.files[names[0]]['source/bo.md'];const result=await page.evaluate(()=>testCatalog.read('paired-text','translation/en.md'));
  expect(result.text).toContain('English opening');expect(result.sourceText).toBe('');expect(result.sourceError).toContain('unavailable');expect(result.sourceDescriptor).toBeNull();
});
test('one unavailable repository does not prevent another work from refreshing',async({page})=>{
  await create(page);fixture.status[names[0]]=404;await page.evaluate(()=>testCatalog.refreshAll());const works=await snapshot(page);
  expect(works[0].error).toContain('unavailable');expect(works[1].error).toBe('');expect(works[1].volumes).toHaveLength(2);
});
test('rate limits pause GitHub API requests while raw files keep the text readable and marked unverified',async({page})=>{
  await create(page);fixture.status[names[0]]=429;
  const apiCalls=()=>fixture.requests.filter(url=>url.startsWith('https://api.github.com/')).length;
  expect(await page.evaluate(()=>testCatalog.refresh('paired-text'))).toBe(true);const before=apiCalls();
  expect(await page.evaluate(()=>testCatalog.refresh('paired-text',{force:true}))).toBe(true);expect(apiCalls()).toBe(before);
  const work=await page.evaluate(()=>({error:testCatalog.works[0].error,stale:testCatalog.works[0].stale}));
  expect(work.error).toBe('');expect(work.stale.state).toBe('unverified');
  const result=await page.evaluate(()=>testCatalog.read('paired-text','translation/en.md'));
  expect(result.text).toContain('English opening');expect(result.sourceText).toContain('བོད་ཡིག');
  expect(result.descriptor.stale.state).toBe('unverified');
  expect(result.descriptor.revision).toBe(blobSHA(fixture.files[names[0]]['translation/en.md']));
});
test('raw and blob URLs identify configured files and preserve section fragments',async({page})=>{
  await create(page);const found=await page.evaluate(()=>[
    testCatalog.identify('https://raw.githubusercontent.com/Lotus-King-Research/Example-Text/main/translation/en.md#opening'),
    testCatalog.identify('https://github.com/Lotus-King-Research/Example-Collection/blob/main/translation/nested/chapter-2.txt'),
    testCatalog.identify('https://github.com/other/repo/blob/main/translation/en.md'),
    testCatalog.identify('https://github.com/Lotus-King-Research/Example-Text/blob/main/private.md')
  ]);
  expect(found[0].catalogId).toBe('paired-text');expect(found[0].section).toBe('#opening');expect(found[1].path).toContain('nested/');expect(found[2]).toBeNull();expect(found[3]).toBeNull();
});
test('invalid configuration reports errors while preserving valid works',async({page})=>{
  const invalid={works:[config.works[0],config.works[0],{...config.works[1],englishUrl:'http://example.org/en.md'},{...config.works[1],englishUrl:'https://127.0.0.1/en.md'}]};
  await create(page,invalid);expect(await snapshot(page)).toHaveLength(1);const error=await page.evaluate(()=>testCatalog.error);expect(error).toContain('Duplicate');expect(error).toContain('HTTPS');
  await create(page,{bad:[]});expect(await page.evaluate(()=>testCatalog.error)).toContain('works array');
});
test('path traversal and unknown file paths never fetch unconfigured paths',async({page})=>{
  await create(page);const errors=await page.evaluate(async()=>{
    const results=[];for(const path of ['translation/../private.md','translation\\private.md','source/bo.md'])try{await testCatalog.read('paired-text',path);}catch(e){results.push(e.message);}return results;
  });expect(errors).toHaveLength(3);expect(fixture.requests).toHaveLength(0);
});
test('public HTTPS Markdown pairs can use non-GitHub hosts',async({page})=>{
  await page.route('https://example.org/en.md',route=>route.fulfill({body:'# English\n\nEnglish text.'}));await page.route('https://example.org/bo.txt',route=>route.fulfill({body:'བོད་ཡིག'}));
  await create(page,{works:[{id:'external',repository:'example/text',englishUrl:'https://example.org/en.md',sourceUrl:'https://example.org/bo.txt'}]});
  const result=await page.evaluate(()=>testCatalog.read('external','en.md'));expect(result.text).toContain('English');expect(result.sourceText).toBe('བོད་ཡིག');expect(result.descriptor.verified).toBe(false);
});
test('oversized configured files are rejected before manuscript fetch',async({page})=>{
  await create(page);fixture.files[names[0]]['translation/en.md']='x'.repeat(4*1024*1024+1);
  const error=await page.evaluate(async()=>{try{await testCatalog.read('paired-text','translation/en.md');}catch(e){return e.message;}});expect(error).toContain('4 MB');
  expect(fixture.requests.some(url=>url.includes('raw.githubusercontent.com') && url.includes('translation/en.md'))).toBe(false);
});

function expectMonotonic(events) {
  expect(events[0]).toMatchObject({stage:'metadata',progress:0});
  expect(events.at(-1)).toMatchObject({stage:'ready',progress:1,phase:'complete'});
  expect(events.every((event,index)=>Number.isFinite(event.progress) && event.progress>=0 && event.progress<=1 && (!index || event.progress>=events[index-1].progress))).toBe(true);
}
test('streaming reports monotonic metadata and byte progress for both verified texts',async({page})=>{
  await create(page);
  const texts=fixture.files[names[0]],result=await page.evaluate(async texts=>{
    const realFetch=window.fetch;
    window.fetch=async(url,options)=>{
      const parsed=new URL(url);
      if(parsed.hostname!=='raw.githubusercontent.com')return realFetch(url,options);
      const bytes=new TextEncoder().encode(texts[parsed.pathname.split('/').slice(4).join('/')]);
      return new Response(new ReadableStream({start(controller){for(let offset=0;offset<bytes.length;offset+=16)controller.enqueue(bytes.slice(offset,offset+16));controller.close();}}),{headers:{'content-length':String(bytes.length)}});
    };
    const events=[],result=await testCatalog.read('paired-text','translation/en.md',undefined,event=>events.push(event));
    return {events,text:result.text,sourceText:result.sourceText};
  },texts);
  expectMonotonic(result.events);
  const downloads=result.events.filter(event=>event.stage==='download');
  expect(downloads.length).toBeGreaterThan(10);
  expect(downloads.every((event,index)=>!index || event.loadedBytes>=downloads[index-1].loadedBytes)).toBe(true);
  expect(new Set(downloads.map(event=>event.language))).toEqual(new Set(['en','bo']));
  expect(downloads.filter(event=>event.phase==='verify')).toHaveLength(2);
  expect(result.events.at(-1).loadedBytes).toBe(Buffer.byteLength(texts['translation/en.md'])+Buffer.byteLength(texts['source/bo.md']));
  expect(result.text).toBe(texts['translation/en.md']);expect(result.sourceText).toBe(texts['source/bo.md']);
});
test('streams without response lengths still advance and complete',async({page})=>{
  await create(page,{works:[{id:'external',repository:'example/text',englishUrl:'https://example.org/en.md',sourceUrl:'https://example.org/bo.txt'}]});
  const result=await page.evaluate(async()=>{
    const realFetch=window.fetch;
    window.fetch=async(url,options)=>{
      if(new URL(url).hostname!=='example.org')return realFetch(url,options);
      const bytes=new TextEncoder().encode(url.endsWith('en.md')?'# English\n\n'+('A streamed paragraph.\n'.repeat(20)):'བོད་ཡིག'.repeat(20));
      return new Response(new ReadableStream({start(controller){for(let offset=0;offset<bytes.length;offset+=32)controller.enqueue(bytes.slice(offset,offset+32));controller.close();}}));
    };
    const events=[],result=await testCatalog.read('external','en.md',undefined,event=>events.push(event));return {events,sourceText:result.sourceText};
  });
  expectMonotonic(result.events);expect(result.events.some(event=>event.stage==='download' && event.totalBytes===null && event.loadedBytes>0)).toBe(true);
  expect(new Set(result.events.filter(event=>event.stage==='download').map(event=>event.progress)).size).toBeGreaterThan(5);
  expect(result.sourceText).toContain('བོད་ཡིག');
});
test('Git blob retries never reverse progress or reset transferred bytes',async({page})=>{
  await create(page);fixture.rawOverride='# Stale CDN text';
  const result=await page.evaluate(async()=>{const events=[],result=await testCatalog.read('paired-text','translation/en.md',undefined,event=>events.push(event));return {events,text:result.text,sourceText:result.sourceText};});
  expectMonotonic(result.events);
  const downloads=result.events.filter(event=>event.stage==='download');
  expect(downloads.filter(event=>event.phase==='fallback')).toHaveLength(2);
  expect(downloads.every((event,index)=>!index || event.loadedBytes>=downloads[index-1].loadedBytes)).toBe(true);
  expect(result.events.at(-1).loadedBytes).toBe(2*Buffer.byteLength(fixture.rawOverride)+Buffer.byteLength(fixture.files[names[0]]['translation/en.md'])+Buffer.byteLength(fixture.files[names[0]]['source/bo.md']));
  expect(result.text).toContain('English opening');expect(result.sourceText).toContain('བོད་ཡིག');
});
test('missing source completes English progress and retains the source warning',async({page})=>{
  await create(page);delete fixture.files[names[0]]['source/bo.md'];
  const result=await page.evaluate(async()=>{const events=[],result=await testCatalog.read('paired-text','translation/en.md',undefined,event=>events.push(event));return {events,text:result.text,sourceError:result.sourceError};});
  expectMonotonic(result.events);expect(result.text).toContain('English opening');expect(result.sourceError).toContain('unavailable');
});
test('a presentation callback error cannot interrupt verification',async({page})=>{
  await create(page);const result=await page.evaluate(()=>testCatalog.read('paired-text','translation/en.md',undefined,()=>{throw new Error('Broken progress display');}));
  expect(result.text).toContain('English opening');expect(result.sourceText).toContain('བོད་ཡིག');expect(result.sourceError).toBe('');
});
test('cancellation stops progress and never announces readiness',async({page})=>{
  await create(page);
  const result=await page.evaluate(async()=>{
    const controller=new AbortController(),events=[];
    try{await testCatalog.read('paired-text','translation/en.md',controller.signal,event=>{events.push(event);if(event.stage==='download' && event.loadedBytes>0)controller.abort();});return {events,error:''};}catch(error){return {events,error:error.name};}
  });
  expect(result.error).toBe('AbortError');expect(result.events.at(-1).stage).toBe('download');expect(result.events.some(event=>event.stage==='ready')).toBe(false);
});

test('explicit fresh-list reuse avoids a second directory metadata request',async({page})=>{
  await create(page);await page.evaluate(()=>testCatalog.refresh('collected-texts'));
  const before=fixture.requests.filter(url=>url.includes('/git/trees/')).length;
  const result=await page.evaluate(()=>testCatalog.read('collected-texts','translation/opening.md',undefined,undefined,{reuseFresh:true}));
  expect(fixture.requests.filter(url=>url.includes('/git/trees/'))).toHaveLength(before);expect(result.text).toContain('Collection opening');expect(result.sourceText).toContain('བོད་ཡིག');
  expect(result.descriptor.revision).toBe(blobSHA(fixture.files[names[1]]['translation/opening.md']));
});
test('expired or errored listings refresh despite requesting reuse',async({page})=>{
  await create(page);await page.evaluate(()=>testCatalog.refresh('collected-texts'));
  await page.evaluate(()=>{const now=Date.now;Date.now=()=>now()+testCatalog.interval+1;});
  await page.evaluate(()=>testCatalog.read('collected-texts','translation/opening.md',undefined,undefined,{reuseFresh:true}));
  expect(fixture.requests.filter(url=>url.includes('/git/trees/'))).toHaveLength(2);
  fixture.status[names[1]]=404;await page.evaluate(()=>testCatalog.refresh('collected-texts',{force:true}));delete fixture.status[names[1]];
  await page.evaluate(()=>testCatalog.read('collected-texts','translation/opening.md',undefined,undefined,{reuseFresh:true}));
  expect(fixture.requests.filter(url=>url.includes('/git/trees/'))).toHaveLength(4);expect((await snapshot(page))[1].error).toBe('');
});
test('default reads still verify the newest revision after a fresh metadata check',async({page})=>{
  await create(page);await page.evaluate(()=>testCatalog.refresh('paired-text'));
  fixture.files[names[0]]['translation/en.md']+='\n\nA correction after discovery.';
  const result=await page.evaluate(()=>testCatalog.read('paired-text','translation/en.md'));
  expect(result.text).toContain('A correction after discovery.');
  expect(fixture.requests.filter(url=>url.includes('/contents/'))).toHaveLength(4);
});
test('metadata cancellation rejects promptly while shared discovery completes safely',async({page})=>{
  await create(page);let release;fixture.listingWait=new Promise(resolve=>release=resolve);
  try {
    await page.evaluate(()=>{
      window.metadataController=new AbortController();window.metadataEvents=[];window.metadataOutcome='pending';
      testCatalog.read('paired-text','translation/en.md',metadataController.signal,event=>metadataEvents.push(event)).then(()=>metadataOutcome='ready',error=>metadataOutcome=error.name);
    });
    await expect.poll(()=>fixture.requests.length).toBe(2);
    await page.evaluate(()=>metadataController.abort());
    await expect.poll(()=>page.evaluate(()=>metadataOutcome),{timeout:2000}).toBe('AbortError');
    const count=await page.evaluate(()=>metadataEvents.length);
    release();await expect.poll(()=>page.evaluate(()=>!!testCatalog.get('paired-text').pending)).toBe(false);
    expect(await page.evaluate(()=>metadataEvents.length)).toBe(count);
    expect(fixture.requests.some(url=>url.includes('raw.githubusercontent.com'))).toBe(false);
  } finally {release();}
});

test('verified inline metadata bodies avoid duplicate raw manuscript transfers',async({page})=>{
  await create(page);fixture.inlineContent=true;fixture.rawOverride='# Wrong raw text';
  const result=await page.evaluate(async()=>{const events=[],result=await testCatalog.read('paired-text','translation/en.md',undefined,event=>events.push(event));return {events,result,listing:testCatalog.get('paired-text').volumes};});
  expectMonotonic(result.events);expect(result.result.text).toBe(fixture.files[names[0]]['translation/en.md']);expect(result.result.sourceText).toBe(fixture.files[names[0]]['source/bo.md']);
  expect(fixture.requests).toHaveLength(2);expect(fixture.requests.every(url=>url.includes('/contents/'))).toBe(true);
  expect(result.events.at(-1).loadedBytes).toBe(0);
  expect(JSON.stringify(result.listing)).not.toContain('English opening');expect(result.result.descriptor).not.toHaveProperty('content');expect(result.result.descriptor).not.toHaveProperty('text');
});
test('invalid or incorrectly hashed inline bodies fall back to verified raw files',async({page})=>{
  await create(page);fixture.inlineContent=true;
  fixture.inlineOverrides['translation/en.md']=Buffer.from('x'.repeat(Buffer.byteLength(fixture.files[names[0]]['translation/en.md']))).toString('base64');
  fixture.inlineOverrides['source/bo.md']='%%% invalid base64 %%%';
  const result=await page.evaluate(()=>testCatalog.read('paired-text','translation/en.md'));
  expect(result.text).toBe(fixture.files[names[0]]['translation/en.md']);expect(result.sourceText).toBe(fixture.files[names[0]]['source/bo.md']);expect(result.sourceError).toBe('');
  expect(fixture.requests.filter(url=>url.includes('raw.githubusercontent.com'))).toHaveLength(2);
});
test('inline size mismatches cannot bypass the published revision check',async({page})=>{
  await create(page);fixture.inlineContent=true;fixture.inlineOverrides['source/bo.md']=Buffer.from('Truncated source').toString('base64');
  const result=await page.evaluate(()=>testCatalog.read('paired-text','translation/en.md'));
  expect(result.sourceText).toBe(fixture.files[names[0]]['source/bo.md']);expect(result.sourceError).toBe('');
  const raw=fixture.requests.filter(url=>url.includes('raw.githubusercontent.com'));expect(raw).toHaveLength(1);expect(raw[0]).toContain('/source/bo.md');
});

test('large line-wrapped inline bodies preserve English and Tibetan without redownload',async({page})=>{
  await create(page);fixture.inlineContent=true;
  fixture.files[names[0]]['translation/en.md']='# A large text\n\n'+'A published paragraph.\n'.repeat(40000);
  fixture.files[names[0]]['source/bo.md']='# དཔེ་ཆ།\n\n'+'བོད་ཡིག'.repeat(35000);
  for(const path of ['translation/en.md','source/bo.md'])fixture.inlineOverrides[path]=Buffer.from(fixture.files[names[0]][path]).toString('base64').match(/.{1,60}/g).join('\n')+'\n';
  const result=await page.evaluate(async()=>{const result=await testCatalog.read('paired-text','translation/en.md');return {englishBytes:new TextEncoder().encode(result.text).length,sourceBytes:new TextEncoder().encode(result.sourceText).length,sourceError:result.sourceError,revision:result.descriptor.revision,sourceRevision:result.descriptor.sourceRevision};});
  expect(result.englishBytes).toBe(Buffer.byteLength(fixture.files[names[0]]['translation/en.md']));expect(result.sourceBytes).toBe(Buffer.byteLength(fixture.files[names[0]]['source/bo.md']));expect(result.sourceError).toBe('');
  expect(result.revision).toBe(blobSHA(fixture.files[names[0]]['translation/en.md']));expect(result.sourceRevision).toBe(blobSHA(fixture.files[names[0]]['source/bo.md']));
  expect(fixture.requests).toHaveLength(2);expect(fixture.requests.some(url=>url.includes('raw.githubusercontent.com'))).toBe(false);
});
