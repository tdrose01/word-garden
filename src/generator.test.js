import test from 'node:test';
import assert from 'node:assert/strict';
import { isDictionaryWord } from './dictionary.js';
import { generateLevels, validateGeneratedLevel } from './generator.js';
import { canBuildWord } from './word-utils.js';

test('generated levels have enough buildable target words', () => {
  const levels = generateLevels();

  assert.equal(levels.length > 0, true);

  for (const level of levels) {
    assert.equal(level.targets.length >= 5, true);
    assert.equal(level.targets.every((word) => canBuildWord(word, level.letters)), true);
  }
});

test('generated levels do not duplicate target or bonus words', () => {
  const levels = generateLevels();

  for (const level of levels) {
    const allWords = [...level.targets, ...level.bonus];
    assert.equal(new Set(level.targets).size, level.targets.length);
    assert.equal(new Set(allWords).size, allWords.length);
  }
});

test('generated bonus candidates are dictionary-backed and buildable', () => {
  const levels = generateLevels();

  for (const level of levels) {
    assert.equal(level.bonus.length > 0, true);
    assert.equal(level.bonus.every((word) => isDictionaryWord(word)), true);
    assert.equal(level.bonus.every((word) => canBuildWord(word, level.letters)), true);
    assert.equal(level.bonus.every((word) => !level.targets.includes(word)), true);
  }
});

test('generated level validation rejects impossible and duplicate words', () => {
  const [level] = generateLevels();

  assert.equal(validateGeneratedLevel(level), true);
  assert.throws(
    () => validateGeneratedLevel({ ...level, bonus: [...level.bonus, level.targets[0]] }),
    /duplicate/
  );
  assert.throws(
    () => validateGeneratedLevel({ ...level, bonus: [...level.bonus, 'PLATE'] }),
    /impossible/
  );
});
