import {test, expect} from '@playwright/test';
import {URL_PATH, setup, opened, readAt, id} from './place-fixture.mjs';

const background = page => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test('the palette follows the system until the reader chooses one', async ({page}) => {
  await page.emulateMedia({colorScheme: 'dark'});
  await setup(page); await page.goto(URL_PATH); await opened(page);
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./);
  expect(await background(page)).toBe('rgb(32, 40, 36)');
  await page.emulateMedia({colorScheme: 'light'});
  expect(await background(page)).toBe('rgb(245, 241, 232)');
  await page.click('#settings-trigger');
  await expect(page.locator('.theme-choice[data-theme="auto"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.theme-choice[data-theme="mist"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'mist');
  expect(await page.locator('meta[name="theme-color"]').evaluateAll(metas => metas.map(meta => meta.content))).toEqual(['#edf0ed', '#edf0ed']);
});

test('a chosen palette is applied by the page head, before the reader script runs', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('padma-reader:v1:settings', JSON.stringify({theme: 'ink'})));
  await page.route(/127\.0\.0\.1:\d+\/(\?.*)?$/, async route => {
    // Serve the page with every script after the head removed, leaving only the head's palette line.
    const response = await route.fetch(), html = await response.text();
    const head = html.slice(0, html.indexOf('</head>')), body = html.slice(html.indexOf('</head>')).replace(/<script[\s\S]*?<\/script>/g, '');
    await route.fulfill({response, body: head + body});
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'ink');
});

test('Appearance is a panel beside the page: the page still scrolls and Escape returns focus', async ({page}) => {
  await setup(page); await page.goto(URL_PATH); await opened(page);
  await readAt(page, 20);
  await page.click('#settings-trigger');
  await expect(page.locator('#settings-dialog')).toBeVisible();
  await expect(page.locator('body')).not.toHaveClass(/dialog-open/);
  const before = await page.evaluate(() => scrollY);
  await page.evaluate(() => scrollBy(0, 300));
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(before + 200);
  await page.locator('#font-size').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings-dialog')).toBeHidden();
  await expect(page.locator('#settings-trigger')).toBeFocused();
  await page.click('#settings-trigger'); await page.click('#settings-trigger');
  await expect(page.locator('#settings-dialog')).toBeHidden();
});

test('Tibetan has its own size', async ({page}) => {
  await setup(page); await page.goto(URL_PATH); await opened(page);
  await readAt(page, 6); await page.keyboard.press('t');
  const ratio = () => page.locator(`#md-${id(6).toLowerCase()} .source-passage`).evaluate(el => parseFloat(getComputedStyle(el).fontSize) / parseFloat(getComputedStyle(el.parentElement).fontSize));
  expect(await ratio()).toBeCloseTo(1, 2);
  await page.click('#settings-trigger');
  await page.locator('#tibetan-size').fill('130'); await page.locator('#tibetan-size').dispatchEvent('change');
  await expect(page.locator('#tibetan-value')).toHaveText('130%');
  expect(await ratio()).toBeCloseTo(1.3, 2);
  await page.reload(); await opened(page);
  expect(await ratio()).toBeCloseTo(1.3, 2);
});

test('the empty-collection message never flashes before the collection loads', async ({request}) => {
  const html = await (await request.get('/')).text();
  expect(html).toContain('id="collection-empty" hidden');
});
