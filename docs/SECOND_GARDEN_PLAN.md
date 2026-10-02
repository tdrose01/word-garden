# Second Garden progression plan

## Objective

Extend Word Garden's campaign, garden collection rewards, and daily variety while preserving existing progress. Release all three together through Word Garden PR CI, independent review, exact-SHA deployment, and independent production verification.

## 1. Second Garden

- Append 24 authored puzzles (101–124), four packs of six, with six required words per board and phone-safe grids.
- Clear the original 100 unique puzzles to unlock the Second Garden and Iris. Clear all 24 new puzzles to unlock a pergola.
- Show chapter progress and the next unlock; celebrate chapter completion. Keep replay available.
- Freeze previous campaign catalogs. Preserve in-flight answers/reveals, then migrate completed original-loop players to the first uncleared new puzzle. Never derive new chapter clears from lifetime counters.

## 2. Garden collection rewards

- Reward the original six-species album with an explicit, one-time +30 coin claim. Iris is a separate chapter reward.
- Add butterfly ornament at 24 collected blooms and gazebo at 48. Preserve existing 3/6/12 unlocks.
- Derive decorative unlocks from progress; validate and persist the collection claim flag. Existing eligible saves can claim without automatic migration payments.

## 3. Daily variety

- Expand to at least 90 distinct authored daily boards.
- Rotate deterministic UTC-date goals: one bonus word, two distinct bonus words, or two required words of at least four letters.
- Keep +10 objective rewards, +2 per bonus, streak/completion rewards, and once-per-date protection.
- Retain frozen old daily catalogs and the old goal for in-flight saves; new days use the new catalog and goals.

## Validation and release

- Tests: content uniqueness/buildability and phone grid limits, chapter unlocks and migrations, locked plants, reward idempotency, attainable daily goals, final-answer claims, strict backup roundtrips/rejections.
- Browser checks: fresh and legacy saves; chapter milestones, planting Iris, collection claim, later landmarks, each objective type; compact phone and Chromebook; complete board matrix.
- Run unit, feedback, build, and full browser smoke; require matching final-head CI and independent review.
- Merge, build and deploy the exact merge SHA. Verify canonical and immutable assets/gameplay and feedback OPTIONS/invalid POST. Preserve prior production deployment as rollback.

## Implementation status

All three workstreams are implemented for issue [#28](https://github.com/tdrose01/word-garden/issues/28): 124 campaign boards, 90 daily boards, unique-ID chapter rewards, explicit album claim, and the later bloom landmarks. Local unit modules, direct progression assertions, feedback regression and build/font checks passed. Full browser smoke, independent final review, final-head CI, exact-SHA deployment and production verification are still required before the release is complete.
