import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createEdge, allowlist, parseEndpoint, blobSHA} from '../../worker/edge.js';

const config = {works: [
  {id: 'paired', repository: 'Example/Text', englishUrl: 'https://github.com/Example/Text/blob/main/paired/translation.md', sourceUrl: 'https://raw.githubusercontent.com/Example/Text/main/paired/source.md'},
  {id: 'collection', repository: 'Example/Collection', englishUrl: 'https://github.com/Example/Collection/tree/main/translation', sourceUrl: 'https://github.com/Example/Collection/tree/main/source'}
]};
const gitSHA = text => { const bytes = Buffer.from(text); return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'); };

function upstreamFake() {
  const state = {files: {'Example/Text/main/paired/translation.md': '# English\n\nPassage.', 'Example/Text/main/paired/source.md': '# བོད་ཡིག\n\nཚིག'},
    trees: {'Example/Collection': [{type: 'blob', mode: '100644', path: 'translation/one.md', sha: gitSHA('One'), size: 3}, {type: 'blob', mode: '100644', path: 'translation/image.png', sha: gitSHA('x'), size: 1}, {type: 'tree', path: 'translation/nested'}]},
    down: false, status: 0, calls: [], headers: []};
  state.fetch = async (url, init) => {
    state.calls.push(url); state.headers.push(init?.headers || {});
    if (state.down) throw new TypeError('network down');
    if (state.status) return new Response('{"message":"limited"}', {status: state.status});
    const parsed = new URL(url);
    if (parsed.hostname === 'raw.githubusercontent.com') {
      const key = parsed.pathname.slice(1).split('/').map(decodeURIComponent).join('/'), text = state.files[key];
      return text === undefined ? new Response('404: Not Found', {status: 404}) : new Response(text);
    }
    const repo = parsed.pathname.split('/').slice(2, 4).join('/');
    return new Response(JSON.stringify({tree: state.trees[repo] || [], truncated: false}), {headers: {'content-type': 'application/json'}});
  };
  return state;
}
function kvFake() {
  const store = new Map(), writes = [];
  return {store, writes,
    async get(key, options) { const item = store.get(key); if (!item) return null; return options?.type === 'json' ? JSON.parse(new TextDecoder().decode(item.value)) : item.value; },
    async getWithMetadata(key) { const item = store.get(key); return item ? {value: item.value.buffer.slice(item.value.byteOffset, item.value.byteOffset + item.value.byteLength), metadata: item.metadata ?? null} : {value: null, metadata: null}; },
    async put(key, value, options) { writes.push(key); store.set(key, {value: typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value), metadata: options?.metadata}); }};
}
function cacheFake() {
  const store = new Map();
  return {store, async match(request) { const hit = store.get(request.url); return hit ? hit.clone() : undefined; }, async put(request, response) { store.set(request.url, response.clone()); }};
}
function setup({kv = kvFake(), cache = cacheFake(), token = '', clock = {t: Date.UTC(2026, 9, 1, 12)}} = {}) {
  const upstream = upstreamFake();
  const edge = createEdge({config, fetch: upstream.fetch, kv, cache, token, now: () => clock.t});
  const pending = [];
  const call = async (path, init = {}) => {
    const response = await edge.handle(new Request('https://reader.example' + path, init), {waitUntil: promise => pending.push(promise)});
    await Promise.all(pending.splice(0));
    return response;
  };
  return {edge, upstream, kv, cache, clock, call};
}
const fileURL = (path, repo = 'Example/Text') => `/api/v1/file?repo=${encodeURIComponent(repo)}&ref=main&path=${encodeURIComponent(path)}`;
const metaURL = path => fileURL(path).replace('/file?', '/meta?');

test('configured URLs become an allowlist of files and directories', () => {
  assert.deepEqual(parseEndpoint('https://github.com/Example/Text/blob/main/paired/translation.md'), {kind: 'file', owner: 'Example', repo: 'Text', ref: 'main', path: 'paired/translation.md'});
  assert.equal(parseEndpoint('https://example.org/text.md'), null);
  const list = allowlist(config);
  assert.ok(list.file('example', 'text', 'main', 'paired/source.md'), 'owner and repository match case-insensitively');
  assert.equal(list.file('Example', 'Text', 'main', 'paired/other.md'), null);
  assert.equal(list.file('Example', 'Text', 'dev', 'paired/translation.md'), null);
  assert.equal(list.file('Example', 'Text', 'main', 'paired/../secret.md'), null);
  assert.ok(list.file('Example', 'Collection', 'main', 'translation/nested/two.md'));
  assert.equal(list.file('Example', 'Collection', 'main', 'translation/image.png'), null);
  assert.ok(list.tree('Example', 'Collection', 'main', 'translation'));
  assert.equal(list.tree('Example', 'Collection', 'main', 'other'), null);
});

test('a configured file is served with its revision, then from the edge cache', async () => {
  const {call, upstream} = setup();
  const first = await call(fileURL('paired/translation.md'));
  assert.equal(first.status, 200);
  assert.equal(await first.text(), '# English\n\nPassage.');
  assert.equal(first.headers.get('x-reader-edge'), '1');
  assert.equal(first.headers.get('x-reader-blob-sha'), gitSHA('# English\n\nPassage.'));
  assert.equal(first.headers.get('x-reader-cache'), 'live');
  assert.equal(first.headers.get('etag'), `"${gitSHA('# English\n\nPassage.')}"`);
  assert.equal(first.headers.get('cache-control'), 'no-cache');
  const second = await call(fileURL('paired/translation.md'));
  assert.equal(await second.text(), '# English\n\nPassage.');
  assert.equal(upstream.calls.length, 1, 'the second request did not reach GitHub');
  assert.match(upstream.calls[0], /^https:\/\/raw\.githubusercontent\.com\/Example\/Text\/main\/paired\/translation\.md$/);
  assert.match(upstream.headers[0]['User-Agent'], /padma-reader/);
});

test('an unchanged revision answers a conditional request with 304', async () => {
  const {call} = setup();
  const sha = gitSHA('# English\n\nPassage.');
  const response = await call(fileURL('paired/translation.md'), {headers: {'If-None-Match': `"${sha}"`}});
  assert.equal(response.status, 304);
  assert.equal(response.headers.get('x-reader-blob-sha'), sha);
});

test('metadata reports the revision without the body', async () => {
  const {call} = setup();
  const meta = await (await call(metaURL('paired/source.md'))).json();
  assert.equal(meta.sha, gitSHA('# བོད་ཡིག\n\nཚིག'));
  assert.equal(meta.size, Buffer.byteLength('# བོད་ཡིག\n\nཚིག'));
  assert.equal(meta.cache, 'live');
});

test('when GitHub fails, the saved copy is served and marked stale', async () => {
  const {call, upstream, cache, clock} = setup();
  await call(fileURL('paired/translation.md'));
  const savedAt = new Date(clock.t).toISOString();
  cache.store.clear(); upstream.down = true; clock.t += 3600000;
  const response = await call(fileURL('paired/translation.md'));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '# English\n\nPassage.');
  assert.equal(response.headers.get('x-reader-cache'), 'stale');
  assert.equal(response.headers.get('x-reader-upstream'), 'unreachable');
  assert.equal(response.headers.get('x-reader-fetched-at'), savedAt);
  upstream.down = false; upstream.status = 429; cache.store.clear();
  const meta = await (await call(metaURL('paired/translation.md'))).json();
  assert.equal(meta.cache, 'stale'); assert.equal(meta.upstream, '429');
});

test('without a saved copy an outage is reported, not hidden', async () => {
  const {call, upstream} = setup();
  upstream.down = true;
  const response = await call(fileURL('paired/translation.md'));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('x-reader-edge'), '1');
});

test('a damaged saved copy is never served', async () => {
  const {call, upstream, kv, cache} = setup();
  await call(fileURL('paired/translation.md'));
  const key = [...kv.store.keys()].find(key => key.startsWith('body:'));
  kv.store.get(key).value = new TextEncoder().encode('# Tampered');
  cache.store.clear(); upstream.down = true;
  assert.equal((await call(fileURL('paired/translation.md'))).status, 503);
});

test('the saved copy is rewritten only when the text changes or its confirmation is old', async () => {
  const {call, upstream, kv, cache, clock} = setup();
  await call(fileURL('paired/translation.md'));
  assert.equal(kv.writes.length, 2);
  cache.store.clear(); clock.t += 60000; await call(fileURL('paired/translation.md'));
  assert.equal(kv.writes.length, 2, 'an unchanged revision within six hours is not rewritten');
  upstream.files['Example/Text/main/paired/translation.md'] += '\n\nA correction.';
  cache.store.clear(); await call(fileURL('paired/translation.md'));
  assert.equal(kv.writes.length, 4);
  cache.store.clear(); clock.t += 7 * 3600000; await call(fileURL('paired/translation.md'));
  assert.equal(kv.writes.length, 6, 'an unchanged copy re-records that it is current every six hours');
});

test('requests outside the collection never reach GitHub', async () => {
  const {call, upstream} = setup();
  for (const path of [fileURL('paired/private.md'), fileURL('paired/translation.md', 'Other/Repo'), fileURL('../etc/passwd'), '/api/v1/unknown', '/api/v1/file']) {
    const response = await call(path);
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.get('x-reader-edge'), '1');
  }
  assert.equal((await call(fileURL('paired/translation.md'), {method: 'POST'})).status, 405);
  assert.equal(upstream.calls.length, 0);
});

test('directory listings include only text files and use a configured token', async () => {
  const {call, upstream} = setup({token: 'secret-token'});
  const listing = await (await call('/api/v1/tree?repo=Example%2FCollection&ref=main&path=translation')).json();
  assert.deepEqual(listing.files.map(file => file.path), ['translation/one.md']);
  assert.equal(listing.cache, 'live');
  assert.equal(upstream.headers[0].Authorization, 'Bearer secret-token');
});

test('the scheduled refresh keeps saved copies of every configured file', async () => {
  const kv = kvFake(), {edge, upstream} = setup({kv});
  upstream.files['Example/Collection/main/translation/one.md'] = 'One';
  const results = await edge.refreshSaved();
  assert.ok(results.every(Boolean), JSON.stringify(results));
  const saved = [...kv.store.keys()].filter(key => key.startsWith('body:file:'));
  assert.deepEqual(saved.sort(), ['body:file:example/collection@main:translation/one.md', 'body:file:example/text@main:paired/source.md', 'body:file:example/text@main:paired/translation.md']);
  const {metadata} = await kv.getWithMetadata('body:file:example/text@main:paired/source.md');
  assert.equal(metadata.sha, await blobSHA(new TextEncoder().encode('# བོད་ཡིག\n\nཚིག')));
});

test('oversized files are refused', async () => {
  const {call, upstream} = setup();
  upstream.files['Example/Text/main/paired/translation.md'] = 'x'.repeat(4 * 1024 * 1024 + 1);
  assert.equal((await call(fileURL('paired/translation.md'))).status, 413);
});

test('word counts are served without the text and counted once per revision', async () => {
  const {call, upstream, kv, cache} = setup();
  const url = fileURL('paired/translation.md').replace('/file?', '/words?');
  const first = await (await call(url)).json();
  assert.equal(first.words, 2, '"# English" and "Passage." are two words');
  assert.equal(first.sha, gitSHA('# English\n\nPassage.'));
  assert.equal(first.text, undefined);
  const writes = kv.writes.filter(key => key.startsWith('words:')).length;
  assert.equal(writes, 1);
  cache.store.clear(); upstream.down = true;
  const stale = await (await call(url)).json();
  assert.equal(stale.words, 2); assert.equal(stale.cache, 'stale');
  assert.equal(kv.writes.filter(key => key.startsWith('words:')).length, writes, 'an unchanged revision is not recounted into storage');
});

test('word counts are only given for files in the collection', async () => {
  const {call, upstream} = setup();
  const response = await call('/api/v1/words?repo=Example%2FText&ref=main&path=paired%2Fprivate.md');
  assert.equal(response.status, 404);
  assert.equal(upstream.calls.length, 0);
});
