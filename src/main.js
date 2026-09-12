import '@fontsource/nunito/latin-500.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-900.css';
import '@fontsource/fraunces/latin-700.css';
import './style.css';
import { prepareWheel, extendSelection } from './wheel.js';
import { writeProgress, createBackup, parseBackup, MAX_BACKUP_BYTES } from './persistence.js';
import { getPuzzleTheme as getLevelTheme, safeSceneText } from './themes.js';
import { botanicalScenery, plantArt } from './botanical.js';
import { playGardenTone } from './sensory.js';
import {
  plantSeed,
  collectBloom,
  chooseGardenDesign,
  updateSettings,
  startReplay,
  exitReplay,
  createSnapshot as createGameSnapshot,
  getLevel,
  getProgress,
  loadState,
  resetState,
  setMode,
  submitWord,
  useHint
} from './game.js';

function createSnapshot(value) {
  const snapshot = createGameSnapshot(value);
  const pack = snapshot.campaignStats.pack;
  snapshot.campaignStats.pack = { ...pack, title: safeSceneText(pack.title, snapshot.level),
    nextTitle: safeSceneText(pack.nextTitle, snapshot.level) };
  return snapshot;
}

const app = document.querySelector('#app');
const BUILD_VERSION = '0.1.0-web';
const FEEDBACK_ENDPOINT = '/api/feedback';
const GITHUB_ISSUE_URL = 'https://github.com/tdrose01/word-garden/issues/new';
const GITHUB_ISSUE_LABELS = 'type:test,area:testing,closed-test,word-garden';
const FEEDBACK_CATEGORIES = [
  { value: 'bug', label: 'Bug' },
  { value: 'puzzle', label: 'Puzzle' },
  { value: 'controls', label: 'Controls' },
  { value: 'performance', label: 'Performance' },
  { value: 'idea', label: 'Idea' }
];
let saveNotice = 'Autosave is attempted after each change. Save now to confirm.';
let state = loadState(undefined, undefined, () => { saveNotice = 'Could not read browser progress. Download a backup before leaving this session.'; });
let wheelLetters = prepareWheel(getLevel(state));
let selection = [];
let message = saveNotice.startsWith('Could not') ? saveNotice : 'Find every word hidden in the garden.';
let completion = null;
let isSwiping = false;
let selectionChangedDuringSwipe = false;
let swipePointer = null;
let feedback = null;
let previousCoins = state.coins;
let panel = null;
let boardResizeObserver;
let selectedPlant = null;
let gardenNotice = '';
let pendingImport = null;
let importReadId = 0;
let importNotice = '';
function saveState(value) {
  const result = writeProgress(value);
  saveNotice = result.message;
  if (!result.ok) message = result.message;
  app.querySelectorAll('[data-save-status]').forEach(status => { status.textContent = saveNotice; });
  return result.ok;
}
let rewardInFlight = false;
let hintTarget = null;
let hintCell = null;
let panelReturnFocus = 'hint';
let renderedDailyDate = state.mode === 'daily' ? getProgress(state).dateKey : null;

function render() {
  refreshDaily(false);
  const snapshot = createSnapshot(state);
  const theme = getLevelTheme(snapshot.level);
  document.body.dataset.scene = theme.scene;
  for (const [name, value] of Object.entries(theme.colors)) document.body.style.setProperty(`--scene-${name}`, value);
  const boardKey = `${state.mode}:${snapshot.level.id}:${snapshot.progress.dateKey || ''}:${state.levelIndex}`;
  const progress = getProgress(state);
  const levelLabel = state.mode === 'replay' ? 'Replay' : state.mode === 'daily' ? 'Daily' : `Level ${snapshot.campaignStats.currentLevel}`;
  const maxX = Math.max(...snapshot.cells.map((cell) => cell.x));
  const maxY = Math.max(...snapshot.cells.map((cell) => cell.y));
  const currentWord = selection.map((item) => item.letter).join('');
  const coinChanged = state.coins !== previousCoins;

  app.innerHTML = `
    ${renderLevelScenery(theme)}
    ${rewardInFlight ? '<span class="garden-reward-flight" aria-hidden="true">✦</span>' : ''}
    <section class="topbar" aria-label="Game status">
      <div>
        <p class="eyebrow"><span class="eyebrow-dot" aria-hidden="true"></span>${levelLabel}</p>
        <h1>Word Garden</h1>

      </div>
      <section class="mode-tabs" aria-label="Game mode">
        <button class="${state.mode === 'campaign' ? 'is-active' : ''}" data-mode="campaign" aria-pressed="${state.mode === 'campaign'}">Levels</button>
        <button class="${state.mode === 'daily' ? 'is-active' : ''}" data-mode="daily" aria-pressed="${state.mode === 'daily'}">Daily</button>
      </section>
      <div class="coin-pill ${coinChanged ? 'is-bumped' : ''}" aria-label="${state.coins} coins"><span>${state.coins}</span></div>
    </section>

    <section class="journey-peek" aria-label="Progress and garden">
      ${renderCompactProgress(snapshot)}
      ${renderGarden(snapshot.gardenStats)}
    </section>

    <section class="board-wrap" aria-label="${state.mode === 'daily' ? 'Daily puzzle' : 'Clearing ' + snapshot.level.id} puzzle board">
      <div class="level-card">
        <span class="level-card__leaf" aria-hidden="true">❧</span>
        <p>${state.mode === 'daily' ? 'Daily puzzle' : 'Clearing ' + snapshot.level.id}<span class="level-theme"> · ${theme.title}</span></p>
        <strong>${progress.solved.length}/${snapshot.level.targets.length}</strong>
        <button class="enlarge-board" data-action="board" aria-label="Enlarge puzzle board">Enlarge board</button>
      </div>
      <div class="board-viewport" data-board-key="${escapeAttribute(boardKey)}" tabindex="0" role="region" aria-label="Puzzle grid" aria-describedby="board-scroll-hint">
      <div class="board" style="--cols: ${maxX + 1}; --rows: ${maxY + 1};">
        ${snapshot.cells
          .map(
            (cell) => `
              <div
                class="tile ${cell.letter ? 'is-filled' : ''} ${cell.solved ? 'is-solved' : ''} ${cell.revealed ? 'is-revealed' : ''}"
                style="grid-column: ${cell.x + 1}; grid-row: ${cell.y + 1}; --pop-delay: ${(cell.x + cell.y) * 18}ms;"
               aria-label="Row ${cell.y + 1}, column ${cell.x + 1}: ${cell.letter || 'blank'}">${renderSlotNumber(snapshot, cell)}${cell.letter}</div>
            `
          )
          .join('')}
      </div>
      </div>
      <p id="board-scroll-hint" class="board-scroll-hint" aria-live="polite"></p>
    </section>

    <section class="composer" aria-label="Word builder">
      <div class="current-word ${currentWord ? 'has-word' : ''}" role="status" aria-live="polite">${currentWord || 'TAP OR SWIPE LETTERS'}</div>
      <div class="wheel" data-wheel>
        <svg class="swipe-guide" data-swipe-guide aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polyline class="swipe-guide__path" data-swipe-path points=""></polyline>
          <line class="swipe-guide__live" data-swipe-live x1="0" y1="0" x2="0" y2="0"></line>
        </svg>
        ${wheelLetters
          .split('')
          .map((letter, index) => {
            const active = selection.some((item) => item.index === index);
            const angle = (index / wheelLetters.length) * Math.PI * 2 - Math.PI / 2;
            const x = 50 + Math.cos(angle) * 34;
            const y = 50 + Math.sin(angle) * 34;
            return `<button class="letter ${active ? 'is-active' : ''}" data-index="${index}" aria-pressed="${active}" aria-label="Add ${letter}" style="left: ${x}%; top: ${y}%;">${letter}</button>`;
          })
          .join('')}
        <div class="wheel-center" aria-hidden="true">
          <span>grow</span>
          <small>your word</small>
        </div>
      </div>
      <div class="actions">
        <button data-action="clear">Clear</button>
        <button data-action="submit" class="primary">Submit</button>
        <button data-action="backspace">Back</button>
      </div>
      <section class="tools" aria-label="Puzzle tools">
        <button data-action="shuffle">Shuffle</button>
        <button data-action="hint">Hints <small>from 5</small></button>
        <button data-action="settings">Settings</button>
      </section>
    </section>

    <section class="ledger" data-tone="${feedback?.tone || 'neutral'}">
      <button class="tester-feedback__cta" type="button" aria-expanded="false" aria-controls="tester-feedback-panel">
        Feedback
      </button>
      <div>
        <span><span class="ledger-leaf" aria-hidden="true">✿</span> Bonus words</span>
        <strong>${progress.bonusFound.length}</strong>
      </div>
      <p role="status" aria-live="polite" aria-atomic="true">${message}</p>
    </section>

    ${completion ? renderLevelComplete(completion) : ''}

    ${renderFeedbackPanel(snapshot)}
    ${renderGamePanel(snapshot)}
  `;

  bindEvents();
  bindFeedbackEvents(snapshot);
  bindGamePanel();
  updateSwipeGuide();
  fitBoard();
  requestAnimationFrame(fitBoard);
  boardResizeObserver?.disconnect();
  boardResizeObserver = new ResizeObserver(() => requestAnimationFrame(fitBoard));
  boardResizeObserver.observe(app.querySelector('.board-viewport'));
  previousCoins = state.coins;
}


function renderLevelScenery(theme) {
  return botanicalScenery(theme);
}

function renderSlotNumber(snapshot, cell) {
  const slots = snapshot.placements.flatMap((slot, index) => slot.x === cell.x && slot.y === cell.y ? [index + 1] : []);
  return slots.length ? `<small class="slot-number" aria-hidden="true">${slots.join('/')}</small>` : '';
}

function renderCompactProgress(snapshot) {
  const stats = snapshot.campaignStats;
  const percent = state.mode === 'daily' ? Math.round(snapshot.progress.solved.length / snapshot.level.targets.length * 100) : stats.pathPercent;
  return `<button class="compact-progress" data-action="progress" aria-label="View detailed progress">
    <span>${state.mode === 'daily' ? `Daily · ${snapshot.dailyStats.streak}d · bonus ${Math.min(snapshot.dailyObjective?.found || 0, snapshot.dailyObjective?.goal || 3)}/${snapshot.dailyObjective?.goal || 3}` : `${stats.pack.title} · ${stats.currentLevel}/${stats.totalLevels}`}</span>
    <span class="campaign-meter"><span style="width:${percent}%"></span></span><span>${percent}% <span aria-hidden="true">›</span></span>
  </button>`;
}

function renderGardenScene(stats = {}) {
  const planted = (stats.plots || []).filter(plot => plot.plantId);
  const scene = stats.design === 'moonlit'
    ? '<rect width="360" height="130" rx="14" fill="#283853"/><circle cx="296" cy="25" r="18" fill="#fff0c6"/><circle cx="305" cy="19" r="16" fill="#283853"/><path d="M30 20h3m37 17h3m57-23h3m95 23h3m100 16h3" stroke="#ffecad" stroke-width="3"/><path d="M0 93Q170 55 360 91V130H0Z" fill="#52746e"/><ellipse cx="196" cy="103" rx="65" ry="18" fill="#9cb6cb"/><path d="M165 102h60m-45 7h30" stroke="#d9e7ed"/>'
    : stats.design === 'sunroom'
    ? '<rect width="360" height="130" rx="14" fill="#fff0c9"/><path d="M20 93V30L180 4L340 30V93Z" fill="#d4ece2" stroke="#568277" stroke-width="5"/><path d="M100 18V93M180 4V93M260 18V93M20 47H340" stroke="#78a194" stroke-width="3"/><path d="M0 93H360V130H0Z" fill="#d6af86"/><path d="M0 111H360M90 93L75 130M180 93V130M270 93L285 130" stroke="#b58b66"/><path d="M14 87H346" stroke="#876b4d" stroke-width="8"/>'
    : '<rect width="360" height="130" rx="14" fill="#e1ebd3"/><circle cx="306" cy="24" r="17" fill="#f4d78b"/><path d="M0 85Q86 47 187 78T360 65V130H0Z" fill="#b1c79a"/><path d="M155 130Q206 98 173 70" fill="none" stroke="#ecdcba" stroke-width="25"/><path d="M12 85V51M30 81V48M48 77V47M8 60H58" stroke="#f8edd3" stroke-width="6"/>';
  return `<svg class="garden-scene" data-garden-design="${stats.design || 'meadow'}" viewBox="0 0 360 130" aria-hidden="true">${scene}${stats.collectedBloomCount >= 12 ? '<g data-garden-fountain="true"><ellipse cx="190" cy="103" rx="28" ry="8" fill="#6c9d9a"/><path d="M190 100V77M180 91Q177 65 190 69Q203 65 201 91" fill="none" stroke="#d1f1ed" stroke-width="3"/><path d="M173 89Q190 103 207 89" fill="#91b8b1" stroke="#507b78" stroke-width="3"/></g>' : ''}
    ${planted.slice(0,8).map((plot,i)=>`<g class="garden-flower" transform="translate(${12+i*42} ${39+(i%2)*12}) scale(.7)">${plantArt(plot,plot.stage)}</g>`).join('')}</svg>`;
}

function renderGardenWorkbench(stats) {
  const plants = stats.plants || [];
  if (!plants.some(plant => plant.id === selectedPlant)) selectedPlant = plants[0]?.id;
  return `${renderGardenScene(stats)}<div class="garden-summary"><span><strong>${stats.seedCredits || 0}</strong> seeds to plant</span><span><strong>${stats.unlockedAreas || 1}</strong> garden areas</span></div><button data-action="tend-flowers">Tend flowers · ${stats.readyBlooms} ready</button>
    <section class="garden-designs" aria-label="Garden designs"><h3>Make it yours</h3><div>${stats.designs.map(design => `<button data-design="${design.id}" aria-pressed="${stats.design === design.id}" ${!design.unlocked ? 'disabled' : ''}><strong>${design.name}</strong><small>${design.unlocked ? (stats.design === design.id ? 'Selected' : 'Use design') : `${stats.collectedBloomCount}/${design.blooms} blooms collected`}</small></button>`).join('')}</div></section>
    <section class="bloom-album" aria-label="Flower collection"><h3>Bloom collection · ${stats.collectedSpecies.length}/6</h3><p>Collect a flower at full bloom for +5 coins. Each planting rewards you once.</p><div>${plants.map(plant => `<span class="${stats.collectedSpecies.includes(plant.id) ? 'is-collected' : ''}">${stats.collectedSpecies.includes(plant.id) ? '✓ ' : ''}${plant.name}</span>`).join('')}</div><p>${stats.collectedBloomCount} lifetime blooms · ${stats.readyBlooms} ready to collect</p><p>${stats.collectedBloomCount >= 12 ? 'Fountain unlocked — a little oasis in every design.' : `Fountain landmark · ${stats.collectedBloomCount}/12 blooms collected`}</p></section>
    <p class="panel-note">1. Choose a plant. 2. Pick an empty plot (1 seed). Complete campaign or daily puzzles to earn seeds; replays do not grow plants.</p>
    <div class="plant-palette" role="group" aria-label="Choose a plant">${plants.map(plant=>`<button data-plant="${escapeAttribute(plant.id)}" aria-pressed="${selectedPlant === plant.id}"><svg viewBox="0 0 80 95" aria-hidden="true">${plantArt(plant)}</svg><span>${escapeAttribute(plant.name)}</span></button>`).join('')}</div>
    <p class="selected-plant">Selected: <strong>${plants.find(plant => plant.id === selectedPlant)?.name}</strong> · ${stats.seedCredits > 0 ? 'Choose an empty plot, or replace a collected flower below.' : 'No seeds left. Complete a campaign or daily puzzle to earn one.'}</p>
    <div class="garden-plots" tabindex="-1" role="group" aria-label="Your garden plots">${(stats.plots || []).map(plot=>`<article class="garden-plot-card"><button class="garden-plot ${plot.plantId ? 'is-planted' : ''}" data-plot="${plot.index}"  aria-label="Plot ${plot.index+1}: ${plot.plantId ? escapeAttribute(plot.name)+' '+plot.stage : 'empty, plant '+plants.find(plant=>plant.id===selectedPlant)?.name+' for 1 seed'}"><svg viewBox="0 0 80 95" aria-hidden="true">${plot.plantId ? plantArt(plot,plot.stage) : '<ellipse cx="40" cy="73" rx="27" ry="9" fill="#ae9474"/><path d="M40 33V53M30 43H50" stroke="#5e7855" stroke-width="3" stroke-linecap="round"/>'}</svg><strong>${plot.plantId ? escapeAttribute(plot.name) : 'Plant here'}</strong><small>${plot.plantId ? plot.stage : 'Plot '+(plot.index+1)}</small></button>${plot.stage === 'blooming' ? `<button data-${plot.bloomCollected ? 'replant' : 'collect'}="${plot.index}" ${state.mode === 'replay' || (plot.bloomCollected && stats.seedCredits < 1) ? 'disabled' : ''}>${plot.bloomCollected ? `Replace ${plot.name} with ${plants.find(p => p.id === selectedPlant)?.name} · 1 seed` : 'Collect bloom · +5 coins'}</button>` : plot.plantId ? `<small class="growth-count">${Math.max(0, 5 - (stats.totalCompletions - plot.plantedAt))} puzzles to bloom</small>` : ''}</article>`).join('')}</div>
    <p class="garden-notice" role="status">${escapeAttribute(gardenNotice || (stats.nextPlotAt ? 'More plots open as you complete puzzles. Next expansion at '+stats.nextPlotAt+' completions.' : 'Your garden has room to flourish.'))}</p>`;
}

function renderObjectives(snapshot) {
  const objective = snapshot.dailyObjective;
  if (!objective) return '';
  return `<section class="daily-objective" aria-label="Daily objective"><span class="eyebrow">A little extra today</span><h3>Find ${objective.goal} bonus words</h3><p>${objective.found}/${objective.goal} found · ${objective.claimed ? 'Reward collected' : '+'+objective.reward+' coins'}</p><progress value="${Math.min(objective.found,objective.goal)}" max="${objective.goal}" aria-label="Daily bonus-word objective"></progress></section>`;
}

function renderLevelMap(snapshot) {
  return `<section class="level-map" aria-label="Level map"><h3>Your garden path</h3><p class="panel-note">Revisit a cleared puzzle for a relaxed practice round. Replays keep your coins, seeds and campaign progress safe.</p>${state.mode === 'replay' ? '<button data-action="exit-replay">Return to current level</button>' : ''}<div class="level-map__list">${(snapshot.levelMap || []).map(level=>`<button data-replay="${level.levelIndex}" ${!level.completed ? 'disabled' : ''} aria-label="${level.completed ? 'Replay' : level.current ? 'Current' : 'Locked'} level ${level.levelIndex+1}, ${'Clearing '+(level.levelIndex+1)}"><span>${level.levelIndex+1}</span><strong>${'Clearing '+(level.levelIndex+1)}</strong><small>${level.completed ? 'Replay ↗' : level.current ? 'You are here' : 'Locked'}</small></button>`).join('')}</div></section>`;
}

function renderGarden(stats = {}) {
  return `<button class="garden-peek" data-garden-growth="${stats.totalCompletions || 0}" data-action="garden" aria-label="Open your garden, ${stats.flowers || 0} flowers">
    ${renderGardenScene(stats)}<span><strong>Your garden</strong><small>${stats.seedCredits || 0} seeds · ${(stats.plots || []).filter(plot => plot.plantId).length} planted <span aria-hidden="true">›</span></small></span>
  </button>`;
}

function renderGamePanel(snapshot) {
  if (!panel) return '';
  let title = 'Settings';
  let content = `<section class="save-controls" aria-label="Save and backup"><p>Progress stays in this browser only. No cloud account or sync. Clearing browser data removes it; keep a backup for another device.</p><button data-action="save-progress">Save progress</button><p data-save-status role="status">${escapeAttribute(saveNotice)}</p><button data-action="download-backup">Download JSON backup</button><label class="backup-input">Import JSON backup<input type="file" accept=".json,application/json" data-import-backup></label><p role="status">${escapeAttribute(importNotice)}</p>${pendingImport ? `<div class="import-preview"><h3>Replace progress?</h3><p>Backup: ${pendingImport.campaign.completedLevels} campaign completions, ${pendingImport.coins} coins, ${pendingImport.garden?.plots.length || 0} planted plots. Mode: ${pendingImport.mode}.</p><p>Current: ${createSnapshot(state).campaignStats.completedLevels} campaign completions, ${state.coins} coins. This replaces campaign, daily, replay, garden and settings. Download your current backup first if you want to keep it.</p><button data-action="confirm-import">Replace with this backup</button><button data-action="cancel-import">Cancel import</button></div>` : ''}</section><div class="settings-list"><button data-setting="sound" role="switch" aria-checked="${Boolean(snapshot.settings?.sound)}"><span><strong>Garden sounds</strong><small>Soft letter tones and a completion melody</small></span><b>${snapshot.settings?.sound ? 'On' : 'Off'}</b></button><button data-setting="haptics" role="switch" aria-checked="${snapshot.settings?.haptics !== false}"><span><strong>Touch feedback</strong><small>Gentle vibration on supported devices</small></span><b>${snapshot.settings?.haptics !== false ? 'On' : 'Off'}</b></button></div><p class="panel-note">Animations follow your device’s reduced-motion preference.</p><button data-action="reset">Reset progress…</button>`;
  if (panel === 'confirm-reset') {
    title = 'Reset your garden?';
    content = '<p>This clears your levels, coins, daily streaks and garden on this device.</p><button data-action="confirm-reset" class="danger">Yes, reset all progress</button>';
  }
  if (panel === 'board') {
    title = 'Your puzzle, up close';
    const cols = Math.max(...snapshot.cells.map(cell => cell.x)) + 1;
    const rows = Math.max(...snapshot.cells.map(cell => cell.y)) + 1;
    content = `<p>Scroll to explore the whole board. Numbers match the words in Hints.</p><div class="expanded-board-scroll" tabindex="0" role="region" aria-label="Enlarged puzzle board, scroll to see every tile"><div class="expanded-board" style="--cols:${cols};--rows:${rows}">${snapshot.cells.map(cell => `<div class="tile ${cell.solved ? 'is-solved' : ''} ${cell.revealed ? 'is-revealed' : ''}" style="grid-column:${cell.x+1};grid-row:${cell.y+1}" aria-label="Row ${cell.y+1}, column ${cell.x+1}: ${cell.letter || 'blank'}">${renderSlotNumber(snapshot, cell)}${cell.letter}</div>`).join('')}</div></div>`;
  }
  if (panel === 'progress') {
    title = 'Your progress';
    content = `${state.mode === 'daily' ? renderDailyStats(snapshot) : renderCampaignStats(snapshot)}${renderObjectives(snapshot)}${renderLevelMap(snapshot)}`;
  }
  if (panel === 'garden') {
    title = 'Your growing garden';
    const stats = snapshot.gardenStats || {};
    content = renderGardenWorkbench(stats);
  }
  if (panel === 'hint') {
    title = 'A little help';
    const options = snapshot.hintOptions || { words: [], cells: [] };
    const free = state.mode === 'replay' || (options.freeRescueAvailable && state.coins < 5);
    content = `<p>${state.coins} coins${state.mode === 'replay' ? ' · Replay hints are free' : free ? ' · One free rescue available on this puzzle' : ''}</p>
      <label for="hint-word">Choose a word for a letter clue</label>
      <select id="hint-word"><option value="">Choose a word…</option>${options.words.filter(word => word.available).map(word => `<option value="${word.targetIndex}" ${hintTarget === word.targetIndex ? 'selected' : ''}>${escapeAttribute(word.label)} ${word.direction} (row ${word.row}, col ${word.col}) · ${escapeAttribute(word.pattern || '')}</option>`).join('')}</select>
      <p class="panel-note">Reveals its next hidden letter. The small board numbers identify each word.</p>
      <button data-action="buy-clue" ${hintTarget === null || (!free && state.coins < 5) ? 'disabled' : ''}>${free ? 'Use free clue' : 'Letter clue · 5 coins'}</button>
      <hr/><p>Or choose a blank tile to reveal exactly that letter.</p>
      <div class="hint-board" style="--cols:${Math.max(...snapshot.cells.map(c => c.x))+1}">${snapshot.cells.map(cell => `<button class="hint-tile ${hintCell === `${cell.x}:${cell.y}` ? 'is-selected' : ''}" style="grid-column:${cell.x+1};grid-row:${cell.y+1}" data-hint-cell="${cell.x}:${cell.y}" aria-pressed="${hintCell === `${cell.x}:${cell.y}`}" aria-label="Row ${cell.y+1}, column ${cell.x+1}: ${cell.letter || 'blank'}" ${cell.letter ? 'disabled' : ''}>${cell.letter || '·'}</button>`).join('')}</div>
      <button data-action="buy-reveal" ${hintCell === null || (!free && state.coins < 10) ? 'disabled' : ''}>${free ? 'Use free reveal' : 'Reveal tile · 10 coins'}</button>
      <p class="panel-note">Letters already on the board still belong in your word. Build and submit the whole word on the wheel.</p>`;
  }
  return `<dialog class="game-panel" aria-labelledby="game-panel-title"><h2 id="game-panel-title">${title}</h2><button class="panel-close" data-action="close-panel" autofocus>${panel === 'confirm-reset' ? 'Cancel' : 'Close'}</button><div class="game-panel__content">${content}</div></dialog>`;
}

function closeGamePanel() {
  importReadId++; pendingImport = null; importNotice = '';
  panel = null;
  render();
  app.querySelector(`[data-action="${panelReturnFocus}"]`)?.focus();
}

function bindGamePanel() {
  app.querySelector('[data-import-backup]')?.addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    pendingImport = null;
    const readId = ++importReadId;
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('Backup is too large. Maximum size is 1 MB.');
      const text = await file.text();
      if (readId !== importReadId || panel !== 'settings') return;
      pendingImport = parseBackup(text);
      importNotice = 'Backup checked. Review before replacing progress.';
    } catch (error) {
      if (readId !== importReadId || panel !== 'settings') return;
      importNotice = error.message;
    }
    render();
    app.querySelector('[data-action="confirm-import"]')?.focus();
  });
  app.querySelectorAll('[data-setting]').forEach(button => button.addEventListener('click', () => {
    const key = button.dataset.setting;
    const settings = createSnapshot(state).settings || {};
    state = updateSettings(state, { [key]: key === 'haptics' ? settings.haptics === false : !settings.sound });
    saveState(state);
    if (key === 'sound') playGardenTone('target', createSnapshot(state).settings);
    render();
    app.querySelector(`[data-setting="${key}"]`)?.focus();
  }));
  app.querySelectorAll('[data-plant]').forEach(button => button.addEventListener('click', () => {
    selectedPlant = button.dataset.plant; gardenNotice = ''; render();
    app.querySelector(`[data-plant="${selectedPlant}"]`)?.focus();
  }));
  for (const action of ['collect', 'replant', 'design']) app.querySelectorAll(`[data-${action}]`).forEach(button => button.addEventListener('click', () => {
    const value = button.dataset[action];
    const result = action === 'collect' ? collectBloom(state, Number(value)) : action === 'replant' ? plantSeed(state, { plotIndex: Number(value), plantId: selectedPlant, replant: true }) : chooseGardenDesign(state, value);
    state = result.state; gardenNotice = result.message;
    if (result.status !== 'blocked') saveState(state);
    render();
    app.querySelector(`[data-${action === 'collect' ? 'replant' : action === 'replant' ? 'plot' : action}="${value}"]`)?.focus();
  }));
  app.querySelectorAll('[data-plot]').forEach(button => button.addEventListener('click', () => {
    const index = Number(button.dataset.plot);
    const stats = createSnapshot(state).gardenStats;
    const plot = stats.plots[index];
    if (plot.plantId) {
      const age = stats.totalCompletions - plot.plantedAt;
      gardenNotice = `Plot ${index+1}: ${plot.name}, ${plot.stage}. ` + (age >= 5 ? 'Fully grown! Enjoy your bloom. No seed spent.' : `${age < 2 ? `Complete ${2-age} more campaign or daily puzzles to reach growing; ` : 'Keep completing campaign or daily puzzles; '}${5-age} more to bloom. No seed spent.`);
    } else {
      const result = plantSeed(state, { plotIndex: index, plantId: selectedPlant });
      state = result.state;
      gardenNotice = result.status === 'planted' ? `${stats.plants.find(p=>p.id===selectedPlant).name} planted in plot ${index+1}. 1 seed used. Growing after 2 more completions; blooming after 5. Click this plot to inspect it.` : result.message;
      if (result.status === 'planted') saveState(state);
      pulse(result.status);
    }
    render();
    app.querySelector(`[data-plot="${index}"]`)?.focus();
  }));
  app.querySelectorAll('[data-replay]').forEach(button => button.addEventListener('click', () => {
    const result = startReplay(state, Number(button.dataset.replay));
    state = result.state; message = result.message; panel = null; completion = null;
    wheelLetters = prepareWheel(getLevel(state)); selection = []; saveState(state); render();
    app.querySelector('.letter')?.focus();
  }));
  const dialog = app.querySelector('.game-panel');
  if (!dialog) return;
  dialog.showModal();
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeGamePanel(); });
  dialog.querySelector('#hint-word')?.addEventListener('change', event => {
    hintTarget = event.target.value === '' ? null : Number(event.target.value);
    render();
    app.querySelector('#hint-word')?.focus();
  });
  dialog.querySelectorAll('[data-hint-cell]').forEach(button => button.addEventListener('click', () => {
    hintCell = button.dataset.hintCell;
    render();
    app.querySelector(`[data-hint-cell="${hintCell}"]`)?.focus();
  }));
}

function renderFeedbackPanel(snapshot) {
  const shareSupported = typeof navigator.share === 'function';
  return `
    <section class="tester-feedback" data-feedback-root>

      <div class="tester-feedback__panel" id="tester-feedback-panel" role="dialog" aria-modal="false" aria-hidden="true" aria-labelledby="tester-feedback-title">
        <div class="tester-feedback__header">
          <div>
            <p>Tester Report</p>
            <h2 id="tester-feedback-title">Word Garden Feedback</h2>
          </div>
          <button class="tester-feedback__close" type="button" data-feedback-close aria-label="Close feedback">x</button>
        </div>
        <label>
          Category
          <select data-feedback-category>
            ${FEEDBACK_CATEGORIES.map((item) => `<option value="${item.value}">${item.label}</option>`).join('')}
          </select>
        </label>
        <div class="tester-feedback__grid">
          <label>
            Device
            <input data-feedback-device type="text" autocomplete="off" value="${escapeAttribute(getDeviceLabel())}" />
          </label>
          <label>
            Browser
            <input data-feedback-browser type="text" readonly value="${escapeAttribute(getBrowserLabel())}" />
          </label>
        </div>
        <div class="tester-feedback__grid">
          <label>
            Build
            <input data-feedback-build type="text" readonly value="${BUILD_VERSION}" />
          </label>
          <label>
            Mode / level
            <input data-feedback-level type="text" autocomplete="off" value="${escapeAttribute(getFeedbackLevelLabel(snapshot))}" />
          </label>
        </div>
        <label>
          Performance note
          <input data-feedback-performance type="text" placeholder="Smooth, stuttered, hot device, slow board..." />
        </label>
        <label>
          Report
          <textarea data-feedback-report rows="5" placeholder="What happened? What did you expect?"></textarea>
        </label>
        <div class="tester-feedback__actions">
          <button type="button" data-feedback-github>Create GitHub ticket</button>
          <button type="button" data-feedback-copy>Copy report</button>
          <button type="button" data-feedback-share ${shareSupported ? '' : 'hidden'}>Web Share</button>
        </div>
        <p class="tester-feedback__status" data-feedback-status aria-live="polite"></p>
      </div>
    </section>
  `;
}

function bindFeedbackEvents(snapshot) {
  const root = app.querySelector('[data-feedback-root]');
  if (!root) return;

  const cta = app.querySelector('.tester-feedback__cta');
  const panel = root.querySelector('.tester-feedback__panel');
  const close = root.querySelector('[data-feedback-close]');
  const githubButton = root.querySelector('[data-feedback-github]');
  const copyButton = root.querySelector('[data-feedback-copy]');
  const shareButton = root.querySelector('[data-feedback-share]');
  const status = root.querySelector('[data-feedback-status]');

  const setOpen = (open, restoreFocus = false) => {
    root.classList.toggle('is-open', open);
    panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    cta.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      root.querySelector('[data-feedback-level]').value = getFeedbackLevelLabel(snapshot);
      window.setTimeout(() => root.querySelector('[data-feedback-category]')?.focus(), 0);
    } else if (restoreFocus) {
      cta.focus();
    }
  };

  const clearStatus = () => {
    status.textContent = '';
    status.replaceChildren();
  };

  const setStatusText = (text) => {
    status.textContent = text;
  };

  const setStatusLink = (text, href, linkText) => {
    clearStatus();
    status.append(document.createTextNode(`${text} `));
    const link = document.createElement('a');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = linkText;
    status.append(link);
  };

  cta.addEventListener('click', () => setOpen(true));
  close.addEventListener('click', () => setOpen(false, true));
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false, true);
    }
  });
  copyButton.addEventListener('click', async () => {
    try {
      await copyText(buildFeedbackReport(root));
      setStatusText('Report copied.');
    } catch {
      setStatusText('Copy failed. Select the report text manually.');
    }
  });
  shareButton?.addEventListener('click', async () => {
    try {
      await navigator.share({ title: 'Word Garden Feedback', text: buildFeedbackReport(root) });
      setStatusText('Share opened.');
    } catch (error) {
      if (error?.name !== 'AbortError') setStatusText('Share failed.');
    }
  });
  githubButton.addEventListener('click', async () => {
    githubButton.disabled = true;
    setStatusText('Creating GitHub ticket...');
    try {
      const response = await fetch(FEEDBACK_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildFeedbackPayload(root))
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result?.issueUrl) {
        setStatusLink('GitHub ticket created:', result.issueUrl, 'Open issue');
      } else {
        setStatusLink('Ticket creation failed. Use this draft instead:', result?.draftUrl || buildFeedbackDraftUrl(root), 'Open draft');
      }
    } catch {
      setStatusLink('Feedback endpoint unavailable. Use this draft instead:', buildFeedbackDraftUrl(root), 'Open draft');
    } finally {
      githubButton.disabled = false;
    }
  });
}

function renderDailyStats(snapshot) {
  return `
    <section class="daily-strip" aria-label="Daily progress">
      <div>
        <span>Streak</span>
        <strong>${snapshot.dailyStats.streak}</strong>
      </div>
      <div>
        <span>Best</span>
        <strong>${snapshot.dailyStats.bestStreak}</strong>
      </div>
      <div>
        <span>Reward</span>
        <strong>${snapshot.progress.completed ? 'Done' : '+' + snapshot.dailyStats.reward}</strong>
      </div>
    </section>
  `;
}

function renderCampaignStats(snapshot) {
  const stats = snapshot.campaignStats;
  const loopLabel = stats.pathLoop > 1 ? `Loop ${stats.pathLoop}` : 'Path';
  const milestoneLabel =
    stats.milestone.remaining === stats.milestone.every
      ? `Next bonus at ${stats.milestone.nextAt}`
      : `${stats.milestone.remaining} to bonus`;

  return `
    <section class="campaign-strip" aria-label="Campaign progress">
      <div class="campaign-strip__meta">
        <span>${stats.pack.title}</span>
        <strong>Level ${stats.currentLevel}/${stats.totalLevels}</strong>
      </div>
      <div class="campaign-meter" aria-label="${stats.pathPercent}% campaign path complete">
        <span style="width: ${stats.pathPercent}%"></span>
      </div>
      <div class="campaign-strip__stats">
        <span>${loopLabel} ${stats.pathPercent}%</span>
        <strong>Next +${stats.nextReward}</strong>
      </div>
      <div class="campaign-journey">
        <div>
          <span>Cleared</span>
          <strong>${stats.completedLevels}</strong>
        </div>
        <div>
          <span>${milestoneLabel}</span>
          <strong>+${stats.nextReward + stats.milestone.reward}</strong>
        </div>
        <div>
          <span>Best run</span>
          <strong>${stats.bestRun}</strong>
        </div>
      </div>
      <div class="campaign-pack">
        <span>Pack ${stats.pack.current}/${stats.pack.total}</span>
        <strong>${stats.pack.percent}%</strong>
      </div>
    </section>
  `;
}

function getBrowserLabel() {
  const ua = navigator.userAgent || '';
  const uaData = navigator.userAgentData;
  if (uaData?.brands?.length) {
    const brand = uaData.brands.find((item) => !/Not/i.test(item.brand)) || uaData.brands[0];
    return `${brand.brand} ${brand.version}`;
  }
  if (/Edg\//.test(ua)) return `Edge ${ua.match(/Edg\/([\d.]+)/)?.[1] || ''}`.trim();
  if (/Chrome\//.test(ua)) return `Chrome ${ua.match(/Chrome\/([\d.]+)/)?.[1] || ''}`.trim();
  if (/Firefox\//.test(ua)) return `Firefox ${ua.match(/Firefox\/([\d.]+)/)?.[1] || ''}`.trim();
  if (/Safari\//.test(ua)) return `Safari ${ua.match(/Version\/([\d.]+)/)?.[1] || ''}`.trim();
  return 'Unknown browser';
}

function getDeviceLabel() {
  const ua = navigator.userAgent || '';
  const platform = navigator.userAgentData?.platform || navigator.platform || 'unknown platform';
  if (/CrOS/i.test(ua)) return `Chromebook (${platform})`;
  if (/Pixel/i.test(ua)) return `Pixel / Android (${platform})`;
  if (/Android/i.test(ua)) return `Android (${platform})`;
  if (/iPhone|iPad|iPod/i.test(ua)) return `iOS (${platform})`;
  return platform;
}

function getFeedbackLevelLabel(snapshot) {
  if (state.mode === 'daily') {
    return `Daily - ${state.mode === 'daily' ? 'Daily puzzle' : 'Clearing ' + snapshot.level.id}`;
  }
  return `Level ${snapshot.campaignStats.currentLevel}/${snapshot.campaignStats.totalLevels} - ${state.mode === 'daily' ? 'Daily puzzle' : 'Clearing ' + snapshot.level.id} (${snapshot.campaignStats.pack.title})`;
}

function feedbackValue(root, selector) {
  return String(root.querySelector(selector)?.value || '').trim() || 'Not provided';
}

function feedbackSelectLabel(root) {
  const select = root.querySelector('[data-feedback-category]');
  return select?.selectedOptions?.[0]?.textContent?.trim() || feedbackValue(root, '[data-feedback-category]');
}

function buildFeedbackReport(root) {
  return [
    'Word Garden Tester Report',
    `Category: ${feedbackSelectLabel(root)}`,
    `Device: ${feedbackValue(root, '[data-feedback-device]')}`,
    `Browser: ${feedbackValue(root, '[data-feedback-browser]')}`,
    `Build: ${feedbackValue(root, '[data-feedback-build]')}`,
    `Mode: ${state.mode}`,
    `Mode / level: ${feedbackValue(root, '[data-feedback-level]')}`,
    `Performance: ${feedbackValue(root, '[data-feedback-performance]')}`,
    '',
    'Report:',
    feedbackValue(root, '[data-feedback-report]')
  ].join('\n');
}

function buildFeedbackPayload(root) {
  return {
    category: feedbackValue(root, '[data-feedback-category]'),
    device: feedbackValue(root, '[data-feedback-device]'),
    browser: feedbackValue(root, '[data-feedback-browser]'),
    build: feedbackValue(root, '[data-feedback-build]'),
    mode: state.mode,
    level: feedbackValue(root, '[data-feedback-level]'),
    performance: feedbackValue(root, '[data-feedback-performance]'),
    report: feedbackValue(root, '[data-feedback-report]')
  };
}

function buildFeedbackDraftUrl(root) {
  const params = new URLSearchParams({
    title: `[Playtest]: ${feedbackSelectLabel(root)} - ${state.mode} - ${feedbackValue(root, '[data-feedback-level]')}`,
    labels: GITHUB_ISSUE_LABELS,
    body: buildFeedbackReport(root)
  });
  return `${GITHUB_ISSUE_URL}?${params.toString()}`;
}

function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const scratch = document.createElement('textarea');
  scratch.value = text;
  scratch.setAttribute('readonly', '');
  scratch.style.position = 'fixed';
  scratch.style.left = '-9999px';
  document.body.appendChild(scratch);
  scratch.select();
  const copied = document.execCommand?.('copy');
  scratch.remove();
  return copied ? Promise.resolve() : Promise.reject(new Error('copy unavailable'));
}

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderLevelComplete(details) {
  return `
    <section class="level-complete" role="dialog" aria-modal="true" aria-labelledby="level-complete-title">
      <div class="level-complete__panel">
        <span>${details.context}</span>
        <h2 id="level-complete-title">${details.title}</h2>
        <p>${details.message}</p>
        <p class="garden-growth">${details.growth || 'A new flower is growing in your garden.'}</p>
        ${renderGardenScene(createSnapshot(state).gardenStats)}
        ${
          details.theme
            ? `<p class="level-complete__theme">${details.theme.completed} complete. ${details.theme.next} unlocked.</p>`
            : ''
        }
        <div class="level-complete__stats">
          <div>
            <span>Cleared</span>
            <strong>${details.cleared}</strong>
          </div>
          <div>
            <span>Reward</span>
            <strong>+${details.reward}</strong>
          </div>
          <div>
            <span>Next</span>
            <strong>${details.next}</strong>
          </div>
        </div>
        <button class="primary" data-action="continue">Continue</button>
        ${state.mode !== 'replay' ? '<button data-action="visit-garden">Visit garden & collect</button>' : '<button data-action="exit-replay">Return to current level</button>'}
      </div>
    </section>
  `;
}

function bindEvents() {
  app.querySelectorAll('.letter').forEach((button) => {
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (refreshDaily()) return;
      isSwiping = true;
      selectionChangedDuringSwipe = false;
      swipePointer = getWheelPoint(event.clientX, event.clientY);
      selectLetter(Number(button.dataset.index));
    });
    button.addEventListener('click', (event) => {
      if (event.detail === 0) selectLetter(Number(button.dataset.index));
    });
  });

  app.querySelector('[data-wheel]').addEventListener('pointerup', () => {
    endSwipe();
  });

  app.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => handleAction(button.dataset.action));
  });

  app.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      state = setMode(state, button.dataset.mode);
      wheelLetters = prepareWheel(getLevel(state));
      selection = [];
      feedback = null;
      message = state.mode === 'daily' ? 'Today has its own little garden.' : 'Back to the level path.';
      pulse('light');
      saveState(state);
      render();
    });
  });

  if (completion) {
    const modal = app.querySelector('.level-complete');
    [...app.children].forEach(child => { if (child !== modal) child.inert = true; });
    modal.addEventListener('keydown', event => {
      if (event.key === 'Tab') {
        const buttons = [...modal.querySelectorAll('button')];
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1).focus(); }
        else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0].focus(); }
      }
    });
    window.setTimeout(() => app.querySelector('.level-complete [data-action="continue"]')?.focus(), 0);
  }
}

function selectLetter(index, backtrack = false) {
  if (refreshDaily()) return false;
  if (!Number.isInteger(index) || index < 0 || index >= wheelLetters.length) {
    return false;
  }

  const next = extendSelection(selection, index, wheelLetters, backtrack);
  if (next === selection) return false;
  selection = next;
  playGardenTone('letter', state.settings, selection.length - 1);
  updateSelectionView();
  return true;
}

function updateSelectionView() {
  const currentWord = selection.map((item) => item.letter).join('');
  const selectedIndexes = new Set(selection.map((item) => item.index));
  const currentWordElement = app.querySelector('.current-word');

  if (currentWordElement) {
    currentWordElement.textContent = currentWord || 'TAP OR SWIPE LETTERS';
    currentWordElement.classList.toggle('has-word', Boolean(currentWord));
  }

  app.querySelectorAll('.letter').forEach((button) => {
    const active = selectedIndexes.has(Number(button.dataset.index));
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });

  updateSwipeGuide();
}

function getWheelPoint(clientX, clientY) {
  const wheel = app.querySelector('[data-wheel]');
  if (!wheel) {
    return null;
  }

  const box = wheel.getBoundingClientRect();
  return {
    x: ((clientX - box.left) / box.width) * 100,
    y: ((clientY - box.top) / box.height) * 100
  };
}

function getLetterPoint(index) {
  const wheel = app.querySelector('[data-wheel]');
  const letter = app.querySelector(`.letter[data-index="${index}"]`);
  if (!wheel || !letter) {
    return null;
  }

  const wheelBox = wheel.getBoundingClientRect();
  const letterBox = letter.getBoundingClientRect();
  return {
    x: ((letterBox.left + letterBox.width / 2 - wheelBox.left) / wheelBox.width) * 100,
    y: ((letterBox.top + letterBox.height / 2 - wheelBox.top) / wheelBox.height) * 100
  };
}

function fitBoard() {
  const pageScroll = { x: window.scrollX, y: window.scrollY };
  app.style.removeProperty('min-height');
  const boardRows = Number(app.querySelector('.board')?.style.getPropertyValue('--rows'));
  app.dataset.compactBoard = boardRows >= 10 && window.innerHeight < 760 ? 'true' : 'false';
  delete document.body.dataset.pageScroll;
  const viewport = app.querySelector('.board-viewport');
  const board = app.querySelector('.board');
  const wheel = app.querySelector('.wheel');
  const letters = wheel?.querySelectorAll('.letter');
  if (!viewport || !board) return;
  const styles = getComputedStyle(board);
  const cols = Number(board.style.getPropertyValue('--cols'));
  const rows = Number(board.style.getPropertyValue('--rows'));
  const gap = parseFloat(styles.gap);
  const paddingX = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
  const paddingY = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
  const minimumTile = window.innerWidth < 350 ? 22 : 24;
  if (letters?.length > 1) {
    const placeLetters = (size, radius) => {
      const diameter = Math.ceil(radius * 2 + size * 1.08 + 6);
      wheel.style.setProperty('--letter-size', `${size}px`);
      wheel.style.width = `${diameter}px`;
      wheel.style.minWidth = `${diameter}px`;
      letters.forEach((letter, index) => {
        const angle = index / letters.length * Math.PI * 2 - Math.PI / 2;
        letter.style.left = `${50 + Math.cos(angle) * radius / diameter * 100}%`;
        letter.style.top = `${50 + Math.sin(angle) * radius / diameter * 100}%`;
      });
      return diameter;
    };
    // Wheel + board height is a fixed budget. Measure it without temporarily
    // shrinking the wheel: transient reflow can scroll-anchor a solved board
    // out of view when returning from replay. Reserve both 44px tool columns.
    const minRadius = size => Math.max(52, (size * 1.08 + 4) / (2 * Math.sin(Math.PI / letters.length)));
    const composer = app.querySelector('.composer');
    const columnGap = parseFloat(getComputedStyle(composer).columnGap);
    const boardMinimum = rows * minimumTile + gap * (rows - 1) + paddingY;
    const maxDiameter = Math.floor(Math.min(
      composer.clientWidth - 88 - columnGap * 2,
      wheel.getBoundingClientRect().height + viewport.clientHeight - boardMinimum
    ));
    // Prefer generous targets and a wider ring even on short, six-letter
    // puzzles. Only unusually dense boards fall back toward the 44px baseline.
    let size = window.innerHeight >= 760 ? 60 : 52;
    while (size > 44 && Math.ceil(minRadius(size) * 2 + size * 1.08 + 6) > maxDiameter) size--;
    const radius = Math.max(minRadius(size), Math.min(76, (maxDiameter - size * 1.08 - 6) / 2));
    placeLetters(size, radius);
  }
  const fitWidth = (viewport.clientWidth - paddingX - gap * (cols - 1)) / cols;
  const fitHeight = (viewport.clientHeight - paddingY - gap * (rows - 1)) / rows;
  const tileSize = Math.min(46, Math.floor(fitWidth), Math.max(minimumTile, Math.floor(fitHeight)));
  board.style.setProperty('--fit-tile-size', `${tileSize}px`);
  // Exceptionally short screens can extend the page, but the complete board
  // remains a single view: never a small independently scrolling window.
  const requiredHeight = rows * tileSize + gap * (rows - 1) + paddingY;
  const deficit = Math.max(0, requiredHeight - viewport.clientHeight);
  if (deficit > 0) {
    app.style.minHeight = `${Math.ceil(app.getBoundingClientRect().height + deficit)}px`;
    document.body.dataset.pageScroll = 'true';
  }
  if (document.body.dataset.pageScroll === 'true' && (pageScroll.x || pageScroll.y)) window.scrollTo(pageScroll.x, pageScroll.y);
  updateBoardScrollHint();
}

function updateBoardScrollHint() {
  const viewport = app.querySelector('.board-viewport');
  const hint = app.querySelector('.board-scroll-hint');
  if (!viewport || !hint) return;
  viewport.dataset.overflow = 'false';
  hint.textContent = 'All words in view';
}

window.addEventListener('resize', fitBoard);

// A daily board may stay open overnight. Refresh the wheel and board together.
function refreshDaily(redraw = true) {
  if (state.mode !== 'daily') { renderedDailyDate = null; return false; }
  const dateKey = getProgress(state).dateKey;
  if (dateKey === renderedDailyDate) return false;
  renderedDailyDate = dateKey;
  state = setMode(state, 'daily');
  wheelLetters = prepareWheel(getLevel(state));
  selection = [];
  isSwiping = false;
  selectionChangedDuringSwipe = false;
  swipePointer = null;
  completion = null;
  feedback = null;
  panel = null;
  hintTarget = null;
  hintCell = null;
  message = 'A new daily garden is ready. Build words with today’s letters.';
  saveState(state);
  if (redraw) render();
  return true;
}
window.addEventListener('focus', () => refreshDaily());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshDaily();
});

function updateSwipeGuide() {
  const guide = app.querySelector('[data-swipe-guide]');
  if (!guide) {
    return;
  }

  const selectedPoints = selection.map((item) => getLetterPoint(item.index)).filter(Boolean);
  const path = guide.querySelector('[data-swipe-path]');
  const live = guide.querySelector('[data-swipe-live]');

  path.setAttribute('points', selectedPoints.map((point) => `${point.x},${point.y}`).join(' '));
  path.classList.toggle('is-visible', selectedPoints.length > 1);

  const lastPoint = selectedPoints.at(-1);
  if (isSwiping && lastPoint && swipePointer) {
    live.setAttribute('x1', lastPoint.x);
    live.setAttribute('y1', lastPoint.y);
    live.setAttribute('x2', swipePointer.x);
    live.setAttribute('y2', swipePointer.y);
    live.classList.add('is-visible');
  } else {
    live.classList.remove('is-visible');
  }
}

window.addEventListener('pointermove', (event) => {
  if (!isSwiping) {
    return;
  }

  event.preventDefault();
  swipePointer = getWheelPoint(event.clientX, event.clientY);
  const target = document.elementFromPoint(event.clientX, event.clientY);
  const letter = target?.closest?.('.letter');
  if (letter && app.contains(letter)) {
    const selected = selectLetter(Number(letter.dataset.index), true);
    selectionChangedDuringSwipe = selectionChangedDuringSwipe || selected;
  } else {
    updateSwipeGuide();
  }
});

window.addEventListener('pointerup', () => {
  endSwipe();
});

window.addEventListener('pointercancel', () => {
  isSwiping = false;
  selectionChangedDuringSwipe = false;
  swipePointer = null;
  updateSwipeGuide();
});

function endSwipe() {
  if (!isSwiping) {
    return;
  }

  isSwiping = false;
  swipePointer = null;
  if (selectionChangedDuringSwipe && selection.length >= 3) {
    handleSubmit();
  } else {
    updateSwipeGuide();
  }
  selectionChangedDuringSwipe = false;
}

function handleAction(action) {
  if (action === 'tend-flowers') {
    const plots = app.querySelector('.garden-plots');
    plots?.focus(); plots?.scrollIntoView({ block: 'start' }); return;
  }
  if (refreshDaily()) return;
  if (action === 'save-progress') { saveState(state); render(); app.querySelector('[data-action="save-progress"]')?.focus(); }
  if (action === 'download-backup') {
    const url = URL.createObjectURL(new Blob([createBackup(state)], {type:'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = 'word-garden-backup.json'; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    importNotice = 'Backup download requested. Check your browser downloads.'; render();
  }
  if (action === 'cancel-import') { importReadId++; pendingImport = null; importNotice = 'Import cancelled. Progress unchanged.'; render(); }
  if (action === 'confirm-import' && pendingImport) {
    if (saveState(pendingImport)) {
      state = pendingImport; pendingImport = null; selection = []; completion = null; feedback = null;
      wheelLetters = prepareWheel(getLevel(state)); importNotice = 'Backup imported and saved in this browser.';
    } else { importNotice = 'Import not applied. Current progress is unchanged.'; }
    render();
  }
  if (action === 'visit-garden') {
    completion = null; rewardInFlight = false; panel = 'garden'; panelReturnFocus = 'garden'; render();
  }
  if (action === 'exit-replay') {
    state = exitReplay(state); panel = null; completion = null; selection = [];
    wheelLetters = prepareWheel(getLevel(state)); message = 'Back to your garden path.'; saveState(state); render();
  }
  if (action === 'submit') {
    handleSubmit();
  }
  if (action === 'clear') {
    selection = [];
    completion = null;
    feedback = null;
    message = 'Cleared.';
    pulse('light');
    render();
  }
  if (action === 'backspace') {
    selection.pop();
    feedback = null;
    pulse('tick');
    render();
  }
  if (action === 'shuffle') {
    wheelLetters = prepareWheel(getLevel(state));
    selection = [];
    feedback = { tone: 'shuffle', label: 'Fresh letters' };
    message = 'Wheel shuffled.';
    pulse('light');
    render();
  }
  if (['hint', 'settings', 'garden', 'progress', 'board'].includes(action)) {
    panel = action;
    panelReturnFocus = action;
    hintTarget = null;
    hintCell = null;
    render();
  }
  if (action === 'reset') {
    importReadId++; pendingImport = null; importNotice = '';
    panel = 'confirm-reset';
    render();
  }
  if (action === 'confirm-reset') {
    try { state = resetState(); } catch { saveNotice = 'Reset failed: browser storage is unavailable. Progress unchanged.'; panel = 'settings'; render(); return; }
    saveState(state);
    wheelLetters = prepareWheel(getLevel(state));
    selection = [];
    completion = null;
    panel = null;
    feedback = { tone: 'reset', label: 'Fresh start' };
    message = 'Progress reset.';
    render();
    app.querySelector('[data-action="settings"]')?.focus();
  }
  if (action === 'close-panel') closeGamePanel();
  if (action === 'buy-clue' || action === 'buy-reveal') {
    const result = useHint(state, action === 'buy-clue'
      ? { type: 'clue', targetIndex: hintTarget }
      : { type: 'reveal', cellKey: hintCell });
    state = result.state;
    message = result.message;
    feedback = createFeedback(result);
    selection = [];
    saveState(state);
    pulse(result.status);
    closeGamePanel();
  }
  if (action === 'continue') {
    completion = null;
    if (rewardInFlight) window.setTimeout(() => { rewardInFlight = false; app.querySelector('.garden-reward-flight')?.remove(); }, 1000);
    feedback = null;
    pulse('light');
    render();
    app.querySelector('.letter')?.focus();
  }
}

function handleSubmit() {
  if (refreshDaily()) return;
  const word = selection.map((item) => item.letter).join('');
  const previousLevel = state.levelIndex;
  const beforeSnapshot = createSnapshot(state);
  const result = submitWord(word, state);
  state = result.state;
  message = result.message;
  selection = [];
  isSwiping = false;
  selectionChangedDuringSwipe = false;
  swipePointer = null;
  feedback = createFeedback(result, word);

  if (state.levelIndex !== previousLevel) {
    wheelLetters = prepareWheel(getLevel(state));
  }

  if (result.status === 'level-complete') {
    completion = createCompletionDetails(beforeSnapshot, createSnapshot(state), result.message);
    rewardInFlight = state.mode !== 'replay';
  } else {
    completion = null;
  }

  pulse(result.status);
  saveState(state);
  render();
}

function createFeedback(result, word = '') {
  if (result.status === 'target') {
    return { tone: 'target', label: `${word} planted` };
  }
  if (result.status === 'bonus') {
    return { tone: 'bonus', label: result.message };
  }
  if (result.status === 'level-complete') {
    return { tone: 'complete', label: 'Garden cleared' };
  }
  if (result.status === 'hint') {
    return { tone: 'hint', label: 'Letter revealed' };
  }
  if (result.status === 'repeat') {
    return { tone: 'repeat', label: 'Already found' };
  }
  if (result.status === 'blocked') {
    return { tone: 'blocked', label: 'Not enough yet' };
  }
  if (result.status === 'invalid') {
    return { tone: 'invalid', label: 'Try another path' };
  }
  return null;
}

function pulse(kind) {
  const settings = state.settings || {};
  playGardenTone(kind, settings);
  if (settings.haptics === false || !navigator.vibrate) {
    return;
  }

  const patterns = {
    target: 18,
    bonus: [18, 26, 18],
    'level-complete': [28, 36, 42],
    hint: [10, 24, 10],
    invalid: 12,
    repeat: 10,
    blocked: 16,
    light: 8,
    tick: 5
  };
  const pattern = patterns[kind];
  if (pattern) navigator.vibrate(pattern);
}

function createCompletionDetails(beforeSnapshot, afterSnapshot, resultMessage) {
  const before = beforeSnapshot.gardenStats;
  const after = afterSnapshot.gardenStats;
  const newBlooms = Math.max(0, after.readyBlooms - before.readyBlooms);
  const newPlots = after.unlockedPlots - before.unlockedPlots;
  const growth = `+1 seed · ${newBlooms} new ${newBlooms === 1 ? 'bloom' : 'blooms'}${newPlots ? ` · +${newPlots} plots` : ''}. ${newBlooms ? 'Visit your garden to collect +5 coins per bloom.' : 'Every puzzle helps your flowers grow.'}`;
  if (state.mode === 'replay') return { growth: 'A little practice, just for you. Your garden progress is safe.', context: 'Garden replay', title: 'Replay complete', message: resultMessage, cleared: beforeSnapshot.level.title, reward: '0', next: 'Your choice' };
  if (state.mode === 'daily') {
    return {
      growth,
      context: beforeSnapshot.level.title,
      title: 'Daily complete',
      message: resultMessage,
      cleared: 'Daily',
      reward: getRewardFromMessage(resultMessage),
      next: 'Tomorrow'
    };
  }

  return {
    growth,
    context: beforeSnapshot.campaignStats.pack.title,
    title: `Level ${beforeSnapshot.campaignStats.currentLevel} complete`,
    message: resultMessage,
    cleared: `Level ${beforeSnapshot.campaignStats.currentLevel}`,
    reward: getRewardFromMessage(resultMessage),
    next: `Level ${afterSnapshot.campaignStats.currentLevel}`,
    theme: getThemeCompletionDetails(beforeSnapshot.campaignStats, afterSnapshot.campaignStats)
  };
}

function getRewardFromMessage(resultMessage) {
  const match = resultMessage.match(/\+(\d+)/);
  return match ? match[1] : '0';
}

function getThemeCompletionDetails(beforeStats, afterStats) {
  if (!beforeStats.pack.isFinalLevel || beforeStats.pack.title === afterStats.pack.title) {
    return null;
  }

  return {
    completed: beforeStats.pack.title,
    next: afterStats.pack.title
  };
}

render();

// Recalculate after web fonts settle so compact screens keep usable board space.
document.fonts.ready.then(() => fitBoard());
document.fonts.addEventListener('loadingdone', fitBoard);
