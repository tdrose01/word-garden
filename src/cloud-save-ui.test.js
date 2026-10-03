import test from 'node:test';
import assert from 'node:assert/strict';
import { loadState } from './game.js';
import { createCloudSnapshot } from './cloud-save.js';
import { createCloudSaveUI, CLOUD_RECOVERY_KEY } from './cloud-save-ui.js';

function harness({ failRecovery = false } = {}) {
  let state = loadState({ getItem: () => null }, () => 0); state.coins = 51;
  const remote = structuredClone(state); remote.coins = 73;
  const snapshot = createCloudSnapshot({ state: remote, revision: 4, deviceId: 'other', savedAt: new Date().toISOString() });
  const storage = new Map(); const calls = []; const errors = { textContent: '' };
  const ui = createCloudSaveUI({ enabled: true,
    auth: { signIn: async () => { calls.push('sign-in'); return { subject: 'user_test' }; }, signOut: async () => calls.push('sign-out') },
    api: { get: async () => snapshot, put: async write => ({ requestId: write.requestId, revision: write.baseRevision + 1 }) },
    readLocal: () => structuredClone(state), writeLocal: value => { calls.push('restore'); state = value; },
    storage: { getItem: key => storage.get(key) || null, setItem(key, value) { if (failRecovery && key === CLOUD_RECOVERY_KEY) throw new Error('Storage full'); storage.set(key, value); } },
    createId: () => 'request_test_id', onChange() {}
  });
  async function press(dataset) {
    let handler;
    const button = { dataset, addEventListener(name, callback) { handler = callback; } };
    ui.bind({ querySelectorAll: () => [button], ownerDocument: { querySelector: () => errors } });
    await handler();
  }
  return { ui, calls, storage, press, state: () => state, errors };
}
test('disabled or unconfigured UI has no auth or persistence side effects', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Storage denied'); } });
  try {
    assert.equal(createCloudSaveUI({ enabled: false, auth: { signIn() { throw new Error('No guest calls'); } } }), null);
    assert.equal(createCloudSaveUI({ enabled: true }), null);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else delete globalThis.localStorage;
  }
  const { ui, calls, storage } = harness();
  assert.match(ui.render(), /Sign in to back up/);
  assert.deepEqual(calls, []); assert.equal(storage.size, 0);
});
test('restore exposes a durable valid previous-save backup and sign-out preserves local play', async () => {
  const h = harness();
  await h.press({ cloudAction: 'sign-in' });
  assert.equal(h.ui.getView().phase, 'conflict');
  assert.match(h.ui.render(), /Daily .*Replay:/);
  assert.match(h.ui.render(), /Backup device: Another device/);
  assert.match(h.ui.render(), /Clerk handles sign-in.*email inbox you can access.*shared device/);
  assert.equal(h.state().coins, 51);
  await h.press({ cloudChoice: 'use-cloud' });
  assert.equal(h.state().coins, 73);
  assert.equal(JSON.parse(JSON.parse(h.storage.get(CLOUD_RECOVERY_KEY)).backup).state.coins, 51);
  assert.match(h.ui.render(), /Download previous save/);
  await h.press({ cloudAction: 'sign-out' });
  assert.equal(h.state().coins, 73);
});
test('failed recovery persistence blocks local restore', async () => {
  const h = harness({ failRecovery: true });
  await h.press({ cloudAction: 'sign-in' });
  await h.press({ cloudChoice: 'use-cloud' });
  assert.equal(h.state().coins, 51);
  assert.equal(h.ui.getView().phase, 'error');
  assert.ok(!h.calls.includes('restore'));
});
