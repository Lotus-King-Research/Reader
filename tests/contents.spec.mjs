import {test, expect} from '@playwright/test';
import {URL_PATH, setup, opened, readAt} from './place-fixture.mjs';

async function openSidebar(page) { if (await page.locator('#mobile-menu').isVisible()) await page.click('#mobile-menu'); }
const chapter = (page, n) => page.locator('#toc .toc-chapter').nth(n - 1);

test('chapters hold their sections and the chapter being read is open', async ({page}) => {
  await setup(page, {sections: true}); await page.goto(URL_PATH); await opened(page);
  await expect(page.locator('#toc .toc-chapter')).toHaveCount(6);
  await readAt(page, 45);
  await openSidebar(page);
  await expect(chapter(page, 3).locator('.toc-sections')).toBeVisible();
  await expect(chapter(page, 1).locator('.toc-sections')).toBeHidden();
  await expect(chapter(page, 3).locator('a[aria-current="location"]')).toHaveText('Section 3.1');
  await expect(chapter(page, 3).locator('.toc-toggle')).toHaveAttribute('aria-expanded', 'true');
  await chapter(page, 1).locator('.toc-toggle').click();
  await expect(chapter(page, 1).locator('.toc-sections')).toBeVisible();
});

test('the current entry stays in view in the contents', async ({page}) => {
  await setup(page, {sections: true}); await page.setViewportSize({width: 1440, height: 520});
  await page.goto(URL_PATH); await opened(page);
  await readAt(page, 115);
  const visible = await page.evaluate(() => {
    const wrap = document.querySelector('.toc-wrap').getBoundingClientRect(), link = document.querySelector('#toc a[aria-current="location"]').getBoundingClientRect();
    return link.top >= wrap.top && link.bottom <= wrap.bottom;
  });
  expect(visible).toBe(true);
});

test('the phone drawer opens at the reader\'s place', async ({page}, info) => {
  test.skip(info.project.name !== 'mobile', 'drawer');
  await setup(page, {sections: true}); await page.goto(URL_PATH); await opened(page);
  await readAt(page, 112);
  await page.click('#mobile-menu');
  await expect.poll(() => page.evaluate(() => {
    const wrap = document.querySelector('.toc-wrap').getBoundingClientRect(), link = document.querySelector('#toc a[aria-current="location"]').getBoundingClientRect();
    return link.top >= wrap.top && link.bottom <= wrap.bottom;
  })).toBe(true);
});

test('the footer names the chapter and section, and the time left in the chapter', async ({page}, info) => {
  await setup(page, {sections: true}); await page.goto(URL_PATH); await opened(page);
  await readAt(page, 55);
  await expect(page.locator('#footer-section')).toHaveText('Chapter 3 · Section 3.2');
  if (info.project.name === 'desktop') await expect(page.locator('#remaining')).toHaveText(/^\d+ min left in chapter · \d+ min in text$/);
});
