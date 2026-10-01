/* Pairing and reading layers operate only on the sanitized manuscript DOM. */
(() => {
'use strict';
const headings = 'H1 H2 H3 H4 H5 H6'.split(' ');
function cleanPairedApparatus(fragment) {
  for(const paragraph of fragment.querySelectorAll('p')) {
    if(/^Earlier notes:\s*/i.test(paragraph.textContent.trim()))paragraph.remove();
  }
  for(const link of fragment.querySelectorAll('a[href]')) {
    if(!/(?:^|\/)LEGACY-NOTES\.md#n-[^#?\s]+$/i.test(link.getAttribute('href')))continue;
    link.classList.add('legacy-note-ref');
    const marker=document.createElement('sup');marker.className='reader-note-marker legacy-note-marker';
    link.replaceWith(marker);marker.append(link);
  }
  for(const heading of fragment.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
    if(/^Golden[-\s]source footnotes(?:\s+and\s+endnotes)?$/i.test(heading.textContent.trim()) && heading.nextElementSibling?.classList.contains('footnotes'))heading.remove();
  }
}
function parts(fragment,anchorAlignment=false) {
  const result=[];let current=null;
  for(const node of [...fragment.childNodes]) {
    if(node.nodeType===1 && node.classList.contains('footnotes'))continue;
    const anchor=node.nodeType===1 && !node.textContent.trim() ? (node.tagName==='A' ? node : node.tagName==='P' && node.children.length===1 ? node.firstElementChild : null) : null;
    if(anchorAlignment && anchor?.tagName==='A' && anchor.id && !anchor.hasAttribute('href')){
      current={id:anchor.id,level:'anchor',nodes:[],heading:null,anchor};result.push(current);
      // Markdown wraps empty anchors in paragraphs; keep the target without a blank stanza.
      if(node!==anchor){node.replaceWith(anchor);current.nodes.push(anchor);continue;}
    } else if(node.nodeType===1 && headings.includes(node.tagName)){
      if(anchorAlignment){current=null;continue;}
      current={id:node.id,level:node.tagName,nodes:[],heading:node};result.push(current);
    } else if(!current && !anchorAlignment && (node.nodeType===1 || node.textContent.trim())){
      current={id:'opening',level:'opening',nodes:[],heading:null};result.push(current);
    }
    if(current)current.nodes.push(node);
  }
  return result;
}
function inlineStandaloneNotes(part) {
  let previousProse=null;
  part.nodes=part.nodes.filter(node=>{
    if(node.nodeType!==1)return true;
    if(node.tagName==='P' && node.querySelector('.footnote-ref,.legacy-note-ref')){
      const remainder=node.cloneNode(true);remainder.querySelectorAll('.footnote-ref,.legacy-note-ref').forEach(ref=>ref.remove());
      if(!remainder.textContent.trim() && !remainder.querySelector('img,input,br,hr') && previousProse){
        if(node.id){const target=document.createElement('span');target.id=node.id;previousProse.append(target);}
        previousProse.append(...node.childNodes);node.remove();return false;
      }
    }
    if(node.tagName==='P' && node.textContent.trim())previousProse=node;
    else if(['BLOCKQUOTE','FIGURE'].includes(node.tagName)){
      const paragraphs=[...node.querySelectorAll('p')].filter(paragraph=>paragraph.textContent.trim());
      if(paragraphs.length)previousProse=paragraphs.at(-1);
    }
    return true;
  });
}
function build(english,source,{language='bo',sectionMap=[],anchorAlignment=false,onToggle=()=>{}}={}) {
  if(anchorAlignment){cleanPairedApparatus(english);cleanPairedApparatus(source);}
  const left=parts(english,anchorAlignment),right=parts(source,anchorAlignment),used=new Set(),pairs=[],sections=[];
  if(anchorAlignment){left.forEach(inlineStandaloneNotes);right.forEach(inlineStandaloneNotes);}
  const englishNotes=[...english.children].find(el=>el.classList.contains('footnotes'));
  const sourceNotes=source.querySelector('.footnotes');
  if(sourceNotes){sourceNotes.classList.add('source-footnotes');sourceNotes.lang=language;sourceNotes.hidden=true;}
  let notesVisible=false,visibleSources=0;
  function syncNotes(){
    if(sourceNotes)sourceNotes.hidden=!notesVisible || visibleSources===0;
    if(englishNotes)englishNotes.hidden=!notesVisible || (left.length>0 && visibleSources===left.length);
  }
  const normalize=id=>id==='opening' ? id : id.startsWith('md-') ? id : 'md-'+id;
  const byId=new Map(right.map(part=>[part.id,part]));
  const sameOutline=left.length===right.length && left.every((part,i)=>part.level===right[i].level);
  const canOrdinal=!anchorAlignment && sameOutline && !sectionMap.length && left.every((part,i)=>!byId.has(part.id) || byId.get(part.id)===right[i]);
  const explicit=new Map(sectionMap.map(item=>[normalize(item.english),normalize(item.source)]));
  const sourceIds=new Map();
  source.querySelectorAll('[id]').forEach(el=>{sourceIds.set(el.id,'source-'+el.id);el.id='source-'+el.id;});
  source.querySelectorAll('a[href^="#"]').forEach(el=>{const target=el.getAttribute('href').slice(1);if(sourceIds.has(target))el.setAttribute('href','#'+sourceIds.get(target));});
  for(const part of left) {
    let match=explicit.has(part.id) ? byId.get(explicit.get(part.id)) : byId.get(part.id);
    if(!match && canOrdinal)match=right[sections.length];
    if(match && used.has(match))match=null;
    const section=document.createElement('section');section.className='parallel-section';section.id=part.id;sections.push(section);
    if(part.anchor)part.anchor.removeAttribute('id');
    part.nodes[0].replaceWith(section);
    const body=document.createElement('div');body.className='english-passage';body.lang='en';
    if(part.heading){part.heading.id='english-'+part.id;part.heading.dataset.sectionAnchor=part.id;}
    body.append(...part.nodes);section.append(body);
    if(match){
      used.add(match);
      const original=document.createElement('div');original.className='source-passage';original.lang=language;original.hidden=true;original.append(...match.nodes);
      const pair={section,english:body,source:original,sourceVisible:false};
      pair.show=(visible,keepPosition=true,silent=false)=>{
        visible=Boolean(visible);
        const offset=keepPosition ? section.getBoundingClientRect().top : 0;
        if(pair.sourceVisible!==visible)visibleSources+=visible ? 1 : -1;
        pair.sourceVisible=visible;body.hidden=visible;original.hidden=!visible;
        if(keepPosition)window.scrollBy({top:section.getBoundingClientRect().top-offset,behavior:'instant'});
        syncNotes();if(!silent)onToggle(pair);
      };
      pairs.push(pair);section.append(original);
    }
  }
  // Endnotes keep their language and distinct targets, outside the continuous prose.
  if(sourceNotes && pairs.length)english.append(sourceNotes);
  if(englishNotes)english.append(englishNotes);
  const referenceHolders=[...new Set([...english.querySelectorAll('.footnote-ref,.legacy-note-ref')].map(ref=>ref.closest('sup') || ref))];
  for(const holder of referenceHolders)holder.classList.add('reader-note-marker');
  function setNotesVisible(visible){
    notesVisible=Boolean(visible);for(const holder of referenceHolders)holder.hidden=!notesVisible;
    syncNotes();return notesVisible;
  }
  function pairsForRange(range){
    if(!range || range.collapsed)return [];
    return pairs.filter(pair=>{try{return range.intersectsNode(pair.sourceVisible ? pair.source : pair.english);}catch{return false;}});
  }
  setNotesVisible(false);
  return {pairs,sections,total:left.length,unpaired:left.length-pairs.length,setNotesVisible,pairsForRange,
    get notesVisible(){return notesVisible;},hasNotes:referenceHolders.length>0 || !!englishNotes || !!(sourceNotes && pairs.length)};
}
window.ReaderParallel=Object.freeze({build});
})();
