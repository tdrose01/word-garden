import test from 'node:test';
import assert from 'node:assert/strict';
import { levels, legacyLevels, dailyLevels, legacyDailyLevels } from './levels.js';
import { getLevelTheme, themeScenes } from './themes.js';

test('every campaign and daily seed has deterministic word-associated scenery, including legacy saves', () => {
  for (const level of [...levels, ...legacyLevels, ...dailyLevels, ...legacyDailyLevels]) {
    const theme = getLevelTheme(level);
    assert.equal(theme.sourceWord, level.letters);
    assert.ok(themeScenes.includes(theme.scene));
    assert.ok(!`${theme.title} ${theme.description}`.toUpperCase().includes(level.letters), 'display copy must not reveal seed answer');
    assert.deepEqual(getLevelTheme(level), theme);
    assert.deepEqual(Object.keys(theme.colors).sort(), ['accent', 'foliage', 'ground', 'mist', 'sky']);
    for (const color of Object.values(theme.colors)) assert.match(color, /^#[0-9a-f]{6}$/);
  }
});

test('themes follow words independently of titles, IDs, modes, and target counts', () => {
  const seed = levels.find(level => level.letters === 'STONE');
  assert.deepEqual(getLevelTheme({ ...seed, id: '2030-01-01', title: 'Daily 01-01', targets: [] }), getLevelTheme(seed));
  assert.deepEqual(getLevelTheme({ letters: 'TONES', targets: ['STONE', 'TONE'] }), getLevelTheme(seed));
});

test('related words share quiet scene colors with individual botanical accents', () => {
  const cedar = getLevelTheme({ letters: 'CEDAR' });
  const forest = getLevelTheme({ letters: 'FOREST' });
  assert.equal(cedar.scene, forest.scene);
  assert.equal(cedar.colors.sky, forest.colors.sky);
  const violet = getLevelTheme({ letters: 'VIOLET' });
  const marigold = getLevelTheme({ letters: 'MARIGOLD' });
  assert.equal(violet.scene, marigold.scene);
  assert.notEqual(violet.colors.accent, marigold.colors.accent);
  assert.notEqual(getLevelTheme({ letters: 'MOONLIT' }).scene, getLevelTheme({ letters: 'SUNRISE' }).scene);
  assert.ok(new Set(levels.map(level => getLevelTheme(level).scene)).size >= 8);
});

test('unknown or malformed boards use a safe fallback and cannot mutate shared palettes', () => {
  for (const input of [undefined, null, {}, { letters: 5 }, { letters: 'constructor' }, { letters: '<script>', targets: [null, 1] }]) {
    const result = getLevelTheme(input);
    assert.equal(result.id, 'garden');
    assert.equal(result.sourceWord, '');
    assert.equal(result.scene, 'seedlings');
  }
  const theme = getLevelTheme({ letters: '  plant  ' });
  assert.equal(theme.sourceWord, 'PLANT');
  theme.colors.sky = 'broken';
  assert.notEqual(getLevelTheme({ letters: 'PLANT' }).colors.sky, 'broken');
});
