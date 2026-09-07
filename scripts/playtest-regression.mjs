// Run against a local dev/preview server: node scripts/playtest-regression.mjs [URL]
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { wheelSpellsTarget } from '../src/wheel.js';
import { levels, getDailyLevel } from '../src/levels.js';
import { loadState } from '../src/game.js';
import { createBackup } from '../src/persistence.js';
export async function runPlaytestRegression(browser, url) {
 await mkdir('state/screenshots',{recursive:true});
 for (const viewport of [{width:1366,height:768},{width:320,height:640}]) {
  const context=await browser.newContext({viewport}); const page=await context.newPage();
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);
  const safeWheel = async targets => {
    const letters=await page.locator('.letter').allTextContents();
    assert.equal(wheelSpellsTarget(letters.join(''),targets),false);
  };
  await safeWheel(levels[0].targets);
  await page.reload(); await safeWheel(levels[0].targets);
  await page.locator('[data-mode="daily"]').click(); await safeWheel(getDailyLevel().targets);
  await page.locator('[data-mode="campaign"]').click(); await safeWheel(levels[0].targets);
  const s=loadState({getItem:()=>null}); s.campaign.cursor=16;
  await page.evaluate(s=>localStorage.setItem('word-garden-state',JSON.stringify(s)),s); await page.reload();
  await safeWheel(levels[16].targets);
  assert.ok(!(await page.locator('.board-wrap').getAttribute('aria-label')).includes('Rapids'));
  assert.ok(!/rapids/i.test(await page.locator('.level-card').innerText()));
  await page.locator('[data-action="progress"]').click();
  assert.ok(!/rapids/i.test(await page.locator('.level-map').innerText()));
  assert.ok(!/rapids/i.test(await page.locator('.level-map').getAttribute('aria-label')));
  await page.locator('[data-action="close-panel"]').click();
  await page.locator('[data-action="garden"]').click();
  await page.locator('[data-plant="poppy"]').focus(); await page.keyboard.press('Enter');
  assert.match(await page.locator('.selected-plant').innerText(),/Poppy/);
  await page.locator('[data-plot="0"]').focus(); await page.keyboard.press('Space');
  assert.match(await page.locator('.garden-notice').innerText(),/1 seed used/);
  const planted=await page.evaluate(()=>localStorage.getItem('word-garden-state'));
  await page.locator('[data-plot="0"]').click();
  assert.match(await page.locator('.garden-notice').innerText(),/No seed spent/);
  assert.equal(await page.evaluate(()=>localStorage.getItem('word-garden-state')),planted);
  await page.locator('[data-plot="1"]').click();
  assert.match(await page.locator('.garden-notice').innerText(),/earn another seed/);
  await page.screenshot({path:`state/screenshots/garden-${viewport.width}.png`});
  await page.locator('[data-action="close-panel"]').click();
  await page.locator('[data-action="settings"]').click();
  await page.locator('[data-action="save-progress"]').click();
  assert.match(await page.locator('.save-controls [data-save-status]').innerText(),/^Saved in this browser/);
  const downloadPromise=page.waitForEvent('download'); await page.locator('[data-action="download-backup"]').click();
  const download=await downloadPromise; assert.equal(download.suggestedFilename(),'word-garden-backup.json');
  const downloaded=await readFile(await download.path(),'utf8');
  assert.deepEqual(JSON.parse(downloaded).state,JSON.parse(planted));
  const portableContext=await browser.newContext({viewport}); const portable=await portableContext.newPage();
  await portable.goto(url); await portable.locator('[data-action="settings"]').click();
  await portable.locator('[data-import-backup]').setInputFiles({name:'download.json',mimeType:'application/json',buffer:Buffer.from(downloaded)});
  await portable.locator('[data-action="confirm-import"]').click(); await portable.reload();
  assert.deepEqual(await portable.evaluate(()=>JSON.parse(localStorage.getItem('word-garden-state'))),JSON.parse(planted));
  await portableContext.close();
  const upload = async data => page.locator('[data-import-backup]').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(data)});
  await upload('{'); await page.waitForFunction(()=>document.querySelector('.save-controls').textContent.includes('Invalid backup'));
  assert.equal(await page.evaluate(()=>localStorage.getItem('word-garden-state')),planted);
  const backup=JSON.parse(planted); backup.coins=77;
  await upload(createBackup(backup)); await page.locator('[data-action="confirm-import"]').waitFor();
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('word-garden-state')).coins),40);
  await page.screenshot({path:`state/screenshots/save-${viewport.width}.png`});
  await page.locator('[data-action="cancel-import"]').click();
  assert.equal(await page.evaluate(()=>localStorage.getItem('word-garden-state')),planted);
  await upload(createBackup(backup)); await page.locator('[data-action="confirm-import"]').click();
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('word-garden-state')).coins),77);
  await page.reload(); assert.match(await page.locator('.coin-pill').innerText(),/77/);
  await page.locator('[data-action="settings"]').click();
  await page.evaluate(() => {
    const read=File.prototype.text;
    File.prototype.text=async function(){await new Promise(resolve=>setTimeout(resolve,200)); return read.call(this);};
  });
  await upload(createBackup(backup));
  await page.locator('[data-action="close-panel"]').click();
  await page.waitForTimeout(250);
  await page.locator('[data-action="settings"]').click();
  assert.equal(await page.locator('[data-action="confirm-import"]').count(),0);
  await page.locator('[data-action="close-panel"]').click();
  await page.locator('[data-action="settings"]').click();
  await page.evaluate(()=>{Storage.prototype.setItem=function(){throw new Error('QuotaExceededError');};});
  await page.locator('[data-action="save-progress"]').click();
  assert.match(await page.locator('.save-controls [data-save-status]').innerText(),/^Not saved/);
  backup.coins=99; await upload(createBackup(backup)); await page.locator('[data-action="confirm-import"]').click();
  assert.match(await page.locator('.save-controls').innerText(),/Import not applied/);
  assert.match(await page.locator('.coin-pill').innerText(),/77/);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('word-garden-state')).coins),77);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]); await context.close();
 }
 const deniedContext=await browser.newContext();
 await deniedContext.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw new Error('SecurityError');}}));
 const denied=await deniedContext.newPage(); const deniedErrors=[];
 denied.on('pageerror',e=>deniedErrors.push(e.message));
 await denied.goto(url);
 assert.match(await denied.locator('.ledger').innerText(),/Could not read browser progress/);
 await denied.locator('[data-action="settings"]').click(); await denied.locator('[data-action="save-progress"]').click();
 assert.match(await denied.locator('.save-controls [data-save-status]').innerText(),/^Not saved/);
 assert.deepEqual(deniedErrors,[]); await deniedContext.close();
 console.log('PASS: Chromebook and 320px phone answer labels, planting/inspection/economy, manual save, download, import preview/cancel/replace/reload/rejection/storage failure; screenshots in state/screenshots.');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
 const executablePath=process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
 const browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox']});
 try { await runPlaytestRegression(browser,process.argv[2] || 'http://127.0.0.1:4318'); }
 finally { await browser.close(); }
}
