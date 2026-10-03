import { createWriteIntent, planInitialSync, resolveConflict } from './cloud-save.js';

const phases = new Set([
  'signed-out', 'checking', 'confirm-upload', 'confirm-restore', 'conflict',
  'up-to-date', 'backed-up', 'paused', 'waiting', 'error'
]);

function view(state) {
  return Object.freeze({ ...state });
}

export function createCloudSaveFlow({
  auth,
  api,
  readLocal,
  writeLocal,
  localIsMeaningful,
  preserveBackup,
  createRequestId,
  deviceId,
  now = () => new Date().toISOString()
}) {
  for (const dependency of [auth?.signIn, auth?.signOut, api?.get, api?.put, readLocal, writeLocal,
    localIsMeaningful, preserveBackup, createRequestId, now]) {
    if (typeof dependency !== 'function') throw new TypeError('Cloud save flow dependency is missing.');
  }
  if (typeof deviceId !== 'string' || !deviceId) throw new TypeError('Cloud save device id is missing.');

  let operation = 0;
  let cloudSnapshot = null;
  let current = { phase: 'signed-out', subject: null, message: 'Sign in only if you want online backup.' };
  const update = (next) => {
    if (!phases.has(next.phase)) throw new Error('Invalid cloud save phase.');
    current = next;
    return view(current);
  };

  async function signIn() {
    const generation = ++operation;
    cloudSnapshot = null;
    update({ phase: 'checking', subject: null, message: 'Signing in without changing progress…' });
    try {
      const session = await auth.signIn();
      if (generation !== operation) return view(current);
      if (!session?.subject) throw new Error('Sign-in did not return an account.');
      const remote = await api.get();
      if (generation !== operation) return view(current);
      cloudSnapshot = remote;
      const localState = readLocal();
      const plan = planInitialSync({
        localState,
        localIsMeaningful: Boolean(localIsMeaningful(localState)),
        cloudSnapshot: remote
      });
      return update({
        ...plan,
        phase: plan.status,
        subject: session.subject,
        message: plan.status === 'up-to-date' ? 'This device matches the online backup.' : 'Choose before any progress changes.'
      });
    } catch (error) {
      if (generation !== operation) return view(current);
      return update({ phase: 'error', subject: null, message: error?.message || 'Sign-in failed. Local progress is unchanged.' });
    }
  }

  async function choose(choice) {
    const before = current;
    if (!['confirm-upload', 'confirm-restore', 'conflict'].includes(before.phase)) {
      throw new Error('No cloud save choice is pending.');
    }
    if (choice === 'cancel') {
      return update({ phase: 'paused', subject: before.subject, message: 'Online backup paused. Local progress is unchanged.' });
    }

    const generation = ++operation;
    const localState = readLocal();
    try {
      if (before.phase === 'confirm-upload') {
        if (choice !== 'keep-local') throw new Error('Invalid cloud save choice.');
        const write = createWriteIntent({
          state: localState, baseRevision: 0, requestId: createRequestId(), deviceId, savedAt: now()
        });
        update({ phase: 'waiting', subject: before.subject, message: 'Backing up this device…' });
        const result = await api.put(write);
        if (generation !== operation) return view(current);
        return update({ phase: 'backed-up', subject: before.subject, revision: result.revision, message: 'Backed up online.' });
      }

      if (!cloudSnapshot) throw new Error('Cloud save comparison is no longer available.');
      const resolution = resolveConflict({
        choice, localState, cloudSnapshot,
        requestId: createRequestId(), deviceId, savedAt: now()
      });
      if (resolution.status === 'replace-local') {
        preserveBackup(resolution.recoveryBackup, 'before-cloud-restore');
        if (generation !== operation) return view(current);
        writeLocal(resolution.state);
        return update({
          phase: 'up-to-date', subject: before.subject, revision: resolution.revision,
          message: 'Cloud progress restored. The previous device save was preserved.'
        });
      }
      if (resolution.status === 'upload-local') {
        preserveBackup(resolution.recoveryBackup, 'before-cloud-replacement');
        update({ phase: 'waiting', subject: before.subject, message: 'Backing up this device…' });
        const result = await api.put(resolution.write);
        if (generation !== operation) return view(current);
        return update({ phase: 'backed-up', subject: before.subject, revision: result.revision, message: 'Backed up online.' });
      }
      throw new Error('Invalid cloud save choice.');
    } catch (error) {
      if (generation !== operation) return view(current);
      if (error?.code === 'conflict' && error.snapshot) {
        cloudSnapshot = error.snapshot;
        const plan = planInitialSync({ localState: readLocal(), localIsMeaningful: true, cloudSnapshot });
        return update({ ...plan, phase: 'conflict', subject: before.subject, message: 'Cloud progress changed. Choose again.' });
      }
      return update({
        phase: error?.code === 'offline' || error?.code === 'unavailable' ? 'waiting' : 'error',
        subject: before.subject,
        message: error?.message || 'Online backup failed. Local progress is unchanged.'
      });
    }
  }

  async function signOut() {
    const generation = ++operation;
    cloudSnapshot = null;
    try {
      await auth.signOut();
    } finally {
      if (generation === operation) {
        update({
          phase: 'signed-out', subject: null,
          message: 'Signed out. This device keeps its playable guest copy.'
        });
      }
    }
    return view(current);
  }

  return { choose, getView: () => view(current), signIn, signOut };
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
  if (model.phase === 'confirm-upload') {
    return `<section class="cloud-save" aria-labelledby="cloud-save-title"><h3 id="cloud-save-title">Back up this device?</h3>${summary('This device', model.local)}${status}<button data-cloud-choice="keep-local">Back up this device</button><button data-cloud-choice="cancel">Not now</button></section>`;
  }
  if (model.phase === 'confirm-restore' || model.phase === 'conflict') {
    return `<section class="cloud-save" aria-labelledby="cloud-save-title"><h3 id="cloud-save-title">Choose your progress</h3>${summary('This device', model.local)}${summary('Online backup', model.cloud)}${status}<button data-cloud-choice="keep-local">Use this device</button><button data-cloud-choice="use-cloud">Use online backup</button><button data-cloud-choice="cancel">Cancel</button></section>`;
  }
  return `<section class="cloud-save" aria-labelledby="cloud-save-title"><h3 id="cloud-save-title">Online backup</h3>${status}<button data-cloud-action="sign-out">Sign out</button></section>`;
}
