import test from 'node:test';
import assert from 'node:assert/strict';
import { loadState } from './game.js';
import { createCloudSnapshot } from './cloud-save.js';
import { createCloudSaveFlow, renderCloudSavePanel } from './cloud-save-flow.js';

const fresh = () => loadState({ getItem: () => null });
const now = '2026-10-02T12:00:00.000Z';
const snapshot = (state, revision = 1) => createCloudSnapshot({ state, revision, savedAt: now, deviceId: 'other-device' });

function harness({ local = fresh(), cloud = null, meaningful = false, delayedGet = null } = {}) {
  let localState = structuredClone(local);
  const writes = [];
  const recoveries = [];
  let signOuts = 0;
  const flow = createCloudSaveFlow({
    auth: { signIn: async () => ({ subject: 'user_1' }), signOut: async () => { signOuts++; } },
    api: {
      get: delayedGet || (async () => cloud),
      put: async write => { writes.push(write); return { revision: write.baseRevision + 1 }; }
    },
    readLocal: () => structuredClone(localState),
    writeLocal: state => { localState = structuredClone(state); },
    localIsMeaningful: () => meaningful,
    preserveBackup: (backup, label) => recoveries.push({ backup, label }),
    createRequestId: () => 'request_12345678',
    deviceId: 'this-device',
    now: () => now
  });
  return { flow, writes, recoveries, getLocal: () => localState, getSignOuts: () => signOuts };
}

test('first sign-in previews a local-only save without uploading it', async () => {
  const local = fresh(); local.coins = 42; local.bonusFound = ['PAN'];
  const { flow, writes } = harness({ local, meaningful: true });
  const result = await flow.signIn();
  assert.equal(result.phase, 'confirm-upload');
  assert.equal(writes.length, 0);
});

test('fresh-device restore preserves local recovery before replacement', async () => {
  const remote = fresh(); remote.coins = 42; remote.bonusFound = ['PAN'];
  const { flow, recoveries, getLocal } = harness({ cloud: snapshot(remote, 4) });
  assert.equal((await flow.signIn()).phase, 'confirm-restore');
  assert.equal((await flow.choose('use-cloud')).phase, 'up-to-date');
  assert.equal(getLocal().coins, 42);
  assert.equal(recoveries[0].label, 'before-cloud-restore');
});

test('conflict requires a choice and conditional local upload preserves cloud', async () => {
  const local = fresh(); local.coins = 42; local.bonusFound = ['PAN'];
  const remote = fresh();
  const { flow, writes, recoveries } = harness({ local, cloud: snapshot(remote, 8), meaningful: true });
  assert.equal((await flow.signIn()).phase, 'conflict');
  assert.equal(writes.length, 0);
  assert.equal((await flow.choose('keep-local')).phase, 'backed-up');
  assert.equal(writes[0].baseRevision, 8);
  assert.equal(recoveries[0].label, 'before-cloud-replacement');
});

test('cancel and sign-out never alter or upload local progress', async () => {
  const local = fresh(); local.coins = 42; local.bonusFound = ['PAN'];
  const { flow, writes, getLocal, getSignOuts } = harness({ local, cloud: snapshot(fresh()), meaningful: true });
  await flow.signIn();
  assert.equal((await flow.choose('cancel')).phase, 'paused');
  assert.equal((await flow.signOut()).phase, 'signed-out');
  assert.equal(getLocal().coins, 42);
  assert.equal(writes.length, 0);
  assert.equal(getSignOuts(), 1);
});

test('late account response is ignored after sign-out', async () => {
  let finish;
  const delayed = new Promise(resolve => { finish = resolve; });
  const { flow } = harness({ delayedGet: () => delayed });
  const signingIn = flow.signIn();
  await Promise.resolve();
  await flow.signOut();
  finish(null);
  await signingIn;
  assert.equal(flow.getView().phase, 'signed-out');
});

test('panel renders explicit accessible choices without automatic-merge language', () => {
  const html = renderCloudSavePanel({
    phase: 'conflict', message: 'Choose before changes.',
    local: { campaignCompleted: 2, coins: 42, gardenPlants: 1 },
    cloud: { campaignCompleted: 1, coins: 40, gardenPlants: 0 }
  });
  assert.match(html, /role="status"/);
  assert.match(html, /Use this device/);
  assert.match(html, /Use online backup/);
  assert.match(html, /Cancel/);
  assert.doesNotMatch(html, /merge/i);
});
