/* Configured public bilingual catalog. Texts remain in their source repositories. */
(() => {
'use strict';
const INTERVAL=5*60*1000, LIMIT=4*1024*1024, TREE_LIMIT=16*1024*1024;
const textFile=path=>/\.(?:md|markdown|txt)$/i.test(path);
const safePath=path=>typeof path==='string' && !!path && !path.startsWith('/') && !/[\\\u0000-\u001f]/.test(path) && path.split('/').every(part=>part && part!=='.' && part!=='..');
const encoded=path=>path.split('/').map(encodeURIComponent).join('/');
const api=endpoint=>`https://api.github.com/repos/${endpoint.owner}/${endpoint.repo}`;
function endpoint(input) {
  let url; try {url=new URL(input);} catch {throw new Error('Text URLs must be valid public HTTPS URLs.');}
  const host=url.hostname.toLowerCase();
  if (url.protocol!=='https:' || url.username || url.password || (url.port && url.port!=='443') || !host.includes('.') || host.startsWith('[') || /(?:^|\.)(?:localhost|local|internal)$/.test(host) || /^\d+(?:\.\d+){3}$/.test(host)) throw new Error('Text URLs must use a public HTTPS host without credentials.');
  url.hash='';
  if (host!=='github.com' && host!=='raw.githubusercontent.com') {
    let path; try {path=decodeURIComponent(url.pathname.split('/').pop() || '');} catch {throw new Error('The text URL contains invalid encoding.');}
    if(!safePath(path) || !textFile(path))throw new Error('Text URLs must identify Markdown or plain text files.');
    return {kind:'file',github:false,path,url:url.href,githubURL:url.href};
  }
  let parts; try {parts=url.pathname.slice(1).split('/').map(decodeURIComponent);} catch {throw new Error('The GitHub text URL contains invalid encoding.');}
  const [owner,repo]=parts;
  if (!/^[\w.-]+$/.test(owner || '') || !/^[\w.-]+$/.test(repo || '')) throw new Error('A GitHub URL must identify an owner and repository.');
  const isRaw=host==='raw.githubusercontent.com', mode=isRaw?'blob':parts[2], ref=parts[isRaw?2:3], path=parts.slice(isRaw?3:4).join('/');
  if (!['blob','tree'].includes(mode) || !ref || !safePath(path)) throw new Error('Use a GitHub blob URL for a text or tree URL for a directory.');
  if (mode==='blob' && !textFile(path)) throw new Error('Configured GitHub texts must be Markdown or plain text files.');
  return {kind:mode==='tree'?'directory':'file',github:true,owner,repo,ref,path,
    url:`https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${encoded(path)}`,
    githubURL:`https://github.com/${owner}/${repo}/${mode}/${encodeURIComponent(ref)}/${encoded(path)}`};
}
function embeddedConfig() {
  if (window.READER_CONFIG!==undefined) return window.READER_CONFIG;
  const slot=document.getElementById('reader-config');
  return slot?.textContent.trim() ? JSON.parse(slot.textContent) : {works:[]};
}
function configuredWork(item,index) {
  if (!item || typeof item!=='object' || !/^[\w.-]+\/[\w.-]+$/.test(item.repository || '')) throw new Error(`Work ${index+1} needs repository in owner/repo form.`);
  const english=endpoint(item.englishUrl), source=endpoint(item.sourceUrl);
  if (english.kind!==source.kind) throw new Error(`Work ${index+1} must pair two files or two directories.`);
  const id=item.id || item.repository.toLowerCase().replace(/[^a-z0-9._-]+/g,'-');
  if (typeof id!=='string' || !/^[a-zA-Z0-9._-]+$/.test(id)) throw new Error(`Work ${index+1} has an invalid id.`);
  if (item.sections!==undefined && (!Array.isArray(item.sections) || item.sections.some(s=>!s || typeof s.english!=='string' || typeof s.source!=='string' || !s.english || !s.source))) throw new Error(`Work ${index+1} has invalid section mappings.`);
  if (item.sourceLanguage!==undefined && !/^[a-z]{2,3}(?:-[A-Za-z0-9]+)*$/.test(item.sourceLanguage)) throw new Error(`Work ${index+1} has an invalid source language.`);
  return {id,repository:item.repository,title:String(item.title || item.repository.split('/')[1].replace(/[-_]/g,' ')),originalTitle:String(item.originalTitle || ''),description:String(item.description || ''),sourceLanguage:item.sourceLanguage || 'bo',sectionMap:(item.sections || []).map(s=>({...s})),englishUrl:english.githubURL,sourceUrl:source.githubURL,branch:english.ref || '',owner:english.owner || '',english,source,directory:english.kind==='directory'?english.path:'',volumes:[],checkedAt:0,attemptedAt:0,error:'',sourceError:'',etag:'',pending:null};
}
function create(onChange=()=>{},config) {
  let error='',works=[];
  try {
    config=config===undefined?embeddedConfig():config;
    if (!config || !Array.isArray(config.works)) throw new Error('Reader configuration must contain a works array.');
    const errors=[];
    config.works.forEach((item,index)=>{try {const work=configuredWork(item,index);if(works.some(w=>w.id===work.id)) throw new Error(`Duplicate work id: ${work.id}.`);works.push(work);}catch(e){errors.push(e.message);}});
    error=errors.join(' ');
  } catch(e) {error='Reader configuration is invalid: '+e.message;}
  let retryAt=0;
  const get=id=>{const work=works.find(w=>w.id===id);if(!work) throw new Error('This work is not in the configured collection.');return work;};
  function pathFor(work,path) {
    if (!safePath(path) || !textFile(path) || (work.english.kind==='file'?path!==work.english.path:!path.startsWith(work.english.path+'/'))) throw new Error('Choose a configured text file.');
    return path;
  }
  function locations(endpoint,path=endpoint.path) {
    return endpoint.github?{url:`https://raw.githubusercontent.com/${endpoint.owner}/${endpoint.repo}/${encodeURIComponent(endpoint.ref)}/${encoded(path)}`,githubURL:`https://github.com/${endpoint.owner}/${endpoint.repo}/blob/${encodeURIComponent(endpoint.ref)}/${encoded(path)}`}:{url:endpoint.url,githubURL:endpoint.githubURL};
  }
  function pairedPath(work,path) {
    return work.source.kind==='file'?work.source.path:work.source.path+path.slice(work.english.path.length);
  }
  function descriptor(id,path) {
    const work=get(id);pathFor(work,path);const file=work.volumes.find(f=>f.path===path), sourcePath=pairedPath(work,path), englishURLs=locations(work.english,path), sourceURLs=locations(work.source,sourcePath);
    const relative=work.english.kind==='directory'?path.slice(work.english.path.length+1):path.split('/').pop();
    return {id:`catalog:${id}:${path}`,kind:'catalog',catalogId:id,path,number:null,verified:!!file?.sha,
      title:work.english.kind==='file'?work.title:relative.replace(/\.(?:md|markdown|txt)$/i,'').replace(/[-_]/g,' '),workTitle:work.title,originalTitle:work.originalTitle,sourceLanguage:work.sourceLanguage,sectionMap:work.sectionMap,
      sourceURL:englishURLs.url,githubURL:englishURLs.githubURL,revision:file?.sha || '',sourceBytes:file?.size || 0,checkedAt:work.checkedAt,
      sourceTextURL:sourceURLs.url,sourceGithubURL:sourceURLs.githubURL,sourcePath,sourceRevision:file?.sourceFile?.sha || '',sourceTextBytes:file?.sourceFile?.size || 0};
  }
  async function request(url,{headers={},signal,limit=LIMIT}={}) {
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000),cancel=()=>controller.abort();
    signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted) controller.abort();
    try {
      const response=await fetch(url,{headers,signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer',cache:'no-cache'});
      if(response.status===304)return {response,bytes:null};
      if(!response.ok) {
        if([403,429].includes(response.status) && new URL(url).hostname==='api.github.com') {
          const retry=Number(response.headers.get('retry-after')),reset=Number(response.headers.get('x-ratelimit-reset'))*1000;
          retryAt=Math.max(Date.now()+60000,retry?Date.now()+retry*1000:reset || Date.now()+300000);
          if(!Number.isFinite(retryAt))retryAt=Date.now()+300000;
          throw new Error('GitHub is limiting requests. Checks will resume after '+new Date(retryAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})+'.');
        }
        throw new Error(response.status===404?'The configured public text is unavailable or has been removed.':`The source returned HTTP ${response.status}.`);
      }
      if(Number(response.headers.get('content-length'))>limit)throw new Error('The source exceeds the reader’s size limit.');
      const reader=response.body.getReader(),chunks=[];let size=0;
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new Error('The source exceeds the reader’s size limit.');}chunks.push(value);}
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      return {response,bytes};
    } catch(e) {
      if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
      if(controller.signal.aborted)throw new Error('The source request timed out. Please try again.');
      throw e;
    } finally {clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
  }
  const json=bytes=>JSON.parse(new TextDecoder().decode(bytes));
  function validateFile(file) {
    if(!file || !safePath(file.path) || !/^[a-f0-9]{40}$/.test(file.sha) || !Number.isSafeInteger(file.size) || file.size<0)throw new Error('The repository returned invalid file revision information.');
    return {path:file.path,name:file.path.split('/').pop(),sha:file.sha,size:file.size};
  }
  async function list(endpoint,cache) {
    if(!endpoint.github)return [{path:endpoint.path,name:endpoint.path,sha:'',size:0}];
    if(Date.now()<retryAt)throw new Error('GitHub request limit reached. Automatic checks will resume shortly.');
    const headers={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
    if(endpoint.kind==='file') {
      const {bytes}=await request(api(endpoint)+`/contents/${encoded(endpoint.path)}?ref=${encodeURIComponent(endpoint.ref)}`,{headers,limit:2*1024*1024});
      const file=json(bytes);if(file.type!=='file' || file.path!==endpoint.path)throw new Error('The configured URL no longer identifies a public text file.');
      return [validateFile(file)];
    }
    const url=api(endpoint)+`/git/trees/${encodeURIComponent(endpoint.ref)}?recursive=1`;
    if(!cache.has(url))cache.set(url,request(url,{headers,limit:TREE_LIMIT}).then(({bytes})=>{
      const listing=json(bytes);if(!Array.isArray(listing.tree) || listing.truncated!==false)throw new Error('The repository listing is incomplete. Select a smaller repository or individual text files.');return listing.tree;
    }));
    const tree=await cache.get(url);
    const files=tree.filter(f=>f.type==='blob' && (!f.mode || ['100644','100755'].includes(f.mode)) && f.path.startsWith(endpoint.path+'/') && textFile(f.path)).map(validateFile);
    if(new Set(files.map(f=>f.path)).size!==files.length)throw new Error('The repository listing contains duplicate paths.');
    return files.sort((a,b)=>a.path.localeCompare(b.path,undefined,{numeric:true}));
  }
  async function refresh(id,{force=false}={}) {
    const work=get(id);if(work.pending)return work.pending;
    if(!force && Date.now()-work.attemptedAt<INTERVAL)return !work.error && !!work.checkedAt;
    work.pending=(async()=>{
      work.attemptedAt=Date.now();work.error='';work.sourceError='';
      try {
        const cache=new Map(), results=await Promise.allSettled([list(work.english,cache),list(work.source,cache)]);
        if(results[0].status==='rejected')throw results[0].reason;
        const sourceFiles=results[1].status==='fulfilled'?results[1].value:[];
        if(results[1].status==='rejected')work.sourceError=results[1].reason.message;
        const byPath=new Map(sourceFiles.map(file=>[file.path,file]));
        work.volumes=results[0].value.map(file=>({...file,sourceFile:byPath.get(pairedPath(work,file.path)) || null}));
        work.checkedAt=Date.now();return true;
      } catch(e) {work.error=e instanceof TypeError?'GitHub could not be reached. Check your connection and try again.':e.message;return false;}
    })();onChange();
    try{return await work.pending;}finally{work.pending=null;onChange();}
  }
  async function refreshAll(options) {for(const work of works)await refresh(work.id,options);}
  async function matches(bytes,sha) {
    if(!globalThis.crypto?.subtle)return false;
    const header=new TextEncoder().encode(`blob ${bytes.length}\0`),blob=new Uint8Array(header.length+bytes.length);blob.set(header);blob.set(bytes,header.length);
    const digest=await crypto.subtle.digest('SHA-1',blob);return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('')===sha;
  }
  async function readFile(endpoint,file,signal) {
    if(file.size>LIMIT)throw new Error('This text exceeds the 4 MB manuscript limit.');
    const url=locations(endpoint,file.path).url;let bytes;
    if(!endpoint.github){({bytes}=await request(url,{signal}));return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}
    try {({bytes}=await request(url+'?revision='+file.sha,{signal}));if(!await matches(bytes,file.sha))bytes=null;}catch(e){if(signal?.aborted)throw e;bytes=null;}
    if(!bytes){if(Date.now()<retryAt)throw new Error('The latest file could not be verified while GitHub is limiting requests. Your open text is unchanged.');({bytes}=await request(api(endpoint)+'/git/blobs/'+file.sha,{signal,headers:{Accept:'application/vnd.github.raw+json'}}));if(globalThis.crypto?.subtle && !await matches(bytes,file.sha))throw new Error('The text failed its revision check. Please try again.');}
    if(bytes.length!==file.size)throw new Error('The text size does not match the published revision.');
    return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
  }
  async function read(id,path,signal) {
    const work=get(id);pathFor(work,path);
    if(!await refresh(id,{force:true}))throw new Error(work.error || 'The latest English text could not be verified.');
    if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
    const file=work.volumes.find(f=>f.path===path);if(!file)throw new Error('This text is no longer in the configured repository.');
    const entry=descriptor(id,path);
    const results=await Promise.allSettled([readFile(work.english,file,signal),file.sourceFile?readFile(work.source,file.sourceFile,signal):Promise.reject(new Error(work.sourceError || 'The matching source text is unavailable.'))]);
    if(signal?.aborted)throw new DOMException('Cancelled','AbortError');if(results[0].status==='rejected')throw results[0].reason;
    const sourceText=results[1].status==='fulfilled'?results[1].value:'',sourceError=results[1].status==='rejected'?results[1].reason.message:'';
    const sourceDescriptor=sourceError?null:{...entry,id:entry.id+':source',path:entry.sourcePath,title:work.originalTitle || work.title,sourceURL:entry.sourceTextURL,githubURL:entry.sourceGithubURL,revision:entry.sourceRevision,sourceBytes:entry.sourceTextBytes,language:work.sourceLanguage};
    return {text:results[0].value,sourceText,sourceError,sourceURL:entry.sourceURL,sourceDescriptor,descriptor:entry};
  }
  function identify(input) {
    let candidate;try{candidate=endpoint(input);}catch{return null;}
    if(candidate.kind!=='file')return null;
    for(const work of works) {
      const known=work.english;
      if(known.github!==candidate.github)continue;
      if(known.github && (known.owner.toLowerCase()!==candidate.owner.toLowerCase() || known.repo.toLowerCase()!==candidate.repo.toLowerCase() || known.ref!==candidate.ref))continue;
      if(!known.github && known.url!==candidate.url)continue;
      try {const entry=descriptor(work.id,candidate.path);entry.section=new URL(input).hash;return entry;}catch{}
    }
    return null;
  }
  return {works,get,descriptor,refresh,refreshAll,read,identify,error,interval:INTERVAL};
}
window.ReaderCatalog=Object.freeze({create});
window.LukijaCatalog=window.ReaderCatalog;
})();
