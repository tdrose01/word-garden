# Progress and garden

Open **Settings → Save progress** to confirm a save in this browser. Changes also attempt autosave. A storage error displays **Not saved**; play can continue in memory, and **Download JSON backup** can keep that session's progress. There are no cloud accounts or automatic transfers between browsers. Clearing browser data removes local progress.

To move progress, download the JSON backup, then use **Import JSON backup** in the destination browser. Review the campaign/coin/plant summary and choose **Replace with this backup**. This replaces campaign, daily, replay, garden, and settings together. Download the destination's current backup first if needed. Cancellation, invalid files, and failed storage writes leave the destination progress intact. The browser controls the file chooser and download location.

Backups use the `word-garden-backup` envelope, format version 1, and a 1 MB limit. Imports validate allowed fields, primitive types, dates, catalog versions, board words/reveals/completion, plot identity/age/availability, and seed capacity before invoking existing save normalization. Supported v1/v2 in-flight catalogs remain supported. Older daily boards roll over through the normal daily flow; history remains.

In **Your garden**, choose a named plant, then an empty plot. Planting uses one seed. Click an occupied plot to inspect its stage and remaining campaign/daily completions: growing after two, blooming after five. Inspection and replay spend no seeds and add no growth. Empty plots explain when another seed is needed.

Puzzle headings and map entries use numbered clearings. Scenery and pack copy avoid required-answer tokens. Every new wheel (including reload, next puzzle, mode changes, daily rollover, replay, reset, import, and Shuffle) preserves letter counts and rejects full-length target anagrams in either circular direction. The order stays stable during selection.

## Local validation

- `npm test`
- `npm run test:feedback`
- `npm run build` (includes self-hosted font checks)
- `WORD_GARDEN_SMOKE_DISPLAY=headless npm run test:smoke`

Full smoke retains the 141-board layout matrix and includes the Chromebook/compact-phone save and planting regression. It downloads a real backup, imports it into a fresh browser context, reloads, checks rejection/failure preservation, and writes screenshots under untracked `state/screenshots/`. For a running local server, the focused check is `node scripts/playtest-regression.mjs http://127.0.0.1:4318`.

Swipe back over the previous letter to undo the tail of your word. Continuing forward adds letters again; the same wheel position cannot be used twice. Accepted bonus words immediately clear the word builder, active letters, and swipe guide.

Each campaign or daily completion keeps its existing coin reward and earns one seed. The completion card shows the seed, newly blooming flowers and any new plots. Mature flowers offer **Collect bloom · +5 coins** once per planting. Collection keeps the flower on display and adds it to your permanent six-species album. Choose another species and explicitly replace a collected flower for one seed to start a new growth cycle. Replays cannot collect, plant or replant.

Collect three lifetime blooms to unlock **Moonlit Garden**, six for **Sunroom**, and twelve for the fountain landmark in every design. Meadow stays available from the start. Designs are free and only change scenery. The garden shows unlock progress and a **Tend flowers** shortcut. Lifetime collection, selected design, each flower's collection status and total seeds spent travel with your JSON backup. Older planted gardens retain their growth and receive no automatic coins; mature legacy flowers can be collected manually.

The CI smoke includes `scripts/garden-regression.mjs`: mouse/touch backtracking, actual bonus swipe submission and clearing, replant costs, collection, design persistence, fountain unlock, and 320px/Chromebook layout screenshots.
