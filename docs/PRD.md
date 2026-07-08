# Word Garden PRD

## Summary
Create a mobile-first word connect game inspired by the proven Wordscapes-style loop: players form words from a circular letter wheel, solve a compact crossword board, earn coins for bonus words, and progress through increasingly difficult levels.

The product should feel calm, polished, and less ad-hostile than the category leaders. The first release is a PWA/web build that can later be wrapped with Capacitor for iOS and Android.

## Goals
- Deliver a playable MVP with a satisfying swipe/click letter wheel.
- Support 4-7 letter level seeds with crossword-style target slots.
- Reward valid extra words as bonus words.
- Include shuffle, hint, coins, level progression, and reset flows.
- Keep the architecture simple enough to extend with generated levels, daily puzzles, rewarded ads, and mobile packaging.

## Non-Goals For MVP
- No real-money purchases.
- No live ad integration.
- No account system, leaderboard, or cloud save.
- No copied art, UI, icons, level layouts, sounds, or branding from existing games.

## Target Player
Casual mobile puzzle players who want short, relaxing sessions. They understand word games immediately, dislike friction, and may play one-handed in short bursts.

## Core Loop
1. Player sees a crossword board and a circular wheel of letters.
2. Player taps or drags letters to build a word.
3. Submitting a target word fills the matching board slot.
4. Submitting a valid non-target word adds it to the bonus list and awards coins.
5. Player uses shuffle or hint when stuck.
6. Completing all target words advances the level and awards coins.

## MVP Requirements
- Letter wheel:
  - Tap letters to select.
  - Drag across letters to select on pointer devices.
  - Show current word in real time.
  - Submit selected word with a clear button.
  - Backspace and clear controls.
- Crossword board:
  - Render horizontal/vertical word slots from level data.
  - Fill solved words.
  - Reveal hinted letters.
  - Keep stable layout on mobile and desktop.
- Game economy:
  - Start with 40 coins.
  - Bonus word: +2 coins once.
  - Level completion: +10 coins.
  - Hint: costs 15 coins and reveals one unrevealed letter in an unsolved word.
- Level progression:
  - At least 5 curated MVP levels.
  - Persist current level and coins in localStorage.
  - Reset progress option.
- UX:
  - Mobile-first layout.
  - Calm nature/editorial visual direction.
  - No modal spam.
  - No mid-puzzle ads.

## Future Requirements
- Puzzle generator:
  - Choose a seed word.
  - Generate valid words from seed letters using a curated dictionary.
  - Filter by word frequency and profanity.
  - Place target words in crossword grids.
  - Rank levels by target count, word length, and frequency.
- Daily puzzle:
  - Deterministic date-based level.
  - Separate streak and reward track.
- Monetization:
  - Rewarded ad for free hints.
  - Optional remove-ads purchase.
  - Optional coin packs.
  - Ads only between levels, never while actively solving.

## Acceptance Criteria For First Slice
- A user can solve at least one full level end to end.
- Target words fill the board only after correct submission.
- Bonus words award coins once and do not fill board slots.
- Shuffle changes wheel order without changing available letters.
- Hint spends coins and reveals a real board letter.
- Progress persists after refresh.
- Build and logic tests pass.

## Acceptance Criteria For Second Slice
- Daily puzzle mode exists beside campaign levels.
- Daily progress is stored separately from campaign progress.
- Today's daily puzzle is deterministic for the calendar date.
- Mobile swipe can select letters while dragging across the wheel.
- Build and expanded logic tests pass.

## Acceptance Criteria For Third Slice
- Daily completions update the current streak, best streak, and last completed date.
- Daily coin rewards scale with the active streak and are awarded once per daily puzzle.
- Daily mode shows streak, best streak, and the current available reward before completion.
- Completed daily puzzles show the reward as claimed.
- Build and daily reward regression tests pass.

## Acceptance Criteria For Fourth Slice
- Campaign mode includes more than the original 5 curated levels.
- Campaign levels are grouped into named path packs.
- Game snapshots expose campaign path stats, pack stats, and next completion reward.
- Campaign mode shows a compact progress strip with current level, path percent, pack progress, and next reward.
- Campaign advancement preserves separate daily progress and daily mode behavior.
- Build and campaign progression regression tests pass.

## Acceptance Criteria For Fifth Slice
- Game logic uses a curated dictionary module for bonus-word validation.
- Target-word behavior is unchanged and takes precedence over dictionary bonus matches.
- Any dictionary word buildable from the wheel letters, not already solved as a target, and not already banked counts as a bonus word.
- Curated `level.bonus` entries remain supported as level seed/hint data, without limiting valid bonus submissions.
- Regression tests cover dictionary bonus acceptance, duplicate bonus prevention, invalid/non-buildable rejection, and target precedence.

## Acceptance Criteria For Sixth Slice
- A deterministic level generator can create candidate level JSON from curated seed letters.
- Generator output chooses buildable target and bonus candidates from the curated dictionary using simple difficulty rules.
- Generated levels validate that targets and bonus words are dictionary-backed, buildable from the wheel, and duplicate-free.
- `npm run generate-levels` writes generated level JSON under `data/` or prints it on demand.
- Generator tests cover buildable targets, duplicate prevention, minimum target count, and valid bonus candidates.

## Acceptance Criteria For Seventh Slice
- Campaign current puzzle position and cleared-level journey progress are tracked separately.
- Randomized campaign starts do not falsely imply the player already cleared earlier levels.
- Campaign clears update cleared count, best run, and last completed level.
- Every 5 cleared campaign levels awards an extra milestone coin bonus.
- Campaign mode shows cleared levels, next milestone bonus, and best run.
- Build, logic, and gesture smoke tests pass.

## Risks
- Raw dictionaries produce obscure junk words. Use curated lists for MVP and frequency-filtered dictionaries later.
- Crossword generation can become a rabbit hole. Ship curated levels first, then generator.
- The category is crowded. Differentiate through cleaner monetization, tasteful design, and smoother feel.
