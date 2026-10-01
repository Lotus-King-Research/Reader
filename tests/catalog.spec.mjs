import {test,expect} from '@playwright/test';
import {mockCatalog,blobSHA,names,config} from './catalog-fixture.mjs';
let fixture;
test.beforeEach(async({page})=>{fixture=await mockCatalog(page,{configuration:{works:[]}});await page.goto('/');});
async function create(page,configuration=config) {await page.evaluate(configuration=>window.testCatalog=ReaderCatalog.create(()=>{},configuration),configuration);}
const snapshot=page=>page.evaluate(()=>testCatalog.works.map(({id,title,originalTitle,volumes,error,sourceError})=>({id,title,originalTitle,volumes,error,sourceError})));
test('live deployment starts with an empty configuration',async({page})=>{
  const response=await page.request.get('/reader-config.json');expect(await response.json()).toEqual({works:[]});
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
test('rate limits pause automatic requests until their retry time',async({page})=>{
  await create(page);fixture.status[names[0]]=429;await page.evaluate(()=>testCatalog.refresh('paired-text'));const before=fixture.requests.length;
  await page.evaluate(()=>testCatalog.refresh('paired-text',{force:true}));expect(fixture.requests).toHaveLength(before);expect((await snapshot(page))[0].error).toContain('request limit');
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
