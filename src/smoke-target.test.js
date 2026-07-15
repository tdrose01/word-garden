import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSmokeBrowser, resolveSmokeTarget } from '../scripts/smoke-target.js';

test('uses an external smoke URL without requesting a local server', () => {
  assert.deepEqual(resolveSmokeTarget({ WORD_GARDEN_SMOKE_URL: ' https://example.com/game?qa=1 ' }), {
    external: true,
    url: 'https://example.com/game?qa=1'
  });
});

test('keeps local smoke behavior when the external URL is unset', () => {
  assert.deepEqual(resolveSmokeTarget({}), {
    external: false,
    url: null
  });
});

test('rejects non-HTTP external smoke targets', () => {
  assert.throws(
    () => resolveSmokeTarget({ WORD_GARDEN_SMOKE_URL: 'file:///tmp/index.html' }),
    /must use http or https/
  );
});

test('uses Playwright-managed Chromium when the host has no browser binary', () => {
  assert.deepEqual(resolveSmokeBrowser({}, false), {
    mode: 'playwright',
    executablePath: null
  });
});

test('uses Playwright-managed Chromium in CI even when a system binary exists', () => {
  assert.deepEqual(resolveSmokeBrowser({ CI: 'true' }, true), {
    mode: 'playwright',
    executablePath: null
  });
});

test('preserves the system Chromium CDP launch path on the local host', () => {
  assert.deepEqual(resolveSmokeBrowser({}, true), {
    mode: 'cdp',
    executablePath: '/usr/bin/chromium'
  });
});

test('honors an explicitly configured Chromium binary', () => {
  assert.deepEqual(resolveSmokeBrowser({ CHROMIUM_PATH: ' /opt/chromium ' }, false), {
    mode: 'cdp',
    executablePath: '/opt/chromium'
  });
});
