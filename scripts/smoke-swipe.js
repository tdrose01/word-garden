import { spawn } from 'node:child_process';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { levels } from '../src/levels.js';
import { resolveSmokeTarget } from './smoke-target.js';

const ROOT = new URL('..', import.meta.url);
const smokeTarget = resolveSmokeTarget();
const port = smokeTarget.external ? null : await chooseSmokePort();
const url = smokeTarget.url || `http://127.0.0.1:${port}`;
const XVNC_DISPLAY = process.env.DISPLAY || (existsSync('/tmp/.X11-unix/X1') ? ':1' : '');
const USE_XVNC = process.env.WORD_GARDEN_SMOKE_DISPLAY === 'xvnc' || (!process.env.WORD_GARDEN_SMOKE_DISPLAY && XVNC_DISPLAY);
const levelOneTargets = ['PLANT', 'PLAN', 'PANT', 'ANT', 'TAP'];
const levelTwoTargets = ['STONE', 'TONE', 'ONES', 'NOTES', 'TOE'];
const levelFiveTargets = ['FOREST', 'FROST', 'STORE', 'ROSE', 'TOE'];
const sequentialPuzzleOrder = levels.map((_, index) => index);
const server = smokeTarget.external
  ? null
  : spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port)], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32'
    });
const serverOutput = { stdout: '', stderr: '' };
let serverError = null;
const runtimeFailures = [];
if (server) {
  server.on('error', (error) => {
    serverError = error;
  });
  server.stdout.on('data', (chunk) => {
    serverOutput.stdout += chunk.toString();
    if (process.env.WORD_GARDEN_SMOKE_DEBUG) process.stdout.write(chunk);
  });
  server.stderr.on('data', (chunk) => {
    serverOutput.stderr += chunk.toString();
    if (process.env.WORD_GARDEN_SMOKE_DEBUG) process.stderr.write(chunk);
  });
}

async function chooseSmokePort() {
  const requestedPort = Number(process.env.WORD_GARDEN_SMOKE_PORT);
  if (Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort < 65536) {
    return requestedPort;
  }

  try {
    return await findFreePort();
  } catch (error) {
    if (error?.code === 'EPERM') return 4211;
    throw error;
  }
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.once('listening', () => {
      const address = probe.address();
      const chosenPort = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(chosenPort));
    });
    probe.listen(0, '127.0.0.1');
  });
}

async function chooseCdpPort() {
  const requestedPort = Number(process.env.WORD_GARDEN_SMOKE_CDP_PORT);
  if (Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort < 65536) {
    return requestedPort;
  }

  try {
    return await findFreePort();
  } catch (error) {
    if (error?.code === 'EPERM') return 4212;
    throw error;
  }
}

async function waitForHttp(targetUrl, label) {
  let lastError = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(targetUrl);
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}: ${lastError?.message || 'no response'}`);
}

async function waitForServer() {
  if (smokeTarget.external) {
    await waitForHttp(url, `external Word Garden URL ${url}`);
    return;
  }

  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (serverError || server.exitCode !== null || server.signalCode !== null) {
      throw new Error(`Vite dev server exited early: ${serverFailureOutput()}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep waiting for Vite to bind the port.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${url}: ${serverFailureOutput()}`);
}

function serverFailureOutput() {
  const status = serverError
    ? `spawn error: ${serverError.message}`
    : `exitCode=${server.exitCode ?? 'running'} signal=${server.signalCode ?? 'none'}`;
  return [status, serverOutput.stderr, serverOutput.stdout]
    .filter(Boolean)
    .join('\n')
    .trim();
}

async function launchBrowser() {
  const debugPort = await chooseCdpPort();
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'word-garden-smoke-'));
  const launchEnv = USE_XVNC ? { ...process.env, DISPLAY: XVNC_DISPLAY } : process.env;
  const args = [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-breakpad',
    '--disable-crashpad',
    '--disable-crash-reporter',
    '--disable-extensions',
    '--disable-sync',
    '--keep-alive-for-test',
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${debugPort}`,
    '--remote-debugging-address=127.0.0.1'
  ];

  if (!USE_XVNC) {
    args.unshift('--headless=new');
    args.push('--no-zygote');
    args.push('--disable-background-networking');
    args.push('--disable-gpu');
    args.push('--ignore-gpu-blocklist');
    args.push('--enable-unsafe-swiftshader');
  }
  args.push('about:blank');

  const browserOutput = { stdout: '', stderr: '' };
  const chromiumPath = process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : chromium.executablePath());
  const child = spawn(chromiumPath, args, {
    cwd: ROOT,
    env: launchEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => {
    browserOutput.stdout += chunk.toString();
    if (process.env.WORD_GARDEN_SMOKE_DEBUG) process.stdout.write(chunk);
  });
  child.stderr.on('data', (chunk) => {
    browserOutput.stderr += chunk.toString();
    if (process.env.WORD_GARDEN_SMOKE_DEBUG) process.stderr.write(chunk);
  });

  try {
    await delay(200);
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Chromium exited early: ${browserFailureOutput(child, browserOutput)}`);
    }
    await waitForHttp(`http://127.0.0.1:${debugPort}/json/version`, 'Chromium DevTools');
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
    return { browser, child, userDataDir, browserOutput };
  } catch (error) {
    await stopProcess(child);
    await rm(userDataDir, { recursive: true, force: true });
    throw new Error(`Failed to launch Chromium via CDP: ${error.message}`);
  }
}

function browserFailureOutput(child, output) {
  const status = `exitCode=${child.exitCode ?? 'running'} signal=${child.signalCode ?? 'none'}`;
  return [status, output.stderr, output.stdout].filter(Boolean).join('\n').trim();
}

async function closeBrowser(handle) {
  if (!handle) return;
  await handle.browser?.close().catch(() => {});
  await stopProcess(handle.child);
  await rm(handle.userDataDir, { recursive: true, force: true }).catch(() => {});
}

async function stopProcess(child, killGroup = false) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        killChild(child, 'SIGKILL', killGroup);
      }
      resolve();
    }, 2_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    killChild(child, 'SIGTERM', killGroup);
  });
}

function killChild(child, signal, killGroup) {
  try {
    if (killGroup && process.platform !== 'win32' && child.pid) {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch {
    // The process may have exited between checks.
  }
}

async function freshPage(browser, contextOptions = {}, stateOverrides = {}) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  observeRuntimeFailures(page);
  await page.goto(url);
  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.evaluate(({ overrides, puzzleOrder }) => {
    window.localStorage.setItem(
      'word-garden-state',
      JSON.stringify({
        mode: 'campaign',
        levelIndex: 0,
        coins: 40,
        solved: [],
        bonusFound: [],
        revealed: [],
        campaign: {
          completedLevels: 0,
          bestRun: 0,
          lastCompletedLevelId: 0,
          puzzleOrder
        },
        ...overrides
      })
    );
  }, { overrides: stateOverrides, puzzleOrder: sequentialPuzzleOrder });
  await page.reload();
  await page.waitForSelector('.letter');
  return { context, page };
}

function observeRuntimeFailures(page) {
  page.on('console', (message) => {
    if (message.type() === 'error') {
      runtimeFailures.push(`console error: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    runtimeFailures.push(`page error: ${error.message}`);
  });
  page.on('requestfailed', (request) => {
    runtimeFailures.push(`network request failed: ${request.method()} ${request.url()} (${request.failure()?.errorText || 'unknown error'})`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      runtimeFailures.push(`network response failed: ${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });
}

function assertNoRuntimeFailures() {
  if (runtimeFailures.length > 0) {
    throw new Error(formatRuntimeFailures());
  }
}

function formatRuntimeFailures() {
  return `Browser runtime failures:\n${runtimeFailures.join('\n')}`;
}

async function letterCenters(page) {
  await page.locator('.wheel').scrollIntoViewIfNeeded();
  return page.$$eval('.letter', (buttons) =>
    buttons.map((button) => {
      const box = button.getBoundingClientRect();
      return {
        text: button.textContent.trim(),
        index: Number(button.dataset.index),
        x: box.left + box.width / 2,
        y: box.top + box.height / 2
      };
    })
  );
}

function spellPath(letters, word) {
  return Array.from(word).map((char) => {
    const point = letters.find((letter) => letter.text === char);
    if (!point) {
      throw new Error(`Missing letter ${char}`);
    }
    return point;
  });
}

async function expectProgress(page, expected) {
  const progress = await page.locator('.level-card strong').textContent();
  if (progress !== expected) {
    throw new Error(`Expected progress ${expected}, got ${progress}`);
  }
}

async function expectCoins(page, expected) {
  const coins = await page.locator('.coin-pill').textContent();
  if (coins !== String(expected)) {
    throw new Error(`Expected ${expected} coins, got ${coins}`);
  }
}

async function expectLedgerMessage(page, expected) {
  const message = await page.locator('.ledger p').textContent();
  if (message !== expected) {
    throw new Error(`Expected ledger message "${expected}", got "${message}"`);
  }
}

async function expectLevelCompleteOverlay(page, expectedTitle, expectedMessage) {
  await page.waitForSelector('.level-complete');

  const title = await page.locator('#level-complete-title').textContent();
  if (title !== expectedTitle) {
    throw new Error(`Expected completion title "${expectedTitle}", got "${title}"`);
  }

  const message = await page.locator('.level-complete__panel > p').first().textContent();
  if (message !== expectedMessage) {
    throw new Error(`Expected completion message "${expectedMessage}", got "${message}"`);
  }
}

async function expectThemeUnlock(page, expected) {
  const note = await page.locator('.level-complete__theme').textContent();
  if (note !== expected) {
    throw new Error(`Expected theme unlock "${expected}", got "${note}"`);
  }
}

async function expectCurrentWord(page, expected) {
  const currentWord = await page.locator('.current-word').textContent();
  if (currentWord !== expected) {
    throw new Error(`Expected current word ${expected}, got ${currentWord}`);
  }
}

async function expectBoardContainsWord(page, word) {
  const letters = await page.$$eval('.tile', (tiles) => tiles.map((tile) => tile.textContent.trim()).join(''));
  if (!letters.includes(word)) {
    throw new Error(`Expected board to show ${word}, got ${letters}`);
  }
}

async function expectLevelTwo(page) {
  await page.waitForFunction(() => document.querySelector('.eyebrow')?.textContent?.trim() === 'Level 2');

  const levelTitle = await page.locator('.level-card p').textContent();
  if (levelTitle !== 'Brook') {
    throw new Error(`Expected level card to show Brook, got ${levelTitle}`);
  }

  const campaignLevel = await page.locator('.campaign-strip__meta strong').textContent();
  if (campaignLevel !== `Level 2/${levels.length}`) {
    throw new Error(`Expected campaign topbar to show Level 2/${levels.length}, got ${campaignLevel}`);
  }

  await expectProgress(page, '0/5');
}

async function expectLevelThree(page) {
  await page.waitForFunction(() => document.querySelector('.eyebrow')?.textContent?.trim() === 'Level 3');

  const levelTitle = await page.locator('.level-card p').textContent();
  if (levelTitle !== 'Orchard') {
    throw new Error(`Expected level card to show Orchard, got ${levelTitle}`);
  }

  const campaignLevel = await page.locator('.campaign-strip__meta strong').textContent();
  if (campaignLevel !== `Level 3/${levels.length}`) {
    throw new Error(`Expected campaign topbar to show Level 3/${levels.length}, got ${campaignLevel}`);
  }

  await expectProgress(page, '0/5');
}

async function dragWithMouse(page, word) {
  const path = spellPath(await letterCenters(page), word);
  await page.mouse.move(path[0].x, path[0].y);
  await page.mouse.down();
  for (const point of path.slice(1)) {
    await page.mouse.move(point.x, point.y, { steps: 8 });
  }
  await page.mouse.up();
}

async function dragWithTouchPointer(page, word) {
  const path = spellPath(await letterCenters(page), word);
  await page.locator(`.letter[data-index="${path[0].index}"]`).dispatchEvent('pointerdown', {
    pointerId: 7,
    pointerType: 'touch',
    clientX: path[0].x,
    clientY: path[0].y,
    bubbles: true,
    cancelable: true
  });

  for (const point of path.slice(1)) {
    await page.evaluate(
      ({ x, y }) => {
        window.dispatchEvent(
          new PointerEvent('pointermove', {
            pointerId: 7,
            pointerType: 'touch',
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true
          })
        );
      },
      { x: point.x, y: point.y }
    );
  }

  await page.evaluate(() => {
    window.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerId: 7,
        pointerType: 'touch',
        bubbles: true,
        cancelable: true
      })
    );
  });
}

async function expectSwipeGuideVisible(page) {
  await page.waitForFunction(() => {
    const path = document.querySelector('.swipe-guide__path.is-visible');
    return path?.getAttribute('points')?.trim().split(/\s+/).length >= 2;
  });
}

async function verifySwipeGuide(page) {
  const path = spellPath(await letterCenters(page), 'PL');
  await page.mouse.move(path[0].x, path[0].y);
  await page.mouse.down();
  await page.mouse.move(path[1].x, path[1].y, { steps: 8 });
  await expectCurrentWord(page, 'PL');
  await expectSwipeGuideVisible(page);
  await page.mouse.up();
  await page.locator('[data-action="clear"]').click();
}

async function tapWithMouse(page, word) {
  const path = spellPath(await letterCenters(page), word);
  for (const point of path) {
    await page.mouse.click(point.x, point.y);
  }
}

async function submitByTap(page, word) {
  await tapWithMouse(page, word);
  await expectCurrentWord(page, word);
  await page.locator('[data-action="submit"]').click();
}

async function wheelLetters(page) {
  return page.$$eval('.letter', (letters) => letters.map((letter) => letter.textContent.trim()));
}

function sortedLetters(letters) {
  return [...letters].sort().join('');
}

async function expectNoActiveLetters(page) {
  const activeCount = await page.locator('.letter.is-active').count();
  if (activeCount !== 0) {
    throw new Error(`Expected no selected letters, got ${activeCount}`);
  }
}

async function expectCampaignProgressDisplay(page, expected, expectedEyebrow = 'Level 1') {
  await page.waitForSelector('.campaign-strip');

  const eyebrow = await page.locator('.eyebrow').textContent();
  if (expectedEyebrow && eyebrow !== expectedEyebrow) {
    throw new Error(`Expected campaign eyebrow ${expectedEyebrow}, got ${eyebrow}`);
  }

  const campaignLevel = await page.locator('.campaign-strip__meta strong').textContent();
  if (expectedEyebrow && campaignLevel !== `${expectedEyebrow}/${levels.length}`) {
    throw new Error(`Expected campaign topbar Level 1/${levels.length}, got ${campaignLevel}`);
  }

  await expectProgress(page, expected);
}

async function expectCampaignJourney(page, expectedCleared) {
  const cleared = await page.locator('.campaign-journey div').first().locator('strong').textContent();
  if (cleared !== String(expectedCleared)) {
    throw new Error(`Expected journey cleared ${expectedCleared}, got ${cleared}`);
  }
}

async function expectViewportFit(page, label) {
  const result = await page.evaluate(() => {
    const sections = ['.topbar', '.mode-tabs', '.campaign-strip, .daily-strip', '.board-wrap', '.composer', '.tools', '.ledger'];
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const overflowing = [];

    for (const selector of sections) {
      const element = document.querySelector(selector);
      if (!element) {
        overflowing.push(`${selector}:missing`);
        continue;
      }

      const box = element.getBoundingClientRect();
      if (box.top < -1 || box.left < -1 || box.right > viewportWidth + 1 || box.bottom > viewportHeight + 1) {
        overflowing.push(
          `${selector}:${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.right)},${Math.round(box.bottom)}`
        );
      }
    }

    return {
      viewportWidth,
      viewportHeight,
      bodyScrollWidth: document.documentElement.scrollWidth,
      bodyScrollHeight: document.documentElement.scrollHeight,
      overflowing
    };
  });

  if (result.bodyScrollWidth > result.viewportWidth + 1 || result.bodyScrollHeight > result.viewportHeight + 1) {
    throw new Error(
      `${label} scrolls: viewport ${result.viewportWidth}x${result.viewportHeight}, scroll ${result.bodyScrollWidth}x${result.bodyScrollHeight}`
    );
  }

  if (result.overflowing.length > 0) {
    throw new Error(`${label} has clipped sections: ${result.overflowing.join('; ')}`);
  }
}

async function expectBoardFullyVisible(page, label) {
  const result = await page.evaluate(() => {
    const wrap = document.querySelector('.board-wrap');
    const board = document.querySelector('.board');
    const tiles = [...document.querySelectorAll('.tile')];

    if (!wrap || !board || tiles.length === 0) {
      return { missing: true };
    }

    const wrapBox = wrap.getBoundingClientRect();
    const boardBox = board.getBoundingClientRect();
    const clippedTiles = tiles
      .map((tile, index) => ({ index, box: tile.getBoundingClientRect() }))
      .filter(
        ({ box }) =>
          box.left < wrapBox.left - 1 ||
          box.top < wrapBox.top - 1 ||
          box.right > wrapBox.right + 1 ||
          box.bottom > wrapBox.bottom + 1
      )
      .map(({ index, box }) => `${index}:${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.right)},${Math.round(box.bottom)}`);

    return {
      missing: false,
      tileCount: tiles.length,
      tileSize: Math.round(tiles[0].getBoundingClientRect().width),
      fitTileSize: board.style.getPropertyValue('--fit-tile-size'),
      wrap: `${Math.round(wrapBox.width)}x${Math.round(wrapBox.height)}`,
      board: `${Math.round(boardBox.width)}x${Math.round(boardBox.height)}`,
      clippedTiles
    };
  });

  if (result.missing) {
    throw new Error(`${label} board is missing`);
  }

  if (result.clippedTiles.length > 0) {
    throw new Error(
      `${label} clips puzzle tiles: tile ${result.tileSize}px, wrap ${result.wrap}, board ${result.board}, clipped ${result.clippedTiles.join('; ')}`
    );
  }

  if (!Number.isFinite(result.tileSize) || result.tileSize <= 0 || result.fitTileSize.includes('NaN')) {
    throw new Error(`${label} has invalid fitted tile size: ${result.fitTileSize || result.tileSize}`);
  }
}

async function expectDailyProgressDisplay(page) {
  await page.waitForSelector('.daily-strip');

  const eyebrow = await page.locator('.eyebrow').textContent();
  if (eyebrow !== 'Daily') {
    throw new Error(`Expected Daily eyebrow, got ${eyebrow}`);
  }

  const progress = await page.locator('.level-card strong').textContent();
  if (!/^\d+\/\d+$/.test(progress)) {
    throw new Error(`Expected daily progress fraction, got ${progress}`);
  }
}

async function verifyVisibleControls(page) {
  await expectCoins(page, 40);

  await tapWithMouse(page, 'PLA');
  await page.locator('[data-action="clear"]').click();
  await expectCurrentWord(page, 'TAP OR SWIPE LETTERS');
  await expectNoActiveLetters(page);

  await tapWithMouse(page, 'PLA');
  await page.locator('[data-action="backspace"]').click();
  await expectCurrentWord(page, 'PL');

  const beforeShuffle = await wheelLetters(page);
  await page.locator('[data-action="shuffle"]').click();
  const afterShuffle = await wheelLetters(page);
  if (sortedLetters(afterShuffle) !== sortedLetters(beforeShuffle)) {
    throw new Error(`Expected shuffle to preserve wheel letters ${beforeShuffle.join('')}, got ${afterShuffle.join('')}`);
  }
  await expectCurrentWord(page, 'TAP OR SWIPE LETTERS');
  await expectNoActiveLetters(page);

  const revealedBefore = await page.locator('.tile.is-revealed').count();
  await page.locator('[data-action="hint"]').click();
  await expectCoins(page, 25);
  const revealedAfter = await page.locator('.tile.is-revealed').count();
  if (revealedAfter <= revealedBefore) {
    throw new Error(`Expected hint to reveal a tile, count stayed at ${revealedAfter}`);
  }

  await dragWithMouse(page, 'PLANT');
  await expectProgress(page, '1/5');
  await expectCampaignJourney(page, 0);
  await page.locator('[data-mode="daily"]').click();
  await expectDailyProgressDisplay(page);
  await page.locator('[data-mode="campaign"]').click();
  await expectCampaignProgressDisplay(page, '1/5');

  await page.locator('[data-action="reset"]').click();
  await expectCampaignProgressDisplay(page, '0/5', null);
  await expectCoins(page, 40);
}

try {
  await waitForServer();
  const browserHandle = await launchBrowser();
  const { browser } = browserHandle;

  try {
    const desktop = await freshPage(browser, { viewport: { width: 900, height: 900 } });
    await expectViewportFit(desktop.page, 'desktop campaign');
    await dragWithMouse(desktop.page, 'PLANT');
    await expectViewportFit(desktop.page, 'desktop campaign after word');
    await expectProgress(desktop.page, '1/5');
    await expectBoardContainsWord(desktop.page, 'PLANT');
    await desktop.context.close();

    const guide = await freshPage(browser, { viewport: { width: 900, height: 900 } });
    await verifySwipeGuide(guide.page);
    await guide.context.close();

    const mobile = await freshPage(browser, {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true
    });
    await expectViewportFit(mobile.page, 'mobile campaign');
    await dragWithTouchPointer(mobile.page, 'ANT');
    await expectViewportFit(mobile.page, 'mobile campaign after word');
    await expectProgress(mobile.page, '1/5');
    await mobile.context.close();

    const smallMobile = await freshPage(browser, {
      viewport: { width: 375, height: 667 },
      isMobile: true,
      hasTouch: true
    });
    await expectViewportFit(smallMobile.page, 'small mobile campaign');
    await expectBoardFullyVisible(smallMobile.page, 'small mobile campaign');
    await smallMobile.page.locator('[data-mode="daily"]').click();
    await expectViewportFit(smallMobile.page, 'small mobile daily');
    await expectBoardFullyVisible(smallMobile.page, 'small mobile daily');
    await smallMobile.context.close();

    const compactMobile = await freshPage(browser, {
      viewport: { width: 360, height: 640 },
      isMobile: true,
      hasTouch: true
    });
    await expectViewportFit(compactMobile.page, 'compact mobile campaign');
    await expectBoardFullyVisible(compactMobile.page, 'compact mobile campaign');
    await compactMobile.context.close();

    const largeRandomStart = await freshPage(
      browser,
      {
        viewport: { width: 375, height: 667 },
        isMobile: true,
        hasTouch: true
      },
      {
        levelIndex: 30,
        campaign: {
          completedLevels: 30,
          bestRun: 30,
          lastCompletedLevelId: 30,
          puzzleOrder: sequentialPuzzleOrder
        }
      }
    );
    await expectViewportFit(largeRandomStart.page, 'small mobile 8x8 campaign');
    await expectBoardFullyVisible(largeRandomStart.page, 'small mobile 8x8 campaign');
    await largeRandomStart.context.close();

    const tap = await freshPage(browser, { viewport: { width: 390, height: 844 }, isMobile: true });
    await tapWithMouse(tap.page, 'TAP');
    await expectProgress(tap.page, '0/5');
    const currentWord = await tap.page.locator('.current-word').textContent();
    if (currentWord !== 'TAP') {
      throw new Error(`Expected tapped current word TAP before submit, got ${currentWord}`);
    }
    await tap.page.locator('[data-action="submit"]').click();
    await expectProgress(tap.page, '1/5');
    await tap.context.close();

    const controls = await freshPage(browser, { viewport: { width: 900, height: 900 } });
    await verifyVisibleControls(controls.page);
    await controls.context.close();

    const completion = await freshPage(browser, { viewport: { width: 900, height: 900 } });
    for (let index = 0; index < levelOneTargets.length; index += 1) {
      await dragWithMouse(completion.page, levelOneTargets[index]);
      if (index < levelOneTargets.length - 1) {
        await expectProgress(completion.page, `${index + 1}/5`);
      }
    }
    await expectLevelTwo(completion.page);
    await expectLedgerMessage(completion.page, 'Level 1 complete! +10 coins. Next: Level 2.');
    await expectLevelCompleteOverlay(completion.page, 'Level 1 complete', 'Level 1 complete! +10 coins. Next: Level 2.');
    await expectCampaignJourney(completion.page, 1);
    await completion.page.locator('.level-complete [data-action="continue"]').click();
    for (let index = 0; index < levelTwoTargets.length; index += 1) {
      await submitByTap(completion.page, levelTwoTargets[index]);
      if (index < levelTwoTargets.length - 1) {
        await expectProgress(completion.page, `${index + 1}/5`);
      }
    }
    await expectLevelThree(completion.page);
    await completion.context.close();

    const themeUnlock = await freshPage(
      browser,
      { viewport: { width: 900, height: 900 } },
      {
        levelIndex: 4,
        campaign: {
          completedLevels: 4,
          bestRun: 4,
          lastCompletedLevelId: 4,
          puzzleOrder: sequentialPuzzleOrder
        }
      }
    );
    for (let index = 0; index < levelFiveTargets.length; index += 1) {
      await submitByTap(themeUnlock.page, levelFiveTargets[index]);
    }
    await expectLevelCompleteOverlay(themeUnlock.page, 'Level 5 complete', 'Level 5 complete! Milestone bonus: +35 coins. Next: Level 6.');
    await expectThemeUnlock(themeUnlock.page, 'Seedling Path complete. Moss Trail unlocked.');
    await themeUnlock.context.close();

    const mobileCompletion = await freshPage(browser, {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true
    });
    for (let index = 0; index < levelOneTargets.length; index += 1) {
      await dragWithTouchPointer(mobileCompletion.page, levelOneTargets[index]);
      if (index < levelOneTargets.length - 1) {
        await expectProgress(mobileCompletion.page, `${index + 1}/5`);
      }
    }
    await expectLevelTwo(mobileCompletion.page);
    await expectLedgerMessage(mobileCompletion.page, 'Level 1 complete! +10 coins. Next: Level 2.');
    await expectLevelCompleteOverlay(mobileCompletion.page, 'Level 1 complete', 'Level 1 complete! +10 coins. Next: Level 2.');
    await expectCampaignJourney(mobileCompletion.page, 1);
    await mobileCompletion.context.close();

    assertNoRuntimeFailures();
  } catch (error) {
    if (runtimeFailures.length > 0 && !error.message.startsWith('Browser runtime failures:')) {
      throw new Error(`${error.message}\n${formatRuntimeFailures()}`, { cause: error });
    }
    throw error;
  } finally {
    await closeBrowser(browserHandle);
  }

  console.log(
    `PASS: smoke gestures, visible controls, desktop level 2 progression, mobile level 1 completion, and runtime diagnostics on ${url}.`
  );
} finally {
  if (server) await stopProcess(server, true);
}
