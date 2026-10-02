import {test, expect} from '@playwright/test';
import {mockCatalog} from './catalog-fixture.mjs';
import {manuscript} from './place-fixture.mjs';

const repository = 'Lotus-King-Research/Example-Text';
const work = {id:'place-text',repository,title:'Place specimen',englishUrl:`https://github.com/${repository}/blob/main/paired/translation.md`,sourceUrl:`https://github.com/${repository}/blob/main/paired/source.md`,sourceLanguage:'bo',restricted:true};
async function setup(page) {
  const state = await mockCatalog(page, {configuration:{works:[work]}});
  state.files['Example-Text'] = {'paired/translation.md':manuscript('english'),'paired/source.md':manuscript('source')};
  return state;
}
const fileRequests = state => state.requests.filter(url => url.includes('translation.md') && !url.includes('/git/'));
const card = page => page.locator('[data-work="place-text"]');

test('a restricted work is marked on its card and asks for confirmation before anything is read', async ({page}) => {
  const state = await setup(page); await page.goto('/');
  await expect(card(page).locator('.work-card-restricted')).toHaveText('Restricted');
  await card(page).click();
  const dialog = page.locator('#restricted-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#restricted-message')).toHaveText('This text is restricted. Confirm below that you have the required authorization to access it.');
  await expect(page.locator('#restricted-title')).toHaveText('Place specimen');
  await expect(page.locator('#restricted-no')).toBeFocused();
  const before = fileRequests(state).length;
  await page.locator('#restricted-no').click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#manuscript')).toBeHidden();
  expect(fileRequests(state).length).toBe(before);
  await card(page).click();
  await page.locator('#restricted-yes').click();
  await expect(page.locator('#manuscript')).toContainText('Passage 1 of the specimen');
  await expect(page.locator('#restricted-mark')).toBeVisible();
  await expect(page.locator('#restricted-mark')).toHaveText('Restricted text');
});

test('a link straight to a restricted work asks first, and No returns to the collection', async ({page}) => {
  await setup(page);
  await page.goto('/?work=place-text&file=paired%2Ftranslation.md#PL-000020');
  await expect(page.locator('#restricted-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#restricted-dialog')).toBeHidden();
  await expect(page.locator('#published-section')).toBeVisible();
  await expect(page).not.toHaveURL(/work=/);
});

test('confirmation lasts for the visit, not across visits', async ({page}) => {
  await setup(page); await page.goto('/');
  await card(page).click(); await page.locator('#restricted-yes').click();
  await expect(page.locator('#manuscript')).toContainText('Passage 1 of the specimen');
  await page.goto('/');
  await card(page).click();
  await expect(page.locator('#restricted-dialog')).toBeVisible();
});

test('an unrestricted work opens without asking', async ({page}) => {
  const state = await mockCatalog(page, {configuration:{works:[{...work, restricted:false}]}});
  state.files['Example-Text'] = {'paired/translation.md':manuscript('english'),'paired/source.md':manuscript('source')};
  await page.goto('/'); await card(page).click();
  await expect(page.locator('#manuscript')).toContainText('Passage 1 of the specimen');
  await expect(page.locator('#restricted-mark')).toBeHidden();
  await expect(card(page).locator('.work-card-restricted')).toHaveCount(0);
});

test('a restricted flag must be true or false', async ({page}) => {
  await mockCatalog(page, {configuration:{works:[{...work, restricted:'yes'}]}});
  await page.goto('/');
  await expect(page.locator('#load-message')).toContainText('must give restricted as true or false');
});
