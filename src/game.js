import { isDictionaryWord } from './dictionary.js';
import { buildGrid, getDailyLevel, getDateKey, levels, legacyLevels, LEVEL_VERSION } from './levels.js';
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
    return getDailyLevel(new Date(`${progress.dateKey}T00:00:00.000Z`), progress.levelVersion);
  }

  return state.campaignLevelVersion === 1 ? legacyLevels[getCampaignPuzzleIndex(state)] : levels[getCampaignPuzzleIndex(state)];
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
    gardenStats: createGardenStats(state),
    hintOptions: createHintOptions(state, placements, progress),
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

export function useHint(state, options = {}) {
  const level = getLevel(state);
  const progress = getProgress(state);
  const placements = buildGrid(level.targets);
  const hints = createHintOptions(state, placements, progress);
  const clue = options.type === 'clue' || options.kind === 'clue';
  const targetIndex = options.targetIndex ?? level.targets.indexOf(options.target);
  if (clue && (options.targetIndex !== undefined || options.target !== undefined) && (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= level.targets.length)) return { state, status: 'blocked', message: 'Choose a word on this board.' };
  const candidates = placements.flatMap((placement, slot) => {
    if (progress.solved.includes(placement.word) || (clue && targetIndex >= 0 && slot !== targetIndex)) return [];
    return Array.from(placement.word).map((_, index) => ({
      revealKey: `${placement.word}:${index}`, cellKey: getPlacementCellKey(placement, index)
    })).filter(cell => hints.cells.includes(cell.cellKey));
  });
  const chosen = options.cellKey ? candidates.find(cell => cell.cellKey === options.cellKey) : candidates[0];
  if (!chosen) return { state, status: 'blocked', message: 'No hidden letters there. Choose another word or cell.' };
  const price = clue ? 5 : 10;
  const free = hints.freeRescueAvailable;
  if (!free && state.coins < price) return { state, status: 'blocked', message: `Need ${price} coins. Try a 5-coin clue or find a bonus word.` };
  return {
    state: updateProgress({ ...state, coins: state.coins - (free ? 0 : price) }, {
      ...progress, revealed: [...progress.revealed, chosen.revealKey], rescueUsed: progress.rescueUsed || free
    }),
    status: 'hint', message: free ? 'Free rescue: one letter revealed.' : clue ? 'Word clue: next hidden letter revealed.' : 'Selected letter revealed.'
  };
}

function createHintOptions(state, placements, progress) {
  const cells = buildCells(placements, progress).filter(cell => !cell.letter).map(cell => `${cell.x}:${cell.y}`);
  const visible = new Map(buildCells(placements, progress).map(cell => [`${cell.x}:${cell.y}`, cell.letter]));
  return {
    clueCost: 5, revealCost: 10,
    freeRescueAvailable: state.coins < 5 && !progress.rescueUsed && cells.length > 0,
    cells,
    words: placements.map((placement, targetIndex) => ({
      targetIndex, slot: targetIndex + 1, label: `Word ${targetIndex + 1} · ${placement.word.length} letters`,
      length: placement.word.length, direction: placement.direction, row: placement.y + 1, col: placement.x + 1,
      pattern: Array.from(placement.word).map((_, index) => visible.get(getPlacementCellKey(placement, index)) || '·').join(''),
      available: !progress.solved.includes(placement.word) && Array.from(placement.word).some((_, index) => cells.includes(getPlacementCellKey(placement, index)))
    }))
  };
}

function createGardenStats(state) {
  const campaign = getCampaignProgress(state);
  const dailyCompletions = getDailyStats(state).totalCompletions;
  const totalCompletions = campaign.completedLevels + dailyCompletions;
  const packEnds = levels.flatMap((level, index) => levels[index + 1]?.pack !== level.pack ? [index + 1] : []);
  const completedPacks = Math.floor(campaign.completedLevels / levels.length) * packEnds.length + packEnds.filter(end => end <= campaign.completedLevels % levels.length).length;
  const nextAt = (Math.floor(totalCompletions / 5) + 1) * 5;
  return {
    flowers: totalCompletions, trees: Math.floor(totalCompletions / 5), butterflies: Math.floor(totalCompletions / 10),
    totalCompletions, dailyCompletions, completedPacks,
    nextUnlock: { label: nextAt % 10 === 0 ? 'Butterfly and tree' : 'Tree', remaining: nextAt - totalCompletions, at: nextAt }
  };
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
    campaignLevelVersion: LEVEL_VERSION,
    rescueUsed: false,
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
    campaignLevelVersion: state.campaignLevelVersion || 1,
    rescueUsed: Boolean(state.rescueUsed),
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
    campaignLevelVersion: LEVEL_VERSION,
    rescueUsed: false,
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
    levelVersion: LEVEL_VERSION,
    rescueUsed: false,
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
    levelVersion: state.daily.levelVersion || 1,
    rescueUsed: Boolean(state.daily.rescueUsed),
    solved: Array.isArray(state.daily.solved) ? state.daily.solved : [],
    bonusFound: Array.isArray(state.daily.bonusFound) ? state.daily.bonusFound : [],
    revealed: Array.isArray(state.daily.revealed) ? state.daily.revealed : [],
    completed: Boolean(state.daily.completed)
  };
}

function createDailyStats() {
  return {
    streak: 0,
    totalCompletions: 0,
    bestStreak: 0,
    lastCompletedDate: '',
    reward: 10
  };
}

function getDailyStats(state) {
  const stats = state.dailyStats || {};
  return {
    totalCompletions: Number.isFinite(stats.totalCompletions) ? Math.max(0, Math.floor(stats.totalCompletions)) : Math.max(stats.bestStreak || 0, stats.streak || 0, stats.lastCompletedDate || state.daily?.completed ? 1 : 0),
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
      totalCompletions: stats.totalCompletions,
      streak: stats.streak,
      bestStreak: stats.bestStreak,
      lastCompletedDate: stats.lastCompletedDate,
      reward: 0
    };
  }

  const streak = getDailyStreak(stats, dateKey);

  return {
    totalCompletions: stats.totalCompletions + 1,
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
    revealed: progress.revealed,
    rescueUsed: Boolean(progress.rescueUsed)
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
