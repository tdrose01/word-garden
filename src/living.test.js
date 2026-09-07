import test from 'node:test';
import assert from 'node:assert/strict';
import { levels, dailyLevels, legacyLevels, versionTwoLevels, versionTwoDailyLevels, getDailyLevel, getDateKey, buildGrid } from './levels.js';
import { curatedDictionary, getBuildableDictionaryWords } from './dictionary.js';
import { canBuildWord, loadState, saveState, createSnapshot, getLevel, getProgress, submitWord, useHint, setMode, startReplay, exitReplay, plantSeed, updateSettings } from './game.js';
const storage = value => ({ value: JSON.stringify(value ?? null), getItem() { return this.value; }, setItem(_, value) { this.value = value; } });
const fresh = () => loadState(storage());
const finish = state => getLevel(state).targets.reduce((next, word) => submitWord(word, next).state, state);
const signature = level => `${[...level.letters].sort().join('')}:${[...level.targets].sort().join(',')}`;

test('100 curated campaign boards and 41 exclusive daily boards are solvable and fit proven bounds', () => {
  assert.ok(levels.length >= 100);
  assert.ok(dailyLevels.length >= 41);
  const campaign = new Set(levels.map(signature));
  assert.equal(campaign.size, levels.length);
  assert.equal(new Set([...levels, ...dailyLevels].map(level => [...level.letters].sort().join(''))).size, levels.length + dailyLevels.length);
  assert.equal(new Set(dailyLevels.map(signature)).size, dailyLevels.length);
  for (const level of [...levels, ...dailyLevels]) {
    assert.ok(level.letters.length <= 9);
    assert.equal(new Set(level.targets).size, level.targets.length);
    for (const word of [...level.targets, ...level.bonus]) assert.ok(canBuildWord(word, level.letters), `${level.letters}: ${word}`);
    const placements = buildGrid(level.targets);
    const width = Math.max(...placements.map(p => p.x + (p.direction === 'across' ? p.word.length : 1)));
    const height = Math.max(...placements.map(p => p.y + (p.direction === 'down' ? p.word.length : 1)));
    assert.ok(width <= 13 && height <= 11, `${level.letters}: ${width}×${height}`);
  }
  for (const level of dailyLevels) {
    assert.ok(!campaign.has(signature(level)), level.letters);
    assert.ok(getBuildableDictionaryWords(level.letters).filter(word => !level.targets.includes(word)).length >= 3, level.letters);
  }
});

test('broader ordinary vocabulary is accepted but impossible and unknown words are rejected', () => {
  assert.ok(curatedDictionary.length > 2200);
  for (const [letters, words] of [['HARVEST', ['RAT', 'TAR', 'RATS']], ['SPROUT', ['OPT', 'PRO']], ['LAVENDER', ['LAND', 'LEAD', 'LEND']]]) {
    const state = { ...fresh(), campaign: undefined, levelIndex: levels.findIndex(level => level.letters === letters) };
    for (const word of words) assert.equal(submitWord(word, state).status, 'bonus', word);
    assert.equal(submitWord('ZZZZ', state).status, 'invalid');
    assert.equal(submitWord('AAAA', state).status, 'invalid');
  }
  assert.equal(submitWord('PTNAL', fresh()).status, 'invalid');
});

test('legacy campaign saves keep their actual board after multiple old 36-board loops', () => {
  for (const version of [1, 2]) {
    const original = { mode: 'campaign', levelIndex: 40, campaignLevelVersion: version, campaign: { completedLevels: 40 }, coins: 19, solved: ['FOREST'], revealed: ['FROST:0'], bonusFound: ['FOR'] };
    const store = storage(original);
    let state = loadState(store);
    assert.deepEqual(getLevel(state), (version === 1 ? legacyLevels : versionTwoLevels)[4]);
    assert.equal(createSnapshot(state).campaignStats.completedLevels, 40);
    assert.equal(createSnapshot(state).gardenStats.completedPacks, 7);
    saveState(state, store); state = loadState(store);
    assert.deepEqual(state.solved, original.solved); assert.deepEqual(state.revealed, original.revealed);
    assert.deepEqual(state.bonusFound, original.bonusFound); assert.equal(state.coins, 19);
    state = finish(state);
    assert.equal(getLevel(state).id, 6); assert.equal(state.campaignLevelVersion, 3);
    assert.equal(state.campaign.completedLevels, 41);
    assert.equal(createSnapshot(state).gardenStats.completedPacks, 8);
    assert.equal(createSnapshot(state).levelMap.filter(level => level.completed).length, 36);
  }
});

test('legacy daily versions retain the current puzzle and switch new dates to the exclusive pool', () => {
  for (const version of [1, 2]) {
    const oldLevel = getDailyLevel(new Date(), version);
    const original = { ...fresh(), mode: 'daily', daily: { dateKey: getDateKey(), levelVersion: version, solved: [oldLevel.targets[0]], revealed: [], bonusFound: [], completed: false } };
    const state = loadState(storage(original));
    assert.deepEqual(getLevel(state), oldLevel);
    const rolled = loadState(storage({ ...state, daily: { ...state.daily, dateKey: '2000-01-01' } }));
    assert.equal(rolled.daily.levelVersion, 3);
    assert.deepEqual(getLevel(rolled), getDailyLevel());
  }
  assert.equal(versionTwoDailyLevels.length, 41);
});

test('starter seed, placement, growth, plot expansion and duplicate planting survive reload', () => {
  let state = fresh();
  assert.equal(createSnapshot(state).gardenStats.seedCredits, 1);
  const planted = plantSeed(state, { plotIndex: 0, plantId: 'poppy' });
  assert.equal(planted.status, 'planted'); state = planted.state;
  assert.equal(createSnapshot(state).gardenStats.seedCredits, 0);
  assert.equal(plantSeed(state, { plotIndex: 0, plantId: 'rose' }).state, state);
  assert.equal(plantSeed(state, { plotIndex: 1, plantId: 'rose' }).status, 'blocked');
  assert.equal(plantSeed(state, { plotIndex: 9, plantId: 'poppy' }).status, 'blocked');
  const store = storage(); saveState(state, store); state = loadState(store);
  assert.equal(createSnapshot(state).gardenStats.plots[0].plantId, 'poppy');
  state = finish(finish(state));
  assert.equal(createSnapshot(state).gardenStats.plots[0].stage, 'growing');
  for (let index = 0; index < 3; index++) state = finish(state);
  const garden = createSnapshot(state).gardenStats;
  assert.equal(garden.plots[0].stage, 'blooming'); assert.equal(garden.unlockedPlots, 8);
  assert.equal(garden.seedCredits, 5);
});

test('daily three-bonus reward is reachable and paid once across completion and reload', () => {
  let state = setMode(fresh(), 'daily');
  const bonuses = getBuildableDictionaryWords(getLevel(state).letters).filter(word => !getLevel(state).targets.includes(word));
  const coins = state.coins;
  for (const word of bonuses.slice(0, 3)) state = submitWord(word, state).state;
  assert.equal(state.coins, coins + 6 + 10);
  assert.equal(createSnapshot(state).dailyObjective.claimed, true);
  const store = storage(); saveState(state, store); state = loadState(store);
  assert.equal(submitWord(bonuses[0], state).state.coins, state.coins);
  const afterObjective = state.coins; state = finish(state);
  assert.equal(state.coins, afterObjective + 10);
  assert.equal(finish(state).coins, state.coins);
  assert.equal(createSnapshot(state).gardenStats.seedCredits, 2);
});

test('replay cannot farm coins, objective rewards or garden seeds and preserves active progress', () => {
  let original = finish(fresh()); original = submitWord(getLevel(original).targets[0], original).state;
  original = useHint(original).state;
  original = setMode(original, 'daily'); original = submitWord(getLevel(original).targets[0], original).state;
  original = setMode(original, 'campaign');
  assert.equal(startReplay(fresh(), 0).status, 'blocked');
  let state = startReplay(original, 0).state;
  assert.equal(state.mode, 'replay');
  assert.equal(startReplay(state, 99).status, 'blocked');
  state = useHint(state).state;
  state = submitWord('NAP', state).state;
  state = finish(state);
  assert.equal(state.mode, 'replay'); assert.equal(state.replay.completed, true);
  assert.equal(state.coins, original.coins);
  assert.deepEqual(state.campaign, original.campaign);
  assert.deepEqual(state.daily, original.daily);
  assert.equal(createSnapshot(state).gardenStats.seedCredits, createSnapshot(original).gardenStats.seedCredits);
  const store = storage(); saveState(state, store); state = loadState(store);
  assert.equal(state.mode, 'replay'); assert.equal(getLevel(state).id, 1);
  state = exitReplay(state);
  assert.deepEqual(state.solved, original.solved); assert.deepEqual(state.revealed, original.revealed);
  assert.deepEqual(state.bonusFound, original.bonusFound); assert.equal(getLevel(state).id, 2);
});

test('sound and haptic choices persist independently without changing gameplay', () => {
  const original = fresh();
  const state = updateSettings(original, { sound: true, haptics: false, coins: 999 });
  const store = storage(); saveState(state, store);
  assert.deepEqual(createSnapshot(loadState(store)).settings, { sound: true, haptics: false });
  assert.equal(state.coins, original.coins);
  assert.deepEqual(updateSettings(state, { sound: 'false' }).settings, state.settings);
});
