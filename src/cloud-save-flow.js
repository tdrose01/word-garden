import { createCloudSnapshot, createWriteIntent, planInitialSync, resolveConflict, sameSave } from './cloud-save.js';
import { parseBackup } from './persistence.js';

const phases = new Set([
  'signed-out', 'checking', 'confirm-upload', 'confirm-restore', 'conflict',
  'up-to-date', 'backed-up', 'paused', 'waiting', 'error'
]);
const view = state => Object.freeze({ ...state });

export function createCloudSaveFlow({ auth, api, readLocal, writeLocal, localIsMeaningful,
  preserveBackup, createRequestId, deviceId, now = () => new Date().toISOString() }) {
  for (const dependency of [auth?.signIn, auth?.signOut, api?.get, api?.put, readLocal,
    writeLocal, localIsMeaningful, preserveBackup, createRequestId, now]) {
    if (typeof dependency !== 'function') throw new TypeError('Cloud save flow dependency is missing.');
  }
  if (typeof deviceId !== 'string' || !deviceId) throw new TypeError('Cloud save device id is missing.');
  let operation = 0;
  let cloudSnapshot = null;
  let autoEnabled = false;
  let pending = null;
  let writing = false;
  let current = { phase: 'signed-out', subject: null, message: 'Sign in only if you want online backup.' };
  const update = next => {
    if (!phases.has(next.phase)) throw new Error('Invalid cloud save phase.');
    current = { ...next, autoBackup: autoEnabled };
    return view(current);
  };
  const clearPending = () => { pending = null; writing = false; autoEnabled = false; };
  function invalidateSession(reason = 'Account changed. Sign in again to compare progress.') {
    ++operation; cloudSnapshot = null; clearPending();
    return update({ phase: 'signed-out', subject: null, message: reason });
  }
  function pauseForImport() {
    ++operation; clearPending();
    return update({ phase: 'paused', subject: current.subject,
      message: 'Saved on this device. Online backup needs your choice after import.' });
  }
  function conflict(snapshot, subject) {
    cloudSnapshot = snapshot; clearPending();
    const plan = planInitialSync({ localState: readLocal(), localIsMeaningful: true, cloudSnapshot });
    // Even equal snapshots need fresh explicit consent after a conflict.
    return update({ ...plan, phase: 'conflict', subject,
      message: 'Cloud progress changed. Choose again.' });
  }
  async function sendPending(isRetry = false) {
    if (!pending || writing) return view(current);
    const write = pending;
    const subject = current.subject;
    const generation = operation;
    writing = true;
    update({ phase: 'waiting', subject, retryPending: false,
      message: 'Backing up this device. New changes remain saved locally…' });
    try {
      const result = await api.put(write);
      if (generation !== operation) return view(current);
      if (!Number.isSafeInteger(result?.revision) || result.revision !== write.baseRevision + 1) {
        throw new Error('Online backup returned an invalid acknowledgement.');
      }
      cloudSnapshot = createCloudSnapshot({ state: parseBackup(JSON.stringify(write.backup)),
        revision: result.revision, savedAt: write.savedAt, deviceId: write.deviceId });
      if (isRetry) {
        // A replay acknowledges an old accepted operation, not necessarily the
        // latest cloud save. Refresh before subsequent automatic uploads.
        const latest = await api.get();
        if (generation !== operation) return view(current);
        if (!latest || latest.revision !== result.revision) {
          if (latest) return conflict(latest, subject);
          clearPending();
          return update({ phase: 'paused', subject, message: 'Online backup changed. Check again before uploading.' });
        }
        cloudSnapshot = latest;
      }
      pending = null; writing = false;
      if (!sameSave(readLocal(), parseBackup(JSON.stringify(write.backup)))) {
        update({ phase: 'waiting', subject, revision: result.revision,
          message: 'New changes are saved locally and waiting for online backup.' });
        return localChanged();
      }
      return update({ phase: 'backed-up', subject, revision: result.revision,
        message: 'Backed up online.' });
    } catch (error) {
      if (generation !== operation) return view(current);
      writing = false;
      if (error?.code === 'signed-out') return invalidateSession('Sign-in expired. Local progress is unchanged.');
      if (error?.code === 'conflict' && error.snapshot) return conflict(error.snapshot, subject);
      const transient = ['offline', 'unavailable', 'rate-limited'].includes(error?.code);
      // Keep the exact intent for retries: rebuilding it would change payload
      // or request ID after an ambiguous accepted-but-response-lost upload.
      autoEnabled = transient && autoEnabled;
      return update({ phase: transient ? 'waiting' : 'error', subject,
        retryPending: true, message: error?.message || 'Online backup failed. Local progress is unchanged.' });
    }
  }
  async function signIn() {
    const generation = ++operation;
    cloudSnapshot = null; clearPending();
    update({ phase: 'checking', subject: null, message: 'Signing in without changing progress…' });
    try {
      const session = await auth.signIn();
      if (generation !== operation) return view(current);
      if (!session?.subject) throw new Error('Sign-in did not return an account.');
      const remote = await api.get();
      if (generation !== operation) return view(current);
      cloudSnapshot = remote;
      const localState = readLocal();
      const plan = planInitialSync({ localState,
        localIsMeaningful: Boolean(localIsMeaningful(localState)), cloudSnapshot: remote });
      return update({ ...plan, phase: plan.status, subject: session.subject,
        message: plan.status === 'up-to-date' ? 'This device matches the online backup. Choose online backup before syncing changes.' : 'Choose before any progress changes.' });
    } catch (error) {
      if (generation !== operation) return view(current);
      return update({ phase: 'error', subject: null,
        message: error?.message || 'Sign-in failed. Local progress is unchanged.' });
    }
  }
  async function choose(choice) {
    const before = current;
    // Equal initial saves still require explicit opt-in for future autosync.
    if (!['confirm-upload', 'confirm-restore', 'conflict', 'up-to-date'].includes(before.phase)) {
      throw new Error('No cloud save choice is pending.');
    }
    if (choice === 'cancel') {
      ++operation; clearPending();
      return update({ phase: 'paused', subject: before.subject,
        message: 'Online backup paused. Local progress is unchanged.' });
    }
    const generation = ++operation;
    const localState = readLocal();
    try {
      if (before.phase === 'confirm-upload') {
        if (choice !== 'keep-local') throw new Error('Invalid cloud save choice.');
        pending = createWriteIntent({ state: localState, baseRevision: 0,
          requestId: createRequestId(), deviceId, savedAt: now() });
        autoEnabled = true;
        return sendPending();
      }
      if (!cloudSnapshot) throw new Error('Cloud save comparison is no longer available.');
      const resolution = resolveConflict({ choice, localState, cloudSnapshot,
        requestId: createRequestId(), deviceId, savedAt: now() });
      if (resolution.status === 'replace-local') {
        await preserveBackup(resolution.recoveryBackup, 'before-cloud-restore');
        if (generation !== operation) return view(current);
        if (!sameSave(readLocal(), localState)) throw new Error('Device progress changed during recovery. Check online backup again.');
        writeLocal(resolution.state); autoEnabled = true;
        return update({ phase: 'up-to-date', subject: before.subject, revision: resolution.revision,
          message: 'Cloud progress restored. Future changes back up online; the previous device save was preserved.' });
      }
      if (resolution.status === 'upload-local') {
        await preserveBackup(resolution.recoveryBackup, 'before-cloud-replacement');
        if (generation !== operation) return view(current);
        pending = resolution.write; autoEnabled = true;
        return sendPending();
      }
      throw new Error('Invalid cloud save choice.');
    } catch (error) {
      if (generation !== operation) return view(current);
      clearPending();
      return update({ phase: 'error', subject: before.subject,
        message: error?.message || 'Online backup failed. Local progress is unchanged.' });
    }
  }
  async function localChanged() {
    if (writing || pending || !autoEnabled || !current.subject) return view(current);
    if (!cloudSnapshot) return view(current);
    if (sameSave(readLocal(), parseBackup(JSON.stringify(cloudSnapshot.backup)))) return view(current);
    pending = createWriteIntent({ state: readLocal(), baseRevision: cloudSnapshot.revision,
      requestId: createRequestId(), deviceId, savedAt: now() });
    return sendPending();
  }
  async function retry() {
    if (pending) return sendPending(true);
    return signIn();
  }
  async function signOut() {
    invalidateSession('Signed out. This device keeps its playable guest copy.');
    await auth.signOut();
    return view(current);
  }
  return { choose, getView: () => view(current),
    getComparisonSnapshot: () => cloudSnapshot ? structuredClone(cloudSnapshot) : null, signIn, signOut, invalidateSession,
    localChanged, pauseForImport, importPause: pauseForImport, retry };
}

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);

function summary(label, value) {
  if (!value) return '';
  return `<p><strong>${escape(label)}:</strong> ${value.campaignCompleted} clearings, ${value.coins} coins, ${value.gardenPlants} plants.</p>`;
}

export function renderCloudSavePanel(model) {
  const status = `<p role="status">${escape(model.message)}</p>`;
  if (model.phase === 'signed-out' || model.phase === 'error') {
    return `<section class="cloud-save" aria-labelledby="cloud-save-title"><h3 id="cloud-save-title">Online backup <small>Optional</small></h3>${status}<button data-cloud-action="sign-in">Sign in to back up</button></section>`;
  }
  if (model.phase === 'up-to-date' && !model.autoBackup) {
    return `<section class="cloud-save" aria-labelledby="cloud-save-title"><h3 id="cloud-save-title">Enable online backup?</h3>${status}<button data-cloud-choice="keep-local">Enable online backup</button><button data-cloud-choice="cancel">Not now</button></section>`;
  }
  if (model.phase === 'confirm-upload') {
    return `<section class="cloud-save" aria-labelledby="cloud-save-title"><h3 id="cloud-save-title">Back up this device?</h3>${summary('This device', model.local)}${status}<button data-cloud-choice="keep-local">Back up this device</button><button data-cloud-choice="cancel">Not now</button></section>`;
  }
  if (model.phase === 'confirm-restore' || model.phase === 'conflict') {
    return `<section class="cloud-save" aria-labelledby="cloud-save-title"><h3 id="cloud-save-title">Choose your progress</h3>${summary('This device', model.local)}${summary('Online backup', model.cloud)}${status}<button data-cloud-choice="keep-local">Use this device</button><button data-cloud-choice="use-cloud">Use online backup</button><button data-cloud-choice="cancel">Cancel</button></section>`;
  }
  return `<section class="cloud-save" aria-labelledby="cloud-save-title"><h3 id="cloud-save-title">Online backup</h3>${status}<button data-cloud-action="sign-out">Sign out</button></section>`;
}
