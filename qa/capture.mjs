import { chromium } from '/Users/diveroid/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import { writeFileSync } from 'node:fs';
const browser = await chromium.launch({headless:true,executablePath:"/Users/diveroid/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell"});
const results=[];
for (const locale of ['ko','en']) {
 for (const kind of ['guide', 'notice3','notice10']) {
  const base = kind === 'guide' ? `guide-${locale}` : `notice-${locale}-${kind.slice(6)}`;
  for (const width of [375,600]) for (const mode of ['light','dark']) {
   const page = await browser.newPage({viewport:{width,height:900},colorScheme:mode,deviceScaleFactor:1});
   await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
   await page.goto(`http://127.0.0.1:4197/qa/${base}.html`);
   await page.screenshot({path:`qa/${base}-${width}-${mode}.png`,fullPage:true});
   results.push({name:`${base}-${width}-${mode}`,overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),background:await page.locator('body').evaluate(e=>getComputedStyle(e).backgroundColor)});
   await page.close();
  }
 }
 for (const count of [3,10]) {
  const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto(`http://127.0.0.1:4197/qa/preview.html?locale=${locale}&count=${count}`);
  await page.locator('[data-tier="top"]').waitFor();
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:`qa/site-${locale}-${count}-390.png`,fullPage:true});
  await page.locator('summary').click();
  await page.screenshot({path:`qa/site-${locale}-${count}-390-open.png`,fullPage:true});
  results.push({name:`site-${locale}-${count}`,overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),conditionsOpen:await page.locator('details').getAttribute('open')!==null});
  await page.close();
 }
}
writeFileSync('qa/browser-checks.json',JSON.stringify(results,null,2));
await browser.close();
