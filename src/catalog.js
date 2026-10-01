/* Configured public bilingual catalog. Texts remain in their source repositories.
   On the hosted reader, files come through the same-origin edge API (worker/), so
   readers never spend GitHub's per-IP request quota. Without that API (forks, local
   servers) the catalog reads GitHub directly, and if GitHub limits requests it falls
   back to the raw files, marked unverified. */
(() => {
'use strict';
const INTERVAL=5*60*1000, DIRECT_INTERVAL=15*60*1000, LIMIT=4*1024*1024, TREE_LIMIT=16*1024*1024;
const textFile=path=>/\.(?:md|markdown|txt)$/i.test(path);
const safePath=path=>typeof path==='string' && !!path && !path.startsWith('/') && !/[\\\u0000-\u001f]/.test(path) && path.split('/').every(part=>part && part!=='.' && part!=='..');
const encoded=path=>path.split('/').map(encodeURIComponent).join('/');
const api=endpoint=>`https://api.github.com/repos/${endpoint.owner}/${endpoint.repo}`;
const notifyProgress=(callback,event)=>{try{callback?.(event);}catch{ /* Presentation callbacks cannot interrupt source verification. */ }};
const byteFraction=(loaded,total)=>total>0?Math.min(loaded/total,0.94):loaded>0?Math.min(loaded/(loaded+65536),0.9):0;
function waitFor(promise,signal) {
  if(!signal)return promise;
  if(signal.aborted)return Promise.reject(new DOMException('Cancelled','AbortError'));
  return new Promise((resolve,reject)=>{
    const abort=()=>reject(new DOMException('Cancelled','AbortError'));
    signal.addEventListener('abort',abort,{once:true});
    promise.then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
  });
}
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
  return {id,repository:item.repository,title:String(item.title || item.repository.split('/')[1].replace(/[-_]/g,' ')),originalTitle:String(item.originalTitle || ''),description:String(item.description || ''),sourceLanguage:item.sourceLanguage || 'bo',sectionMap:(item.sections || []).map(s=>({...s})),englishUrl:english.githubURL,sourceUrl:source.githubURL,branch:english.ref || '',owner:english.owner || '',english,source,directory:english.kind==='directory'?english.path:'',volumes:[],checkedAt:0,attemptedAt:0,error:'',sourceError:'',stale:null,pending:null};
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
  // The edge API is same-origin; window.READER_EDGE=false disables it, a string sets its origin.
  const edgeOrigin=typeof window.READER_EDGE==='string' ? window.READER_EDGE : window.READER_EDGE!==false && /^https?:$/.test(location.protocol) ? location.origin : '';
  let edge=edgeOrigin ? 'unknown' : 'off';
  const interval=()=>edge==='off' ? DIRECT_INTERVAL : INTERVAL;
  const refreshProgress=new Map(),inlineContent=new Map();
  let inlineBytes=0;
  function rememberInline(sha,bytes) {
    inlineBytes-=inlineContent.get(sha)?.length || 0;inlineContent.delete(sha);inlineContent.set(sha,bytes);inlineBytes+=bytes.length;
    while(inlineBytes>2*LIMIT || inlineContent.size>16){const oldest=inlineContent.keys().next().value;inlineBytes-=inlineContent.get(oldest).length;inlineContent.delete(oldest);}
  }
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
      sourceTextURL:sourceURLs.url,sourceGithubURL:sourceURLs.githubURL,sourcePath,sourceRevision:file?.sourceFile?.sha || '',sourceTextBytes:file?.sourceFile?.size || 0,
      stale:work.stale?{...work.stale}:null};
  }
  async function request(url,{headers={},signal,limit=LIMIT,onProgress}={}) {
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000),cancel=()=>controller.abort();
    signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted) controller.abort();
    try {
      const response=await fetch(url,{headers,signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer',cache:'no-cache'});
      if(response.status===304)return {response,bytes:null};
      if(!response.ok) {
        let error;
        if([403,429].includes(response.status) && new URL(url).hostname==='api.github.com') {
          const retry=Number(response.headers.get('retry-after')),reset=Number(response.headers.get('x-ratelimit-reset'))*1000;
          retryAt=Math.max(Date.now()+60000,retry?Date.now()+retry*1000:reset || Date.now()+300000);
          if(!Number.isFinite(retryAt))retryAt=Date.now()+300000;
          error=new Error('GitHub is limiting requests. Checks will resume after '+new Date(retryAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})+'.');
          error.rateLimited=true;
        } else error=new Error(response.status===404?'The configured public text is unavailable or has been removed.':`The source returned HTTP ${response.status}.`);
        error.status=response.status;error.edge=response.headers.get('x-reader-edge')==='1';
        throw error;
      }
      if(Number(response.headers.get('content-length'))>limit)throw new Error('The source exceeds the reader’s size limit.');
      const length=Number(response.headers.get('content-length')),encoding=response.headers.get('content-encoding');
      const totalBytes=Number.isSafeInteger(length) && length>0 && (!encoding || encoding==='identity')?length:null;
      notifyProgress(onProgress,{loadedBytes:0,totalBytes,phase:'download'});
      const reader=response.body.getReader(),chunks=[];let size=0;
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new Error('The source exceeds the reader’s size limit.');}chunks.push(value);notifyProgress(onProgress,{loadedBytes:size,totalBytes,phase:'download'});}
      notifyProgress(onProgress,{loadedBytes:size,totalBytes:size,phase:'complete'});
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
  const edgeURL=(route,endpoint,path=endpoint.path)=>`${edgeOrigin}/api/v1/${route}?${new URLSearchParams({repo:`${endpoint.owner}/${endpoint.repo}`,ref:endpoint.ref,path})}`;
  const savedState=(response,meta)=>({state:(meta?.cache ?? response?.headers.get('x-reader-cache'))==='stale' ? 'saved' : '',
    savedAt:Date.parse(meta?.fetchedAt ?? response?.headers.get('x-reader-fetched-at') ?? '') || null});
  // Edge listing: the revision only, or, when a text is being opened, the verified body too.
  async function listEdge(endpoint,onProgress,bodies) {
    if(endpoint.kind==='directory') {
      const {response,bytes}=await request(edgeURL('tree',endpoint),{headers:{Accept:'application/json'},limit:TREE_LIMIT,onProgress});
      if(response.headers.get('x-reader-edge')!=='1')throw Object.assign(new Error('No reader edge API.'),{notEdge:true});
      const listing=json(bytes),flags=savedState(null,listing);
      if(!Array.isArray(listing.files))throw new Error('The edge returned an invalid listing.');
      const files=listing.files.map(validateFile).map(file=>({...file,via:'edge',stale:flags.state,savedAt:flags.savedAt}));
      if(new Set(files.map(f=>f.path)).size!==files.length)throw new Error('The repository listing contains duplicate paths.');
      return files.sort((a,b)=>a.path.localeCompare(b.path,undefined,{numeric:true}));
    }
    if(!bodies) {
      const {response,bytes}=await request(edgeURL('meta',endpoint),{headers:{Accept:'application/json'},limit:65536,onProgress});
      if(response.headers.get('x-reader-edge')!=='1')throw Object.assign(new Error('No reader edge API.'),{notEdge:true});
      const meta=json(bytes),flags=savedState(null,meta);
      return [{...validateFile({path:endpoint.path,sha:meta.sha,size:meta.size}),via:'edge',stale:flags.state,savedAt:flags.savedAt}];
    }
    const {response,bytes}=await request(edgeURL('file',endpoint),{limit:LIMIT,onProgress});
    if(response.headers.get('x-reader-edge')!=='1')throw Object.assign(new Error('No reader edge API.'),{notEdge:true});
    const entry=validateFile({path:endpoint.path,sha:response.headers.get('x-reader-blob-sha'),size:bytes.length}),flags=savedState(response);
    // The edge checks each file against its revision; check again here before keeping it.
    if(globalThis.crypto?.subtle && !await matches(bytes,entry.sha))throw new Error('The text failed its revision check. Please try again.');
    rememberInline(entry.sha,bytes);
    return [{...entry,via:'edge',stale:flags.state,savedAt:flags.savedAt}];
  }
  // Last resort without the edge: GitHub refused the revision check, so read the raw
  // file and record the revision it actually has, marked as not checked by GitHub.
  async function listRaw(endpoint,onProgress) {
    if(!globalThis.crypto?.subtle)throw new Error('This browser cannot check text revisions.');
    const {bytes}=await request(locations(endpoint).url,{limit:LIMIT,onProgress});
    const entry=validateFile({path:endpoint.path,sha:await blobSHA(bytes),size:bytes.length});
    rememberInline(entry.sha,bytes);
    return [{...entry,via:'raw',stale:'unverified',savedAt:null}];
  }
  async function list(endpoint,cache,onProgress,bodies=false) {
    if(!endpoint.github)return [{path:endpoint.path,name:endpoint.path,sha:'',size:0}];
    if(edge!=='off') {
      try {const files=await listEdge(endpoint,onProgress,bodies);edge='on';return files;}
      catch(error) {
        // A host without the edge API answers with its own 404 page: use GitHub directly from now on.
        // Any other edge failure falls back to GitHub for this request only.
        if(error.notEdge || (!error.edge && [404,405,501].includes(error.status)))edge='off';
      }
    }
    try {return await listGitHub(endpoint,cache,onProgress);}
    catch(error) {
      if(endpoint.kind==='file' && (error.rateLimited || error instanceof TypeError || error.status>=500))return listRaw(endpoint,onProgress);
      throw error;
    }
  }
  async function listGitHub(endpoint,cache,onProgress) {
    if(Date.now()<retryAt)throw Object.assign(new Error('GitHub request limit reached. Automatic checks will resume shortly.'),{rateLimited:true});
    // Only CORS-safelisted headers, so GitHub requests need no preflight.
    const headers={Accept:'application/vnd.github+json'};
    if(endpoint.kind==='file') {
      const {bytes}=await request(api(endpoint)+`/contents/${encoded(endpoint.path)}?ref=${encodeURIComponent(endpoint.ref)}`,{headers,limit:2*1024*1024,onProgress});
      const file=json(bytes);if(file.type!=='file' || file.path!==endpoint.path)throw new Error('The configured URL no longer identifies a public text file.');
      const entry=validateFile(file);
      // GitHub already transfers small text bodies inside its metadata response.
      // Keep only verified bytes in a private, bounded memory cache.
      if(file.encoding==='base64' && typeof file.content==='string' && entry.size<=LIMIT) {
        try {
          const decoded=atob(file.content.replace(/\s/g,''));
          if(decoded.length===entry.size){const inline=new Uint8Array(decoded.length);for(let i=0;i<decoded.length;i++)inline[i]=decoded.charCodeAt(i);if(await matches(inline,entry.sha))rememberInline(entry.sha,inline);}
        } catch { /* Invalid inline bodies use the raw/Git-blob verification path. */ }
      }
      return [entry];
    }
    const url=api(endpoint)+`/git/trees/${encodeURIComponent(endpoint.ref)}?recursive=1`;
    if(!cache.has(url))cache.set(url,request(url,{headers,limit:TREE_LIMIT,onProgress}).then(({bytes})=>{
      const listing=json(bytes);if(!Array.isArray(listing.tree) || listing.truncated!==false)throw new Error('The repository listing is incomplete. Select a smaller repository or individual text files.');return listing.tree;
    }));
    const tree=await cache.get(url);
    const files=tree.filter(f=>f.type==='blob' && (!f.mode || ['100644','100755'].includes(f.mode)) && f.path.startsWith(endpoint.path+'/') && textFile(f.path)).map(validateFile);
    if(new Set(files.map(f=>f.path)).size!==files.length)throw new Error('The repository listing contains duplicate paths.');
    return files.sort((a,b)=>a.path.localeCompare(b.path,undefined,{numeric:true}));
  }
  async function refresh(id,{force=false,onProgress,bodies=false}={}) {
    const work=get(id);
    let tracker=refreshProgress.get(work);
    if(!tracker){tracker={listeners:new Set(),last:null};refreshProgress.set(work,tracker);}
    if(onProgress){tracker.listeners.add(onProgress);if(tracker.last && work.pending)notifyProgress(onProgress,tracker.last);}
    try {
      if(work.pending)return await work.pending;
      if(!force && Date.now()-work.attemptedAt<interval())return !work.error && !!work.checkedAt;
      const states=[{loadedBytes:0,totalBytes:null,done:false},{loadedBytes:0,totalBytes:null,done:false}];
      const metadataProgress=(index,event)=>{
        Object.assign(states[index],event);
        // When a listing carries the text itself (edge, raw or GitHub's inline body),
        // this stage is the whole download; a bare revision listing is a small step.
        const share=state=>state.done ? (bodies && state.loadedBytes>65536 ? 0.9 : 0.15) : (bodies ? 0.9 : 0.15)*byteFraction(state.loadedBytes,state.totalBytes);
        const progress=states.reduce((sum,state)=>sum+share(state),0)/2;
        tracker.last={stage:bodies && event.loadedBytes>65536?'download':'metadata',progress,loadedBytes:states.reduce((sum,state)=>sum+state.loadedBytes,0),totalBytes:states.every(state=>state.totalBytes!==null)?states.reduce((sum,state)=>sum+state.totalBytes,0):null,language:index===0?'en':work.sourceLanguage,phase:event.done?'complete':'download'};
        for(const listener of tracker.listeners)notifyProgress(listener,tracker.last);
      };
      tracker.last=null;
      work.pending=(async()=>{
        work.attemptedAt=Date.now();work.error='';work.sourceError='';
        try {
          const cache=new Map(), results=await Promise.allSettled([work.english,work.source].map((endpoint,index)=>list(endpoint,cache,event=>metadataProgress(index,event),bodies).finally(()=>metadataProgress(index,{done:true,totalBytes:states[index].loadedBytes}))));
          if(results[0].status==='rejected')throw results[0].reason;
          const sourceFiles=results[1].status==='fulfilled'?results[1].value:[];
          if(results[1].status==='rejected')work.sourceError=results[1].reason.message;
          const byPath=new Map(sourceFiles.map(file=>[file.path,file]));
          work.volumes=results[0].value.map(file=>({...file,sourceFile:byPath.get(pairedPath(work,file.path)) || null}));
          // A saved (edge) or unverified (raw) copy may not be the latest version; say so.
          const flagged=[...results[0].value,...sourceFiles].filter(file=>file.stale);
          work.stale=flagged.length?{state:flagged.some(file=>file.stale==='unverified')?'unverified':'saved',savedAt:Math.min(...flagged.map(file=>file.savedAt || Infinity))}:null;
          if(work.stale && !Number.isFinite(work.stale.savedAt))work.stale.savedAt=null;
          work.checkedAt=Date.now();return true;
        } catch(e) {work.error=e instanceof TypeError?'The text could not be reached. Check your connection and try again.':e.message;return false;}
      })();onChange();
      try{return await work.pending;}finally{work.pending=null;onChange();}
    } finally {if(onProgress)tracker.listeners.delete(onProgress);}
  }
  async function refreshAll(options) {for(const work of works)await refresh(work.id,options);}
  async function blobSHA(bytes) {
    const header=new TextEncoder().encode(`blob ${bytes.length}\0`),blob=new Uint8Array(header.length+bytes.length);blob.set(header);blob.set(bytes,header.length);
    const digest=await crypto.subtle.digest('SHA-1',blob);return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  async function matches(bytes,sha) {
    if(!globalThis.crypto?.subtle)return false;
    return await blobSHA(bytes)===sha;
  }
  async function readFile(endpoint,file,signal,onProgress) {
    if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
    if(file.size>LIMIT)throw new Error('This text exceeds the 4 MB manuscript limit.');
    const url=locations(endpoint,file.path).url;let bytes,transferred=0,totalBytes=file.size || null;
    const report=phase=>notifyProgress(onProgress,{loadedBytes:transferred,totalBytes,phase});
    const download=async(target,headers)=>{
      const previous=transferred;
      return request(target,{signal,headers,onProgress:event=>{
        transferred=previous+event.loadedBytes;
        if(event.totalBytes!==null)totalBytes=Math.max(totalBytes || 0,previous+event.totalBytes);
        report('download');
      }});
    };
    const inline=endpoint.github?inlineContent.get(file.sha):null;
    if(inline && inline.length===file.size){totalBytes=0;report('verify');const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(inline);report('complete');return text;}
    if(!endpoint.github){({bytes}=await download(url));const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);report('complete');return text;}
    if(file.via==='edge') {
      try {({bytes}=await download(edgeURL('file',endpoint,file.path)));report('verify');if(!await matches(bytes,file.sha))bytes=null;}catch(e){if(signal?.aborted)throw e;bytes=null;}
      if(bytes){if(bytes.length!==file.size)throw new Error('The text size does not match the published revision.');const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);report('complete');return text;}
    }
    try {({bytes}=await download(url+'?revision='+file.sha));report('verify');if(!await matches(bytes,file.sha))bytes=null;}catch(e){if(signal?.aborted)throw e;bytes=null;}
    if(!bytes){if(Date.now()<retryAt)throw new Error('The latest file could not be verified while GitHub is limiting requests. Your open text is unchanged.');report('fallback');({bytes}=await download(api(endpoint)+'/git/blobs/'+file.sha,{Accept:'application/vnd.github.raw+json'}));report('verify');if(globalThis.crypto?.subtle && !await matches(bytes,file.sha))throw new Error('The text failed its revision check. Please try again.');}
    if(bytes.length!==file.size)throw new Error('The text size does not match the published revision.');
    const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);report('complete');return text;
  }
  async function read(id,path,signal,onProgress,{reuseFresh=false}={}) {
    const work=get(id);pathFor(work,path);
    let progress=0;
    const report=event=>{if(signal?.aborted)return;progress=Math.max(progress,event.progress);notifyProgress(onProgress,{...event,progress});};
    if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
    report({stage:'metadata',progress:0,loadedBytes:0,totalBytes:null,language:null,phase:'download'});
    if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
    const age=Date.now()-work.checkedAt;
    const fresh=reuseFresh && work.checkedAt && !work.error && !work.sourceError && !work.pending && age>=0 && age<INTERVAL;
    if(fresh)report({stage:'metadata',progress:0.15,loadedBytes:0,totalBytes:0,language:null,phase:'complete'});
    else {
      let checked;
      try {checked=await waitFor(refresh(id,{force:true,onProgress:report,bodies:true}),signal);}
      finally {refreshProgress.get(work)?.listeners.delete(report);}
      if(!checked)throw new Error(work.error || 'The latest English text could not be verified.');
    }
    if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
    const file=work.volumes.find(f=>f.path===path);if(!file)throw new Error('This text is no longer in the configured repository.');
    const entry=descriptor(id,path),states=[{loadedBytes:0,totalBytes:file.size || null,fraction:0},{loadedBytes:0,totalBytes:file.sourceFile?.size || null,fraction:file.sourceFile?0:1}];
    const weights=[file.size || 65536,file.sourceFile?(file.sourceFile.size || 65536):0],weight=weights[0]+weights[1];
    // Downloads continue from wherever the listing stage left the bar.
    const base=Math.max(0.15,Math.min(0.9,progress));
    const downloadProgress=(index,event)=>{
      Object.assign(states[index],event);
      states[index].fraction=Math.max(states[index].fraction,event.phase==='complete'?1:byteFraction(event.loadedBytes,event.totalBytes));
      report({stage:'download',progress:base+(0.98-base)*states.reduce((sum,state,i)=>sum+state.fraction*weights[i],0)/weight,loadedBytes:states.reduce((sum,state)=>sum+state.loadedBytes,0),totalBytes:states.every((state,i)=>!weights[i] || state.totalBytes!==null)?states.reduce((sum,state)=>sum+(state.totalBytes || 0),0):null,language:index===0?'en':work.sourceLanguage,phase:event.phase});
    };
    downloadProgress(0,{loadedBytes:0,totalBytes:states[0].totalBytes,phase:'download'});
    const results=await Promise.allSettled([readFile(work.english,file,signal,event=>downloadProgress(0,event)),file.sourceFile?readFile(work.source,file.sourceFile,signal,event=>downloadProgress(1,event)):Promise.reject(new Error(work.sourceError || 'The matching source text is unavailable.'))]);
    if(signal?.aborted)throw new DOMException('Cancelled','AbortError');if(results[0].status==='rejected')throw results[0].reason;
    const sourceText=results[1].status==='fulfilled'?results[1].value:'',sourceError=results[1].status==='rejected'?results[1].reason.message:'';
    const sourceDescriptor=sourceError?null:{...entry,id:entry.id+':source',path:entry.sourcePath,title:work.originalTitle || work.title,sourceURL:entry.sourceTextURL,githubURL:entry.sourceGithubURL,revision:entry.sourceRevision,sourceBytes:entry.sourceTextBytes,language:work.sourceLanguage};
    report({stage:'ready',progress:1,loadedBytes:states.reduce((sum,state)=>sum+state.loadedBytes,0),totalBytes:states.reduce((sum,state)=>sum+state.loadedBytes,0),language:null,phase:'complete'});
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
  return {works,get,descriptor,refresh,refreshAll,read,identify,error,interval:INTERVAL,get edge(){return edge;}};
}
window.ReaderCatalog=Object.freeze({create});
window.LukijaCatalog=window.ReaderCatalog;
})();
