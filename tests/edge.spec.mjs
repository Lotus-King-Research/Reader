import {test, expect} from '@playwright/test';
import {mockCatalog, blobSHA, names} from './catalog-fixture.mjs';

// Emulates the same-origin edge API in worker/ (unit-tested in tests/unit/edge.test.mjs).
async function mockEdge(page, fixture, options = {}) {
  const edge = {requests: [], state: options.state || 'live', fail: false, savedAt: '2026-09-30T08:15:00.000Z'};
  await page.route(/\/api\/v1\//, async route => {
    const url = new URL(route.request().url()); edge.requests.push(url.pathname);
    const json = {'x-reader-edge': '1', 'content-type': 'application/json'};
    if (edge.fail) return route.fulfill({status: 503, headers: json, body: '{"error":"GitHub could not be reached and no saved copy exists yet."}'});
    const repo = (url.searchParams.get('repo') || '').split('/')[1], path = url.searchParams.get('path'), text = fixture.files[repo]?.[path];
    if (text === undefined) return route.fulfill({status: 404, headers: json, body: '{"error":"Not in the collection."}'});
    const fetchedAt = edge.state === 'stale' ? edge.savedAt : new Date().toISOString();
    const headers = {'x-reader-edge': '1', 'x-reader-blob-sha': blobSHA(text), 'x-reader-cache': edge.state, 'x-reader-fetched-at': fetchedAt};
    if (url.pathname.endsWith('/meta')) return route.fulfill({headers: {...headers, ...json}, body: JSON.stringify({path, sha: blobSHA(text), size: Buffer.byteLength(text), fetchedAt, cache: edge.state})});
    return route.fulfill({headers: {...headers, 'content-type': 'text/plain; charset=utf-8'}, body: text});
  });
  return edge;
}
async function open(page) {
  await page.goto('/?work=paired-text&file=translation%2Fen.md');
  await expect(page.locator('body')).not.toHaveClass(/loading/);
  await expect(page.locator('#manuscript')).toContainText('English opening paragraph.');
}

test('published texts come through the edge cache without contacting GitHub', async ({page}) => {
  const fixture = await mockCatalog(page), edge = await mockEdge(page, fixture);
  await open(page);
  expect(fixture.requests).toEqual([]);
  expect(edge.requests.filter(path => path.endsWith('/file'))).toHaveLength(2);
  await expect(page.locator('#paired-status')).toBeHidden();
  await expect(page.locator('#stale-badge')).toBeHidden();
  await expect(page.locator('#revision-notice')).toBeHidden();
});

test('a saved copy opens, says it may not be the latest version, and clears once GitHub answers', async ({page}) => {
  const fixture = await mockCatalog(page), edge = await mockEdge(page, fixture, {state: 'stale'});
  await open(page);
  await expect(page.locator('#revision-notice')).toBeVisible();
  await expect(page.locator('#revision-message')).toContainText('saved copy');
  await expect(page.locator('#revision-message')).toContainText('may not be the latest version');
  await expect(page.locator('#revision-load')).toHaveText('Check again');
  await expect(page.locator('#stale-badge')).toBeVisible();
  await expect(page.locator('#stale-badge')).toHaveText('Saved copy');
  await page.locator('#stale-badge').click();
  await expect(page.locator('#toast')).toContainText('may not be the latest version');
  edge.state = 'live';
  await page.locator('#revision-load').click();
  await expect(page.locator('#revision-notice')).toBeHidden();
  await expect(page.locator('#stale-badge')).toBeHidden();
  expect(fixture.requests).toEqual([]);
});

test('the collection card marks a work read from a saved copy', async ({page}) => {
  const fixture = await mockCatalog(page); await mockEdge(page, fixture, {state: 'stale'});
  await open(page);
  await page.goto('/');
  await page.locator('#refresh-catalog').click();
  await expect(page.locator('[data-work="paired-text"] .work-card-status')).toHaveText('Saved copy · may not be the latest');
  await expect(page.locator('#stale-badge')).toBeHidden();
});

test('if the edge cannot serve a text, the reader reads GitHub directly', async ({page}) => {
  const fixture = await mockCatalog(page), edge = await mockEdge(page, fixture);
  edge.fail = true;
  await open(page);
  expect(fixture.requests.some(url => url.startsWith('https://api.github.com/'))).toBe(true);
  await expect(page.locator('#stale-badge')).toBeHidden();
});

test('without the edge, a GitHub rate limit still opens the text from raw files, marked unverified', async ({page}) => {
  const fixture = await mockCatalog(page); fixture.status[names[0]] = 429;
  await open(page);
  expect(fixture.requests.filter(url => url.startsWith('https://raw.githubusercontent.com/'))).toHaveLength(2);
  await expect(page.locator('#paired-status')).toBeHidden();
  await expect(page.locator('#revision-message')).toContainText('has not been checked against its published revision');
  await expect(page.locator('#stale-badge')).toHaveText('Not checked');
  await expect(page.locator('#load-message')).toBeHidden();
});

test('a host without the edge API is detected once and then left alone', async ({page}) => {
  const fixture = await mockCatalog(page), probes = [];
  page.on('request', request => { if (request.url().includes('/api/v1/')) probes.push(request.url()); });
  await open(page);
  const afterOpen = probes.length;
  expect(afterOpen).toBeGreaterThan(0); expect(afterOpen).toBeLessThanOrEqual(2);
  await page.locator('#refresh-catalog').evaluate(button => button.click());
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 300)));
  expect(probes).toHaveLength(afterOpen);
  expect(fixture.requests.some(url => url.startsWith('https://api.github.com/'))).toBe(true);
});
