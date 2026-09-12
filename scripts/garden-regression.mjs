import assert from 'node:assert/strict';
import { loadState, getLevel, submitWord, plantSeed, collectBloom } from '../src/game.js';
import { getBuildableDictionaryWords } from '../src/dictionary.js';
export async function runGardenRegression(browser, url) {
 for(const viewport of [{width:1366,height:768},{width:320,height:640}]) {
  const context=await browser.newContext({viewport,hasTouch:true,reducedMotion:'reduce'});
  const page=await context.newPage(); const failures=[]; page.on('pageerror',e=>failures.push(e.message));
  await page.goto(url);
  const fresh=loadState({getItem:()=>null});
  await page.evaluate(s=>localStorage.setItem('word-garden-state',JSON.stringify(s)),fresh); await page.reload();
  for(const pointerType of ['mouse','touch']) {
   const points=await page.locator('.letter').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};}));
   const dispatch=async(type,index)=>page.evaluate(({type,index,points,pointerType})=>{
    const p=points[index]; document.elementFromPoint(p.x,p.y).dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:1,pointerType,clientX:p.x,clientY:p.y}));
   },{type,index,points,pointerType});
   await dispatch('pointerdown',0); await dispatch('pointermove',1); await dispatch('pointermove',2);
   await dispatch('pointermove',1); assert.equal(await page.locator('.letter.is-active').count(),2);
   await dispatch('pointermove',0); assert.equal(await page.locator('.letter.is-active').count(),1);
   await dispatch('pointerup',0); await page.locator('[data-action="backspace"]').click();
  }
  const bonus=getBuildableDictionaryWords(getLevel(fresh).letters).find(w=>!getLevel(fresh).targets.includes(w));
  assert.ok(bonus);
  // A touch swipe must auto-submit and clear the actual gesture, without Submit.
  const indices=[];
  const letters=await page.locator('.letter').allTextContents();
  for(const letter of bonus) indices.push(letters.findIndex((v,i)=>v===letter&&!indices.includes(i)));
  for(let i=0;i<indices.length;i++) {
   const target=page.locator(`.letter[data-index="${indices[i]}"]`); const box=await target.boundingBox();
   await target.dispatchEvent(i===0?'pointerdown':'pointermove', {pointerType:'touch',pointerId:7,clientX:box.x+box.width/2,clientY:box.y+box.height/2});
  }
  await page.locator('[data-wheel]').dispatchEvent('pointerup',{pointerType:'touch',pointerId:7});
  assert.equal(await page.locator('.current-word').innerText(),'TAP OR SWIPE LETTERS');
  assert.equal(await page.locator('.letter.is-active').count(),0);
  assert.equal(await page.locator('[data-swipe-path]').getAttribute('points'),'');
  assert.equal((await page.evaluate(()=>JSON.parse(localStorage.getItem('word-garden-state')))).bonusFound.length,1);
  const next=page.locator('.letter').first(); const nextLetter=await next.innerText(); await next.focus(); await page.keyboard.press('Enter');
  await page.waitForTimeout(200); assert.equal(await page.locator('.current-word').innerText(),nextLetter);
  let s=plantSeed(fresh,{plotIndex:0,plantId:'daisy'}).state;
  const finish=s=>getLevel(s).targets.reduce((s,w)=>submitWord(w,s).state,s);
  for(let i=0;i<5;i++) s=finish(s);
  await page.evaluate(s=>localStorage.setItem('word-garden-state',JSON.stringify(s)),s); await page.reload();
  await page.locator('[data-action="garden"]').click();
  assert.equal(await page.locator('[data-design="moonlit"]').isDisabled(),true);
  await page.locator('[data-collect="0"]').click();
  assert.match(await page.locator('.garden-notice').innerText(),/\+5 coins/);
  assert.equal(await page.locator('[data-collect="0"]').count(),0);
  await page.locator('[data-plant="rose"]').click(); await page.locator('[data-replant="0"]').click();
  assert.match(await page.locator('[data-plot="0"]').innerText(),/Rose.*seedling/s);
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('word-garden-state')));
  assert.equal(saved.garden.seedsSpent,2); assert.equal(saved.garden.collectedBloomCount,1);
  // Earn both alternate designs through the public game API, then inspect each at real viewport sizes.
  s=collectBloom(s,0).state;
  for(let i=0;i<5;i++) {
   s=plantSeed(s,{plotIndex:0,plantId:['rose','poppy','fern','bluebell','lavender'][i],replant:true}).state;
   for(let j=0;j<5;j++) s=finish(s);
   s=collectBloom(s,0).state;
  }
  await page.evaluate(s=>localStorage.setItem('word-garden-state',JSON.stringify(s)),s); await page.reload();
  await page.locator('[data-action="garden"]').click();
  for(const design of ['meadow','moonlit','sunroom']) {
   await page.locator(`[data-design="${design}"]`).click();
   assert.equal(await page.locator(`.game-panel [data-garden-design="${design}"]`).count(),1);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:`state/screenshots/rewards-${design}-${viewport.width}.png`,fullPage:true});
  }
  await page.reload(); await page.locator('[data-action="garden"]').click();
  assert.equal(await page.locator('[data-design="sunroom"]').getAttribute('aria-pressed'),'true');
  assert.match(await page.locator('.bloom-album h3').innerText(),/6\/6/);
  for(let cycle=0;cycle<6;cycle++) {
   s=plantSeed(s,{plotIndex:0,plantId:'daisy',replant:true}).state;
   for(let i=0;i<5;i++) s=finish(s);
   s=collectBloom(s,0).state;
  }
  await page.evaluate(s=>localStorage.setItem('word-garden-state',JSON.stringify(s)),s); await page.reload();
  await page.locator('[data-action="garden"]').click();
  assert.equal(await page.locator('.game-panel [data-garden-fountain]').count(),1);
  assert.match(await page.locator('.bloom-album').innerText(),/Fountain unlocked/);
  assert.deepEqual(failures,[]); await context.close();
 }
 console.log('PASS: pointer backtracking mouse/touch, immediate bonus clearing, collect/replant, design unlocks and all three garden layouts on Chromebook and 320px phone.');
}
