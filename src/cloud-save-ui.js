import { createCloudSaveFlow, renderCloudSavePanel } from './cloud-save-flow.js';
import { createCloudSaveApi } from './cloud-save-client.js';
import { createClerkAuth } from './cloud-save-auth.js';
import { createBackup, parseBackup } from './persistence.js';

export const CLOUD_RECOVERY_KEY = 'word-garden-cloud-recovery';
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const count = value => Array.isArray(value) ? value.length : 0;
function progressDetails(label, state) {
  if (!state) return '';
  const daily = state.daily || {};
  const replay = state.replay;
  const active = state.mode === 'daily' ? daily : state.mode === 'replay' ? replay || state : state;
  return `<section class="cloud-save-details" aria-label="${escape(label)} details"><h4>${escape(label)}</h4><p>Current play: ${escape(state.mode)}. Current puzzle: ${count(active.solved)} words found, ${count(active.revealed)} hints revealed.</p><p>Daily ${escape(daily.dateKey || 'not started')}: ${count(daily.solved)} words found, ${count(daily.revealed)} hints revealed, ${daily.completed ? 'complete' : 'in progress'}.</p><p>Replay: ${state.mode === 'replay' && replay ? `board ${Number(replay.levelIndex) + 1}, ${count(replay.solved)} words found, ${count(replay.revealed)} hints revealed` : 'not active'}.</p></section>`;
}

export function createCloudSaveUI({ enabled, publishableKey, readLocal, writeLocal, onChange,
  beforeSignIn = () => {}, storage, auth: injectedAuth, api: injectedApi,
  createId = () => crypto.randomUUID(), download = downloadBackup }) {
  // Merely opening Settings never initializes Clerk or contacts the API.
  if (!enabled || (!publishableKey && !injectedAuth)) return null;
  const auth = injectedAuth || createClerkAuth({ publishableKey });
  const getStorage = () => storage ?? globalThis.localStorage;
  let expectedSubject = null;
  let active = false;
  let notice = '';
  let flow;
  let applyingRemote = false;
  let deviceId;
  let localChangeTimer;
  let remoteDetails = null;
  const transport = injectedApi || createCloudSaveApi({ getToken: () => auth.getToken(expectedSubject) });
  const api = {
    async get() { remoteDetails = await transport.get(); return remoteDetails; },
    async put(write) {
      try { return await transport.put(write); }
      catch (error) { if (error.snapshot) remoteDetails = error.snapshot; throw error; }
    }
  };
  const preserveBackup = (backup, reason) => {
    parseBackup(backup);
    try { getStorage().setItem(CLOUD_RECOVERY_KEY, JSON.stringify({ backup, reason, savedAt: new Date().toISOString() })); }
    catch { throw new Error('Previous progress could not be preserved. Download a JSON backup and free browser storage before trying again.'); }
  };
  const initializeFlow = () => {
    if (flow) return flow;
    deviceId = getStorage().getItem('word-garden-cloud-device');
    if (!deviceId) { deviceId = createId(); getStorage().setItem('word-garden-cloud-device', deviceId); }
    flow = createCloudSaveFlow({
      auth: {
        async signIn() { const session = await auth.signIn(); expectedSubject = session.subject; return session; },
        async signOut() { expectedSubject = null; await auth.signOut(); }
      }, api, readLocal,
      writeLocal(value) {
        applyingRemote = true;
        try { writeLocal(value); } finally { applyingRemote = false; }
      },
      // Every device copy, including its current randomized board, deserves an
      // explicit choice when different from the remote copy.
      localIsMeaningful: () => true,
      preserveBackup,
      createRequestId: createId, deviceId
    });
    auth.subscribe?.(subject => {
      if (expectedSubject && subject !== expectedSubject) {
        expectedSubject = null; clearTimeout(localChangeTimer);
        flow.invalidateSession(); onChange();
      }
    });
    return flow;
  };
  const model = () => flow?.getView() || { phase: 'signed-out', message: 'Your progress stays on this device. Sign in only for optional online backup.' };
  function recovery() {
    try {
      const value = JSON.parse(getStorage().getItem(CLOUD_RECOVERY_KEY) || 'null');
      if (!value) return null;
      parseBackup(value.backup); return value.backup;
    } catch { return null; }
  }
  return {
    render() {
      const view = model();
      const checking = active || view.phase === 'checking' || (view.phase === 'waiting' && !view.retryPending);
      const panel = renderCloudSavePanel(view);
      const comparing = ['confirm-upload', 'confirm-restore', 'conflict'].includes(view.phase);
      const remote = comparing ? remoteDetails : null;
      const date = remote?.savedAt ? new Date(remote.savedAt) : null;
      const metadata = date && !Number.isNaN(date.getTime()) ? `<p>Backup device: ${remote.deviceId === deviceId ? 'This device' : 'Another device'}. Saved <time data-cloud-time datetime="${escape(remote.savedAt)}">${escape(date.toLocaleString())}</time>.</p>` : '';
      return `<div data-cloud-save-ui>${panel}${comparing ? progressDetails('This device', readLocal()) + progressDetails('Online backup', remote?.backup?.state) + metadata : ''}<p>Sign-in compares first. After your choice, new progress backs up automatically. Importing a JSON backup pauses online backup. Guest play remains available.</p><p>Clerk handles sign-in; Word Garden stores your puzzle, daily, replay, garden and settings progress for backup. Use an account you can recover and an email inbox you can access. On a shared device, sign out when finished. Signing out keeps the playable local copy in this browser.</p>${notice ? '<p role="status">Online backup is paused after importing. Check online backup before choosing again.</p>' : ''}${!checking && view.phase !== 'signed-out' ? '<button data-cloud-action="check">Check online backup</button>' : ''}${view.subject && !panel.includes('data-cloud-action="sign-out"') ? '<button data-cloud-action="sign-out">Sign out</button>' : ''}${view.retryPending ? '<button data-cloud-action="retry">Retry backup</button>' : ''}${recovery() ? '<button data-cloud-action="download-recovery">Download previous save</button>' : ''}<p data-cloud-ui-error role="status"></p></div>`;
    },
    bind(root) {
      for (const button of root.querySelectorAll('[data-cloud-action], [data-cloud-choice]')) {
        const view = model();
        button.disabled = (active || view.phase === 'checking' || (view.phase === 'waiting' && !view.retryPending)) && button.dataset.cloudAction !== 'sign-out' && button.dataset.cloudAction !== 'download-recovery';
        button.addEventListener('click', async () => {
          const action = button.dataset.cloudAction;
          if (active && !['sign-out', 'download-recovery'].includes(action)) return;
          if (action === 'download-recovery') { const backup = recovery(); if (backup) download(backup); return; }
          active = true;
          try {
            const current = initializeFlow();
            let operation;
            if (action === 'sign-in' || action === 'check') { beforeSignIn(); notice = ''; operation = current.signIn(); }
            else if (action === 'sign-out') operation = current.signOut();
            else if (action === 'retry') operation = current.retry();
            else operation = current.choose(button.dataset.cloudChoice);
            onChange(); await operation;
          } catch (error) {
            active = false; onChange();
            const status = root.ownerDocument.querySelector('[data-cloud-ui-error]');
            if (status) status.textContent = error.message || 'Online backup failed. Local progress is unchanged.';
            return;
          } finally { active = false; }
          onChange();
        });
      }
    },
    localChanged() {
      if (applyingRemote) return;
      if (!flow) return;
      clearTimeout(localChangeTimer);
      localChangeTimer = setTimeout(async () => {
        const operation = flow.localChanged(); onChange();
        try { await operation; } finally { onChange(); }
      }, 600);
    },
    pauseForImport() {
      clearTimeout(localChangeTimer); notice = 'imported';
      flow?.pauseForImport();
      preserveBackup(createBackup(readLocal()), 'before-json-import');
    },
    getView: model
  };
}

function downloadBackup(text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'word-garden-previous-save.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
