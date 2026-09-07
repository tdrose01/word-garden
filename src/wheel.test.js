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
