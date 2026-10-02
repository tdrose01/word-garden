# Living Garden

Word Garden has 124 campaign puzzles and 90 distinct authored daily boards, with a garden that grows through real puzzle completions.

- The original 100 campaign boards retain their identifiers and words. Second Garden adds clearings 101–124 in four packs of six, with six required words per board.
- Clearing all 100 original puzzles unlocks Second Garden and Iris. Clearing all 24 new puzzles unlocks a pergola. Progress shows unique chapter clears and the next unlock; completing either chapter earns a celebration. Completed puzzles remain available for replay.
- The daily pool uses separate letter banks and answer boards from campaign. Consecutive UTC days traverse the entire 90-board pool. The deterministic date goal rotates between one bonus word, two distinct bonus words, and two required words of at least four letters. Every board supports the goals.
- Daily goals award ten extra coins once per UTC date, in addition to two coins per bonus and existing completion/streak rewards. Goals are checked on target and bonus submissions, including the final answer. Duplicate submissions, reloads and replay do not repeat rewards.
- Six original plants are available immediately; Iris is earned through chapter progress. Plants grow after two real completions and bloom after five. Four initial plots expand by four every five completions, up to 48. One starter seed and one per completion fund planting.
- Collect each mature planting once for five coins. Replant a collected flower explicitly for one seed. Completing the original six-species album offers a manual, once-per-save 30-coin claim; Iris is separate from that album.
- Three collected blooms unlock Moonlit Garden, six unlock Sunroom, twelve unlock the fountain, twenty-four unlock a butterfly ornament and forty-eight unlock a gazebo. The chapter-earned pergola appears alongside these landmarks in every design.
- Replay hints are free. Replay grants no coins, seeds, chapter progression or daily rewards, and cannot plant, replant, collect blooms or claim the album reward. Returning resumes the active campaign puzzle.
- Sound defaults off; touch feedback defaults on where supported. Both persist. WebAudio starts from user gestures. Decorative motion respects reduced-motion preferences.

The accepted vocabulary is hand-curated project data rather than a complete English dictionary. Targets are authored separately. Native SVG supplies botanical art, including Iris and all landmarks. Browser vibration depends on device support.

## Existing saves

Version-one, version-two and version-three campaign and daily catalogs remain available with their original target words. Active old boards retain answers, bonuses, reveals and their catalog version until completion. An old campaign puzzle then advances to the first missing original clearing, or to the first missing Second Garden clearing when all original IDs have been cleared.

A completed version-three 100-board looping save with no active answers, bonuses, reveals or rescue use can enter clearing 101 on load. An in-flight looping board stays pinned until finished. Historical lifetime counters only establish clears inside the historical catalog; they never manufacture Second Garden clears. Explicit incomplete original history continues through missing originals. Coins, seeds, planted ages and lifetime completion counters remain intact.

Old in-flight daily boards retain the fixed three-bonus-word goal and frozen catalog. A fresh UTC day uses version four's expanded pool and rotating goals. Existing eligible flower albums receive no automatic migration payment; their owner claims the reward explicitly.

Progress remains local to the browser. JSON backups preserve both chapter history and the collection claim flag. There is no account or automatic cross-device synchronization.

## Validation

Unit coverage checks all 214 unique banks, word buildability, phone grid bounds, chapter unlocks, old catalog migration, strict backup rejection/roundtrips, garden economy, reward idempotency and attainable daily goals across the whole pool. The full browser smoke includes all 124 campaign and 90 daily boards at 360×640, prior compact-phone gameplay checks, and a focused progression regression at 320×640, 360×640 and Chromebook size.

The progression regression exercises chapter celebrations and map, locked/plantable Iris, all new landmarks, keyboard activation of the album claim, legacy loop and daily preservation, all three date goals, reloads and repeated submissions. Screenshots are written under `state/screenshots/`. Browser verification and release receipts must pass before publication. Emulation does not replace acceptance on a physical phone.
