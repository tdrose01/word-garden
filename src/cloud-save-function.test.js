import test from 'node:test';
import assert from 'node:assert/strict';
import { loadState } from './game.js';
import { createWriteIntent } from './cloud-save.js';
import { __test } from '../functions/api/cloud-save.js';

const state = () => loadState({ getItem: () => null });
const request = origin => new Request('https://word-garden-6fl.pages.dev/api/cloud-save', {
  headers: origin ? { origin } : {}
});

test('cloud Function accepts only owned production, preview, native and configured origins', () => {
  assert.equal(__test.getAllowedOrigin(request('https://word-garden-6fl.pages.dev'), {}), 'https://word-garden-6fl.pages.dev');
  assert.equal(__test.getAllowedOrigin(request('https://abc123.word-garden-6fl.pages.dev'), {}), 'https://abc123.word-garden-6fl.pages.dev');
  assert.equal(__test.getAllowedOrigin(request('capacitor://localhost'), {}), 'capacitor://localhost');
  assert.equal(__test.getAllowedOrigin(request('https://attacker.example'), {}), false);
  assert.equal(__test.getAllowedOrigin(request('https://staging.example'), { ALLOWED_CLOUD_SAVE_ORIGINS: 'https://staging.example' }), 'https://staging.example');
});

test('cloud Function revalidates the complete backup and canonicalizes it', () => {
  const intent = createWriteIntent({
    state: state(), baseRevision: 0, requestId: 'request_12345678', deviceId: 'device-1',
    savedAt: '2026-10-02T12:00:00.000Z'
  });
  const validated = __test.validateWrite(intent);
  assert.equal(JSON.parse(validated.backupJson).format, 'word-garden-backup');

  intent.backup.state.coins = -1;
  assert.throws(() => __test.validateWrite(intent), /Invalid/);
});

test('cloud Function rejects client account keys and malformed retry metadata', () => {
  const intent = createWriteIntent({
    state: state(), baseRevision: 0, requestId: 'request_12345678', deviceId: 'device-1',
    savedAt: '2026-10-02T12:00:00.000Z'
  });
  assert.throws(() => __test.validateWrite({ ...intent, accountId: 'client-controlled' }), /Invalid/);
  assert.throws(() => __test.validateWrite({ ...intent, requestId: 'short' }), /Invalid/);
});

test('idempotency hashes match retries but reject changed payloads', async () => {
  const intent = __test.validateWrite(createWriteIntent({
    state: state(), baseRevision: 0, requestId: 'request_12345678', deviceId: 'device-1',
    savedAt: '2026-10-02T12:00:00.000Z'
  }));
  assert.equal(await __test.hashWrite(intent), await __test.hashWrite(structuredClone(intent)));
  const changed = structuredClone(intent);
  changed.deviceId = 'device-2';
  assert.notEqual(await __test.hashWrite(intent), await __test.hashWrite(changed));
});

test('database rows return a versioned client snapshot without account identity', () => {
  const backup = JSON.stringify({ format: 'word-garden-backup', version: 1, state: state() });
  const snapshot = __test.cloudSnapshotFromRow({
    revision: 3, save_json: backup, saved_at: '2026-10-02T12:00:00.000Z', device_id: 'device-1'
  });
  assert.equal(snapshot.revision, 3);
  assert.equal(snapshot.accountId, undefined);
  assert.equal(snapshot.backup.format, 'word-garden-backup');
});


test('cloud Function stops oversized streamed bodies before reading their remainder', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024 + 16 * 1024 + 1));
    },
    cancel() { cancelled = true; }
  });
  const request = new Request('https://word-garden-6fl.pages.dev/api/cloud-save', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body, duplex: 'half'
  });
  assert.equal((await __test.readJson(request)).status, 413);
  assert.equal(cancelled, true);
});

test('cloud Function parses a bounded valid streamed write', async () => {
  const intent = createWriteIntent({ state: state(), baseRevision: 0, requestId: 'request_12345678',
    deviceId: 'device-1', savedAt: '2026-10-03T00:00:00Z' });
  const request = new Request('https://word-garden-6fl.pages.dev/api/cloud-save', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(intent)
  });
  assert.equal((await __test.readJson(request)).value.requestId, intent.requestId);
});


test('cloud Function verifies signature, issuer, audience, expiry and authorized account session', async () => {
  const issuer = 'https://word-garden-jwt-regression.clerk.accounts.dev';
  const key = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...await crypto.subtle.exportKey('jwk', key.publicKey), kid: 'test-key' };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(url, `${issuer}/.well-known/jwks.json`);
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
  };
  const env = { CLERK_ISSUER: issuer, CLERK_AUTHORIZED_PARTIES: 'https://word-garden-6fl.pages.dev', CLERK_AUDIENCE: 'word-garden' };
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: issuer, sub: 'user_verified', exp: now + 60, azp: 'https://word-garden-6fl.pages.dev', aud: 'word-garden' };
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  async function token(payload) {
    const message = `${encode({ alg: 'RS256', kid: 'test-key' })}.${encode(payload)}`;
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.privateKey, new TextEncoder().encode(message));
    return `${message}.${Buffer.from(signature).toString('base64url')}`;
  }
  async function verify(payload, corrupt = false) {
    const signed = await token(payload);
    const request = new Request('https://word-garden-6fl.pages.dev/api/cloud-save', {
      headers: { authorization: `Bearer ${corrupt ? signed.slice(0, -10) + 'AAAAAAAAAA' : signed}` }
    });
    return __test.verifySession(request, env, 'https://word-garden-6fl.pages.dev');
  }
  try {
    assert.deepEqual(await verify(claims), { accountId: 'user_verified' });
    for (const patch of [{ iss: 'https://attacker.example' }, { sub: '' }, { exp: now - 1 },
      { azp: 'https://attacker.example' }, { aud: 'other-game' }, { nbf: now + 60 }, { nbf: 'invalid' }]) {
      assert.equal((await verify({ ...claims, ...patch })).status, 401);
    }
    assert.equal((await verify(claims, true)).status, 401);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('cloud Function enforces account and IP budgets and fails closed if counters fail', async () => {
  const keys = [];
  let counts = [1, 1];
  const database = {
    prepare(sql) { return { bind(...values) { keys.push({ sql, values }); return { sql, values }; } }; },
    async batch() { return counts.map(requests => ({ results: [{ requests }] })); }
  };
  const request = new Request('https://word-garden-6fl.pages.dev/api/cloud-save', {
    method: 'PUT', headers: { 'cf-connecting-ip': '203.0.113.1' }
  });
  const access = { database, accountId: 'verified_user', origin: 'https://word-garden-6fl.pages.dev' };
  assert.equal(await __test.enforceRateLimit({ request }, access), null);
  assert.equal(keys[0].values[0], 'account:verified_user:PUT');
  assert.match(keys[1].values[0], /^ip:[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(keys).includes('203.0.113.1'));
  counts = [31, 1];
  const limited = await __test.enforceRateLimit({ request }, access);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  counts = [1, 241];
  assert.equal((await __test.enforceRateLimit({ request }, access)).status, 429);
  counts = [];
  assert.equal((await __test.enforceRateLimit({ request }, access)).status, 503);
});
