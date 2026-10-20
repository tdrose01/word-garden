import { createBackup, parseBackup } from './persistence.js';

export const CLOUD_SAVE_FORMAT = 'word-garden-cloud-save';
export const CLOUD_SAVE_VERSION = 1;

const nonEmpty = (value, max = 200) => typeof value === 'string' && value.length > 0 && value.length <= max;
const revision = (value) => Number.isSafeInteger(value) && value >= 0;
const instant = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value));

function invalid() {
  throw new Error('Invalid cloud save. Your progress has not changed.');
}

function validatedBackup(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const state = parseBackup(text);
  return { text: createBackup(state), state };
}

export function createCloudSnapshot({ state, revision: currentRevision, savedAt, deviceId }) {
  if (!revision(currentRevision) || !instant(savedAt) || !nonEmpty(deviceId)) invalid();
  const backup = JSON.parse(validatedBackup(createBackup(state)).text);
  return {
    format: CLOUD_SAVE_FORMAT,
    version: CLOUD_SAVE_VERSION,
    revision: currentRevision,
    savedAt,
    deviceId,
    backup
  };
}

export function parseCloudSnapshot(value) {
  const snapshot = typeof value === 'string' ? JSON.parse(value) : value;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) invalid();
  const keys = Object.keys(snapshot).sort();
  const expected = ['backup', 'deviceId', 'format', 'revision', 'savedAt', 'version'];
  if (JSON.stringify(keys) !== JSON.stringify(expected) ||
      snapshot.format !== CLOUD_SAVE_FORMAT || snapshot.version !== CLOUD_SAVE_VERSION ||
      !revision(snapshot.revision) || !instant(snapshot.savedAt) || !nonEmpty(snapshot.deviceId)) invalid();
  const { text, state } = validatedBackup(snapshot.backup);
  return { ...snapshot, backup: JSON.parse(text), state };
}

export function summarizeSave(state) {
  const normalized = parseBackup(createBackup(state));
  return {
    campaignCompleted: normalized.campaign.completedLevels,
    campaignLevel: normalized.campaign.cursor + 1,
    dailyDate: normalized.daily.dateKey,
    dailyCompleted: normalized.daily.completed,
    coins: normalized.coins,
    gardenPlants: normalized.garden.plots.length,
    collectedSpecies: (normalized.garden.collectedSpecies ?? []).length
  };
}

export function sameSave(leftState, rightState) {
  return createBackup(parseBackup(createBackup(leftState))) ===
    createBackup(parseBackup(createBackup(rightState)));
}

export function planInitialSync({ localState, localIsMeaningful, cloudSnapshot }) {
  const local = parseBackup(createBackup(localState));
  if (cloudSnapshot == null) return { status: 'confirm-upload', local: summarizeSave(local) };
  const cloud = parseCloudSnapshot(cloudSnapshot);
  if (sameSave(local, cloud.state)) return { status: 'up-to-date', revision: cloud.revision };
  if (!localIsMeaningful) {
    return { status: 'confirm-restore', cloud: summarizeSave(cloud.state), revision: cloud.revision };
  }
  return {
    status: 'conflict',
    local: summarizeSave(local),
    cloud: summarizeSave(cloud.state),
    revision: cloud.revision
  };
}

export function createWriteIntent({ state, baseRevision, requestId, deviceId, savedAt }) {
  if (!revision(baseRevision) || !nonEmpty(requestId) || !nonEmpty(deviceId) || !instant(savedAt)) invalid();
  const backup = JSON.parse(validatedBackup(createBackup(state)).text);
  return {
    format: CLOUD_SAVE_FORMAT,
    version: CLOUD_SAVE_VERSION,
    baseRevision,
    requestId,
    deviceId,
    savedAt,
    backup
  };
}

export function resolveConflict({ choice, localState, cloudSnapshot, requestId, deviceId, savedAt }) {
  const local = parseBackup(createBackup(localState));
  const cloud = parseCloudSnapshot(cloudSnapshot);
  const localBackup = createBackup(local);
  const cloudBackup = createBackup(cloud.state);

  if (choice === 'cancel') {
    return { status: 'cancelled', localBackup, cloudBackup };
  }
  if (choice === 'use-cloud') {
    return { status: 'replace-local', state: cloud.state, recoveryBackup: localBackup, revision: cloud.revision };
  }
  if (choice === 'keep-local') {
    return {
      status: 'upload-local',
      recoveryBackup: cloudBackup,
      write: createWriteIntent({ state: local, baseRevision: cloud.revision, requestId, deviceId, savedAt })
    };
  }
  invalid();
}

export function classifyWriteResponse({ requestId }, response) {
  if (!response || typeof response !== 'object') return { status: 'retry-later' };
  if (response.status === 409) return { status: 'conflict', snapshot: parseCloudSnapshot(response.snapshot) };
  if (response.status >= 500 || response.status === 408 || response.status === 429) return { status: 'retry-later' };
  if ((response.status === 200 || response.status === 201) && response.requestId === requestId && revision(response.revision)) {
    return { status: 'saved', revision: response.revision };
  }
  return { status: 'failed' };
}
