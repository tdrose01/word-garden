# Living Garden

This release adds a larger puzzle library and a player-directed garden while preserving the compact play screen.

-100 campaign puzzles: the original36 version-two boards stay intact;64 original curated word families extend the path. New chapters69–100 use six required words. Wheel sizes remain bounded for phone play.
-41 daily puzzles use separate letter banks and answer boards from campaign. The daily pool still cycles after41UTCdays; the objective gives each day an extra goal, not an unlimited content claim.
-A hand-curated common vocabulary expands bonus acceptance. Targets remain authored separately. The word list is original project data, not a complete English dictionary.
-Six selectable plants grow from seedling to growing to blooming as real puzzles are completed. Four initial planting plots expand by four every five completions, up to48. One starter seed and one per completion fund planting; occupied plots cannot be replaced or charged twice.
-Daily mode awards ten extra coins for three distinct bonus words, once perUTCdate, in addition to the existing two coins per bonus. Reloads, duplicate submissions and replay cannot farm the reward.
-Cleared campaign puzzles appear in a replay map. Replay hints are free and replay gives no coins, seeds, campaign progression or daily rewards. Returning resumes the active campaign puzzle.
-Sound defaults off; touch feedback defaults on where supported. Both preferences persist. WebAudio starts only from user gestures and requires no audio downloads. Decorative/reward motion respects reduced-motion settings.

## Existing saves

Version-one and version-two active campaign and daily puzzles remain available with their original target words and revealed letters. Completing the old campaign puzzle moves to version three while preserving lifetime progress and the correct position, including saves beyond the previous36-board loop. Browser-local persistence remains the storage model; there is no account or cross-device synchronization.

## Validation

Core tests cover all141 unique puzzle/letter-bank combinations, word buildability, grid integrity and size bounds, everyday word acceptance, save migration, planting/growth, settings, replay isolation and daily objective idempotency. Browser smoke checks all100 campaign and41 daily boards at360×640, the existing compact-phone gameplay cases, planting persistence, sound/haptic controls, replay completion/return and daily goal claims.

Native SVG supplies the botanical art. Browser vibration depends on device support. Mobile browser emulation is included; it does not replace product acceptance on a physical phone.
