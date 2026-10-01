// Cloudflare Worker entry. Static assets are served directly; only /api/* reaches this code.
import config from '../public/reader-config.json';
import {createEdge} from './edge.js';

const edgeFor = env => createEdge({config, kv: env.READER_CACHE || null, cache: globalThis.caches?.default || null, token: env.GITHUB_TOKEN || ''});

export default {
  async fetch(request, env, ctx) {
    if (!new URL(request.url).pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    return edgeFor(env).handle(request, {waitUntil: promise => ctx.waitUntil(promise)});
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(edgeFor(env).refreshSaved());
  }
};
