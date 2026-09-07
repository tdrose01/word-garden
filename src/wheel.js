// A circular wheel must not hand out a full-length answer in either direction.
export function wheelSpellsTarget(letters, targets) {
  const full = targets.filter(word => word.length === letters.length);
  const reverse = [...letters].reverse().join('');
  return full.some(word => (letters + letters).includes(word) || (reverse + reverse).includes(word));
}
export function prepareWheel(level, random = Math.random) {
  const letters = [...level.letters];
  for (let attempt = 0; attempt < 16; attempt++) {
    for (let i = letters.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [letters[i], letters[j]] = [letters[j], letters[i]];
    }
    const candidate = letters.join('');
    if (!wheelSpellsTarget(candidate, level.targets)) return candidate;
  }
  // Deterministic unique permutations make the guarantee independent of luck,
  // including repeated letters and a constant random source in tests.
  letters.sort();
  do {
    const candidate = letters.join('');
    if (!wheelSpellsTarget(candidate, level.targets)) return candidate;
    let i = letters.length - 2;
    while (i >= 0 && letters[i] >= letters[i + 1]) i--;
    if (i < 0) break;
    let j = letters.length - 1;
    while (letters[j] <= letters[i]) j--;
    [letters[i], letters[j]] = [letters[j], letters[i]];
    letters.splice(i + 1, letters.length, ...letters.slice(i + 1).reverse());
  } while (true);
  throw new Error('Puzzle has no answer-safe circular wheel order.');
}
