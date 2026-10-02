import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { loadState, getLevel, submitWord, plantSeed } from '../src/game.js';
import { levels, getDailyLevel, getDateKey } from '../src/levels.js';
const fresh=()=>loadState({getItem:()=>null});
const finish=s=>getLevel(s).targets.reduce((s,w)=>submitWord(w,s).state,s);
const ids=n=>Array.from({length:n},(_,i)=>i);
const campaignAt=cursor=>({...fresh(),levelIndex:cursor,campaign:{...fresh().campaign,completedLevels:cursor,cursor,completedIds:ids(cursor)}});
async function submit(page,word) {
 const letters=await page.locator('.letter').allTextContents(); const used=[];
 for(const char of word) {
  const index=letters.findIndex((letter,i)=>letter===char&&!used.includes(i)); assert.ok(index>=0,word);used.push(index);
  await page.locator(`.letter[data-index="${index}"]`).click();
 }
 await page.locator('[data-action="submit"]').click();
}
export async function runProgressionRegression(browser,url) {
 await mkdir('state/screenshots',{recursive:true});
 for(const viewport of [{width:320,height:640},{width:360,height:640},{width:1366,height:768}]) {
  const context=await browser.newContext({viewport,hasTouch:true,reducedMotion:'reduce'});const page=await context.newPage();const failures=[];
  page.on('pageerror',e=>failures.push(e.message));page.on('console',m=>{if(m.type()==='error')failures.push(m.text());});
  await page.goto(url);
  const seed=async s=>{await page.evaluate(s=>localStorage.setItem('word-garden-state',JSON.stringify(s)),s);await page.reload();await page.locator('.letter').first().waitFor();};
  const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('word-garden-state')));
  const fit=async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow');
  const shot=async name=>{await fit();await page.screenshot({path:`state/screenshots/progression-${name}-${viewport.width}.png`,fullPage:true});};
  await seed(fresh());await page.locator('[data-action="garden"]').click();assert.equal(await page.locator('[data-plant="iris"]').isDisabled(),true);
  await page.locator('[data-action="close-panel"]').click();
  let growthState=campaignAt(10);growthState=plantSeed(growthState,{plotIndex:0,plantId:'daisy'}).state;await seed(growthState);
  await page.locator('[data-action="garden"]').click();await page.locator('[data-plot="0"]').click();
  assert.match(await page.locator('.garden-notice').innerText(),/seedling.*2 more.*5 more to bloom/i);
  assert.match(await page.locator('.garden-plot-card').first().innerText(),/Seedling.*5 puzzles until bloom/s);
  await page.locator('[data-action="close-panel"]').click();
  for(let completed=0;completed<2;completed++) {
   for(const word of getLevel(growthState).targets)await submit(page,word);
   growthState=finish(growthState);await page.locator('.level-complete [data-action="continue"]').click();
  }
  await page.locator('[data-action="garden"]').click();
  assert.match(await page.locator('.garden-notice').innerText(),/growing.*3 more to bloom/i);
  assert.match(await page.locator('.garden-plot-card').first().innerText(),/Growing.*3 puzzles until bloom/s);
  await shot('inspection-refresh');await page.locator('[data-action="close-panel"]').click();
  let unlockState=campaignAt(14);await seed(unlockState);
  for(const word of getLevel(unlockState).targets)await submit(page,word);
  assert.match(await page.locator('.level-complete__unlock').innerText(),/\+4 new garden plots unlocked.*Garden area 4 unlocked/s);
  await shot('unlock-spotlight');await page.locator('.level-complete [data-action="continue"]').click();
  assert.equal(await page.locator('.level-complete__unlock').count(),0);
  let designState=campaignAt(10);designState=plantSeed(designState,{plotIndex:0,plantId:'daisy'}).state;
  designState={...designState,garden:{...designState.garden,collectedBloomCount:2,collectedSpecies:['poppy','rose'],plots:designState.garden.plots.map(plot=>plot.index===0?{...plot,plantedAt:5}:plot)}};
  await seed(designState);await page.locator('[data-action="garden"]').click();await page.locator('[data-collect="0"]').click();
  assert.match(await page.locator('.garden-unlock-spotlight').innerText(),/Moonlit Garden unlocked.*Use this design.*Not now/s);
  await page.locator('[data-action="dismiss-garden-spotlight"]').click();assert.equal(await page.locator('.garden-unlock-spotlight').count(),0);
  await page.locator('[data-plot="0"]').click();assert.equal(await page.locator('.garden-unlock-spotlight').count(),0);
  await shot('design-unlock-dismissed');await page.locator('[data-action="close-panel"]').click();
  let s=campaignAt(99);await seed(s);
  for(const word of getLevel(s).targets)await submit(page,word);
  assert.match(await page.locator('.level-complete').innerText(),/Original garden complete.*Iris unlocked/s);
  await shot('chapter-unlock');
  await page.reload();await page.locator('[data-action="progress"]').click();
  assert.match(await page.locator('.chapter-progress').innerText(),/Second Garden.*0\/24.*Pergola/s);
  assert.equal(await page.locator('[data-replay]').count(),levels.length);await shot('chapter-map');
  await page.locator('[data-action="close-panel"]').click();await page.locator('[data-action="garden"]').click();
  assert.equal(await page.locator('[data-plant="iris"]').isDisabled(),false);
  await page.locator('[data-plant="iris"]').click();await page.locator('[data-plot="0"]').click();
  assert.equal((await saved()).garden.plots[0].plantId,'iris');assert.match(await page.locator('[data-plot="0"]').innerText(),/Iris/);
  s=campaignAt(123);s=plantSeed(s,{plotIndex:0,plantId:'iris'}).state;await seed(s);
  for(const word of getLevel(s).targets)await submit(page,word);
  assert.match(await page.locator('.level-complete').innerText(),/Second Garden complete.*Pergola unlocked/s);
  await shot('chapter-complete');
  s=finish(s);s.garden={...s.garden,seedsSpent:48,collectedBloomCount:48,collectedSpecies:['daisy','poppy','lavender','bluebell','fern','rose'],plots:[{index:0,plantId:'iris',plantedAt:100,bloomCollected:false}]};
  await seed(s);await page.locator('[data-action="garden"]').click();
  assert.equal(await page.locator('.game-panel [data-iris-art]').count(),3); // Scene, palette and planted plot.
  for(const id of ['pergola','butterfly','gazebo','fountain']) assert.equal(await page.locator(`.game-panel [data-garden-${id}]`).count(),1);
  const coins=(await saved()).coins;
  const claim=page.locator('[data-action="claim-collection"]');assert.equal(await claim.isDisabled(),false);
  await claim.focus();await page.keyboard.press('Enter');assert.equal((await saved()).coins,coins+30);assert.equal(await claim.isDisabled(),true);
  await page.reload();await page.locator('[data-action="garden"]').click();assert.equal(await claim.isDisabled(),true);assert.equal((await saved()).coins,coins+30);
  await shot('late-garden-album');
  // Legacy v3 in-flight loop must still show its frozen board before entering101.
  s={...campaignAt(17),campaignLevelVersion:3,levelIndex:217,campaign:{...campaignAt(17).campaign,completedLevels:217,completedIds:ids(100)},solved:[levels[17].targets[0]],revealed:[`${levels[17].targets[1]}:0`]};
  await seed(s);assert.equal((await saved()).campaignLevelVersion,3);
  for(const word of levels[17].targets.slice(1))await submit(page,word);
  assert.equal((await saved()).campaign.cursor,100);assert.equal((await saved()).campaign.completedLevels,218);
  await page.clock.install({time:new Date('2030-01-01T12:00:00Z')});
  for(let offset=0;offset<3;offset++) {
   const date=new Date(Date.parse('2030-01-01T12:00:00Z')+offset*86400000);await page.clock.setFixedTime(date);
   const level=getDailyLevel(date);const dateKey=getDateKey(date);
   s={...fresh(),mode:'daily',daily:{dateKey,levelVersion:4,solved:[],bonusFound:[],revealed:[],completed:false}};
   const kind=['one-bonus','two-bonus','long-targets'][((Math.floor(date.getTime()/86400000)%3)+3)%3];
   const goal=kind==='one-bonus'?1:2;
   const words=kind==='long-targets'?level.targets.filter(w=>w.length>=4).slice(0,2):level.bonus.slice(0,goal);
   await seed(s);for(const word of words)await submit(page,word);
   const expected=40+10+(kind==='long-targets'?0:goal*2);assert.equal((await saved()).coins,expected);
   await page.locator('[data-action="progress"]').click();assert.match(await page.locator('.daily-objective').innerText(),/Reward collected/);
   assert.match(await page.locator('.daily-objective h3').innerText(),kind==='long-targets'?/at least 4 letters/:new RegExp(`Find ${goal}`));
   await shot(`daily-${kind}`);await page.reload();await submit(page,words[0]);assert.equal((await saved()).coins,expected);
   if(offset===0) {
    const oldLevel=getDailyLevel(date,3);await seed({...s,daily:{...s.daily,levelVersion:3,solved:[oldLevel.targets[0]]}});
    await page.locator('[data-action="progress"]').click();assert.match(await page.locator('.daily-objective h3').innerText(),/Find 3/);
   }
  }
  assert.deepEqual(failures,[]);await context.close();
 }
 console.log('PASS: Second Garden milestones/map, locked and planted Iris, pergola/butterfly/gazebo, one-time original album claim, legacy loop/daily migration and all UTC goals on320/360px phone and Chromebook.');
}
