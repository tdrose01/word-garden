import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSmokeTarget } from '../scripts/smoke-target.js';

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
