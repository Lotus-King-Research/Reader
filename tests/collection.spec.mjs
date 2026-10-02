import {mockCatalog} from './catalog-fixture.mjs';
let fixture;
import {test, expect} from '@playwright/test';
const textA = '---\nwork_title: The Book of Patterns\nchinese_title: 天地之理\nauthor: Example author\ntranslator: Example translator\nedition: Study edition\n---\n# First scroll\n\nSynthetic interface fixture, not a translation.\n\n## Opening\n\nRoot text. Lie Yukou says: “What has form is born from what has no form.”\n\n## Continuation\n\n' + 'A paragraph for testing the reading position.\n\n'.repeat(45);
async function load(page, text=textA, name='alpha.md') {
  await page.setInputFiles('#file-input',{name,mimeType:'text/markdown',buffer:Buffer.from(text)});
  await expect(page.locator('#manuscript')).toBeVisible();
  await expect(page.locator('#title-content h1')).toHaveText(text.match(/^#\s+(.+)$/m)[1]);
  await expect(page.locator('body')).not.toHaveClass(/loading/);
}
async function sidebar(page) {
  if (await page.locator('#mobile-menu').isVisible() && await page.locator('#mobile-menu').getAttribute('aria-expanded') !== 'true') {
    const box = await page.locator('#mobile-menu').boundingBox();
    await page.mouse.click(box.x + box.width / 2,box.y + box.height / 2);
  }
}
async function home(page) {
  await sidebar(page); await page.click('#collection-link');
  await expect(page.locator('#welcome')).toBeVisible();
}
test.beforeEach(async ({page}) => { fixture = await mockCatalog(page); await page.goto('/'); });
test('the collection keeps generic branding and exposes two public works', async ({page}) => {
  await expect(page).toHaveTitle('Reader · Collection');
  await expect(page.locator('.identity-title')).toHaveText('Reader');
  await expect(page.locator('#published-work-list button')).toHaveCount(2);
  await expect(page.locator('#session-section')).toBeHidden();
  await expect(page.locator('#book-header')).toBeHidden();
  await expect(page.locator('#reading-room-link, .collection-hero, #import-side')).toHaveCount(0);
  await expect(page.locator('#toc li')).toHaveCount(0);
  await expect(page.locator('.toc-wrap')).toBeHidden();
  await expect(page.locator('.sidebar-bottom #open-welcome')).toHaveText('Open your own text');
  await expect(page.locator('.sidebar-bottom #demo-button')).toHaveCount(0);
  await expect(page.locator('#settings-dialog #demo-button')).toHaveText('See the typography specimen');
  await sidebar(page); await page.click('#open-welcome');
  await expect(page.locator('#library-list button')).toHaveCount(0);
  await expect(page.locator('#refresh-library')).toBeHidden();
});
test('each work supplies its own identity and missing metadata stays neutral', async ({page}) => {
  await load(page);
  await expect(page.locator('.identity-title')).toHaveText('Reader');
  await expect(page.locator('#title-content')).toContainText('The Book of Patterns');
  await expect(page.locator('#edition-han')).toHaveText('天地之理');
  await expect(page.locator('#edition-label')).toHaveText('Study edition');
  await expect(page.locator('.work-credit')).toContainText('Example translator');
  await expect(page).toHaveTitle('First scroll · Reader');
  await load(page,'# A different work\n\nAnother synthetic specimen.','beta.md');
  await expect(page).toHaveTitle('A different work · Reader');
  await expect(page.locator('#edition-label')).toHaveText('The text');
  await expect(page.locator('#book-header')).not.toContainText(/Patterns|Example|天地之理|Sanming/);
});
test('session cards are distinct from the two published works', async ({page}) => {
  await load(page); await load(page,'# A second work\n\nA synthetic specimen.','beta.md');
  await home(page);
  await expect(page.locator('#session-work-list .work-card')).toHaveCount(2);
  await expect(page.locator('#published-work-list .work-card')).toHaveCount(2);
  await expect(page.locator('#collection-empty')).toBeHidden();
  await page.locator('#session-work-list .work-card').filter({hasText:'The Book of Patterns'}).click();
  await expect(page.locator('#title-content h1')).toHaveText('First scroll');
});
test('returning from the collection preserves the in-session position', async ({page}) => {
  await load(page); await page.evaluate(() => window.scrollTo(0,1000));
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(900);
  const before = await page.evaluate(() => scrollY);
  await home(page); await page.locator('#session-work-list .work-card').filter({hasText:'The Book of Patterns'}).click();
  await expect(page.locator('#manuscript')).toBeVisible();
  await expect.poll(async () => Math.abs(await page.evaluate(() => scrollY) - before)).toBeLessThan(12);
});
test('browser back and forward distinguish local reading from collection', async ({page}) => {
  await load(page); await home(page); await page.goBack();
  await expect(page.locator('#manuscript')).toBeVisible();
  await expect(page.locator('#title-content h1')).toHaveText('First scroll');
  await page.goForward(); await expect(page.locator('#welcome')).toBeVisible();
  await expect(page).toHaveTitle('Reader · Collection');
});
test('local manuscripts are not saved across reloads', async ({page}) => {
  await load(page,'# Private specimen\n\nUNIQUE_BODY_NOT_FOR_STORAGE');
  const saved = await page.evaluate(() => Object.values(localStorage).join(' '));
  expect(saved).not.toContain('UNIQUE_BODY_NOT_FOR_STORAGE');
  await page.reload(); await expect(page.locator('#welcome')).toBeVisible();
  await expect(page.locator('#session-section')).toBeHidden();
  await expect(page.locator('#manuscript')).toBeEmpty();
});
test('collection and long work titles fit phone through desktop layouts', async ({page}, info) => {
  for (const width of [320,390,768,1024,1440]) {
    await page.setViewportSize({width,height:900});
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  }
  await page.screenshot({path:info.outputPath('collection-desktop.png'),animations:'disabled',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:info.outputPath('collection-mobile.png'),animations:'disabled',fullPage:true});
  await load(page,'# '+ 'A long work title '.repeat(12) +'\n\nA synthetic specimen.');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
});
test('Chinese-only headings provide their own reading-room title', async ({page}) => {
  await load(page,'# 天地之理\n\nThis is a synthetic interface specimen.');
  await expect(page.locator('#title-content h1')).toHaveAttribute('lang','zh');
  await expect(page).toHaveTitle('天地之理 · Reader');
});
test('book metadata is displayed as text, not executable markup', async ({page}) => {
  await load(page,'---\nwork_title: <img src=x onerror=alert(1)>\nauthor: <script>bad()</script>\n---\n# Safe title\n\nFixture.');
  await expect(page.locator('#title-content img, #title-content script')).toHaveCount(0);
  await expect(page.locator('#title-content')).toContainText('<img src=x');
});
test('appearance changes at home apply on returning to the text', async ({page}) => {
  await load(page); await home(page); await page.click('#settings-trigger');
  await page.uncheck('#auto-citations'); await page.press('#auto-citations','Escape');
  await expect(page.locator('#welcome')).toBeVisible(); await page.locator('#session-work-list .work-card').filter({hasText:'The Book of Patterns'}).click();
  await expect(page.locator('#manuscript .citation-block')).toHaveCount(0);
  await expect(page.locator('#title-content h1')).toHaveText('First scroll');
});
test('same-site deep links do not require a default repository', async ({page}) => {
  await page.route('**/texts/example.md',route => route.fulfill({contentType:'text/markdown',body:'# A published work\n\nFixture.'}));
  await page.goto('/?file=texts/example.md');
  await expect(page.locator('#title-content h1')).toHaveText('A published work');
  await home(page); await expect(page).toHaveTitle('Reader · Collection');
  await expect(page.locator('#welcome')).toBeVisible();
});
test('home cancels a pending manuscript instead of reopening it later', async ({page}) => {
  await load(page);
  let release; const pending = new Promise(resolve => { release = resolve; });
  await page.route('https://example.org/slow.md',async route => {
    await pending;
    await route.fulfill({contentType:'text/markdown',body:'# Late text'}).catch(()=>{});
  });
  await page.keyboard.press('l'); await page.fill('#url-input','https://example.org/slow.md'); await page.click('#url-submit');
  await expect(page.locator('body')).toHaveClass(/loading/); await home(page);
  release(); await page.waitForTimeout(100);
  await expect(page.locator('#welcome')).toBeVisible();
  await expect(page.locator('#session-work-list')).toContainText('First scroll');
});

test('a file work opens the reader directly from its collection card', async ({page}) => {
  await expect(page.locator('#published-work-list [data-work="paired-text"]')).toContainText('Read');
  expect(fixture.requests.some(url => url.includes('raw.githubusercontent.com'))).toBe(false);
  await page.locator('#published-work-list [data-work="paired-text"]').click();
  await expect(page.locator('#manuscript')).toBeVisible();
  await expect(page.locator('#manuscript')).toContainText('English opening paragraph.');
  await expect(page.locator('#welcome')).toBeHidden();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page).toHaveURL(/work=paired-text/);
  await expect(page.locator('#language-toggle, .section-language-toggle')).toHaveCount(0);
});

test('the collection edition chooser opens the selected file without an intermediate dialog', async ({page}) => {
  const edition = page.locator('select[data-editions="collected-texts"]');
  await expect(edition).toHaveCount(0);
  await page.locator('#published-work-list [data-work="collected-texts"]').click();
  await expect(edition).toBeVisible();
  await expect(page.locator('#welcome')).toBeVisible();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(edition).toHaveAttribute('aria-label','Edition of Example collection');
  await edition.selectOption('translation/nested/chapter-2.txt');
  await expect(page.locator('#manuscript')).toBeVisible();
  await expect(page.locator('#manuscript')).toContainText('A plain text chapter.');
  await expect(page).toHaveURL(/file=translation%2Fnested%2Fchapter-2\.txt/);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});

test('opening a work exposes loading progress and arrives in the reader after completion', async ({page}) => {
  await expect(page.locator('#published-work-list [data-work="paired-text"]')).toContainText('Read');
  let release;
  fixture.listingWait = new Promise(resolve => {release = resolve;});
  await page.locator('#published-work-list [data-work="paired-text"]').click();
  await expect(page.locator('#loading-panel')).toBeVisible();
  await expect(page.locator('#loading-progress')).toHaveAttribute('role','progressbar');
  const value = Number(await page.locator('#loading-progress').getAttribute('aria-valuenow'));
  expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThan(100);
  await expect(page.locator('#manuscript')).toBeHidden();
  release();
  await expect(page.locator('#manuscript')).toBeVisible();
  await expect(page.locator('#manuscript')).toContainText('English opening paragraph.');
  await expect(page.locator('#loading-panel')).toBeHidden();
  await expect(page.locator('#loading-progress')).toHaveAttribute('aria-valuenow','100');
  await expect(page.locator('body')).not.toHaveClass(/loading/);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});

test('the typography specimen opens from Appearance without a collection hero', async ({page}) => {
  await page.click('#settings-trigger'); await page.click('#demo-button');
  await expect(page.locator('#settings-dialog')).not.toHaveAttribute('open', '');
  await expect(page.locator('#manuscript')).toBeVisible();
  await expect(page.locator('#title-content')).toContainText(/specimen/i);
  await expect(page.locator('#welcome')).toBeHidden();
});


test('browser Back cancels a pending work and restores the current manuscript', async ({page}) => {
  await load(page); await home(page);
  let release; const pending = new Promise(resolve => {release = resolve;});
  let requested; const started = new Promise(resolve => {requested = resolve;});
  await page.route('https://example.org/pending-back.md',async route => {
    requested(); await pending;
    await route.fulfill({contentType:'text/markdown',body:'# Stale work\n\nA later response must not replace the restored manuscript.'}).catch(()=>{});
  });
  await page.keyboard.press('l'); await page.fill('#url-input','https://example.org/pending-back.md'); await page.click('#url-submit');
  await started;
  await expect(page.locator('#loading-panel')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#manuscript')).toBeVisible();
  await expect(page.locator('#title-content h1')).toHaveText('First scroll');
  await expect(page.locator('body')).not.toHaveClass(/loading/);
  await expect(page.locator('#loading-panel')).toBeHidden();
  release(); await page.waitForTimeout(150);
  await expect(page.locator('#title-content h1')).toHaveText('First scroll');
  await expect(page.locator('#manuscript')).not.toContainText('A later response');
  await expect(page).not.toHaveURL(/pending-back/);
});


test('the sticky toolbar can save a bookmark and the sidebar returns to that reading position', async ({page}) => {
  await load(page);
  await page.evaluate(() => scrollTo(0,1000));
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(900);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const before = await page.evaluate(() => scrollY), bookmark = page.locator('#bookmark-button');
  await expect(bookmark).toBeVisible(); await expect(bookmark).toBeEnabled();
  const box = await bookmark.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
  await page.mouse.click(box.x + box.width / 2,box.y + box.height / 2);
  await expect(bookmark).toHaveClass(/bookmark-set/); await expect(page.locator('#toast-text')).toHaveText('Bookmarked.');
  await page.evaluate(() => scrollTo(0,1600));
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before + 400);
  await sidebar(page); await page.locator('#resume-button').click();
  await expect.poll(async () => Math.abs(await page.evaluate(() => scrollY) - before)).toBeLessThan(12);
  await expect(page.locator('body')).not.toHaveClass(/nav-open/);
});
