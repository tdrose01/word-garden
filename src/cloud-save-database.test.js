import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { loadState } from './game.js';
import { createWriteIntent } from './cloud-save.js';
import { onRequestGet, onRequestPut } from '../functions/api/cloud-save.js';

// Execute the actual migration and handler SQL against SQLite. This verifies
// query semantics, not the separately required real D1 provider rollout drill.
test('real handler SQL isolates accounts, detects races and replays requests after later saves', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_cloud_saves.sql', import.meta.url), 'utf8'));
  const query = ({ queries }) => {
    sqlite.exec('BEGIN');
    try {
      const result = queries.map(({ sql, values }) => {
        const before = sqlite.prepare('SELECT total_changes() AS count').get().count;
        const results = sqlite.prepare(sql).all(...values).map(row => ({ ...row }));
        const after = sqlite.prepare('SELECT total_changes() AS count').get().count;
        return { results, meta: { changes: after - before } };
      });
      sqlite.exec('COMMIT');
      return result;
    } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  };
  const database = {
    prepare(sql) { return { bind(...values) {
      return { sql, values, async first() { return query({ queries: [{ sql, values }] })[0].results[0] ?? null; } };
    } }; },
    async batch(statements) { return query({ queries: statements.map(({ sql, values }) => ({ sql, values })) }); }
  };
  const issuer = 'https://word-garden-sql-regression.clerk.accounts.dev';
  const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...await crypto.subtle.exportKey('jwk', keys.publicKey), kid: 'sql-test' };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(url, `${issuer}/.well-known/jwks.json`);
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
  };
  const origin = 'https://word-garden-6fl.pages.dev';
  const env = { CLOUD_SAVES: database, CLERK_ISSUER: issuer, CLERK_AUTHORIZED_PARTIES: origin };
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  async function token(subject) {
    const message = `${encode({ alg: 'RS256', kid: 'sql-test' })}.${encode({
      iss: issuer, sub: subject, azp: origin, exp: Math.floor(Date.now() / 1000) + 300
    })}`;
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(message));
    return `${message}.${Buffer.from(signature).toString('base64url')}`;
  }
  const sessions = { user_a: await token('user_a'), user_b: await token('user_b') };
  function request(subject, method, intent) {
    return { env, request: new Request(`${origin}/api/cloud-save`, {
      method, headers: { origin, authorization: `Bearer ${sessions[subject]}`,
        'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.2' },
      ...(intent ? { body: JSON.stringify(intent) } : {})
    }) };
  }
  function intent(baseRevision, requestId, coins) {
    const state = loadState({ getItem: () => null }, () => 0); state.coins = coins;
    return createWriteIntent({ state, baseRevision, requestId, deviceId: 'regression-device', savedAt: '2026-10-03T00:00:00Z' });
  }
  const put = (subject, write) => onRequestPut(request(subject, 'PUT', write));
  const get = subject => onRequestGet(request(subject, 'GET'));
  try {
    const writeA = intent(0, 'request_A_0001', 51);
    const acceptedA = await put('user_a', writeA);
    assert.equal(acceptedA.status, 201);
    assert.equal((await get('user_b')).status, 404);
    assert.equal((await put('user_b', intent(0, 'request_A_0001', 99))).status, 201,
      'request ids are scoped to authenticated accounts');
    const writeB = intent(1, 'request_B_0002', 61);
    assert.equal((await put('user_a', writeB)).status, 200);
    const replayA = await put('user_a', writeA);
    assert.deepEqual(await replayA.json(), { ok: true, revision: 1, requestId: writeA.requestId });
    assert.equal((await get('user_a')).status, 200);
    assert.equal((await (await get('user_a')).json()).snapshot.backup.state.coins, 61,
      'replaying A must not replace newer B');
    assert.equal((await put('user_a', intent(0, writeA.requestId, 777))).status, 422);
    const race = await Promise.all([
      put('user_a', intent(2, 'request_race_C', 71)),
      put('user_a', intent(2, 'request_race_D', 81))
    ]);
    assert.deepEqual(race.map(response => response.status).sort(), [200, 409]);
    const latest = (await (await get('user_a')).json()).snapshot;
    assert.equal(latest.revision, 3);
    assert.ok([71, 81].includes(latest.backup.state.coins));
    assert.equal((await (await get('user_b')).json()).snapshot.backup.state.coins, 99);
    const duplicates = await Promise.all([
      put('user_a', intent(3, 'request_same_E', 91)),
      put('user_a', intent(3, 'request_same_E', 91))
    ]);
    assert.deepEqual(await duplicates[0].json(), await duplicates[1].json());
    assert.equal((await (await get('user_a')).json()).snapshot.revision, 4);
    const history = query({ queries: [{ sql: 'SELECT count(*) AS count FROM cloud_save_versions WHERE account_id = ?1', values: ['user_a'] }] });
    assert.equal(history[0].results[0].count, 4);
    const before = (await (await get('user_a')).json()).snapshot;
    assert.throws(() => query({ queries: [
      { sql: 'UPDATE cloud_saves SET revision = 999 WHERE account_id = ?1', values: ['user_a'] },
      { sql: 'INSERT INTO nonexistent_table VALUES (1)', values: [] }
    ] }));
    assert.deepEqual((await (await get('user_a')).json()).snapshot, before, 'batch error rolls back preceding mutation');
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});
