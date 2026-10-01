// Loads the embedded Marked build and the reader's createCompiler exactly as the browser worker does.
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);

export async function loadCompiler() {
  const html = await readFile(new URL('public/index.html', root), 'utf8');
  const app = await readFile(new URL('src/app.js', root), 'utf8');
  const engine = /<script id="markdown-engine">([\s\S]*?)<\/script>/.exec(html)?.[1];
  const factory = /function createCompiler\(marked\) \{[\s\S]*?\n\}\n(?=let mainCompiler)/.exec(app)?.[0];
  if (!engine || !factory) throw new Error('Could not find the Markdown engine or createCompiler.');
  const context = vm.createContext({});
  vm.runInContext(engine, context);
  vm.runInContext(factory + '\nthis.compile = createCompiler(this.marked);', context);
  return context.compile;
}
