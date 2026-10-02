import test from 'node:test';
import assert from 'node:assert/strict';
import { loadState } from './game.js';
import { parseBackup } from './persistence.js';
import {
  classifyWriteResponse,
  createCloudSnapshot,
  createWriteIntent,
  parseCloudSnapshot,
  planInitialSync,
  resolveConflict,
  sameSave,
  summarizeSave
} from './cloud-save.js';

const fresh = () => loadState({ getItem: () => null });
const now = '2026-10-02T12:00:00.000Z';

function progressed() {
  const state = fresh();
  state.coins = 42;
  state.bonusFound = ['PAN'];
  return state;
}

test('cloud snapshot round-trips the complete validated save', () => {
  const state = progressed();
  const snapshot = createCloudSnapshot({ state, revision: 7, savedAt: now, deviceId: 'phone' });
  const restored = parseCloudSnapshot(JSON.stringify(snapshot));

  assert.deepEqual(restored.state, state);
  assert.equal(restored.revision, 7);
});

test('cloud snapshot rejects extra metadata and invalid game progress', () => {
  const snapshot = createCloudSnapshot({ state: fresh(), revision: 0, savedAt: now, deviceId: 'phone' });
  assert.throws(() => parseCloudSnapshot({ ...snapshot, accountId: 'untrusted-client-value' }), /Invalid cloud save/);
  snapshot.backup.state.coins = -1;
  assert.throws(() => parseCloudSnapshot(snapshot), /Invalid/);
});

test('first sign-in never overwrites a differing meaningful local save', () => {
  const cloud = createCloudSnapshot({ state: fresh(), revision: 3, savedAt: now, deviceId: 'chromebook' });
  const plan = planInitialSync({ localState: progressed(), localIsMeaningful: true, cloudSnapshot: cloud });

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.local.coins, 42);
  assert.equal(plan.cloud.coins, 40);
});

test('fresh device restore and new-account upload both require confirmation', () => {
  const cloud = createCloudSnapshot({ state: progressed(), revision: 3, savedAt: now, deviceId: 'chromebook' });
  assert.equal(planInitialSync({ localState: fresh(), localIsMeaningful: false, cloudSnapshot: cloud }).status, 'confirm-restore');
  assert.equal(planInitialSync({ localState: progressed(), localIsMeaningful: true, cloudSnapshot: null }).status, 'confirm-upload');
});

test('identical local and cloud saves are safe without a conflict choice', () => {
  const state = progressed();
  const cloud = createCloudSnapshot({ state, revision: 2, savedAt: now, deviceId: 'phone' });
  assert.equal(sameSave(state, parseCloudSnapshot(cloud).state), true);
  assert.deepEqual(planInitialSync({ localState: state, localIsMeaningful: true, cloudSnapshot: cloud }), {
    status: 'up-to-date', revision: 2
  });
});

test('using cloud preserves a recoverable copy of local progress', () => {
  const local = progressed();
  const cloud = createCloudSnapshot({ state: fresh(), revision: 9, savedAt: now, deviceId: 'chromebook' });
  const result = resolveConflict({ choice: 'use-cloud', localState: local, cloudSnapshot: cloud });

  assert.equal(result.status, 'replace-local');
  assert.deepEqual(parseBackup(result.recoveryBackup), local);
  assert.deepEqual(result.state, fresh());
});

test('keeping local is conditional on the observed cloud revision and preserves cloud', () => {
  const local = progressed();
  const cloudState = fresh();
  const cloud = createCloudSnapshot({ state: cloudState, revision: 9, savedAt: now, deviceId: 'chromebook' });
  const result = resolveConflict({
    choice: 'keep-local', localState: local, cloudSnapshot: cloud,
    requestId: 'stable-retry-id', deviceId: 'phone', savedAt: now
  });

  assert.equal(result.status, 'upload-local');
  assert.equal(result.write.baseRevision, 9);
  assert.equal(result.write.requestId, 'stable-retry-id');
  assert.deepEqual(parseBackup(result.recoveryBackup), cloudState);
});

test('cancelling conflict resolution changes neither save', () => {
  const local = progressed();
  const cloudState = fresh();
  const cloud = createCloudSnapshot({ state: cloudState, revision: 1, savedAt: now, deviceId: 'chromebook' });
  const result = resolveConflict({ choice: 'cancel', localState: local, cloudSnapshot: cloud });

  assert.equal(result.status, 'cancelled');
  assert.deepEqual(parseBackup(result.localBackup), local);
  assert.deepEqual(parseBackup(result.cloudBackup), cloudState);
});

test('retry uses the same request id and a stale write becomes an explicit conflict', () => {
  const intent = createWriteIntent({
    state: progressed(), baseRevision: 4, requestId: 'request-123', deviceId: 'phone', savedAt: now
  });
  const retry = createWriteIntent({
    state: progressed(), baseRevision: 4, requestId: 'request-123', deviceId: 'phone', savedAt: now
  });
  assert.deepEqual(retry, intent);

  const latest = createCloudSnapshot({ state: fresh(), revision: 5, savedAt: now, deviceId: 'chromebook' });
  const result = classifyWriteResponse(intent, { status: 409, snapshot: latest });
  assert.equal(result.status, 'conflict');
  assert.equal(result.snapshot.revision, 5);
});

test('write acknowledgement must match the request and transient errors remain pending', () => {
  const intent = createWriteIntent({
    state: progressed(), baseRevision: 4, requestId: 'request-123', deviceId: 'phone', savedAt: now
  });
  assert.deepEqual(classifyWriteResponse(intent, { status: 200, requestId: 'request-123', revision: 5 }), {
    status: 'saved', revision: 5
  });
  assert.equal(classifyWriteResponse(intent, { status: 200, requestId: 'other', revision: 5 }).status, 'failed');
  assert.equal(classifyWriteResponse(intent, { status: 503 }).status, 'retry-later');
});

test('save summaries expose comparison fields without mutating rewards', () => {
  const state = progressed();
  const before = structuredClone(state);
  const summary = summarizeSave(state);
  assert.equal(summary.coins, 42);
  assert.deepEqual(state, before);
});
