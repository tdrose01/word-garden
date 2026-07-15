import test from 'node:test';
import assert from 'node:assert/strict';
import { isDictionaryWord } from './dictionary.js';
import {
  canBuildWord,
  createSnapshot,
  getLevel,
  getProgress,
  loadState,
  resetState,
  setMode,
  submitWord,
  useHint
} from './game.js';
import { buildGrid, levels } from './levels.js';

test('validates whether a word can be built from wheel letters', () => {
  assert.equal(canBuildWord('plant', 'PLANT'), true);
  assert.equal(canBuildWord('plate', 'PLANT'), false);
  assert.equal(canBuildWord('llama', 'PLANT'), false);
});

test('target words fill progress without awarding bonus coins', () => {
  const state = { levelIndex: 0, coins: 40, solved: [], bonusFound: [], revealed: [] };
  const result = submitWord('plant', state);

  assert.equal(result.status, 'target');
  assert.deepEqual(result.state.solved, ['PLANT']);
  assert.equal(result.state.coins, 40);
});

test('solved words show every letter across intersecting down words', () => {
  const snapshot = createSnapshot({
    mode: 'campaign',
    levelIndex: 0,
    coins: 40,
    solved: ['PLANT'],
    bonusFound: [],
    revealed: []
  });
  const plant = snapshot.placements.find((placement) => placement.word === 'PLANT');
  const letters = Array.from('PLANT').map((_, index) => {
    const x = plant.x + index;
    const y = plant.y;
    return snapshot.cells.find((cell) => cell.x === x && cell.y === y)?.letter;
  });

  assert.deepEqual(letters, ['P', 'L', 'A', 'N', 'T']);
});

test('level 1 grid placements do not create coordinate letter conflicts', () => {
  const cells = new Map();

  for (const placement of buildGrid(levels[0].targets)) {
    Array.from(placement.word).forEach((letter, index) => {
      const x = placement.x + (placement.direction === 'across' ? index : 0);
      const y = placement.y + (placement.direction === 'down' ? index : 0);
      const key = `${x}:${y}`;

      assert.equal(cells.get(key) ?? letter, letter, `conflicting letter at ${key}`);
      cells.set(key, letter);
    });
  }
});

test('Brook grid keeps secondary words compactly crossed with the base word', () => {
  const placements = buildGrid(levels[1].targets);
  const cells = new Map();

  placements.forEach((placement) => {
    Array.from(placement.word).forEach((letter, index) => {
      const x = placement.x + (placement.direction === 'across' ? index : 0);
      const y = placement.y + (placement.direction === 'down' ? index : 0);
      const key = `${x}:${y}`;
      assert.equal(cells.get(key) ?? letter, letter, `conflicting letter at ${key}`);
      cells.set(key, letter);
    });
  });

  const xs = [...cells.keys()].map((key) => Number(key.split(':')[0]));
  const ys = [...cells.keys()].map((key) => Number(key.split(':')[1]));
  assert.equal(Math.max(...xs) - Math.min(...xs) + 1, 6);
  assert.equal(Math.max(...ys) - Math.min(...ys) + 1, 5);
  assert.equal(placements.filter((placement) => placement.direction === 'across').length, 2);
  assert.equal(placements.filter((placement) => placement.direction === 'down').length, 3);
});

test('campaign target words each add visible board space', () => {
  for (const level of levels) {
    const occupied = new Set();

    for (const placement of buildGrid(level.targets)) {
      const placementKeys = Array.from(placement.word).map((_, index) => {
        const x = placement.x + (placement.direction === 'across' ? index : 0);
        const y = placement.y + (placement.direction === 'down' ? index : 0);
        return `${x}:${y}`;
      });

      assert.equal(
        placementKeys.some((key) => !occupied.has(key)),
        true,
        `${level.title}: ${placement.word} should not be completely hidden by an earlier word`
      );
      placementKeys.forEach((key) => occupied.add(key));
    }
  }
});

test('completing all level 1 targets advances campaign to level 2', () => {
  let state = { levelIndex: 0, coins: 40, solved: [], bonusFound: [], revealed: [] };

  for (const target of levels[0].targets) {
    state = submitWord(target, state).state;
  }

  assert.equal(state.levelIndex, 1);
  assert.equal(getLevel(state).id, 2);
  assert.equal(getLevel(state).title, 'Brook');
  assert.deepEqual(state.solved, []);
  assert.equal(state.coins, 50);
});

test('target words take precedence over dictionary bonus matches', () => {
  const state = { levelIndex: 0, coins: 40, solved: [], bonusFound: [], revealed: [] };
  const result = submitWord('tap', state);

  assert.equal(result.status, 'target');
  assert.deepEqual(result.state.solved, ['TAP']);
  assert.deepEqual(result.state.bonusFound, []);
  assert.equal(result.state.coins, 40);
});

test('dictionary words count as bonus even when not listed on the level', () => {
  const state = { levelIndex: 0, coins: 40, solved: [], bonusFound: [], revealed: [] };
  const result = submitWord('alt', state);

  assert.equal(levels[0].bonus.includes('ALT'), false);
  assert.equal(result.status, 'bonus');
  assert.deepEqual(result.state.bonusFound, ['ALT']);
  assert.equal(result.state.coins, 42);
});

test('bonus words award coins only once', () => {
  const state = { levelIndex: 0, coins: 40, solved: [], bonusFound: [], revealed: [] };
  const first = submitWord('pan', state);
  const second = submitWord('pan', first.state);

  assert.equal(first.status, 'bonus');
  assert.equal(first.state.coins, 42);
  assert.equal(second.status, 'repeat');
  assert.equal(second.state.coins, 42);
});

test('rejects non-dictionary and non-buildable dictionary submissions', () => {
  const state = { levelIndex: 0, coins: 40, solved: [], bonusFound: [], revealed: [] };
  const nonDictionary = submitWord('tla', state);
  const nonBuildableDictionary = submitWord('plate', state);

  assert.equal(nonDictionary.status, 'invalid');
  assert.equal(nonDictionary.message, 'Not in this puzzle.');
  assert.equal(nonBuildableDictionary.status, 'invalid');
  assert.equal(nonBuildableDictionary.message, 'Those letters are not on the wheel.');
});

test('hint spends coins and records a revealed target letter', () => {
  const state = { levelIndex: 0, coins: 40, solved: [], bonusFound: [], revealed: [] };
  const result = useHint(state);

  assert.equal(result.status, 'hint');
  assert.equal(result.state.coins, 25);
  assert.deepEqual(result.state.revealed, ['PLANT:0']);
});

test('hint skips letters already shown by solved intersections', () => {
  const state = { levelIndex: 0, coins: 40, solved: ['PLANT'], bonusFound: [], revealed: [] };
  const result = useHint(state);

  assert.equal(result.status, 'hint');
  assert.equal(result.state.coins, 25);
  assert.deepEqual(result.state.revealed, ['PLAN:1']);
});

test('daily mode keeps progress separate from campaign progress', () => {
  const today = new Date().toISOString().slice(0, 10);
  const campaign = {
    mode: 'campaign',
    levelIndex: 0,
    coins: 40,
    solved: [],
    bonusFound: [],
    revealed: [],
    daily: { dateKey: today, solved: [], bonusFound: [], revealed: [], completed: false }
  };
  const daily = setMode(campaign, 'daily');
  const dailyLevel = getLevel(daily);
  const result = submitWord(dailyLevel.targets[0], daily);

  assert.equal(result.status, 'target');
  assert.deepEqual(result.state.solved, []);
  assert.deepEqual(getProgress(result.state).solved, [dailyLevel.targets[0]]);
});

test('daily completion extends streak and awards the current reward', () => {
  const today = new Date().toISOString().slice(0, 10);
  const yesterdayDate = new Date(`${today}T00:00:00.000Z`);
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
  const yesterday = yesterdayDate.toISOString().slice(0, 10);
  let state = {
    mode: 'daily',
    levelIndex: 0,
    coins: 40,
    solved: [],
    bonusFound: [],
    revealed: [],
    daily: { dateKey: today, solved: [], bonusFound: [], revealed: [], completed: false },
    dailyStats: { streak: 1, bestStreak: 1, lastCompletedDate: yesterday, reward: 10 }
  };

  assert.equal(createSnapshot(state).dailyStats.reward, 12);

  for (const target of getLevel(state).targets) {
    state = submitWord(target, state).state;
  }

  assert.equal(state.daily.completed, true);
  assert.equal(state.dailyStats.streak, 2);
  assert.equal(state.dailyStats.bestStreak, 2);
  assert.equal(state.dailyStats.lastCompletedDate, today);
  assert.equal(state.dailyStats.reward, 12);
  assert.equal(state.coins, 52);
});

test('campaign has an expanded curated path with buildable words', () => {
  assert.equal(levels.length >= 36, true);

  for (const level of levels) {
    assert.equal(typeof level.pack, 'string');
    assert.equal(level.targets.every((word) => canBuildWord(word, level.letters)), true);
    assert.equal(level.bonus.every((word) => canBuildWord(word, level.letters)), true);
    assert.equal([...level.targets, ...level.bonus].every((word) => isDictionaryWord(word)), true);
  }
});

test('campaign completion advances through the deeper path and updates snapshot stats', () => {
  let state = {
    mode: 'campaign',
    levelIndex: 4,
    coins: 40,
    solved: [],
    bonusFound: [],
    revealed: [],
    daily: { dateKey: new Date().toISOString().slice(0, 10), solved: ['MORNING'], bonusFound: [], revealed: [], completed: false },
    dailyStats: { streak: 1, bestStreak: 1, lastCompletedDate: '', reward: 10 }
  };

  for (const target of getLevel(state).targets) {
    state = submitWord(target, state).state;
  }

  const snapshot = createSnapshot(state);

  assert.equal(state.levelIndex, 5);
  assert.equal(state.coins, 75);
  assert.deepEqual(state.solved, []);
  assert.equal(snapshot.level.id, 6);
  assert.equal(snapshot.campaignStats.currentLevel, 6);
  assert.equal(snapshot.campaignStats.totalLevels, levels.length);
  assert.equal(snapshot.campaignStats.completedLevels, 5);
  assert.equal(snapshot.campaignStats.pathPercent, 14);
  assert.equal(snapshot.campaignStats.pack.title, 'Moss Trail');
  assert.equal(snapshot.campaignStats.pack.current, 1);
  assert.equal(snapshot.campaignStats.nextReward, 10);
  assert.equal(snapshot.campaignStats.milestone.remaining, 5);
  assert.deepEqual(state.daily.solved, ['MORNING']);
});

test('campaign milestone rewards pay extra coins every five cleared levels', () => {
  let state = {
    mode: 'campaign',
    levelIndex: 4,
    coins: 40,
    solved: [],
    bonusFound: [],
    revealed: [],
    campaign: { completedLevels: 4, bestRun: 4, lastCompletedLevelId: 4 }
  };
  let result;

  for (const target of getLevel(state).targets) {
    result = submitWord(target, state);
    state = result.state;
  }

  assert.equal(result.status, 'level-complete');
  assert.equal(result.message, 'Level 5 complete! Milestone bonus: +35 coins. Next: Level 6.');
  assert.equal(state.coins, 75);
  assert.equal(state.campaign.completedLevels, 5);
  assert.equal(state.campaign.bestRun, 5);
  assert.equal(createSnapshot(state).campaignStats.milestone.remaining, 5);
});

test('campaign advances through the full curated path before looping', () => {
  let state = {
    mode: 'campaign',
    levelIndex: 0,
    coins: 40,
    solved: [],
    bonusFound: [],
    revealed: []
  };

  for (const level of levels) {
    assert.equal(getLevel(state).id, level.id);
    for (const target of level.targets) {
      state = submitWord(target, state).state;
    }
  }

  const snapshot = createSnapshot(state);
  assert.equal(state.levelIndex, levels.length);
  assert.equal(getLevel(state).id, levels[0].id);
  assert.equal(snapshot.campaignStats.pathLoop, 2);
  assert.equal(snapshot.campaignStats.currentLevel, 1);
  assert.equal(state.coins, 40 + levels.length * 10 + Math.floor(levels.length / 5) * 25);
});

test('campaign stats report pack progress and path loops from level index', () => {
  const snapshot = createSnapshot({
    mode: 'campaign',
    levelIndex: levels.length + 6,
    coins: 40,
    solved: [],
    bonusFound: [],
    revealed: []
  });

  assert.equal(snapshot.campaignStats.pathLoop, 2);
  assert.equal(snapshot.campaignStats.currentLevel, 7);
  assert.equal(snapshot.campaignStats.pathPercent, 17);
  assert.equal(snapshot.campaignStats.pack.title, 'Moss Trail');
  assert.equal(snapshot.campaignStats.pack.current, 2);
  assert.equal(snapshot.campaignStats.pack.total, 5);
  assert.equal(snapshot.campaignStats.pack.percent, 20);
  assert.equal(snapshot.campaignStats.pack.remaining, 4);
  assert.equal(snapshot.campaignStats.pack.nextTitle, 'Grove Rise');
  assert.equal(snapshot.campaignStats.pack.isFinalLevel, false);
});

test('campaign stats mark final theme level before next theme unlocks', () => {
  const finalSeedlingSnapshot = createSnapshot({
    mode: 'campaign',
    levelIndex: 4,
    coins: 40,
    solved: [],
    bonusFound: [],
    revealed: []
  });

  assert.equal(finalSeedlingSnapshot.campaignStats.pack.title, 'Seedling Path');
  assert.equal(finalSeedlingSnapshot.campaignStats.pack.current, 5);
  assert.equal(finalSeedlingSnapshot.campaignStats.pack.remaining, 1);
  assert.equal(finalSeedlingSnapshot.campaignStats.pack.nextTitle, 'Moss Trail');
  assert.equal(finalSeedlingSnapshot.campaignStats.pack.isFinalLevel, true);

  let state = {
    mode: 'campaign',
    levelIndex: 4,
    coins: 40,
    solved: [],
    bonusFound: [],
    revealed: []
  };

  for (const target of getLevel(state).targets) {
    state = submitWord(target, state).state;
  }

  const nextThemeSnapshot = createSnapshot(state);
  assert.equal(nextThemeSnapshot.campaignStats.pack.title, 'Moss Trail');
  assert.equal(nextThemeSnapshot.campaignStats.pack.current, 1);
  assert.equal(nextThemeSnapshot.campaignStats.currentLevel, 6);
});

test('fresh campaign starts at visible level 1 with the first puzzle', () => {
  const storage = createMemoryStorage();
  const state = loadState(storage, () => 0.5);
  const snapshot = createSnapshot(state);

  assert.equal(state.levelIndex, 0);
  assert.equal(state.campaign.completedLevels, 0);
  assert.equal(snapshot.campaignStats.currentLevel, 1);
  assert.equal(snapshot.campaignStats.pathPercent, 0);
  assert.equal(getLevel(state).id, 1);
  assert.deepEqual(state.campaign.puzzleOrder.slice(0, 3), [0, 1, 2]);
  assert.equal(getLevel(state).title, 'Meadow');
});

test('reset clears progress and returns to the first puzzle', () => {
  const storage = createMemoryStorage({
    'word-garden-state': JSON.stringify({
      mode: 'campaign',
      levelIndex: 12,
      coins: 76,
      solved: ['SUN'],
      bonusFound: ['RUN'],
      revealed: ['SUN:0']
    })
  });

  const state = resetState(storage, () => 0.25);

  assert.equal(state.levelIndex, 0);
  assert.equal(createSnapshot(state).campaignStats.currentLevel, 1);
  assert.equal(getLevel(state).id, 1);
  assert.deepEqual(state.campaign.puzzleOrder.slice(0, 3), [0, 1, 2]);
  assert.equal(getLevel(state).title, 'Meadow');
  assert.deepEqual(state.solved, []);
  assert.deepEqual(state.bonusFound, []);
  assert.deepEqual(state.revealed, []);
  assert.equal(state.coins, 40);
  assert.equal(state.campaign.completedLevels, 0);
});

test('old random-start saves migrate back to the first puzzle', () => {
  const storage = createMemoryStorage({
    'word-garden-state': JSON.stringify({
      mode: 'campaign',
      levelIndex: 30,
      coins: 40,
      solved: [],
      bonusFound: [],
      revealed: [],
      campaign: { completedLevels: 0, bestRun: 0, lastCompletedLevelId: 0 },
      startRandomizerVersion: 1
    })
  });

  const state = loadState(storage, () => 0.75);

  assert.equal(state.levelIndex, 0);
  assert.equal(createSnapshot(state).campaignStats.currentLevel, 1);
  assert.equal(getLevel(state).id, 1);
  assert.deepEqual(state.campaign.puzzleOrder.slice(0, 3), [0, 1, 2]);
  assert.equal(state.campaign.completedLevels, 0);
});

test('old random-start saves without campaign progress migrate to visible level 1', () => {
  const storage = createMemoryStorage({
    'word-garden-state': JSON.stringify({
      mode: 'campaign',
      levelIndex: 30,
      coins: 40,
      solved: [],
      bonusFound: [],
      revealed: [],
      startRandomizerVersion: 1
    })
  });

  const state = loadState(storage, () => 0.25);

  assert.equal(state.levelIndex, 0);
  assert.equal(createSnapshot(state).campaignStats.currentLevel, 1);
  assert.equal(getLevel(state).id, 1);
  assert.deepEqual(state.campaign.puzzleOrder.slice(0, 3), [0, 1, 2]);
  assert.equal(state.campaign.completedLevels, 0);
});

test('campaign puzzle order follows the visible level path', () => {
  const storage = createMemoryStorage();
  const state = loadState(storage, () => 0.5);
  assert.deepEqual(state.campaign.puzzleOrder, levels.map((_, index) => index));
});

function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));

  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}
