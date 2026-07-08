import { isDictionaryWord } from './dictionary.js';
import { buildGrid, getDailyLevel, getDateKey, levels } from './levels.js';
import { canBuildWord, normalizeWord } from './word-utils.js';

export { canBuildWord };

const STORAGE_KEY = 'word-garden-state';
const CAMPAIGN_MILESTONE_EVERY = 5;
const CAMPAIGN_MILESTONE_REWARD = 25;

export function loadState(storage = window.localStorage, random = Math.random) {
  try {
    const stored = JSON.parse(storage.getItem(STORAGE_KEY) || 'null');
    if (!stored) {
      return createInitialState(random);
    }

    return normalizeState(stored, random);
  } catch {
    return createInitialState(random);
  }
}

export function saveState(state, storage = window.localStorage) {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function resetState(storage = window.localStorage, random = Math.random) {
  storage.removeItem(STORAGE_KEY);
  return loadState(storage, random);
}

export function getLevel(state) {
  if (state.mode === 'daily') {
    const progress = getDailyProgress(state);
    return getDailyLevel(new Date(`${progress.dateKey}T00:00:00.000Z`));
  }

  return levels[getCampaignPuzzleIndex(state)];
}

export function getProgress(state) {
  return state.mode === 'daily' ? getDailyProgress(state) : state;
}

export function setMode(state, mode) {
  return normalizeState({ ...state, mode });
}

export function createSnapshot(state) {
  const level = getLevel(state);
  const placements = buildGrid(level.targets);
  const progress = getProgress(state);

  return {
    level,
    placements,
    progress,
    campaignStats: createCampaignStats(state),
    dailyStats: getDailyStatsView(state),
    cells: buildCells(placements, progress)
  };
}

export function submitWord(input, state) {
  const word = normalizeWord(input);
  const level = getLevel(state);
  const progress = getProgress(state);

  if (!canBuildWord(word, level.letters)) {
    return { state, status: 'invalid', message: 'Those letters are not on the wheel.' };
  }

  if (level.targets.includes(word)) {
    if (progress.solved.includes(word)) {
      return { state, status: 'repeat', message: 'Already solved.' };
    }

    const solved = [...progress.solved, word];
    let nextState = updateProgress(state, { ...progress, solved });

    if (solved.length === level.targets.length) {
      const reward = getCompletionReward(state);
      const completionState = { ...nextState, coins: nextState.coins + reward };
      const completedLevelNumber = getCampaignProgress(state).completedLevels + 1;
      nextState = advanceLevel(completionState);
      return {
        state: nextState,
        status: 'level-complete',
        message: completionMessage(state.mode, reward, completedLevelNumber, nextState)
      };
    }

    return { state: nextState, status: 'target', message: 'Nice find.' };
  }

  if (isDictionaryWord(word)) {
    if (progress.bonusFound.includes(word)) {
      return { state, status: 'repeat', message: 'Bonus already banked.' };
    }

    return {
      state: updateProgress(
        { ...state, coins: state.coins + 2 },
        { ...progress, bonusFound: [...progress.bonusFound, word] }
      ),
      status: 'bonus',
      message: 'Bonus word. +2 coins.'
    };
  }

  return { state, status: 'invalid', message: 'Not in this puzzle.' };
}

export function useHint(state) {
  if (state.coins < 15) {
    return { state, status: 'blocked', message: 'Need 15 coins for a hint.' };
  }

  const level = getLevel(state);
  const progress = getProgress(state);
  const placements = buildGrid(level.targets);
  const visibleCells = new Set(
    buildCells(placements, progress)
      .filter((cell) => cell.letter)
      .map((cell) => `${cell.x}:${cell.y}`)
  );
  const unsolvedTargets = level.targets.filter((word) => !progress.solved.includes(word));
  if (unsolvedTargets.length === 0) {
    return { state, status: 'blocked', message: 'No hints needed.' };
  }

  for (const target of unsolvedTargets) {
    const placement = placements.find((candidate) => candidate.word === target);
    if (!placement) {
      continue;
    }

    for (let index = 0; index < target.length; index += 1) {
      const key = `${target}:${index}`;
      const cellKey = getPlacementCellKey(placement, index);
      if (!visibleCells.has(cellKey)) {
        return {
          state: updateProgress(
            { ...state, coins: state.coins - 15 },
            { ...progress, revealed: [...progress.revealed, key] }
          ),
          status: 'hint',
          message: 'One letter revealed.'
        };
      }
    }
  }

  return { state, status: 'blocked', message: 'Try another word.' };
}

export function shuffleLetters(letters) {
  const next = letters.split('');
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next.join('');
}

function buildCells(placements, state) {
  const cellMap = new Map();

  placements.forEach((placement) => {
    Array.from(placement.word).forEach((letter, index) => {
      const key = `${placement.x + (placement.direction === 'across' ? index : 0)}:${placement.y + (placement.direction === 'down' ? index : 0)}`;
      const revealKey = `${placement.word}:${index}`;
      const solved = state.solved.includes(placement.word);
      const revealed = state.revealed.includes(revealKey);
      const current = cellMap.get(key);

      cellMap.set(key, {
        x: placement.x + (placement.direction === 'across' ? index : 0),
        y: placement.y + (placement.direction === 'down' ? index : 0),
        letter: solved || revealed ? letter : current?.letter || '',
        solved: solved || current?.solved || false,
        revealed: revealed || current?.revealed || false
      });
    });
  });

  return [...cellMap.values()];
}

function getPlacementCellKey(placement, index) {
  const x = placement.x + (placement.direction === 'across' ? index : 0);
  const y = placement.y + (placement.direction === 'down' ? index : 0);
  return `${x}:${y}`;
}

function getCampaignPuzzleIndex(state) {
  const campaign = getCampaignProgress(state);
  const orderIndex = campaign.completedLevels % campaign.puzzleOrder.length;
  const puzzleIndex = campaign.puzzleOrder[orderIndex];
  return Number.isInteger(puzzleIndex) && puzzleIndex >= 0 && puzzleIndex < levels.length ? puzzleIndex : 0;
}

function advanceLevel(state) {
  if (state.mode === 'daily') {
    const daily = getDailyProgress(state);
    const dailyStats = getDailyStats(state);

    return {
      ...state,
      daily: {
        ...daily,
        completed: true
      },
      dailyStats: completeDailyStats(dailyStats, daily.dateKey)
    };
  }

  const completedLevelNumber = getCampaignProgress(state).completedLevels + 1;
  const campaign = completeCampaignProgress(getCampaignProgress(state), completedLevelNumber);

  return {
    ...state,
    mode: 'campaign',
    levelIndex: state.levelIndex + 1,
    coins: state.coins,
    solved: [],
    bonusFound: [],
    revealed: [],
    campaign,
    daily: getDailyProgress(state),
    dailyStats: getDailyStats(state)
  };
}

function normalizeState(state, random) {
  const campaign = getCampaignProgress(state, random);

  return {
    ...state,
    mode: state.mode === 'daily' ? 'daily' : 'campaign',
    levelIndex: campaign.completedLevels,
    solved: Array.isArray(state.solved) ? state.solved : [],
    bonusFound: Array.isArray(state.bonusFound) ? state.bonusFound : [],
    revealed: Array.isArray(state.revealed) ? state.revealed : [],
    campaign,
    daily: getDailyProgress(state),
    dailyStats: getDailyStats(state)
  };
}

function createInitialState(random = Math.random) {
  return {
    mode: 'campaign',
    levelIndex: 0,
    coins: 40,
    solved: [],
    bonusFound: [],
    revealed: [],
    campaign: createCampaignProgress(random),
    daily: createDailyProgress(),
    dailyStats: createDailyStats()
  };
}

function createCampaignStats(state) {
  const levelIndex = Number.isFinite(state.levelIndex) && state.levelIndex >= 0 ? state.levelIndex : 0;
  const totalLevels = levels.length;
  const pathIndex = levelIndex % totalLevels;
  const campaign = getCampaignProgress(state);
  const completedInJourney = campaign.completedLevels % totalLevels;
  const pathLoop = Math.floor(campaign.completedLevels / totalLevels) + 1;
  const level = levels[pathIndex];
  const pack = level.pack || 'Garden Path';
  const packLevels = levels.filter((candidate) => (candidate.pack || 'Garden Path') === pack);
  const packStart = levels.findIndex((candidate) => (candidate.pack || 'Garden Path') === pack);
  const packEnd = packStart + packLevels.length;
  const completedInPack = levels
    .slice(0, pathIndex)
    .filter((candidate) => (candidate.pack || 'Garden Path') === pack).length;
  const nextPack = levels[packEnd] || levels[0];
  const nextMilestoneAt =
    Math.floor(campaign.completedLevels / CAMPAIGN_MILESTONE_EVERY) * CAMPAIGN_MILESTONE_EVERY + CAMPAIGN_MILESTONE_EVERY;

  return {
    currentLevel: pathIndex + 1,
    totalLevels,
    completedLevels: campaign.completedLevels,
    bestRun: campaign.bestRun,
    lastCompletedLevelId: campaign.lastCompletedLevelId,
    pathLoop,
    pathPercent: Math.round((completedInJourney / totalLevels) * 100),
    nextReward: 10,
    milestone: {
      every: CAMPAIGN_MILESTONE_EVERY,
      nextAt: nextMilestoneAt,
      remaining: nextMilestoneAt - campaign.completedLevels,
      reward: CAMPAIGN_MILESTONE_REWARD
    },
    pack: {
      title: pack,
      current: completedInPack + 1,
      total: packLevels.length,
      percent: Math.round((completedInPack / packLevels.length) * 100),
      remaining: packLevels.length - completedInPack,
      nextTitle: nextPack.pack || 'Garden Path',
      isFinalLevel: completedInPack + 1 === packLevels.length
    }
  };
}

function createCampaignProgress(random) {
  return {
    completedLevels: 0,
    bestRun: 0,
    lastCompletedLevelId: 0,
    puzzleOrder: createSequentialPuzzleOrder()
  };
}

function createCampaignPuzzleOrder(random) {
  return createSequentialPuzzleOrder();
}

function createSequentialPuzzleOrder() {
  return levels.map((_, index) => index);
}

function normalizePuzzleOrder(order) {
  if (!Array.isArray(order) || order.length !== levels.length) {
    return null;
  }

  const unique = new Set(order);
  if (unique.size !== levels.length) {
    return null;
  }

  const isValid = order.every((index) => Number.isInteger(index) && index >= 0 && index < levels.length);
  return isValid ? order : null;
}

function getCampaignProgress(state, random) {
  const campaign = state.campaign || {};
  const fallbackCompleted =
    state.startRandomizerVersion && isUnclearedCampaignState(state) && !Number.isFinite(campaign.completedLevels)
      ? 0
      : state.levelIndex;
  const completedLevels = Number.isFinite(campaign.completedLevels)
    ? Math.max(0, campaign.completedLevels)
    : Math.max(0, Number.isFinite(fallbackCompleted) ? fallbackCompleted : 0);

  return {
    completedLevels,
    bestRun: Number.isFinite(campaign.bestRun) ? Math.max(0, campaign.bestRun) : completedLevels,
    lastCompletedLevelId: Number.isFinite(campaign.lastCompletedLevelId) ? campaign.lastCompletedLevelId : 0,
    puzzleOrder: createCampaignPuzzleOrder(random)
  };
}

function isUnclearedCampaignState(state) {
  return (
    state.mode !== 'daily' &&
    (state.coins === undefined || state.coins === 40) &&
    (!Array.isArray(state.solved) || state.solved.length === 0) &&
    (!Array.isArray(state.bonusFound) || state.bonusFound.length === 0) &&
    (!Array.isArray(state.revealed) || state.revealed.length === 0)
  );
}

function completeCampaignProgress(campaign, completedLevelNumber) {
  const completedLevels = campaign.completedLevels + 1;

  return {
    ...campaign,
    completedLevels,
    bestRun: Math.max(campaign.bestRun, completedLevels),
    lastCompletedLevelId: completedLevelNumber
  };
}

function createDailyProgress(date = new Date()) {
  return {
    dateKey: getDateKey(date),
    solved: [],
    bonusFound: [],
    revealed: [],
    completed: false
  };
}

function getDailyProgress(state) {
  const today = getDateKey();
  if (!state.daily || state.daily.dateKey !== today) {
    return createDailyProgress();
  }

  return {
    dateKey: today,
    solved: Array.isArray(state.daily.solved) ? state.daily.solved : [],
    bonusFound: Array.isArray(state.daily.bonusFound) ? state.daily.bonusFound : [],
    revealed: Array.isArray(state.daily.revealed) ? state.daily.revealed : [],
    completed: Boolean(state.daily.completed)
  };
}

function createDailyStats() {
  return {
    streak: 0,
    bestStreak: 0,
    lastCompletedDate: '',
    reward: 10
  };
}

function getDailyStats(state) {
  const stats = state.dailyStats || {};
  return {
    streak: Number.isFinite(stats.streak) ? stats.streak : 0,
    bestStreak: Number.isFinite(stats.bestStreak) ? stats.bestStreak : 0,
    lastCompletedDate: typeof stats.lastCompletedDate === 'string' ? stats.lastCompletedDate : '',
    reward: Number.isFinite(stats.reward) ? stats.reward : 10
  };
}

function getDailyStatsView(state) {
  const stats = getDailyStats(state);
  const daily = getDailyProgress(state);

  if (daily.completed) {
    return stats;
  }

  return {
    ...stats,
    reward: getDailyReward(stats, daily.dateKey)
  };
}

function completeDailyStats(stats, dateKey) {
  if (stats.lastCompletedDate === dateKey) {
    return {
      streak: stats.streak,
      bestStreak: stats.bestStreak,
      lastCompletedDate: stats.lastCompletedDate,
      reward: 0
    };
  }

  const streak = getDailyStreak(stats, dateKey);

  return {
    streak,
    bestStreak: Math.max(stats.bestStreak, streak),
    lastCompletedDate: dateKey,
    reward: getDailyReward(stats, dateKey)
  };
}

function getDailyStreak(stats, dateKey) {
  const yesterdayDate = new Date(dateKey + 'T00:00:00.000Z');
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
  const yesterday = getDateKey(yesterdayDate);

  return stats.lastCompletedDate === yesterday ? stats.streak + 1 : 1;
}

function getDailyReward(stats, dateKey) {
  if (stats.lastCompletedDate === dateKey) {
    return 0;
  }

  const streak = getDailyStreak(stats, dateKey);
  return 10 + Math.min(streak - 1, 6) * 2;
}

function getCompletionReward(state) {
  if (state.mode === 'daily') {
    return getDailyStatsView(state).reward;
  }

  const campaign = getCampaignProgress(state);
  const nextCompleted = campaign.completedLevels + 1;
  const milestoneReward = nextCompleted % CAMPAIGN_MILESTONE_EVERY === 0 ? CAMPAIGN_MILESTONE_REWARD : 0;
  return 10 + milestoneReward;
}

function updateProgress(state, progress) {
  if (state.mode === 'daily') {
    return {
      ...state,
      daily: progress
    };
  }

  return {
    ...state,
    solved: progress.solved,
    bonusFound: progress.bonusFound,
    revealed: progress.revealed
  };
}

function completionMessage(mode, reward, completedLevelNumber, state) {
  if (mode === 'daily') {
    return `Daily complete. +${reward} coins.`;
  }

  const campaign = getCampaignProgress(state);
  const nextLevelNumber = createCampaignStats(state).currentLevel;
  return campaign.completedLevels % CAMPAIGN_MILESTONE_EVERY === 0
    ? `Level ${completedLevelNumber} complete! Milestone bonus: +${reward} coins. Next: Level ${nextLevelNumber}.`
    : `Level ${completedLevelNumber} complete! +${reward} coins. Next: Level ${nextLevelNumber}.`;
}
