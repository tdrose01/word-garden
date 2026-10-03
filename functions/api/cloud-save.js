import { createBackup, parseBackup, MAX_BACKUP_BYTES } from '../../src/persistence.js';

const CLOUD_SAVE_FORMAT = 'word-garden-cloud-save';
const CLOUD_SAVE_VERSION = 1;
const MAX_REQUEST_BYTES = MAX_BACKUP_BYTES + 16 * 1024;
const DEFAULT_ALLOWED_ORIGINS = new Set([
  'https://word-garden-6fl.pages.dev',
  'capacitor://localhost',
  'http://localhost'
]);
const SAFE_LOCAL_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):(?:4173|5173|8788)$/;
const SAFE_PREVIEW_ORIGIN = /^https:\/\/[a-z0-9-]+\.word-garden-6fl\.pages\.dev$/;
const jwksCache = new Map();

function jsonResponse(body, status = 200, origin = null) {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  if (origin) {
    headers.set('access-control-allow-origin', origin);
    headers.set('vary', 'Origin');
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function allowedOrigins(env = {}) {
  const result = new Set(DEFAULT_ALLOWED_ORIGINS);
  for (const value of String(env.ALLOWED_CLOUD_SAVE_ORIGINS || '').split(',')) {
    const origin = value.trim();
    if (/^https:\/\/[a-z0-9.-]+$/i.test(origin) || SAFE_LOCAL_ORIGIN.test(origin)) result.add(origin);
  }
  return result;
}

function getAllowedOrigin(request, env) {
  const origin = request.headers.get('origin') || '';
  if (!origin) return null;
  if (allowedOrigins(env).has(origin) || SAFE_LOCAL_ORIGIN.test(origin) || SAFE_PREVIEW_ORIGIN.test(origin)) return origin;
  return false;
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
}

function decodePart(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

function bearerToken(request) {
  const match = request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9._~-]+)$/);
  return match?.[1] || null;
}

function configuredParties(env, requestOrigin) {
  const parties = String(env.CLERK_AUTHORIZED_PARTIES || '').split(',').map(value => value.trim()).filter(Boolean);
  if (parties.length) return new Set(parties);
  return requestOrigin ? new Set([requestOrigin]) : new Set();
}

async function getJwk(url, kid) {
  const cached = jwksCache.get(url);
  if (cached && cached.expires > Date.now()) return cached.keys.find(key => key.kid === kid);
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error('JWKS unavailable');
  const body = await response.json();
  if (!Array.isArray(body?.keys)) throw new Error('JWKS invalid');
  jwksCache.set(url, { keys: body.keys, expires: Date.now() + 10 * 60 * 1000 });
  return body.keys.find(key => key.kid === kid);
}

async function verifySession(request, env, requestOrigin) {
  const token = bearerToken(request);
  const issuer = String(env.CLERK_ISSUER || '').replace(/\/$/, '');
  if (!token) return { error: 'Authentication required.', status: 401 };
  if (!issuer) return { error: 'Cloud backup is not configured.', status: 503 };

  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('JWT invalid');
    const header = decodePart(parts[0]);
    const payload = decodePart(parts[1]);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('JWT algorithm invalid');
    const key = await getJwk(env.CLERK_JWKS_URL || `${issuer}/.well-known/jwks.json`, header.kid);
    if (!key || key.kty !== 'RSA') throw new Error('JWT key invalid');
    const cryptoKey = await crypto.subtle.importKey(
      'jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    );
    const validSignature = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', cryptoKey, decodeBase64Url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    );
    const now = Math.floor(Date.now() / 1000);
    const audience = String(env.CLERK_AUDIENCE || '');
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    const parties = configuredParties(env, requestOrigin);
    if (!validSignature || payload.iss !== issuer || typeof payload.sub !== 'string' || !payload.sub ||
        !Number.isFinite(payload.exp) || payload.exp <= now || (payload.nbf !== undefined && (!Number.isFinite(payload.nbf) || payload.nbf > now)) ||
        !parties.has(payload.azp) || (audience && !audiences.includes(audience))) throw new Error('JWT claims invalid');
    return { accountId: payload.sub };
  } catch {
    return { error: 'Authentication required.', status: 401 };
  }
}

function cloudSnapshotFromRow(row) {
  return {
    format: CLOUD_SAVE_FORMAT,
    version: CLOUD_SAVE_VERSION,
    revision: row.revision,
    savedAt: row.saved_at,
    deviceId: row.device_id,
    backup: JSON.parse(row.save_json)
  };
}

function validateWrite(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid cloud save.');
  const keys = Object.keys(input).sort();
  const expected = ['backup', 'baseRevision', 'deviceId', 'format', 'requestId', 'savedAt', 'version'];
  if (JSON.stringify(keys) !== JSON.stringify(expected) || input.format !== CLOUD_SAVE_FORMAT ||
      input.version !== CLOUD_SAVE_VERSION || !Number.isSafeInteger(input.baseRevision) || input.baseRevision < 0 ||
      typeof input.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(input.requestId) ||
      typeof input.deviceId !== 'string' || !/^[A-Za-z0-9 _.-]{1,100}$/.test(input.deviceId) ||
      typeof input.savedAt !== 'string' || Number.isNaN(Date.parse(input.savedAt))) throw new Error('Invalid cloud save.');
  const state = parseBackup(JSON.stringify(input.backup));
  return { ...input, backupJson: createBackup(state) };
}

async function hashWrite(write) {
  const canonical = JSON.stringify({
    baseRevision: write.baseRevision,
    deviceId: write.deviceId,
    savedAt: write.savedAt,
    backup: JSON.parse(write.backupJson)
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

async function readJson(request) {
  const type = request.headers.get('content-type') || '';
  if (!type.toLowerCase().includes('application/json')) return { error: 'Content-Type must be application/json.', status: 415 };
  const tooLarge = { error: 'Cloud save is too large.', status: 413 };
  const declaredLength = Number(request.headers.get('content-length'));
  if (declaredLength > MAX_REQUEST_BYTES) return tooLarge;
  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let raw = '';
  if (reader) {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_REQUEST_BYTES) {
          await reader.cancel();
          return tooLarge;
        }
        raw += decoder.decode(value, { stream: true });
      }
      raw += decoder.decode();
    } finally {
      reader.releaseLock();
    }
  }
  try {
    return { value: validateWrite(JSON.parse(raw)) };
  } catch {
    return { error: 'Cloud save is invalid. Local progress is unchanged.', status: 422 };
  }
}

async function authenticate(context) {
  const origin = getAllowedOrigin(context.request, context.env);
  if (origin === false) return { response: jsonResponse({ error: 'Origin is not allowed.' }, 403) };
  const auth = await verifySession(context.request, context.env || {}, origin);
  if (auth.error) return { response: jsonResponse({ error: auth.error }, auth.status, origin) };
  if (!context.env?.CLOUD_SAVES) return { response: jsonResponse({ error: 'Cloud backup is not configured.' }, 503, origin) };
  return { origin, accountId: auth.accountId, database: context.env.CLOUD_SAVES };
}

const RATE_COUNTER_SQL = `INSERT INTO cloud_save_rate_limits (limiter_key, bucket, requests)
  VALUES (?1, ?2, 1) ON CONFLICT(limiter_key, bucket)
  DO UPDATE SET requests = cloud_save_rate_limits.requests + 1 RETURNING requests`;

async function enforceRateLimit(context, access) {
  const bucket = Math.floor(Date.now() / 60_000);
  const ip = context.request.headers.get('cf-connecting-ip') || 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  const ipHash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  const method = context.request.method;
  const accountLimit = method === 'PUT' ? 30 : 120;
  try {
    const results = await access.database.batch([
      access.database.prepare(RATE_COUNTER_SQL).bind(`account:${access.accountId}:${method}`, bucket),
      access.database.prepare(RATE_COUNTER_SQL).bind(`ip:${ipHash}`, bucket),
      access.database.prepare('DELETE FROM cloud_save_rate_limits WHERE bucket < ?1').bind(bucket - 1)
    ]);
    const accountCount = results?.[0]?.results?.[0]?.requests;
    const ipCount = results?.[1]?.results?.[0]?.requests;
    if (!Number.isSafeInteger(accountCount) || !Number.isSafeInteger(ipCount)) throw new Error('Rate limiter unavailable');
    if (accountCount > accountLimit || ipCount > 240) {
      const response = jsonResponse({ error: 'Online backup is busy. Progress is safe on this device. Retry shortly.' }, 429, access.origin);
      response.headers.set('retry-after', String(60 - Math.floor(Date.now() / 1000) % 60));
      return response;
    }
    return null;
  } catch {
    return jsonResponse({ error: 'Online backup is temporarily unavailable. Progress is safe on this device.' }, 503, access.origin);
  }
}

async function currentSave(database, accountId) {
  return database.prepare(
    'SELECT revision, save_json, saved_at, device_id FROM cloud_saves WHERE account_id = ?1'
  ).bind(accountId).first();
}

export async function onRequestOptions({ request, env }) {
  const origin = getAllowedOrigin(request, env);
  if (!origin) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, PUT, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '600',
    'cache-control': 'no-store',
    vary: 'Origin'
  } });
}

export async function onRequestGet(context) {
  const access = await authenticate(context);
  if (access.response) return access.response;
  const limited = await enforceRateLimit(context, access);
  if (limited) return limited;
  const row = await currentSave(access.database, access.accountId);
  if (!row) return jsonResponse({ error: 'No cloud save.' }, 404, access.origin);
  return jsonResponse({ snapshot: cloudSnapshotFromRow(row) }, 200, access.origin);
}

export async function onRequestPut(context) {
  const access = await authenticate(context);
  if (access.response) return access.response;
  const limited = await enforceRateLimit(context, access);
  if (limited) return limited;
  const parsed = await readJson(context.request);
  if (parsed.error) return jsonResponse({ error: parsed.error }, parsed.status, access.origin);
  const write = parsed.value;
  const payloadHash = await hashWrite(write);
  const existingRequest = await access.database.prepare(
    'SELECT payload_hash, response_json FROM cloud_save_requests WHERE account_id = ?1 AND request_id = ?2'
  ).bind(access.accountId, write.requestId).first();
  if (existingRequest) {
    if (existingRequest.payload_hash !== payloadHash) {
      return jsonResponse({ error: 'This retry identifier was already used for different progress.' }, 422, access.origin);
    }
    return jsonResponse(JSON.parse(existingRequest.response_json), 200, access.origin);
  }

  const existing = await currentSave(access.database, access.accountId);
  if ((existing?.revision ?? 0) !== write.baseRevision) {
    return jsonResponse({ error: 'Cloud progress changed on another device.', snapshot: cloudSnapshotFromRow(existing) }, 409, access.origin);
  }

  const nextRevision = write.baseRevision + 1;
  const savedAt = new Date().toISOString();
  const acceptedResponse = JSON.stringify({ ok: true, revision: nextRevision, requestId: write.requestId });
  const statements = [
    access.database.prepare(`INSERT INTO cloud_saves
      (account_id, revision, save_json, saved_at, device_id, request_id)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)
      ON CONFLICT(account_id) DO UPDATE SET revision = excluded.revision, save_json = excluded.save_json,
        saved_at = excluded.saved_at, device_id = excluded.device_id, request_id = excluded.request_id
      WHERE cloud_saves.revision = ?7`).bind(
        access.accountId, nextRevision, write.backupJson, savedAt, write.deviceId, write.requestId, write.baseRevision
      ),
    access.database.prepare(`INSERT OR IGNORE INTO cloud_save_requests
      (account_id, request_id, payload_hash, accepted_revision, response_json, accepted_at)
      SELECT ?1, ?2, ?3, ?4, ?5, ?6 FROM cloud_saves
      WHERE account_id = ?1 AND revision = ?4 AND request_id = ?2`).bind(
        access.accountId, write.requestId, payloadHash, nextRevision, acceptedResponse, savedAt
      ),
    access.database.prepare(`INSERT OR IGNORE INTO cloud_save_versions (account_id, revision, save_json, saved_at)
      SELECT ?1, ?2, ?3, ?4 FROM cloud_saves
      WHERE account_id = ?1 AND revision = ?2 AND request_id = ?5`).bind(
        access.accountId, nextRevision, write.backupJson, savedAt, write.requestId
      )
  ];
  const results = await access.database.batch(statements);
  const changes = results?.[0]?.meta?.changes ?? results?.[0]?.meta?.rows_written ?? 0;
  if (changes < 1) {
    const retry = await access.database.prepare(
      'SELECT payload_hash, response_json FROM cloud_save_requests WHERE account_id = ?1 AND request_id = ?2'
    ).bind(access.accountId, write.requestId).first();
    if (retry?.payload_hash === payloadHash) return jsonResponse(JSON.parse(retry.response_json), 200, access.origin);
    if (retry) return jsonResponse({ error: 'This retry identifier was already used for different progress.' }, 422, access.origin);
    const latest = await currentSave(access.database, access.accountId);
    return jsonResponse({ error: 'Cloud progress changed on another device.', snapshot: cloudSnapshotFromRow(latest) }, 409, access.origin);
  }
  return jsonResponse({ ok: true, revision: nextRevision, requestId: write.requestId }, write.baseRevision === 0 ? 201 : 200, access.origin);
}

export const __test = { cloudSnapshotFromRow, getAllowedOrigin, hashWrite, readJson, validateWrite, verifySession, enforceRateLimit, RATE_COUNTER_SQL };
