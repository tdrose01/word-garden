import { ORIGINAL_LEVEL_COUNT, levels } from './levels.js';

export function getChapterProgress(state) {
  const ids = new Set(state.campaign?.completedIds || []);
  const originalCleared = Array.from({ length: ORIGINAL_LEVEL_COUNT }, (_, i) => i).filter(i => ids.has(i)).length;
  const secondCleared = levels.slice(ORIGINAL_LEVEL_COUNT).filter((_, i) => ids.has(ORIGINAL_LEVEL_COUNT + i)).length;
  return { originalCleared, originalTotal: ORIGINAL_LEVEL_COUNT, secondCleared,
    secondTotal: levels.length - ORIGINAL_LEVEL_COUNT,
    secondUnlocked: originalCleared === ORIGINAL_LEVEL_COUNT,
    pergolaUnlocked: originalCleared === ORIGINAL_LEVEL_COUNT && secondCleared === levels.length - ORIGINAL_LEVEL_COUNT };
}
