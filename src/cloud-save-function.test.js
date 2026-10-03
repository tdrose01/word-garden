import test from 'node:test';
import assert from 'node:assert/strict';
import { loadState } from './game.js';
import { createWriteIntent } from './cloud-save.js';
import { __test } from '../functions/api/cloud-save.js';

const state = () => loadState({ getItem: () => null });
const request = origin => new Request('https://word-garden-6fl.pages.dev/api/cloud-save', {
  headers: origin ? { origin } : {}
});

test('cloud Function accepts only owned production, preview, native and configured origins', () => {
  assert.equal(__test.getAllowedOrigin(request('https://word-garden-6fl.pages.dev'), {}), 'https://word-garden-6fl.pages.dev');
  assert.equal(__test.getAllowedOrigin(request('https://abc123.word-garden-6fl.pages.dev'), {}), 'https://abc123.word-garden-6fl.pages.dev');
  assert.equal(__test.getAllowedOrigin(request('capacitor://localhost'), {}), 'capacitor://localhost');
  assert.equal(__test.getAllowedOrigin(request('https://attacker.example'), {}), false);
  assert.equal(__test.getAllowedOrigin(request('https://staging.example'), { ALLOWED_CLOUD_SAVE_ORIGINS: 'https://staging.example' }), 'https://staging.example');
});

test('cloud Function revalidates the complete backup and canonicalizes it', () => {
  const intent = createWriteIntent({
    state: state(), baseRevision: 0, requestId: 'request_12345678', deviceId: 'device-1',
    savedAt: '2026-10-02T12:00:00.000Z'
  });
  const validated = __test.validateWrite(intent);
  assert.equal(JSON.parse(validated.backupJson).format, 'word-garden-backup');

  intent.backup.state.coins = -1;
  assert.throws(() => __test.validateWrite(intent), /Invalid/);
});

test('cloud Function rejects client account keys and malformed retry metadata', () => {
  const intent = createWriteIntent({
    state: state(), baseRevision: 0, requestId: 'request_12345678', deviceId: 'device-1',
    savedAt: '2026-10-02T12:00:00.000Z'
  });
  assert.throws(() => __test.validateWrite({ ...intent, accountId: 'client-controlled' }), /Invalid/);
  assert.throws(() => __test.validateWrite({ ...intent, requestId: 'short' }), /Invalid/);
});

test('idempotency hashes match retries but reject changed payloads', async () => {
  const intent = __test.validateWrite(createWriteIntent({
    state: state(), baseRevision: 0, requestId: 'request_12345678', deviceId: 'device-1',
    savedAt: '2026-10-02T12:00:00.000Z'
  }));
  assert.equal(await __test.hashWrite(intent), await __test.hashWrite(structuredClone(intent)));
  const changed = structuredClone(intent);
  changed.deviceId = 'device-2';
  assert.notEqual(await __test.hashWrite(intent), await __test.hashWrite(changed));
});

test('database rows return a versioned client snapshot without account identity', () => {
  const backup = JSON.stringify({ format: 'word-garden-backup', version: 1, state: state() });
  const snapshot = __test.cloudSnapshotFromRow({
    revision: 3, save_json: backup, saved_at: '2026-10-02T12:00:00.000Z', device_id: 'device-1'
  });
  assert.equal(snapshot.revision, 3);
  assert.equal(snapshot.accountId, undefined);
  assert.equal(snapshot.backup.format, 'word-garden-backup');
});


test('cloud Function stops oversized streamed bodies before reading their remainder', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024 + 16 * 1024 + 1));
    },
    cancel() { cancelled = true; }
  });
  const request = new Request('https://word-garden-6fl.pages.dev/api/cloud-save', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body, duplex: 'half'
  });
  assert.equal((await __test.readJson(request)).status, 413);
  assert.equal(cancelled, true);
});

test('cloud Function parses a bounded valid streamed write', async () => {
  const intent = createWriteIntent({ state: state(), baseRevision: 0, requestId: 'request_12345678',
    deviceId: 'device-1', savedAt: '2026-10-03T00:00:00Z' });
  const request = new Request('https://word-garden-6fl.pages.dev/api/cloud-save', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(intent)
  });
  assert.equal((await __test.readJson(request)).value.requestId, intent.requestId);
});
