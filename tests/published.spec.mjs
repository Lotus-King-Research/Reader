import {test, expect} from '@playwright/test';

// The published collection, as configured in public/reader-config.json.
test('the published collection offers its own texts only', async ({page, request}) => {
  const config = await (await request.get('/reader-config.json')).json();
  expect(config.localTexts).toBe(false);
  await page.goto('/?src=https%3A%2F%2Fexample.org%2Ftext.md');
  await expect(page.locator('#published-section')).toBeVisible();
  await expect(page).not.toHaveURL(/src=/);
  await expect(page.locator('#open-welcome')).toBeHidden();
  await page.keyboard.press('l');
  await expect(page.locator('#library-dialog')).not.toHaveAttribute('open', '');
  await page.evaluate(() => {
    const data = new DataTransfer(); data.items.add(new File(['# Dropped\n\nText.'], 'dropped.md', {type: 'text/markdown'}));
    for (const type of ['dragenter', 'dragover', 'drop']) window.dispatchEvent(new DragEvent(type, {dataTransfer: data, bubbles: true, cancelable: true}));
  });
  await expect(page.locator('#drop-overlay')).toBeHidden();
  await expect(page.locator('#manuscript')).toBeHidden();
  await page.click('#settings-trigger');
  expect(await page.locator('#settings-dialog small', {hasText: 'search'}).innerText()).not.toContain('library');
});

test('Dra Thal Gyur and Lhenchig Kyechor are restricted; the others are not', async ({page, request}) => {
  const config = await (await request.get('/reader-config.json')).json();
  const restricted = config.works.filter(work => work.restricted).map(work => work.id).sort();
  expect(restricted).toEqual(['dra-thal-gyur', 'lhenchig-kyechor']);
  // No network is needed to see the marks on the cards.
  await page.route(/github|api\/v1/, route => route.abort());
  await page.goto('/');
  for (const id of restricted) await expect(page.locator(`[data-work="${id}"] .work-card-restricted`)).toHaveText('Restricted');
  await expect(page.locator('[data-work="gongchig-chawa"] .work-card-restricted')).toHaveCount(0);
  await expect(page.locator('.work-card-detail')).toHaveCount(0);
  await expect(page.locator('#collection-search')).toHaveAttribute('placeholder', /^Find a text by its /);
  await expect(page.locator('.collection-filter > span:not(.sr-only)')).toHaveCount(0);
});
