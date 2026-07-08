import './style.css';
import {
  createSnapshot,
  getLevel,
  getProgress,
  loadState,
  resetState,
  saveState,
  setMode,
  shuffleLetters,
  submitWord,
  useHint
} from './game.js';

const app = document.querySelector('#app');
let state = loadState();
let wheelLetters = getLevel(state).letters;
let selection = [];
let message = 'Find every word hidden in the garden.';
let completion = null;
let isSwiping = false;
let selectionChangedDuringSwipe = false;
let swipePointer = null;
let feedback = null;
let previousCoins = state.coins;

function render() {
  const snapshot = createSnapshot(state);
  const progress = getProgress(state);
  const levelLabel = state.mode === 'daily' ? 'Daily' : `Level ${snapshot.campaignStats.currentLevel}`;
  const maxX = Math.max(...snapshot.cells.map((cell) => cell.x));
  const maxY = Math.max(...snapshot.cells.map((cell) => cell.y));
  const currentWord = selection.map((item) => item.letter).join('');
  const coinChanged = state.coins !== previousCoins;

  app.innerHTML = `
    <section class="topbar" aria-label="Game status">
      <div>
        <p class="eyebrow">${levelLabel}</p>
        <h1>Word Garden</h1>
      </div>
      <div class="coin-pill ${coinChanged ? 'is-bumped' : ''}" aria-label="${state.coins} coins">${state.coins}</div>
    </section>

    <section class="mode-tabs" aria-label="Game mode">
      <button class="${state.mode === 'campaign' ? 'is-active' : ''}" data-mode="campaign">Levels</button>
      <button class="${state.mode === 'daily' ? 'is-active' : ''}" data-mode="daily">Daily</button>
    </section>

    ${state.mode === 'daily' ? renderDailyStats(snapshot) : renderCampaignStats(snapshot)}

    <section class="board-wrap">
      <div class="level-card">
        <p>${snapshot.level.title}</p>
        <strong>${progress.solved.length}/${snapshot.level.targets.length}</strong>
      </div>
      <div class="board" style="--cols: ${maxX + 1}; --rows: ${maxY + 1};">
        ${snapshot.cells
          .map(
            (cell) => `
              <div
                class="tile ${cell.letter ? 'is-filled' : ''} ${cell.solved ? 'is-solved' : ''} ${cell.revealed ? 'is-revealed' : ''}"
                style="grid-column: ${cell.x + 1}; grid-row: ${cell.y + 1}; --pop-delay: ${(cell.x + cell.y) * 18}ms;"
              >${cell.letter}</div>
            `
          )
          .join('')}
      </div>
    </section>

    <section class="composer" aria-label="Word builder">
      <div class="current-word ${currentWord ? 'has-word' : ''}">${currentWord || 'TAP OR SWIPE LETTERS'}</div>
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
            return `<button class="letter ${active ? 'is-active' : ''}" data-index="${index}" style="left: ${x}%; top: ${y}%;">${letter}</button>`;
          })
          .join('')}
      </div>
      <div class="actions">
        <button data-action="clear">Clear</button>
        <button data-action="submit" class="primary">Submit</button>
        <button data-action="backspace">Back</button>
      </div>
    </section>

    <section class="tools">
      <button data-action="shuffle">Shuffle</button>
      <button data-action="hint">Hint 15</button>
      <button data-action="reset">Reset</button>
    </section>

    <section class="ledger">
      <div>
        <span>Bonus words</span>
        <strong>${progress.bonusFound.length}</strong>
      </div>
      <p>${message}</p>
      ${feedback ? `<strong class="feedback-toast feedback-toast--${feedback.tone}" role="status">${feedback.label}</strong>` : ''}
    </section>

    ${completion ? renderLevelComplete(completion) : ''}
  `;

  bindEvents();
  updateSwipeGuide();
  fitBoard();
  previousCoins = state.coins;
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

function renderLevelComplete(details) {
  return `
    <section class="level-complete" role="dialog" aria-modal="true" aria-labelledby="level-complete-title">
      <div class="level-complete__panel">
        <span>${details.context}</span>
        <h2 id="level-complete-title">${details.title}</h2>
        <p>${details.message}</p>
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
      </div>
    </section>
  `;
}

function bindEvents() {
  app.querySelectorAll('.letter').forEach((button) => {
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      isSwiping = true;
      selectionChangedDuringSwipe = false;
      swipePointer = getWheelPoint(event.clientX, event.clientY);
      selectLetter(Number(button.dataset.index));
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
      wheelLetters = getLevel(state).letters;
      selection = [];
      feedback = null;
      message = state.mode === 'daily' ? 'Today has its own little garden.' : 'Back to the level path.';
      pulse('light');
      saveState(state);
      render();
    });
  });
}

function selectLetter(index) {
  if (!Number.isInteger(index) || index < 0 || index >= wheelLetters.length) {
    return false;
  }

  if (selection.some((item) => item.index === index)) {
    return false;
  }
  selection.push({ index, letter: wheelLetters[index] });
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
    button.classList.toggle('is-active', selectedIndexes.has(Number(button.dataset.index)));
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
  const wrap = app.querySelector('.board-wrap');
  const board = app.querySelector('.board');
  const firstTile = board?.querySelector('.tile');

  if (!wrap || !board || !firstTile) {
    return;
  }

  board.style.removeProperty('--fit-tile-size');

  const boardStyles = getComputedStyle(board);
  const cols = Number(board.style.getPropertyValue('--cols'));
  const rows = Number(board.style.getPropertyValue('--rows'));
  const baseTileSize = firstTile.getBoundingClientRect().width;
  const tileGap = parseFloat(boardStyles.gap);
  const boardPaddingX = parseFloat(boardStyles.paddingLeft) + parseFloat(boardStyles.paddingRight);
  const boardPaddingY = parseFloat(boardStyles.paddingTop) + parseFloat(boardStyles.paddingBottom);
  const availableWidth = wrap.clientWidth;
  const availableHeight = wrap.clientHeight;

  if (!cols || !rows || !availableWidth || !availableHeight || !baseTileSize || !Number.isFinite(tileGap)) {
    return;
  }

  const fitWidth = (availableWidth - boardPaddingX - tileGap * (cols - 1)) / cols;
  const fitHeight = (availableHeight - boardPaddingY - tileGap * (rows - 1)) / rows;
  const fittedTileSize = Math.max(10, Math.floor(Math.min(baseTileSize, fitWidth, fitHeight) - 1));

  if (Number.isFinite(fittedTileSize) && fittedTileSize > 0) {
    board.style.setProperty('--fit-tile-size', `${fittedTileSize}px`);
  }
}

window.addEventListener('resize', fitBoard);

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
    const selected = selectLetter(Number(letter.dataset.index));
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
    wheelLetters = shuffleLetters(wheelLetters);
    selection = [];
    feedback = { tone: 'shuffle', label: 'Fresh letters' };
    message = 'Wheel shuffled.';
    pulse('light');
    render();
  }
  if (action === 'hint') {
    completion = null;
    const result = useHint(state);
    state = result.state;
    message = result.message;
    feedback = createFeedback(result);
    pulse(result.status);
    saveState(state);
    render();
  }
  if (action === 'reset') {
    state = resetState();
    wheelLetters = getLevel(state).letters;
    selection = [];
    completion = null;
    feedback = { tone: 'reset', label: 'Fresh start' };
    message = 'Progress reset.';
    pulse('light');
    render();
  }
  if (action === 'continue') {
    completion = null;
    feedback = null;
    pulse('light');
    render();
  }
}

function handleSubmit() {
  const word = selection.map((item) => item.letter).join('');
  const previousLevel = state.levelIndex;
  const beforeSnapshot = createSnapshot(state);
  const result = submitWord(word, state);
  state = result.state;
  message = result.message;
  selection = [];
  feedback = createFeedback(result, word);

  if (state.levelIndex !== previousLevel) {
    wheelLetters = getLevel(state).letters;
  }

  if (result.status === 'level-complete') {
    completion = createCompletionDetails(beforeSnapshot, createSnapshot(state), result.message);
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
    return { tone: 'bonus', label: `${word} +2 bonus` };
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
  if (!navigator.vibrate) {
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
  if (state.mode === 'daily') {
    return {
      context: beforeSnapshot.level.title,
      title: 'Daily complete',
      message: resultMessage,
      cleared: 'Daily',
      reward: getRewardFromMessage(resultMessage),
      next: 'Tomorrow'
    };
  }

  return {
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
