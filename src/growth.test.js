import test from 'node:test';
import assert from 'node:assert/strict';
import { loadState, saveState, createSnapshot, getLevel, submitWord, useHint, setMode } from './game.js';
import { levels, legacyLevels, dailyLevels, getDailyLevel, getDateKey, buildGrid } from './levels.js';
const storage = (value) => ({ value: JSON.stringify(value ?? null), getItem() { return this.value; }, setItem(_, value) { this.value = value; } });
const fresh = () => loadState(storage());
const finish = state => getLevel(state).targets.reduce((next, word) => submitWord(word, next).state, state);

test('common STONE bonus words bank once and enforce letter counts', () => {
  const state = {...fresh(), levelIndex: 1, campaign: undefined};
  for (const word of ['SENT', 'NEST', 'NOSE', 'ONSET', 'TOES']) {
    const result = submitWord(word, state);
    assert.equal(result.status, 'bonus', word);
    assert.equal(submitWord(word, result.state).state.coins, result.state.coins);
  }
  assert.equal(submitWord('STONES', state).status, 'invalid');
});

test('legacy campaign board survives save/reload then moves to new difficulty', () => {
  const old = { levelIndex: 23, coins: 40, solved: ['HARVEST'], revealed: ['HEART:0'], bonusFound: [] };
  const store = storage(old);
  let state = loadState(store);
  assert.deepEqual(getLevel(state).targets, legacyLevels[23].targets);
  saveState(state, store);
  state = loadState(store);
  assert.deepEqual(state.solved, old.solved);
  state = finish(state);
  assert.equal(getLevel(state).targets.length, 7);
  assert.equal(state.campaignLevelVersion, 3);
});

test('legacy current daily remains pinned while fresh daily uses new rotation', () => {
  const dateKey = getDateKey();
  const oldLevel = getDailyLevel(new Date(), 1);
  const state = loadState(storage({ ...fresh(), daily: {dateKey, solved: [oldLevel.targets[0]], revealed: [], bonusFound: [], completed: false} }));
  assert.deepEqual(getLevel(setMode(state, 'daily')).targets, oldLevel.targets);
  assert.equal(setMode(fresh(), 'daily').daily.levelVersion, 3);
});

test('daily rotation has no duplicate actual puzzles during entire 41-day cycle', () => {
  const signatures = [];
  for (let day = 0; day < dailyLevels.length; day++) {
    const date = new Date(Date.UTC(2026, 8, 20 + day));
    const level = getDailyLevel(date);
    signatures.push(`${level.letters}:${[...level.targets].sort().join(',')}`);
    assert.deepEqual(getDailyLevel(date), level);
  }
  assert.equal(new Set(signatures).size, dailyLevels.length);
  assert.ok(dailyLevels.length >= 36);
  assert.deepEqual([...new Set(levels.map(level => level.targets.length))], [5, 6, 7]);
});

test('targeted hints reveal selected cells, skip shared visible letters, and never charge invalid selection', () => {
  let state = fresh();
  const cellKey = createSnapshot(state).hintOptions.cells.at(-1);
  state = useHint(state, {type: 'reveal', cellKey}).state;
  assert.equal(state.coins, 30);
  assert.ok(createSnapshot(state).cells.find(cell => `${cell.x}:${cell.y}` === cellKey).letter);
  assert.equal(useHint(state, {type: 'reveal', cellKey}).state, state);
  assert.equal(useHint(state, {type: 'clue', targetIndex: -1}).state, state);
  state = submitWord('PLANT', state).state;
  const before = createSnapshot(state).hintOptions.cells.length;
  const result = useHint(state, {type: 'clue', targetIndex: 1});
  assert.equal(result.state.coins, 25);
  assert.equal(createSnapshot(result.state).hintOptions.cells.length, before - 1);
  assert.ok(createSnapshot(state).hintOptions.words.every(word => !('target' in word)));
});

test('cheap clue and one rescue per puzzle prevent unaffordable-hint loop', () => {
  let state = {...fresh(), coins: 5};
  assert.equal(useHint(state).status, 'blocked');
  state = useHint(state, {type: 'clue', targetIndex: 0}).state;
  assert.equal(state.coins, 0);
  assert.equal(createSnapshot(state).hintOptions.freeRescueAvailable, true);
  state = useHint(state).state;
  assert.equal(state.coins, 0);
  assert.equal(useHint(state).status, 'blocked');
  const store = storage(); saveState(state, store);
  assert.equal(useHint(loadState(store)).status, 'blocked');
  assert.equal(finish(state).rescueUsed, false);
});

test('garden migrates historical minimum and rewards daily completion only once', () => {
  let state = setMode(fresh(), 'daily');
  state = finish(state);
  assert.equal(createSnapshot(state).gardenStats.dailyCompletions, 1);
  const coins = state.coins;
  state = finish(state);
  assert.equal(state.coins, coins);
  assert.equal(createSnapshot(state).gardenStats.dailyCompletions, 1);
  const migrated = loadState(storage({ ...state, dailyStats: {streak: 2, bestStreak: 4, lastCompletedDate: getDateKey()}, campaign: {completedLevels: 6} }));
  const garden = createSnapshot(migrated).gardenStats;
  assert.equal(garden.dailyCompletions, 4);
  assert.equal(garden.flowers, 10);
  assert.equal(garden.trees, 2);
  assert.equal(garden.butterflies, 1);
});

test('all board segments are actual targets, preventing phantom NETOE words', () => {
  for (const level of [...levels, ...dailyLevels]) {
    const occupied = new Map();
    for (const p of buildGrid(level.targets)) {
      [...p.word].forEach((letter, i) => occupied.set(`${p.x + (p.direction === 'across' ? i : 0)}:${p.y + (p.direction === 'down' ? i : 0)}`, letter));
    }
    for (const key of occupied.keys()) {
      const [x, y] = key.split(':').map(Number);
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        if (occupied.has(`${x-dx}:${y-dy}`)) continue;
        let segment = '', i = 0;
        while (occupied.has(`${x+dx*i}:${y+dy*i}`)) { segment += occupied.get(`${x+dx*i}:${y+dy*i}`); i++; }
        if (segment.length > 1) assert.ok(level.targets.includes(segment), `${level.title}: phantom ${segment}`);
      }
    }
  }
});
