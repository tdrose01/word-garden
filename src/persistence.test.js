import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackup, parseBackup, writeProgress } from './persistence.js';
import { loadState, plantSeed, startReplay, submitWord, getLevel, updateSettings } from './game.js';
import { levels, legacyLevels, versionTwoLevels, dailyLevels } from './levels.js';
import { getPuzzleTheme, safeSceneText } from './themes.js';
const fresh = () => loadState({getItem:()=>null});
test('portable backup preserves campaign, daily, replay, garden and settings', () => {
  let s = fresh();
  for (const word of getLevel(s).targets) s = submitWord(word,s).state;
  s = plantSeed(s,{plotIndex:0,plantId:'poppy'}).state;
  s = updateSettings(s,{sound:true,haptics:false});
  s = startReplay(s,0).state;
  s = submitWord(getLevel(s).targets[0],s).state;
  const restored = parseBackup(createBackup(s));
  assert.deepEqual(restored,s);
});
test('legacy v1/v2 in-flight boards migrate without erasing solved words', () => {
  for (const v of [1,2]) {
    const s = {...fresh(), campaignLevelVersion:v};
    s.solved = [getLevel(s).targets[0]];
    assert.deepEqual(parseBackup(createBackup(s)).solved,s.solved);
    assert.equal(parseBackup(createBackup(s)).campaignLevelVersion,v);
  }
});
test('malformed and hostile imports reject before modifying existing progress', () => {
  const original = fresh(); const before = JSON.stringify(original);
  for (const change of [s=>s.coins=-1,s=>s.bonusFound=['HACK'],s=>s.daily.completed=true,s=>s.settings.sound='yes',s=>s.solved=['HACK'],s=>s.revealed=['PLANT:99'],s=>s.campaign.cursor=999,s=>s.garden.plots=[{index:0,plantId:'rose',plantedAt:99}],s=>s.daily.dateKey='2026-02-30',s=>s.mode='cloud',s=>s.extra=true,s=>s.replay={levelIndex:999}]) {
    const s=structuredClone(original); change(s); assert.throws(()=>parseBackup(createBackup(s)));
  }
  for (const text of ['{','null','{}',createBackup(original).replace('"version": 1','"version": 99'),' '.repeat(1024*1024+1)]) assert.throws(()=>parseBackup(text));
  assert.equal(JSON.stringify(original),before);
});
test('write result is honest for successful and denied storage', () => {
  let saved; const s=fresh();
  assert.equal(writeProgress(s,{setItem:(k,v)=>{saved=v;}}).ok,true);
  assert.deepEqual(JSON.parse(saved),s);
  const failed=writeProgress(s,{setItem:()=>{throw new Error('quota');}});
  assert.equal(failed.ok,false); assert.match(failed.message,/Not saved/);
});
test('scene display copy does not spell required answers across current and old catalogs', () => {
  assert.equal(levels[16].title.toUpperCase(),levels[16].targets[0]);
  for (const level of [...levels,...legacyLevels,...versionTwoLevels,...dailyLevels]) {
    const theme=getPuzzleTheme(level);
    const words=(theme.title+' '+theme.description+' '+safeSceneText(level.pack || '',level)).toUpperCase().match(/[A-Z]+/g)||[];
    assert.ok(!words.some(word=>level.targets.includes(word)),level.title);
  }
});
test('read-denied storage reports failure without crashing game initialization', () => {
  let failures=0;
  const s=loadState({getItem:()=>{throw new Error('denied');}},undefined,()=>failures++);
  assert.equal(failures,1); assert.equal(s.coins,40);
});
test('older daily history remains portable and naturally rolls over without losing totals', () => {
  const s=fresh(); s.daily.dateKey='2020-01-01'; s.dailyStats.totalCompletions=7;
  const restored=parseBackup(createBackup(s));
  assert.equal(restored.daily.dateKey,'2020-01-01');
  const loaded=loadState({getItem:()=>JSON.stringify(restored)});
  assert.equal(loaded.dailyStats.totalCompletions,7);
  assert.notEqual(loaded.daily.dateKey,'2020-01-01');
});
