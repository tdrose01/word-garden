import '@fontsource/nunito/latin-500.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-900.css';
import '@fontsource/fraunces/latin-700.css';
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
        <p class="eyebrow"><span class="eyebrow-dot" aria-hidden="true"></span>${levelLabel}</p>
        <h1>Word Garden</h1>
        <p class="tagline">A little word ritual.</p>
      </div>
      <div class="coin-pill ${coinChanged ? 'is-bumped' : ''}" aria-label="${state.coins} coins"><span>${state.coins}</span></div>
    </section>

    <section class="mode-tabs" aria-label="Game mode">
      <button class="${state.mode === 'campaign' ? 'is-active' : ''}" data-mode="campaign" aria-pressed="${state.mode === 'campaign'}">Levels</button>
      <button class="${state.mode === 'daily' ? 'is-active' : ''}" data-mode="daily" aria-pressed="${state.mode === 'daily'}">Daily</button>
    </section>

    ${state.mode === 'daily' ? renderDailyStats(snapshot) : renderCampaignStats(snapshot)}

    <section class="board-wrap" aria-label="${snapshot.level.title} puzzle board">
      <div class="level-card">
        <span class="level-card__leaf" aria-hidden="true">❧</span>
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
    </section>

    <section class="tools">
      <button data-action="shuffle">Shuffle</button>
      <button data-action="hint">Hint 15</button>
      <button data-action="reset">Reset</button>
    </section>

    <section class="ledger">
      <div>
        <span><span class="ledger-leaf" aria-hidden="true">✿</span> Bonus words</span>
        <strong>${progress.bonusFound.length}</strong>
      </div>
      <p role="status" aria-live="polite" aria-atomic="true">${message}</p>
      ${feedback ? `<strong class="feedback-toast feedback-toast--${feedback.tone}">${feedback.label}</strong>` : ''}
    </section>

    ${completion ? renderLevelComplete(completion) : ''}

    ${renderFeedbackPanel(snapshot)}
  `;

  bindEvents();
  bindFeedbackEvents(snapshot);
  updateSwipeGuide();
  fitBoard();
  previousCoins = state.coins;
}

function renderFeedbackPanel(snapshot) {
  const shareSupported = typeof navigator.share === 'function';
  return `
    <section class="tester-feedback" data-feedback-root>
      <button class="tester-feedback__cta" type="button" aria-expanded="false" aria-controls="tester-feedback-panel">
        Feedback
      </button>
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

  const cta = root.querySelector('.tester-feedback__cta');
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
    return `Daily - ${snapshot.level.title}`;
  }
  return `Level ${snapshot.campaignStats.currentLevel}/${snapshot.campaignStats.totalLevels} - ${snapshot.level.title} (${snapshot.campaignStats.pack.title})`;
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
      wheelLetters = getLevel(state).letters;
      selection = [];
      feedback = null;
      message = state.mode === 'daily' ? 'Today has its own little garden.' : 'Back to the level path.';
      pulse('light');
      saveState(state);
      render();
    });
  });

  if (completion) {
    window.setTimeout(() => app.querySelector('.level-complete [data-action="continue"]')?.focus(), 0);
  }
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
    // A hint starts a fresh attempt. Keeping an in-progress swipe here can
    // leave an invalid word (for example, NETOE) stuck in the composer.
    selection = [];
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
