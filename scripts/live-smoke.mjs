// Optional check against real public sources; not part of offline CI.
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const directory=resolve('test-results/live'); await mkdir(directory,{recursive:true});
const browser=await chromium.launch(), page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
const errors=[]; page.on('pageerror',error=>errors.push(error.message));
const results=[];
try {
  await page.goto(process.env.LUKIJA_URL || pathToFileURL(resolve('public/index.html')).href);
  const works=await page.evaluate(()=>(JSON.parse(document.getElementById('reader-config').textContent).works).map(w=>({id:w.id,title:w.title})));
  for (const work of works) {
    await page.keyboard.press('l'); await page.locator(`#library-list [data-work="${work.id}"]`).click();
    await page.waitForFunction(()=>document.querySelector('#work-volume-list button:not(:disabled)'),{},{timeout:25000});
    const paths=await page.locator('#work-volume-list button').evaluateAll(nodes=>nodes.map(n=>n.dataset.path));
    console.log(work.title,paths.length,'volumes');
    for (const [index,path] of paths.entries()) {
      if (index) {await page.keyboard.press('l'); await page.locator(`#library-list [data-work="${work.id}"]`).click();}
      await page.locator(`#work-volume-list [data-path="${path}"]`).click();
      await page.waitForFunction(()=>!document.body.classList.contains('loading'),{},{timeout:45000});
      if (await page.locator('#load-message').isVisible()) throw new Error(await page.locator('#load-message').innerText());
      const result={work:work.id,path,revision:await page.locator('#source-status').textContent(),characters:await page.locator('#manuscript').evaluate(n=>n.textContent.length),citations:await page.locator('#manuscript .citation-block').count()};
      if (result.characters<1000) throw new Error('Unexpectedly short published manuscript.');
      console.log(JSON.stringify(result)); results.push(result);
      if (index===0) {
        await page.click('#source-button'); await page.click('#export-epub');
        const pending=page.waitForEvent('download'); await page.click('#epub-save');
        await (await pending).saveAs(resolve(directory,work.id+'.epub'));
        await page.setViewportSize({width:390,height:844});
        await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+1,{},{timeout:3000});
        await page.screenshot({animations:'disabled',path:resolve(directory,work.id+'-mobile.png')});
        await page.setViewportSize({width:1440,height:1000});
      }
    }
  }
  await page.click('#collection-link');
  await page.screenshot({animations:'disabled',path:resolve(directory,'collection-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({animations:'disabled',path:resolve(directory,'collection-mobile.png'),fullPage:true});
  if (errors.length) throw new Error(errors.join('\n'));
  await writeFile(resolve(directory,'report.json'),JSON.stringify({url:page.url(),at:new Date().toISOString(),results},null,2));
  console.log('LIVE CHECK PASSED:',results.length,'published volumes; two EPUB downloads; no page errors.');
} finally {await browser.close();}
