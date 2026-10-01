import {createHash} from 'node:crypto';
export const names=['Example-Text','Example-Collection'];
export const config={works:[
  {id:'paired-text',repository:'Lotus-King-Research/Example-Text',title:'Example text',originalTitle:'དཔེ་ཆ།',englishUrl:'https://github.com/Lotus-King-Research/Example-Text/blob/main/translation/en.md',sourceUrl:'https://github.com/Lotus-King-Research/Example-Text/blob/main/source/bo.md',sourceLanguage:'bo',sections:[{id:'opening',english:'opening',source:'དང་པོ།'},{id:'continuation',english:'continuation',source:'གཉིས་པ།'}]},
  {id:'collected-texts',repository:'Lotus-King-Research/Example-Collection',title:'Example collection',englishUrl:'https://github.com/Lotus-King-Research/Example-Collection/tree/main/translation',sourceUrl:'https://github.com/Lotus-King-Research/Example-Collection/tree/main/source',sourceLanguage:'bo'}
]};
export function blobSHA(text) {const data=Buffer.from(text);return createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');}
export async function mockCatalog(page,{configuration=config,inject=true}={}) {
  const state={files:{},status:{},rawStatus:{},requests:[],rawOverride:null,listingWait:null,truncated:{},inlineContent:false,inlineOverrides:{}};
  state.files[names[0]]={
    'translation/en.md':'# Example text\n\nSynthetic interface fixture.\n\n## Opening\n\nEnglish opening paragraph.\n\n## Continuation\n\nEnglish continuation paragraph.',
    'source/bo.md':'# དཔེ་ཆ།\n\n## དང་པོ།\n\nབོད་ཡིག་གི་ཚིག་དང་པོ།\n\n## གཉིས་པ།\n\nབོད་ཡིག་གི་ཚིག་གཉིས་པ།'
  };
  state.files[names[1]]={
    'translation/opening.md':'# Collection opening\n\n## First\n\nA section.',
    'source/opening.md':'# དཔེ་ཆ།\n\n## དང་པོ།\n\nབོད་ཡིག',
    'translation/nested/chapter-2.txt':'Collection continuation\n\nA plain text chapter.',
    'source/nested/chapter-2.txt':'དཔེ་ཆ།\n\nབོད་ཡིག',
    'assets/figure.png':'Image fixture excluded from text catalog'
  };
  if(inject)await page.addInitScript(configuration=>window.READER_CONFIG=configuration,configuration);
  await page.route(/^https:\/\/api\.github\.com\/repos\/Lotus-King-Research\/(Example-Text|Example-Collection)\//,async route=>{
    const url=new URL(route.request().url()),parts=url.pathname.split('/'),name=parts[3];state.requests.push(url.href);
    if(state.listingWait)await state.listingWait;
    const error=state.status[name];
    if(error)return route.fulfill({status:error,contentType:'application/json',headers:error===429?{'retry-after':'60'}:{},body:'{"message":"Test source error"}'});
    if(url.pathname.includes('/git/trees/')) {
      const tree=Object.entries(state.files[name]).map(([path,text])=>({type:'blob',mode:'100644',path,sha:blobSHA(text),size:Buffer.byteLength(text)}));
      return route.fulfill({contentType:'application/json',body:JSON.stringify({tree,truncated:state.truncated[name] || false})});
    }
    if(url.pathname.includes('/contents/')) {
      const path=decodeURIComponent(parts.slice(5).join('/')),text=state.files[name]?.[path];
      return route.fulfill({status:text===undefined?404:200,contentType:'application/json',body:text===undefined?'{}':JSON.stringify({type:'file',path,name:path.split('/').pop(),sha:blobSHA(text),size:Buffer.byteLength(text),...(state.inlineContent?{encoding:'base64',content:state.inlineOverrides[path] ?? Buffer.from(text).toString('base64')}: {})})});
    }
    const sha=parts.at(-1),text=Object.values(state.files[name]).find(t=>blobSHA(t)===sha);
    return route.fulfill({status:text===undefined?404:200,contentType:'text/plain',body:text ?? 'Missing blob'});
  });
  await page.route(/^https:\/\/raw\.githubusercontent\.com\/Lotus-King-Research\/(Example-Text|Example-Collection)\//,async route=>{
    const url=new URL(route.request().url()),parts=url.pathname.split('/'),name=parts[2],path=decodeURIComponent(parts.slice(4).join('/'));state.requests.push(url.href);
    const text=state.rawOverride ?? state.files[name]?.[path],status=state.rawStatus[path] || (text===undefined?404:200);
    return route.fulfill({status,contentType:'text/plain',body:text ?? 'Missing file'});
  });
  return state;
}
