import { curatedDictionary, getBuildableDictionaryWords, isDictionaryWord } from './dictionary.js';
import { canBuildWord, normalizeWord } from './word-utils.js';

export const levelSeeds = [
  { title: 'Meadow Draft', pack: 'Generated Grove', letters: 'PLANT' },
  { title: 'Stone Draft', pack: 'Generated Grove', letters: 'STONE' },
  { title: 'Cedar Draft', pack: 'Generated Grove', letters: 'CEDAR' },
  { title: 'Petal Draft', pack: 'Generated Grove', letters: 'PETALS' }
];

export function generateLevels(seeds = levelSeeds, options = {}) {
  const minTargets = options.minTargets ?? 5;
  const maxTargets = options.maxTargets ?? 6;
  const maxBonus = options.maxBonus ?? 10;

  return seeds.map((seed, index) => {
    const letters = normalizeWord(seed.letters);
    const candidates = getBuildableDictionaryWords(letters)
      .filter((word) => isDictionaryWord(word))
      .sort(compareCandidateWords);
    const targets = candidates.slice(0, maxTargets);

    if (targets.length < minTargets) {
      throw new Error(`${letters} only produced ${targets.length} target candidates`);
    }

    const targetSet = new Set(targets);
    const curatedBonus = Array.isArray(seed.bonus) ? seed.bonus.map(normalizeWord) : [];
    const bonus = [...curatedBonus, ...candidates]
      .filter((word) => word.length >= 3 && !targetSet.has(word))
      .filter((word, candidateIndex, list) => list.indexOf(word) === candidateIndex)
      .slice(0, maxBonus);

    const level = {
      id: seed.id ?? index + 1,
      title: seed.title ?? `Generated ${index + 1}`,
      pack: seed.pack ?? 'Generated Grove',
      letters,
      targets,
      bonus
    };

    validateGeneratedLevel(level, { minTargets });
    return level;
  });
}

export function validateGeneratedLevel(level, options = {}) {
  const minTargets = options.minTargets ?? 5;
  const targets = level.targets.map(normalizeWord);
  const bonus = level.bonus.map(normalizeWord);
  const allWords = [...targets, ...bonus];

  if (targets.length < minTargets) {
    throw new Error(`${level.title} needs at least ${minTargets} targets`);
  }

  if (new Set(targets).size !== targets.length) {
    throw new Error(`${level.title} has duplicate targets`);
  }

  if (new Set(allWords).size !== allWords.length) {
    throw new Error(`${level.title} has duplicate target/bonus words`);
  }

  for (const word of allWords) {
    if (!isDictionaryWord(word)) {
      throw new Error(`${level.title} includes non-dictionary word ${word}`);
    }
    if (!canBuildWord(word, level.letters)) {
      throw new Error(`${level.title} includes impossible word ${word}`);
    }
  }

  return true;
}

function compareCandidateWords(a, b) {
  if (b.length !== a.length) {
    return b.length - a.length;
  }

  const aScore = rarityScore(a);
  const bScore = rarityScore(b);
  if (aScore !== bScore) {
    return aScore - bScore;
  }

  return a.localeCompare(b);
}

function rarityScore(word) {
  const uncommonLetters = new Set(['J', 'K', 'Q', 'V', 'W', 'X', 'Y', 'Z']);
  return Array.from(word).filter((letter) => uncommonLetters.has(letter)).length;
}

export function dictionaryStats() {
  return {
    words: curatedDictionary.length,
    minLength: Math.min(...curatedDictionary.map((word) => word.length)),
    maxLength: Math.max(...curatedDictionary.map((word) => word.length))
  };
}
