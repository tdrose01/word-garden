// Scenery follows each board's seed word. Other anagrams are wordplay, not a
// promise that every answer belongs to the same semantic category.
const PALETTES = {
  seedlings: { sky: '#edf5e4', mist: '#f8faee', ground: '#dce8c5', foliage: '#738b58', accent: '#bd965d' },
  brook: { sky: '#e8f3f5', mist: '#f4f8f3', ground: '#d7e5dd', foliage: '#698a82', accent: '#91b6bc' },
  woodland: { sky: '#e8efdf', mist: '#f4f5e9', ground: '#d6dfc2', foliage: '#647c58', accent: '#ad9769' },
  flowers: { sky: '#f4edf2', mist: '#fbf7f0', ground: '#e2e9d0', foliage: '#7b9067', accent: '#ba85a4' },
  sunrise: { sky: '#f8ebd8', mist: '#fff6e8', ground: '#e6e7c9', foliage: '#869269', accent: '#d6a067' },
  canyon: { sky: '#f4e9df', mist: '#fcf5e9', ground: '#e4cdb8', foliage: '#8c916c', accent: '#ba8669' },
  moonlight: { sky: '#e5e9f3', mist: '#f1f2f7', ground: '#d8e1df', foliage: '#778b91', accent: '#9c9abd' },
  alpine: { sky: '#e7f0f7', mist: '#f7fafb', ground: '#dce6e6', foliage: '#779194', accent: '#a1b9cc' },
  harvest: { sky: '#f5eedc', mist: '#fcf8eb', ground: '#e7dfbf', foliage: '#90916a', accent: '#c19a59' }
};

// Explicit assignments keep daily boards, old saves, and campaign boards
// visually consistent even when their IDs, titles, or target counts change.
const SEEDS = {
  PLANT: ['seedlings'],
  STONE: ['brook'],
  BRANCH: ['woodland'],
  GARDEN: ['seedlings'],
  FOREST: ['woodland'],
  MALLOW: ['flowers', '#c692ad'],
  CEDAR: ['woodland', '#88a185'],
  WANDER: ['woodland'],
  POLLEN: ['flowers', '#c8ae68'],
  SPROUT: ['seedlings'],
  LAUREL: ['woodland', '#8fa575'],
  THICKET: ['woodland'],
  SUNRISE: ['sunrise'],
  BLOOM: ['flowers'],
  WILLOW: ['brook', '#9aaa79'],
  PEBBLE: ['brook', '#a4a9a1'],
  RAPIDS: ['brook', '#7daab5'],
  HOLLOW: ['woodland'],
  THORNS: ['woodland', '#a58985'],
  PETUNIA: ['flowers', '#ac8cbd'],
  MARIGOLD: ['flowers', '#cea15c'],
  CANYON: ['canyon'],
  CYPRESS: ['woodland', '#7a9990'],
  HARVEST: ['harvest'],
  CLOUDS: ['alpine'],
  MOONLIT: ['moonlight'],
  GLACIER: ['alpine'],
  ORCHID: ['flowers', '#b995bf'],
  MAPLES: ['harvest', '#bc886b'],
  ROOTED: ['seedlings', '#ae916b'],
  LAVENDER: ['flowers', '#a49abe'],
  JASMINE: ['flowers', '#b7b889'],
  DAHLIA: ['flowers', '#bd8c9b'],
  TERRACE: ['seedlings'],
  WILDWOOD: ['woodland'],
  EVERGREEN: ['woodland', '#799587'],
  MORNING: ['sunrise'],
  PETALS: ['flowers', '#cc9eaf'],
  CLOVER: ['seedlings', '#93a874'],
  VIOLET: ['flowers', '#a38fba'],
  SUMMER: ['sunrise', '#cbb169']
};

// Display copy describes scenery without naming the seed answer. The source
// remains metadata for designers; UI must never render sourceWord as a clue.
const SCENE_COPY = {
  seedlings: ['Fresh beginnings', 'Young leaves and softly tended beds.'],
  brook: ['Beside the water', 'Cool water passes rounded rocks and leafy banks.'],
  woodland: ['Under the canopy', 'Layered boughs shelter a quiet winding path.'],
  flowers: ['Soft color', 'Soft hues brighten a leafy clearing.'],
  sunrise: ['First light', 'Warm light spreads across the horizon.'],
  canyon: ['Sunlit cliffs', 'Warm rock layers rise above a quiet valley.'],
  moonlight: ['Quiet evening', 'A gentle lunar glow settles over the landscape.'],
  alpine: ['Cool horizons', 'Pale mountains rise into clear, crisp air.'],
  harvest: ['Golden season', 'Warm leaves and golden fields signal a changing season.']
};

export const themeScenes = Object.freeze(Object.keys(PALETTES));

export function getLevelTheme(level) {
  const letters = typeof level?.letters === 'string' ? level.letters.trim().toUpperCase() : '';
  // Generated boards may reorder wheel letters; their seed remains a target.
  const targetSeed = Array.isArray(level?.targets)
    ? level.targets.find(word => typeof word === 'string' && Object.hasOwn(SEEDS, word.toUpperCase()))?.toUpperCase()
    : undefined;
  const sourceWord = Object.hasOwn(SEEDS, letters) ? letters : targetSeed;
  if (Object.hasOwn(PALETTES, level?.scene)) {
    const [title, description] = SCENE_COPY[level.scene];
    return { id: letters.toLowerCase() || level.scene, title, description, sourceWord: letters, scene: level.scene, colors: { ...PALETTES[level.scene] } };
  }
  if (!sourceWord) {
    return {
      id: 'garden', title: 'Quiet garden', description: 'A quiet garden for a little wordplay.',
      sourceWord: '', scene: 'seedlings', colors: { ...PALETTES.seedlings }
    };
  }
  const [scene, accent] = SEEDS[sourceWord];
  const [title, description] = SCENE_COPY[scene];
  return {
    id: sourceWord.toLowerCase(), title,
    description,
    sourceWord, scene, colors: { ...PALETTES[scene], ...(accent ? { accent } : {}) }
  };
}

// Keep scenery, but never repeat a required answer in its display copy.
export function safeSceneText(text, level, fallback = 'Wordplay') {
  const words = text.toUpperCase().match(/[A-Z]+/g) || [];
  return words.some(word => level.targets.includes(word)) ? fallback : text;
}
export function getPuzzleTheme(level) {
  const theme = getLevelTheme(level);
  return { ...theme, title: safeSceneText(theme.title, level),
    description: safeSceneText(theme.description, level, '') };
}
