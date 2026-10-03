import assert from 'node:assert/strict';
import { loadState } from '../src/game.js';
import { createCloudSnapshot } from '../src/cloud-save.js';

export async function runCloudSaveBrowserAcceptance(browser, url, { development = true } = {}) {
  const guest = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const guestPage = await guest.newPage();
  const guestRequests = [];
  guestPage.on('request', request => { if (/clerk|\/api\/cloud-save/.test(request.url())) guestRequests.push(request.url()); });
  await guestPage.goto(url);
  await guestPage.locator('[data-action="settings"]').click();
  assert.equal(await guestPage.locator('[data-cloud-save-ui]').count(), 0, 'disabled build keeps the existing guest Settings');
  assert.deepEqual(guestRequests, [], 'guest Settings must not contact auth or backup services');
  await guest.close();
  if (!development) return; // Test-only injection is intentionally absent from production.

  const local = loadState({ getItem: () => null }, () => 0); local.coins = 51;
  const remote = structuredClone(local); remote.coins = 73;
  const snapshot = createCloudSnapshot({ state: remote, revision: 4, deviceId: 'other-device', savedAt: new Date().toISOString() });
  const context = await browser.newContext({ viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true });
  await context.addInitScript(({ local, snapshot }) => {
    localStorage.setItem('word-garden-state', JSON.stringify(local));
    window.__CLOUD_CALLS__ = { signIn: 0, get: 0, writes: [], signOut: 0 };
    window.__CLOUD_OFFLINE__ = false;
    let subject = null;
    const listeners = new Set();
    window.__CLOUD_CHANGE_SESSION__ = () => { subject = 'other_user'; listeners.forEach(listener => listener(subject)); };
    window.__WORD_GARDEN_CLOUD_TEST__ = { enabled: true,
      auth: {
        async signIn() { window.__CLOUD_CALLS__.signIn++; subject = 'user_acceptance'; return { subject, identity: 'very.long.word.garden.acceptance.account@example.test' }; },
        async signOut() { subject = null; window.__CLOUD_CALLS__.signOut++; listeners.forEach(listener => listener(null)); },
        getSubject: () => subject,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
      },
      api: {
        async get() { window.__CLOUD_CALLS__.get++; return snapshot; },
        async put(write) {
          window.__CLOUD_CALLS__.writes.push(write);
          if (window.__CLOUD_OFFLINE__) throw Object.assign(new Error('Online backup is offline. Progress stays on this device.'), { code: 'offline' });
          const revision = write.baseRevision + 1;
          Object.assign(snapshot, { revision, backup: write.backup, savedAt: write.savedAt, deviceId: write.deviceId });
          return { requestId: write.requestId, revision };
        }
      }
    };
  }, { local, snapshot });
  const page = await context.newPage();
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  page.on('console', message => { if (message.type() === 'error') failures.push(message.text()); });
  const network = [];
  page.on('request', request => { if (/clerk|\/api\/cloud-save/.test(request.url())) network.push(request.url()); });
  try {
    await page.goto(url);
    await page.locator('[data-action="settings"]').click();
    await page.locator('[data-cloud-save-ui]').waitFor();
    const cloudCopy = await page.locator('[data-cloud-save-ui]').textContent();
    assert.match(cloudCopy, /Clerk handles sign-in/);
    assert.match(cloudCopy, /email inbox you can access/);
    assert.match(cloudCopy, /shared device/);
    assert.equal(await page.evaluate(() => window.__CLOUD_CALLS__.signIn), 0);
    await page.locator('[data-cloud-action="sign-in"]').click();
    await page.locator('[data-cloud-choice="use-cloud"]').waitFor();
    assert.match(await page.locator('[data-cloud-identity]').textContent(), /Signed in as very\.long\.word\.garden\.acceptance\.account@example\.test/);
    assert.equal(await page.locator('[data-cloud-identity]').evaluate(element => getComputedStyle(element).overflowWrap), 'anywhere');
    assert.equal(await page.locator('.cloud-save-details').count(), 2, 'comparison includes device and online daily/replay details');
    assert.match(await page.locator('.cloud-save-details').first().textContent(), /Daily .*Replay:/);
    assert.equal(await page.locator('[data-cloud-time]').getAttribute('datetime'), snapshot.savedAt);
    assert.match(await page.locator('[data-cloud-save-ui]').textContent(), /Backup device: Another device/);
    assert.equal(await page.evaluate(() => window.__CLOUD_CALLS__.writes.length), 0, 'sign-in must only compare');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('word-garden-state')).coins), 51);
    await page.locator('[data-cloud-choice="cancel"]').click();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('word-garden-state')).coins), 51, 'cancel keeps local progress');
    await page.locator('[data-cloud-action="check"]').click();
    await page.locator('[data-cloud-choice="use-cloud"]').click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('word-garden-state')).coins === 73);
    await page.locator('[data-cloud-action="download-recovery"]').waitFor();
    const recovery = await page.evaluate(() => JSON.parse(localStorage.getItem('word-garden-cloud-recovery')));
    assert.equal(JSON.parse(recovery.backup).state.coins, 51, 'restore durably preserves previous device progress');
    assert.equal(await page.evaluate(() => window.__CLOUD_CALLS__.writes.length), 0, 'restore must not upload');
    await page.locator('[data-setting="sound"]').click();
    await page.waitForFunction(() => window.__CLOUD_CALLS__.writes.length === 1);
    await page.getByText('Backed up online.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__CLOUD_CALLS__.writes[0].backup.state.settings.sound), true, 'new local changes back up only after the explicit restore choice');
    await page.evaluate(() => { window.__CLOUD_OFFLINE__ = true; });
    await page.locator('[data-setting="haptics"]').click();
    await page.locator('[data-cloud-action="retry"]').waitFor();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('word-garden-state')).settings.haptics), false, 'offline change stays saved locally');
    await page.evaluate(() => { window.__CLOUD_OFFLINE__ = false; });
    await page.locator('[data-cloud-action="retry"]').click();
    await page.getByText('Backed up online.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__CLOUD_CALLS__.writes[1].requestId === window.__CLOUD_CALLS__.writes[2].requestId), true, 'offline retry keeps its original operation id');
    const imported = structuredClone(local); imported.coins = 88;
    await page.locator('[data-import-backup]').setInputFiles({ name: 'accepted-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'word-garden-backup', version: 1, state: imported })) });
    await page.locator('[data-action="confirm-import"]').click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('word-garden-state')).coins === 88);
    assert.equal(await page.evaluate(() => JSON.parse(JSON.parse(localStorage.getItem('word-garden-cloud-recovery')).backup).state.coins), 73, 'JSON import also preserves the previous device save');
    await page.waitForTimeout(750); // Allow the local-change debounce to prove import remains paused.
    assert.equal(await page.evaluate(() => window.__CLOUD_CALLS__.writes.length), 3, 'JSON import must pause automatic uploads');
    await page.locator('[data-cloud-action="check"]').click();
    await page.locator('[data-cloud-choice="keep-local"]').click();
    await page.getByText('Backed up online.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__CLOUD_CALLS__.writes[3].backup.state.coins), 88, 'import uploads only after another explicit choice');
    await page.evaluate(() => window.__CLOUD_CHANGE_SESSION__());
    await page.locator('[data-cloud-action="sign-in"]').waitFor();
    assert.equal(await page.locator('[data-cloud-identity]').count(), 0, 'account change clears stale identity');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('word-garden-state')).coins), 88, 'account change retains local progress');
    await page.locator('[data-cloud-action="sign-in"]').click();
    await page.locator('[data-cloud-action="sign-out"]').click();
    await page.locator('[data-cloud-action="sign-in"]').waitFor();
    assert.equal(await page.locator('[data-cloud-identity]').count(), 0, 'sign-out clears identity');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('word-garden-state')).coins), 88, 'sign-out retains playable local copy');
    assert.deepEqual(network, [], 'fake adapter acceptance uses no real provider or backend');
    assert.deepEqual(failures, []);
  } finally { await context.close(); }
  console.log('PASS optional cloud Settings: guest isolation, explicit choices, recovery, autosync, stable offline retry, import pause, account changes and sign-out');
}
