/* Edge cache for the configured manuscripts.
   Readers never call GitHub directly. Files come from the Cloudflare edge cache,
   which asks GitHub at most once a minute per location, so GitHub's request
   limits are never reached by readers. Every verified copy is also kept in
   Workers KV; if GitHub cannot be reached, that saved copy is served and marked
   stale so the reader can say it may not be the latest version.
   Nothing about readers is logged or stored. */

const LIMIT = 4 * 1024 * 1024, TREE_LIMIT = 16 * 1024 * 1024;
const FRESH_SECONDS = 60, STALE_SECONDS = 30, TIMEOUT = 10000, MAX_TREE_FILES = 500;
const CONFIRM_MS = 6 * 60 * 60 * 1000; // How often an unchanged saved copy re-records that it is current.
const USER_AGENT = 'padma-reader-edge (+https://reader.padma.io)';
const textFile = path => /\.(?:md|markdown|txt)$/i.test(path);
const safePath = path => typeof path === 'string' && !!path && path.length < 1024 && !path.startsWith('/') && !/[\\\u0000-\u001f]/.test(path) && path.split('/').every(part => part && part !== '.' && part !== '..');
const name = /^[\w.-]+$/;
const encoded = path => path.split('/').map(encodeURIComponent).join('/');
const hex = buffer => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');

export async function blobSHA(bytes) {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`), blob = new Uint8Array(header.length + bytes.length);
  blob.set(header); blob.set(bytes, header.length);
  return hex(await crypto.subtle.digest('SHA-1', blob));
}

// GitHub blob/tree/raw URLs from reader-config.json, normalised to {kind, owner, repo, ref, path}.
export function parseEndpoint(input) {
  let url; try { url = new URL(input); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase(), raw = host === 'raw.githubusercontent.com';
  if (!raw && host !== 'github.com') return null;
  let parts; try { parts = url.pathname.slice(1).split('/').map(decodeURIComponent); } catch { return null; }
  const [owner, repo] = parts, mode = raw ? 'blob' : parts[2], ref = parts[raw ? 2 : 3], path = parts.slice(raw ? 3 : 4).join('/');
  if (!name.test(owner || '') || !name.test(repo || '') || !['blob', 'tree'].includes(mode) || !ref || !safePath(path)) return null;
  if (mode === 'blob' && !textFile(path)) return null;
  return {kind: mode === 'tree' ? 'directory' : 'file', owner, repo, ref, path};
}

export function allowlist(config) {
  const files = new Map(), directories = new Map();
  const repoKey = (owner, repo, ref) => `${owner.toLowerCase()}/${repo.toLowerCase()}@${ref}`;
  for (const work of Array.isArray(config?.works) ? config.works : []) {
    for (const url of [work?.englishUrl, work?.sourceUrl]) {
      const endpoint = parseEndpoint(url);
      if (!endpoint) continue;
      (endpoint.kind === 'file' ? files : directories).set(`${repoKey(endpoint.owner, endpoint.repo, endpoint.ref)}:${endpoint.path}`, endpoint);
    }
  }
  return {
    files: [...files.values()], directories: [...directories.values()],
    // A configured file, or a text file inside a configured directory.
    file(owner, repo, ref, path) {
      if (!name.test(owner) || !name.test(repo) || !ref || !safePath(path) || !textFile(path)) return null;
      const key = repoKey(owner, repo, ref);
      const exact = files.get(`${key}:${path}`);
      if (exact) return exact;
      for (const directory of directories.values()) {
        if (repoKey(directory.owner, directory.repo, directory.ref) === key && path.startsWith(directory.path + '/')) return {...directory, kind: 'file', path};
      }
      return null;
    },
    tree(owner, repo, ref, path) {
      if (!name.test(owner) || !name.test(repo) || !ref || !safePath(path)) return null;
      return directories.get(`${repoKey(owner, repo, ref)}:${path}`) || null;
    }
  };
}

const rawURL = target => `https://raw.githubusercontent.com/${target.owner}/${target.repo}/${encodeURIComponent(target.ref)}/${encoded(target.path)}`;
const treeURL = target => `https://api.github.com/repos/${target.owner}/${target.repo}/git/trees/${encodeURIComponent(target.ref)}?recursive=1`;
const storageKey = (kind, target) => `${kind}:${target.owner.toLowerCase()}/${target.repo.toLowerCase()}@${target.ref}:${target.path}`;

class UpstreamError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export function createEdge({config, fetch: fetcher = globalThis.fetch, kv = null, cache = null, token = '', now = () => Date.now()}) {
  const allowed = allowlist(config);

  async function upstream(url, limit, headers = {}) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), TIMEOUT);
    try {
      const response = await fetcher(url, {headers: {'User-Agent': USER_AGENT, ...headers}, signal: controller.signal, cache: 'no-store', redirect: 'follow'});
      if (!response.ok) throw new UpstreamError(`GitHub returned HTTP ${response.status}.`, response.status);
      if (Number(response.headers.get('content-length')) > limit) throw new UpstreamError('The file exceeds the reader’s size limit.', 413);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > limit) throw new UpstreamError('The file exceeds the reader’s size limit.', 413);
      return bytes;
    } catch (error) {
      if (error instanceof UpstreamError) throw error;
      throw new UpstreamError(controller.signal.aborted ? 'GitHub did not respond in time.' : 'GitHub could not be reached.', 0);
    } finally { clearTimeout(timer); }
  }

  // The saved copy: the body, with its revision and the last time it was confirmed current.
  async function save(key, bytes, info) {
    if (!kv) return;
    const previous = await kv.get('meta:' + key, {type: 'json'}).catch(() => null);
    const time = now();
    if (previous?.sha === info.sha && time - (previous.confirmedAt || 0) < CONFIRM_MS) return;
    const record = {sha: info.sha, size: bytes.length, savedAt: previous?.sha === info.sha ? previous.savedAt : time, confirmedAt: time};
    await kv.put('body:' + key, bytes, {metadata: record});
    await kv.put('meta:' + key, JSON.stringify(record));
  }
  async function saved(key) {
    if (!kv) return null;
    const {value, metadata} = await kv.getWithMetadata('body:' + key, {type: 'arrayBuffer'}).catch(() => ({value: null, metadata: null}));
    if (!value || !metadata) return null;
    const bytes = new Uint8Array(value);
    // Never serve a damaged copy: it must still match the revision it was saved as.
    if (await blobSHA(bytes) !== metadata.sha) return null;
    return {bytes, sha: metadata.sha, size: bytes.length, confirmedAt: metadata.confirmedAt};
  }

  async function cached(cacheKey) {
    if (!cache || !cacheKey) return null;
    const response = await cache.match(cacheKey).catch(() => null);
    if (!response) return null;
    return {bytes: new Uint8Array(await response.arrayBuffer()), sha: response.headers.get('x-reader-blob-sha'),
      fetchedAt: Number(response.headers.get('x-reader-fetched-at')), state: response.headers.get('x-reader-cache'), upstream: response.headers.get('x-reader-upstream') || ''};
  }
  function remember(cacheKey, record, seconds, waitUntil) {
    if (!cache || !cacheKey) return;
    const headers = {'Cache-Control': `public, max-age=${seconds}`, 'x-reader-blob-sha': record.sha, 'x-reader-fetched-at': String(record.fetchedAt), 'x-reader-cache': record.state};
    if (record.upstream) headers['x-reader-upstream'] = record.upstream;
    waitUntil(cache.put(cacheKey, new Response(record.bytes, {headers})).catch(() => {}));
  }

  // One file: edge cache, then GitHub, then the saved copy.
  async function file(target, {cacheKey = null, waitUntil = promise => promise, bypass = false} = {}) {
    if (!bypass) { const hit = await cached(cacheKey); if (hit) return hit; }
    const key = storageKey('file', target);
    try {
      const bytes = await upstream(rawURL(target), LIMIT);
      const record = {bytes, sha: await blobSHA(bytes), fetchedAt: now(), state: 'live', upstream: ''};
      waitUntil(save(key, bytes, record).catch(() => {}));
      remember(cacheKey, record, FRESH_SECONDS, waitUntil);
      return record;
    } catch (error) {
      const copy = await saved(key);
      if (!copy) throw error;
      const record = {bytes: copy.bytes, sha: copy.sha, fetchedAt: copy.confirmedAt, state: 'stale', upstream: String(error.status || 'unreachable')};
      remember(cacheKey, record, STALE_SECONDS, waitUntil);
      return record;
    }
  }

  // A configured directory listing, from GitHub's tree API (with a token when one is configured).
  async function tree(target, {cacheKey = null, waitUntil = promise => promise, bypass = false} = {}) {
    if (!bypass) { const hit = await cached(cacheKey); if (hit) return {...hit, files: JSON.parse(new TextDecoder().decode(hit.bytes))}; }
    const key = storageKey('tree', target);
    try {
      const headers = {Accept: 'application/vnd.github+json'};
      if (token) headers.Authorization = `Bearer ${token}`;
      const listing = JSON.parse(new TextDecoder().decode(await upstream(treeURL(target), TREE_LIMIT, headers)));
      if (!Array.isArray(listing.tree) || listing.truncated !== false) throw new UpstreamError('The repository listing is incomplete.', 502);
      const files = listing.tree.filter(entry => entry?.type === 'blob' && (!entry.mode || ['100644', '100755'].includes(entry.mode)) && safePath(entry.path) && entry.path.startsWith(target.path + '/') && textFile(entry.path) && /^[a-f0-9]{40}$/.test(entry.sha) && Number.isSafeInteger(entry.size))
        .slice(0, MAX_TREE_FILES).map(entry => ({path: entry.path, sha: entry.sha, size: entry.size}));
      const bytes = new TextEncoder().encode(JSON.stringify(files));
      const record = {bytes, sha: await blobSHA(bytes), fetchedAt: now(), state: 'live', upstream: '', files};
      waitUntil(save(key, bytes, record).catch(() => {}));
      remember(cacheKey, record, FRESH_SECONDS, waitUntil);
      return record;
    } catch (error) {
      const copy = await saved(key);
      if (!copy) throw error;
      const record = {bytes: copy.bytes, sha: copy.sha, fetchedAt: copy.confirmedAt, state: 'stale', upstream: String(error.status || 'unreachable'), files: JSON.parse(new TextDecoder().decode(copy.bytes))};
      remember(cacheKey, record, STALE_SECONDS, waitUntil);
      return record;
    }
  }

  const baseHeaders = () => ({
    'X-Reader-Edge': '1', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'Cross-Origin-Resource-Policy': 'same-origin'
  });
  const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {status, headers: {...baseHeaders(), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra}});
  const describe = record => {
    const headers = {'X-Reader-Blob-Sha': record.sha, 'X-Reader-Size': String(record.bytes.length), 'X-Reader-Fetched-At': new Date(record.fetchedAt).toISOString(), 'X-Reader-Cache': record.state};
    if (record.upstream) headers['X-Reader-Upstream'] = record.upstream;
    return headers;
  };

  async function handle(request, {waitUntil = promise => promise} = {}) {
    const url = new URL(request.url);
    if (!['GET', 'HEAD'].includes(request.method)) return json({error: 'Only GET and HEAD are supported.'}, 405, {Allow: 'GET, HEAD'});
    const route = url.pathname.replace(/^\/api\/v1\//, '');
    if (!['file', 'meta', 'tree'].includes(route)) return json({error: 'Unknown reader API route.'}, 404);
    const [owner = '', repo = ''] = (url.searchParams.get('repo') || '').split('/');
    const ref = url.searchParams.get('ref') || '', path = url.searchParams.get('path') || '';
    const target = route === 'tree' ? allowed.tree(owner, repo, ref, path) : allowed.file(owner, repo, ref, path);
    if (!target) return json({error: 'This text is not in the configured collection.'}, 404);
    const cacheKey = cache ? new Request(new URL(`/api/v1/__cache/${route === 'tree' ? 'tree' : 'file'}?${new URLSearchParams({k: storageKey(route === 'tree' ? 'tree' : 'file', target)})}`, url)) : null;
    try {
      if (route === 'tree') {
        const record = await tree(target, {cacheKey, waitUntil});
        return json({path: target.path, files: record.files, fetchedAt: new Date(record.fetchedAt).toISOString(), cache: record.state, upstream: record.upstream || undefined});
      }
      const record = await file(target, {cacheKey, waitUntil});
      if (route === 'meta') return json({path: target.path, sha: record.sha, size: record.bytes.length, fetchedAt: new Date(record.fetchedAt).toISOString(), cache: record.state, upstream: record.upstream || undefined});
      const etag = `"${record.sha}"`, headers = {...baseHeaders(), ...describe(record), ETag: etag, 'Cache-Control': 'no-cache', 'Content-Type': 'text/plain; charset=utf-8'};
      if ((request.headers.get('If-None-Match') || '').split(',').map(tag => tag.trim().replace(/^W\//, '')).includes(etag)) return new Response(null, {status: 304, headers});
      return new Response(request.method === 'HEAD' ? null : record.bytes, {headers});
    } catch (error) {
      const status = error.status === 404 ? 404 : error.status === 413 ? 413 : 503;
      return json({error: status === 404 ? 'The configured text was not found on GitHub.' : status === 413 ? error.message : 'GitHub could not be reached and no saved copy exists yet.'}, status);
    }
  }

  // Scheduled: keep the saved copies current even when nobody is reading.
  async function refreshSaved() {
    const results = [], pending = [], waitUntil = promise => { pending.push(promise); };
    for (const target of allowed.files) results.push(await file(target, {bypass: true, waitUntil}).then(() => true, () => false));
    for (const directory of allowed.directories) {
      const listing = await tree(directory, {bypass: true, waitUntil}).catch(() => null);
      results.push(!!listing);
      for (const entry of listing?.files || []) results.push(await file({...directory, kind: 'file', path: entry.path}, {bypass: true, waitUntil}).then(() => true, () => false));
    }
    await Promise.all(pending);
    return results;
  }

  return {handle, refreshSaved, allowed};
}
