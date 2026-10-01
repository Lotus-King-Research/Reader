import {readFile, writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url), path=new URL('public/index.html',root);
let html=await readFile(path,'utf8');
for (const [name,source,id] of [['epub','src/epub.js'],['catalog','src/catalog.js'],['parallel','src/parallel.js'],['app','src/app.js','reader-code']]) {
  const engine=await readFile(new URL(source,root),'utf8');
  if (/<\/script/i.test(engine)) throw new Error(`Invalid embedded ${name} source.`);
  const slot=new RegExp(`(<script id="${id || name+'-engine'}">)[\\s\\S]*?(<\\/script>)`);
  if (!slot.test(html)) throw new Error(`Missing ${name} slot in public/index.html.`);
  html=html.replace(slot,(_,open,close)=>open+'\n'+engine+'\n'+close);
}
const config=JSON.parse(await readFile(new URL('public/reader-config.json',root),'utf8'));
if(!Array.isArray(config.works))throw new Error('reader-config.json must contain a works array.');
// Escaping the opening bracket keeps untrusted titles from ending the JSON script.
const serialized=JSON.stringify(config,null,2).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
const configSlot=/(<script id="reader-config" type="application\/json">)[\s\S]*?(<\/script>)/;
if(!configSlot.test(html))throw new Error('Missing reader-config JSON slot in public/index.html.');
html=html.replace(configSlot,(_,open,close)=>open+'\n'+serialized+'\n'+close);
const font=await readFile(new URL('public/fonts/NotoSerifTibetan-Regular.woff2',root));
const fontSlot=/\/\* TIBETAN_FONT \*\/(?:[\s\S]*?\/\* END_TIBETAN_FONT \*\/)?/;
if(!fontSlot.test(html))throw new Error('Missing Tibetan font CSS slot in public/index.html.');
const fontCSS=`/* TIBETAN_FONT */\n@font-face { font-family: 'Noto Serif Tibetan'; font-style: normal; font-weight: 400; font-display: swap; src: url(data:font/woff2;base64,${font.toString('base64')}) format('woff2'); }\n/* END_TIBETAN_FONT */`;
html=html.replace(fontSlot,()=>fontCSS);
await writeFile(path,html);
// The sitemap lists the collection and each configured work, from the same configuration.
const origin=(process.env.READER_ORIGIN || 'https://reader.padma.io').replace(/\/+$/,'');
const xml=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const urls=[origin+'/',...config.works.filter(work=>typeof work.id==='string' && /^[a-zA-Z0-9._-]+$/.test(work.id)).map(work=>`${origin}/?work=${encodeURIComponent(work.id)}`)];
await writeFile(new URL('public/sitemap.xml',root),`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(url=>`  <url><loc>${xml(url)}</loc></url>`).join('\n')}\n</urlset>\n`);
console.log('Built public/index.html with reader config, bilingual catalog, EPUB export and Tibetan font, and public/sitemap.xml.');
