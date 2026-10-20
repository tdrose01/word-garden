import test from 'node:test';
import assert from 'node:assert/strict';
import { loadState } from './game.js';
import { createCloudSnapshot } from './cloud-save.js';
import { createCloudSaveFlow, renderCloudSavePanel } from './cloud-save-flow.js';

const fresh = () => loadState({ getItem: () => null });
const now = '2026-10-02T12:00:00.000Z';
const snapshot = (state, revision = 1) => createCloudSnapshot({ state, revision, savedAt: now, deviceId: 'other-device' });

function harness({ local = fresh(), cloud = null, meaningful = false, delayedGet = null, put = null } = {}) {
  let localState = structuredClone(local);
  const writes = [];
  const recoveries = [];
  let signOuts = 0;
  const flow = createCloudSaveFlow({
    auth: { signIn: async () => ({ subject: 'user_1', identity: 'player@example.test' }), signOut: async () => { signOuts++; } },
    api: {
      get: delayedGet || (async () => cloud),
      put: async write => { writes.push(write); if (put) return put(write); cloud = createCloudSnapshot({ state: write.backup.state, revision: write.baseRevision + 1, savedAt: now, deviceId: 'this-device' }); return { revision: write.baseRevision + 1 }; }
    },
    readLocal: () => structuredClone(localState),
    writeLocal: state => { localState = structuredClone(state); },
    localIsMeaningful: () => meaningful,
    preserveBackup: (backup, label) => recoveries.push({ backup, label }),
    createRequestId: () => `request_${writes.length}_12345678`,
    deviceId: 'this-device',
    now: () => now
  });
  return { flow, writes, recoveries, getLocal: () => localState, setLocal: state => { localState = structuredClone(state); }, setCloud: state => { cloud = state; }, getSignOuts: () => signOuts };
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
  assert.equal(flow.getView().identity, null);
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
    phase: 'conflict', subject: 'user_1', identity: 'player+garden@example.test', message: 'Choose before changes.',
    local: { campaignCompleted: 2, coins: 42, gardenPlants: 1 },
    cloud: { campaignCompleted: 1, coins: 40, gardenPlants: 0 }
  });
  assert.match(html, /role="status"/);
  assert.match(html, /Use this device/);
  assert.match(html, /Use online backup/);
  assert.match(html, /Cancel/);
  assert.match(html, /Signed in as player\+garden@example\.test/);
  assert.match(html, /data-cloud-identity role="status"/);
  assert.doesNotMatch(html, /merge/i);
});

test('signed-in backup errors preserve provider identity without claiming backup success', async () => {
  const { flow } = harness({ delayedGet: async () => { throw new Error('Online backup check failed.'); } });
  const result = await flow.signIn();
  assert.equal(result.phase, 'error');
  assert.equal(result.subject, 'user_1');
  assert.equal(result.identity, 'player@example.test');
  const html = renderCloudSavePanel(result);
  assert.match(html, /Signed in as player@example\.test/);
  assert.match(html, /Online backup check failed/);
  assert.match(html, /Sign out/);
  assert.doesNotMatch(html, /Backed up online/);
});

test('signed-in state remains explicit when the provider email is unavailable', () => {
  const html = renderCloudSavePanel({ phase: 'error', subject: 'user_1', identity: null, message: 'Backup check failed.' });
  assert.match(html, /Signed in\. Account email is unavailable\./);
  assert.doesNotMatch(html, /user_1/);
});

test('same-account provider updates refresh identity without changing backup state', async () => {
  const { flow } = harness();
  await flow.signIn();
  const before = flow.getView();
  flow.updateIdentity('user_1', 'updated@example.test');
  assert.equal(flow.getView().identity, 'updated@example.test');
  assert.equal(flow.getView().phase, before.phase);
  flow.updateIdentity('another_user', 'wrong@example.test');
  assert.equal(flow.getView().identity, 'updated@example.test');
});


test('autosync requires explicit consent and imports pause it', async () => {
  const { flow, writes, getLocal, setLocal } = harness();
  await flow.signIn();
  const changed = getLocal(); changed.coins = 42; setLocal(changed);
  await flow.localChanged(); assert.equal(writes.length, 0);
  await flow.choose('keep-local'); assert.equal(writes.length, 1);
  changed.coins = 43; setLocal(changed); await flow.localChanged();
  assert.equal(writes.length, 2); assert.equal(writes[1].baseRevision, 1);
  flow.pauseForImport(); changed.coins = 44; setLocal(changed);
  await flow.localChanged(); assert.equal(writes.length, 2);
  assert.equal(flow.getView().phase, 'paused');
});

test('same initial saves require explicit opt-in for subsequent changes', async () => {
  const local = fresh();
  const { flow, writes, setLocal } = harness({ local, cloud: snapshot(local) });
  await flow.signIn(); assert.equal(flow.getView().autoBackup, false);
  assert.match(renderCloudSavePanel(flow.getView()), /Enable online backup/);
  const changed = structuredClone(local); changed.coins = 42; setLocal(changed);
  await flow.localChanged(); assert.equal(writes.length, 0);
  await flow.choose('keep-local'); assert.equal(writes.length, 1);
});

test('local edits made during an upload are backed up as a subsequent revision', async () => {
  let finish;
  let count = 0;
  const first = new Promise(resolve => { finish = resolve; });
  const { flow, writes, getLocal, setLocal } = harness({ put: async write => {
    if (++count === 1) return first;
    return { revision: write.baseRevision + 1 };
  } });
  await flow.signIn();
  const uploading = flow.choose('keep-local');
  const changed = getLocal(); changed.coins = 42; setLocal(changed);
  await flow.localChanged(); assert.equal(writes.length, 1);
  finish({ revision: 1 }); await uploading;
  assert.equal(writes.length, 2); assert.equal(writes[1].backup.state.coins, 42);
  assert.equal(flow.getView().phase, 'backed-up');
});

test('offline retry retains the exact original request and snapshot', async () => {
  let attempts = 0;
  const { flow, writes, getLocal, setLocal, setCloud } = harness({ put: async write => {
    if (++attempts === 1) throw Object.assign(new Error('Offline'), { code: 'offline' });
    setCloud(snapshot(write.backup.state, write.baseRevision + 1));
    return { revision: write.baseRevision + 1 };
  } });
  await flow.signIn(); await flow.choose('keep-local');
  assert.equal(flow.getView().retryPending, true);
  const changed = getLocal(); changed.coins = 42; setLocal(changed);
  await flow.localChanged(); assert.equal(writes.length, 1);
  await flow.retry(); assert.deepEqual(writes[1], writes[0]);
  assert.equal(writes[2].backup.state.coins, 42);
  assert.notEqual(writes[2].requestId, writes[0].requestId);
});

test('session change immediately invalidates an outstanding write and clears account', async () => {
  let finish;
  const response = new Promise(resolve => { finish = resolve; });
  const { flow, writes } = harness({ put: () => response });
  await flow.signIn(); const uploading = flow.choose('keep-local');
  flow.invalidateSession(); finish({ revision: 1 }); await uploading;
  assert.equal(flow.getView().phase, 'signed-out');
  assert.equal(flow.getView().subject, null);
  assert.equal(flow.getView().identity, null);
  await flow.localChanged(); assert.equal(writes.length, 1);
});

test('import invalidates an outstanding upload acknowledgement and stops autosync', async () => {
  let finish;
  const response = new Promise(resolve => { finish = resolve; });
  const { flow, getLocal, setLocal, writes } = harness({ put: () => response });
  await flow.signIn(); const uploading = flow.choose('keep-local');
  flow.importPause(); const changed = getLocal(); changed.coins = 42; setLocal(changed);
  finish({ revision: 1 }); await uploading; await flow.localChanged();
  assert.equal(flow.getView().phase, 'paused'); assert.equal(writes.length, 1);
  assert.equal(flow.getView().autoBackup, false);
});

test('retry of an acknowledged old revision fetches and surfaces a newer conflict', async () => {
  let attempts = 0;
  const { flow, setCloud } = harness({ put: async () => {
    if (++attempts === 1) throw Object.assign(new Error('Lost response'), { code: 'offline' });
    const remote = fresh(); remote.coins = 43; setCloud(snapshot(remote, 2));
    return { revision: 1 };
  } });
  await flow.signIn(); await flow.choose('keep-local'); await flow.retry();
  assert.equal(flow.getView().phase, 'conflict');
  assert.equal(flow.getView().autoBackup, false);
});
