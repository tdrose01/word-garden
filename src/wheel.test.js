import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareWheel, wheelSpellsTarget } from './wheel.js';
import { levels, legacyLevels, versionTwoLevels, dailyLevels, legacyDailyLevels, versionTwoDailyLevels } from './levels.js';
const sorted = value => [...value].sort().join('');
test('all supported catalogs preserve duplicate letters without circular full-answer leaks, even with unlucky randomness', () => {
  for (const level of [...levels,...legacyLevels,...versionTwoLevels,...dailyLevels,...legacyDailyLevels,...versionTwoDailyLevels]) {
    for (const random of [()=>0,()=>0.999999]) {
      const result = prepareWheel(level,random);
      assert.equal(sorted(result),sorted(level.letters));
      assert.equal(wheelSpellsTarget(result,level.targets),false,level.title);
    }
  }
});
test('detects full-length anagrams, rotations and reverse rotations', () => {
  for (const word of ['RAPIDS','APIDSR','SDIPAR']) assert.equal(wheelSpellsTarget(word,['RAPIDS']),true);
  assert.equal(wheelSpellsTarget('RAPIDS',['RAPID']),false);
  assert.throws(()=>prepareWheel({letters:'AAA',targets:['AAA']},()=>0),/no answer-safe/);
});

test('swipe backtracks one letter at a time without reusing indices or breaking repeated letters', async () => {
 const { extendSelection } = await import('./wheel.js');
 let s=[];
 for(const i of [0,1,2]) s=extendSelection(s,i,'ABBA',true);
 assert.equal(extendSelection(s,0,'ABBA',true),s);
 assert.equal(extendSelection(s,2,'ABBA',true),s);
 s=extendSelection(s,1,'ABBA',true); assert.deepEqual(s.map(x=>x.index),[0,1]);
 s=extendSelection(s,0,'ABBA',true); assert.deepEqual(s.map(x=>x.index),[0]);
 s=extendSelection(s,3,'ABBA',true); assert.equal(s.map(x=>x.letter).join(''),'AA');
 assert.equal(extendSelection(s,0,'ABBA'),s);
});
