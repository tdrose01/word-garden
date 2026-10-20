import test from 'node:test';
import assert from 'node:assert/strict';
import { loadState } from './game.js';
import { createCloudSnapshot } from './cloud-save.js';
import { createCloudSaveApi, CloudSaveApiError } from './cloud-save-client.js';

const snapshot = revision => createCloudSnapshot({ state: loadState({ getItem: () => null }), revision, savedAt: '2026-10-03T00:00:00Z', deviceId: 'other-device' });

const jsonResponse = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body
});

test('cloud client sends the session token without embedding provider credentials', async () => {
  let request;
  const api = createCloudSaveApi({
    getToken: async () => 'session-token',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse(200, { ok: true, requestId: 'request-123', revision: 4 });
    }
  });

  assert.deepEqual(await api.put({ requestId: 'request-123', baseRevision: 3 }), { ok: true, requestId: 'request-123', revision: 4 });
  assert.equal(request.url, '/api/cloud-save');
  assert.equal(request.options.headers.authorization, 'Bearer session-token');
  assert.equal(request.options.method, 'PUT');
});

test('signed-out and offline requests preserve local-only behavior', async () => {
  const signedOut = createCloudSaveApi({ getToken: async () => null, fetchImpl: async () => assert.fail() });
  await assert.rejects(signedOut.get(), error => error instanceof CloudSaveApiError && error.code === 'signed-out');

  const offline = createCloudSaveApi({ getToken: async () => 'token', fetchImpl: async () => { throw new Error('offline'); } });
  await assert.rejects(offline.get(), error => error instanceof CloudSaveApiError && error.code === 'offline');
});

test('missing saves and stale revisions are distinct outcomes', async () => {
  const current = snapshot(7);
  const found = createCloudSaveApi({
    getToken: async () => 'token', fetchImpl: async () => jsonResponse(200, { snapshot: current })
  });
  assert.equal(await found.get(), current);

  const missing = createCloudSaveApi({
    getToken: async () => 'token', fetchImpl: async () => jsonResponse(404, { error: 'Not found.' })
  });
  assert.equal(await missing.get(), null);

  const latest = snapshot(8);
  const stale = createCloudSaveApi({
    getToken: async () => 'token', fetchImpl: async () => jsonResponse(409, { snapshot: latest })
  });
  await assert.rejects(stale.put({}), error =>
    error instanceof CloudSaveApiError && error.code === 'conflict' && error.snapshot === latest);
});

test('server and validation failures never masquerade as successful saves', async () => {
  for (const [status, code] of [[413, 'too-large'], [429, 'rate-limited'], [503, 'unavailable'], [422, 'invalid']]) {
    const api = createCloudSaveApi({
      getToken: async () => 'token', fetchImpl: async () => jsonResponse(status, { error: 'No save.' })
    });
    await assert.rejects(api.put({}), error => error.code === code && error.status === status);
  }
});


test('malformed successful reads and conflict snapshots never become empty or usable saves', async () => {
  for (const [status, body] of [[200, null], [200, {}], [200, { snapshot: { revision: 2 } }], [409, { snapshot: { revision: 2 } }]]) {
    const api = createCloudSaveApi({ getToken: async () => 'token', fetchImpl: async () => jsonResponse(status, body) });
    await assert.rejects(api.get(), error => error.code === 'invalid');
  }
});

test('successful write must acknowledge this request and exactly its accepted revision', async () => {
  const intent = { requestId: 'request-123', baseRevision: 3 };
  for (const body of [null, {}, { ok: true, requestId: 'other', revision: 4 },
    { ok: true, requestId: 'request-123', revision: 3 }, { ok: true, requestId: 'request-123', revision: 5 }]) {
    const api = createCloudSaveApi({ getToken: async () => 'token', fetchImpl: async () => jsonResponse(200, body) });
    await assert.rejects(api.put(intent), error => error.code === 'invalid');
  }
});
