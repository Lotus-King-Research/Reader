/* Section pairing operates only on the sanitized manuscript DOM. */
(() => {
'use strict';
const headings = 'H1 H2 H3 H4 H5 H6'.split(' ');
function parts(fragment,anchorAlignment=false) {
  const result=[];let current=null;
  for(const node of [...fragment.childNodes]) {
    if(node.nodeType===1 && node.classList.contains('footnotes'))continue;
    const anchor=node.nodeType===1 && !node.textContent.trim() ? (node.tagName==='A' ? node : node.tagName==='P' && node.children.length===1 ? node.firstElementChild : null) : null;
    if(anchorAlignment && anchor?.tagName==='A' && anchor.id && !anchor.hasAttribute('href')){
      current={id:anchor.id,level:'anchor',nodes:[],heading:null,anchor};result.push(current);
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
function build(english,source,{language='bo',sectionMap=[],anchorAlignment=false,onToggle=()=>{}}={}) {
  const left=parts(english,anchorAlignment), right=parts(source,anchorAlignment), used=new Set(), pairs=[],sections=[];
  const englishNotes=[...english.children].find(el=>el.classList.contains('footnotes'));
  const sourceNotes=source.querySelector('.footnotes');
  if(sourceNotes){sourceNotes.classList.add('source-footnotes');sourceNotes.lang=language;sourceNotes.hidden=true;}
  function syncNotes(){if(sourceNotes)sourceNotes.hidden=!pairs.some(pair=>pair.sourceVisible);if(englishNotes)englishNotes.hidden=pairs.length===left.length && pairs.length>0 && pairs.every(pair=>pair.sourceVisible);}
  const normalize=id=>id==='opening' ? id : id.startsWith('md-') ? id : 'md-'+id;
  const byId=new Map(right.map(part=>[part.id,part]));
  const sameOutline=left.length===right.length && left.every((part,i)=>part.level===right[i].level);
  const canOrdinal=!anchorAlignment && sameOutline && !sectionMap.length && left.every((part,i)=>!byId.has(part.id) || byId.get(part.id)===right[i]);
  const explicit=new Map(sectionMap.map(item=>[normalize(item.english),normalize(item.source)]));
  const sourceIds=new Map();
  source.querySelectorAll('[id]').forEach(el=>{sourceIds.set(el.id,'source-'+el.id);el.id='source-'+el.id;});
  source.querySelectorAll('a[href^="#"]').forEach(el=>{const target=el.getAttribute('href').slice(1);if(sourceIds.has(target))el.setAttribute('href','#'+sourceIds.get(target));});
  for (let i=0;i<left.length;i++) {
    const part=left[i];
    let match=explicit.has(part.id) ? byId.get(explicit.get(part.id)) : byId.get(part.id);
    if (!match && canOrdinal) match=right[i];
    if (match && used.has(match)) match=null;
    const section=document.createElement('section'); section.className='parallel-section'; section.id=part.id;sections.push(section);
    if(part.anchor)part.anchor.removeAttribute('id');
    part.nodes[0].replaceWith(section);
    const body=document.createElement('div'); body.className='english-passage'; body.lang='en';
    if (part.heading) {part.heading.id='english-'+part.id;part.heading.dataset.sectionAnchor=part.id;}
    body.append(...part.nodes); section.append(body);
    if (match) {
      used.add(match);
      const original=document.createElement('div'); original.className='source-passage'; original.lang=language; original.hidden=true; original.append(...match.nodes);
      const button=document.createElement('button');button.type='button';button.className='section-language-toggle';button.dataset.readerUi='';
      const pair={section,english:body,source:original,button,sourceVisible:false};
      const label=language==='bo'?'Tibetan':'Source';
      pair.show=(visible,keepPosition=true,silent=false)=>{
        const offset=section.getBoundingClientRect().top;
        pair.sourceVisible=visible;body.hidden=visible;original.hidden=!visible;
        button.textContent=visible?'English':label;button.setAttribute('aria-pressed',String(visible));
        button.setAttribute('aria-label','Show '+(visible?'English':label)+' for this section');
        if (keepPosition) window.scrollBy({top:section.getBoundingClientRect().top-offset,behavior:'instant'});
        syncNotes();if(!silent)onToggle(pair);
      };
      pairs.push(pair);pair.show(false,false,true);button.addEventListener('click',()=>pair.show(!pair.sourceVisible));
      section.prepend(button);section.append(original);
    } else {
      const note=document.createElement('p');note.className='section-pair-unavailable';note.dataset.readerUi='';note.textContent='Source alignment unavailable for this section.';section.prepend(note);
    }
  }
  // Endnotes retain their language and distinct targets even when headings differ.
  if(sourceNotes && pairs.length)english.append(sourceNotes);
  // append() moved sections after English endnotes; restore the original order.
  if(englishNotes)english.append(englishNotes);
  return {pairs,sections,total:left.length,unpaired:left.length-pairs.length};
}
window.ReaderParallel=Object.freeze({build});
})();
