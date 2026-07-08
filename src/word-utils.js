export function normalizeWord(word) {
  return String(word).trim().toUpperCase();
}

export function canBuildWord(word, letters) {
  const bank = countLetters(letters);
  return normalizeWord(word)
    .split('')
    .every((letter) => {
      if (!bank[letter]) {
        return false;
      }
      bank[letter] -= 1;
      return true;
    });
}

function countLetters(letters) {
  return normalizeWord(letters)
    .split('')
    .reduce((bank, letter) => {
      bank[letter] = (bank[letter] || 0) + 1;
      return bank;
    }, {});
}
