import {test, expect} from '@playwright/test';
import {URL_PATH, setup, opened} from './place-fixture.mjs';

test('the page introduces itself to search engines and link previews', async ({page, request}) => {
  const violations = [];
  page.on('console', message => { if (/Content Security Policy/i.test(message.text())) violations.push(message.text()); });
  await page.goto('/');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /^Wisdom texts in English and in their Tibetan sources/);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', 'https://reader.padma.io/og.png');
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  const manifest = await (await request.get('/site.webmanifest')).json();
  expect(manifest.name).toBe('Reader');
  for (const icon of manifest.icons) expect((await request.get(icon.src)).ok(), icon.src).toBe(true);
  for (const path of ['/icon.svg', '/apple-touch-icon.png', '/og.png']) expect((await request.get(path)).ok(), path).toBe(true);
  expect(await (await request.get('/robots.txt')).text()).toContain('Sitemap: https://reader.padma.io/sitemap.xml');
  expect(await (await request.get('/sitemap.xml')).text()).toContain('<loc>https://reader.padma.io/?work=dra-thal-gyur</loc>');
  await page.waitForTimeout(300);
  expect(violations).toEqual([]);
});

test('an open work describes itself, and the collection returns the site description', async ({page}) => {
  await setup(page); await page.goto(URL_PATH); await opened(page);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /^Place specimen/);
  await page.goto('/');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /^Wisdom texts/);
});
