import test from 'node:test';
import assert from 'node:assert/strict';
import { levels, dailyLevels, versionThreeLevels, versionThreeDailyLevels, legacyLevels, versionTwoLevels, LEVEL_VERSION, ORIGINAL_LEVEL_COUNT, getDailyLevel, getDateKey, buildGrid } from './levels.js';
import { loadState, getLevel, submitWord, createSnapshot, getDailyObjective, plantSeed, claimCollectionReward, startReplay } from './game.js';
import { createBackup, parseBackup } from './persistence.js';
import { getBuildableDictionaryWords, isDictionaryWord } from './dictionary.js';
import { canBuildWord } from './word-utils.js';
const fresh = () => loadState({ getItem: () => null });
const reload = state => loadState({ getItem: () => JSON.stringify(state) });
const finish = state => getLevel(state).targets.reduce((s, word) => submitWord(word, s).state, state);
const ids = n => Array.from({ length: n }, (_, i) => i);
const at = (cursor, version = LEVEL_VERSION, count = cursor) => ({ ...fresh(), campaignLevelVersion: version, levelIndex: count,
  campaign: { ...fresh().campaign, completedLevels: count, cursor, completedIds: ids(Math.min(count, version < 3 ? 36 : version < 4 ? 100 : cursor)) } });

test('authored progression has 24 fresh six-answer boards and 90 exclusive attainable daily banks', () => {
  assert.equal(ORIGINAL_LEVEL_COUNT, 100); assert.equal(levels.length, 124); assert.equal(dailyLevels.length, 90);
  assert.deepEqual(levels.slice(0, 100), versionThreeLevels); assert.equal(versionThreeDailyLevels.length, 41);
  assert.equal(new Set([...levels, ...dailyLevels].map(l => [...l.letters].sort().join(''))).size, 214);
  assert.deepEqual([...new Set(levels.slice(100).map(l => l.pack))].map(pack => levels.filter(l => l.pack === pack).length), [6,6,6,6]);
  for (const level of [...levels.slice(100), ...dailyLevels]) {
    if (typeof level.id === 'number') assert.equal(level.targets.length, 6);
    for (const word of [...level.targets, ...level.bonus]) { assert.ok(canBuildWord(word, level.letters), `${level.letters}: ${word}`); assert.ok(isDictionaryWord(word)); }
    assert.ok(level.targets.filter(w => w.length >= 4).length >= 2);
    assert.ok(getBuildableDictionaryWords(level.letters).filter(w => !level.targets.includes(w)).length >= 2);
    const p = buildGrid(level.targets);
    assert.ok(Math.max(...p.map(v => v.x + (v.direction === 'across' ? v.word.length : 1))) <= 13);
    assert.ok(Math.max(...p.map(v => v.y + (v.direction === 'down' ? v.word.length : 1))) <= 11);
  }
});

test('unique chapter clears unlock Iris and pergola only at 100 and 124, with replay reward isolation', () => {
  let s = at(99); assert.equal(plantSeed(s, { plotIndex: 0, plantId: 'iris' }).status, 'blocked');
  const result = getLevel(s).targets.reduce((r, w) => submitWord(w, r.state), { state: s });
  assert.match(result.message, /Original garden complete.*Iris unlocked/); s = result.state;
  assert.equal(getLevel(s).id, 101); assert.equal(createSnapshot(s).campaignStats.chapter.secondCleared, 0);
  s = plantSeed(s, { plotIndex: 0, plantId: 'iris' }).state; assert.equal(s.garden.plots[0].plantId, 'iris');
  for (let i = 0; i < 23; i++) s = finish(s);
  assert.equal(createSnapshot(s).gardenStats.landmarks.pergola, false);
  const final = getLevel(s).targets.reduce((r,w) => submitWord(w,r.state), {state:s}); s = final.state;
  assert.match(final.message, /Second Garden complete.*Pergola unlocked/);
  assert.equal(createSnapshot(s).gardenStats.landmarks.pergola, true);
  assert.deepEqual(parseBackup(createBackup(s)), s);
  const replay = startReplay(s, 123).state; const done = finish(replay);
  assert.equal(done.coins, replay.coins); assert.deepEqual(done.campaign, replay.campaign);
});

test('frozen v3 loop keeps active board and lifetime economy, then enters first missing second clearing', () => {
  for (const cursor of [0, 17, 99]) {
    let s = at(cursor, 3, 200 + cursor); const level = getLevel(s);
    s.solved = [level.targets[0]]; s.revealed = [`${level.targets[1]}:0`]; s.bonusFound = [level.bonus[0]];
    s.coins = 77; s.garden = { plots: [{ index: 0, plantId: 'rose', plantedAt: 100 }] };
    s = parseBackup(createBackup(s)); s = reload(s);
    assert.equal(s.campaignLevelVersion, 3); assert.deepEqual(getLevel(s), versionThreeLevels[cursor]);
    assert.equal(s.coins, 77); assert.equal(s.garden.plots[0].plantedAt, 100);
    s = finish(s); assert.equal(getLevel(s).id, 101); assert.equal(s.campaignLevelVersion, 4);
    assert.equal(s.campaign.completedLevels, 201 + cursor); assert.equal(createSnapshot(s).campaignStats.chapter.secondCleared, 0);
  }
  const empty = reload(at(5,3,205)); assert.equal(getLevel(empty).id,101); assert.equal(empty.coins,40);
  assert.deepEqual(parseBackup(createBackup(at(0,3,300))).campaign.completedIds, ids(100));
});

test('old catalogs and incomplete original history cannot manufacture Second Garden clears', () => {
  for (const version of [1,2]) {
    let s = at(4, version, 400); const level = getLevel(s); s.solved=[level.targets[0]];
    s = reload(s); assert.deepEqual(getLevel(s), (version===1 ? legacyLevels : versionTwoLevels)[4]);
    s = finish(s); assert.equal(getLevel(s).id,37); assert.equal(createSnapshot(s).campaignStats.chapter.secondUnlocked,false);
  }
  let s = at(99,3,500); s.campaign.completedIds=[0,1]; s.solved=[getLevel(s).targets[0]];
  s=finish(reload(s)); assert.equal(getLevel(s).id,3); assert.equal(createSnapshot(s).campaignStats.chapter.secondUnlocked,false);
  s=reload({...fresh(),campaign:{completedLevels:1000}}); assert.equal(createSnapshot(s).campaignStats.chapter.secondCleared,0);
});

test('original album manual claim is once-only, portable, rejects invalid flags and excludes Iris', () => {
  let s=at(100); s.garden={plots:[],seedsSpent:6,collectedBloomCount:6,collectedSpecies:['daisy','poppy','lavender','bluebell','fern','rose']};
  const before=s.coins; s=reload(parseBackup(createBackup(s))); assert.equal(s.coins,before);
  assert.equal(claimCollectionReward(startReplay(s,0).state).status,'blocked');
  s=claimCollectionReward(s).state; assert.equal(s.coins,before+30);
  s=reload(parseBackup(createBackup(s))); assert.equal(claimCollectionReward(s).state,s);
  for (const mutate of [g=>g.albumRewardClaimed='yes',g=>g.collectedSpecies=['iris','poppy','lavender','bluebell','fern','rose']]) {
    const bad=structuredClone(s);mutate(bad.garden);assert.throws(()=>parseBackup(createBackup(bad)));
  }
  for(const count of [23,24,47,48]) {
    const g=createSnapshot({...s,garden:{...s.garden,collectedBloomCount:count,seedsSpent:count}}).gardenStats;
    assert.equal(g.landmarks.butterfly,count>=24);assert.equal(g.landmarks.gazebo,count>=48);
  }
  const locked=fresh(); locked.garden.plots=[{index:0,plantId:'iris',plantedAt:0}];assert.throws(()=>parseBackup(createBackup(locked)));
  const fake=at(100);fake.campaign.completedIds=[100];assert.throws(()=>parseBackup(createBackup(fake)));
});

test('UTC goals rotate, pay on targets including final answer, and retain old in-flight goal versions', () => {
  // The date-dependent game API reads Date; pin UTC days without changing production APIs.
  const RealDate=Date;
  try {
    const kinds=[];
    for(let day=0;day<90;day++) {
      const now=new RealDate(Date.UTC(2030,0,1+day,12));
      globalThis.Date=class extends RealDate { constructor(...args){super(...(args.length?args:[now.getTime()]));} static now(){return now.getTime();} };
      let s={...fresh(),mode:'daily'}; const level=getLevel(s); let objective=getDailyObjective(s); kinds.push(objective.kind);
      const coins=s.coins;
      const words=objective.kind==='long-targets' ? level.targets.filter(w=>w.length>=4).slice(0,2) : getBuildableDictionaryWords(level.letters).filter(w=>!level.targets.includes(w)).slice(0,objective.goal);
      for(const word of words)s=submitWord(word,s).state;
      assert.equal(s.coins,coins+10+(objective.kind==='long-targets'?0:2*objective.goal));
      assert.equal(getDailyObjective(s).claimed,true);
      s=reload(parseBackup(createBackup(s)));assert.equal(submitWord(words[0],s).state.coins,s.coins);
      const done=finish(s);assert.equal(finish(done).coins,done.coins);
      for(const v of [1,2,3]) {
        const legacy={...fresh(),mode:'daily',daily:{dateKey:getDateKey(),levelVersion:v,solved:[],bonusFound:[],revealed:[],completed:false}};
        assert.equal(getDailyObjective(reload(legacy)).goal,3);assert.deepEqual(getLevel(reload(legacy)),getDailyLevel(now,v));
      }
      if(objective.kind==='long-targets') {
        // Put the second qualifying answer last. The objective must pay before completion advances.
        const short=level.targets.filter(w=>w.length<4);const longs=level.targets.filter(w=>w.length>=4);
        const finalState={...fresh(),mode:'daily',daily:{...fresh().daily,solved:[...short,...longs.slice(0,-1)],bonusFound:[],objectiveClaimed:false},dailyStats:{...fresh().dailyStats,objectiveDates:[]}};
        // If more than one long answer is already solved, goal was reached earlier; crafted unclaimed saves still claim exactly once.
        const r=submitWord(longs.at(-1),finalState); assert.equal(r.status,'level-complete'); assert.equal(r.state.coins,60);
        assert.equal(getDailyObjective(r.state).claimed,true);
      }
    }
    assert.deepEqual([...new Set(kinds)].sort(),['long-targets','one-bonus','two-bonus']);
  } finally {globalThis.Date=RealDate;}
});
