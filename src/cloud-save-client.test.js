import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudSaveApi, CloudSaveApiError } from './cloud-save-client.js';

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
      return jsonResponse(200, { revision: 4 });
    }
  });

  assert.deepEqual(await api.put({ requestId: 'request-123' }), { revision: 4 });
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
  const missing = createCloudSaveApi({
    getToken: async () => 'token', fetchImpl: async () => jsonResponse(404, { error: 'Not found.' })
  });
  assert.equal(await missing.get(), null);

  const snapshot = { revision: 8 };
  const stale = createCloudSaveApi({
    getToken: async () => 'token', fetchImpl: async () => jsonResponse(409, { snapshot })
  });
  await assert.rejects(stale.put({}), error =>
    error instanceof CloudSaveApiError && error.code === 'conflict' && error.snapshot === snapshot);
});

test('server and validation failures never masquerade as successful saves', async () => {
  for (const [status, code] of [[413, 'too-large'], [429, 'rate-limited'], [503, 'unavailable'], [422, 'invalid']]) {
    const api = createCloudSaveApi({
      getToken: async () => 'token', fetchImpl: async () => jsonResponse(status, { error: 'No save.' })
    });
    await assert.rejects(api.put({}), error => error.code === code && error.status === status);
  }
});
