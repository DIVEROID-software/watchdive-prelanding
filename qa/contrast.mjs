import { chromium } from '/Users/diveroid/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import { writeFileSync } from 'node:fs';
const browser = await chromium.launch({headless:true,executablePath:'/Users/diveroid/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell'});
const results=[];
for (const locale of ['ko','en']) for (const type of ['guide', 'notice3','notice10']) for (const width of [375,600]) for (const colorScheme of ['light','dark']) {
 const base=type==='guide'?`guide-${locale}`:`notice-${locale}-${type.slice(6)}`;
 const page=await browser.newPage({viewport:{width,height:900},colorScheme});
 await page.goto(`http://127.0.0.1:4197/qa/${base}.html`);
 const text=await page.evaluate(()=>{
  const rgb=s=>(s.match(/[\d.]+/g)||[]).map(Number);
  const lum=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
  return [...document.querySelectorAll('body *')].filter(e=>[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&e.getBoundingClientRect().height>0&&getComputedStyle(e).visibility!=='hidden').map(e=>{
   let bg=e;while(bg.parentElement&&['transparent','rgba(0, 0, 0, 0)'].includes(getComputedStyle(bg).backgroundColor))bg=bg.parentElement;
   const a=lum(rgb(getComputedStyle(e).color)),b=lum(rgb(getComputedStyle(bg).backgroundColor));
   return {text:e.textContent.trim().slice(0,70),ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
  });
 });
 results.push({name:`${base}-${width}-${colorScheme}`,minRatio:Math.min(...text.map(t=>t.ratio)),failures:text.filter(t=>t.ratio<4.5)});await page.close();
}
writeFileSync('qa/contrast-checks.json',JSON.stringify(results,null,2));await browser.close();
if(results.some(r=>r.failures.length))process.exitCode=1;
