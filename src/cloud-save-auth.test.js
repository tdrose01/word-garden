import test from 'node:test';
import assert from 'node:assert/strict';
import { clerkDomain, createClerkAuth } from './cloud-save-auth.js';

const key = `pk_test_${btoa('accounts.example.com$')}`;
test('Clerk domain rejects URLs, ports and malformed publishable keys', () => {
  assert.equal(clerkDomain(key), 'accounts.example.com');
  for (const value of ['', 'secret_key', `pk_test_${btoa('https://example.com$')}`, `pk_test_${btoa('example.com:443$')}`, `pk_test_${btoa('example.com')}`]) {
    assert.throws(() => clerkDomain(value), /not configured/);
  }
});
test('auth loads only after explicit sign-in and binds tokens to the chosen session', async () => {
  const loads = [];
  let emitted;
  const clerk = { user: { id: 'user_a' }, session: { user: { id: 'user_a' }, getToken: async () => 'token_a' },
    load: async () => {}, addListener(callback) { emitted = callback; return () => {}; }, signOut: async () => { clerk.session = null; emitted(); } };
  const auth = createClerkAuth({ publishableKey: key, document: {}, window: { Clerk: clerk }, load: async (...args) => loads.push(args) });
  assert.equal(loads.length, 0);
  assert.equal(auth.getSubject(), null);
  assert.deepEqual(await auth.signIn(), { subject: 'user_a' });
  assert.equal(loads.length, 2);
  assert.match(loads[0][1], /\/npm\/@clerk\/ui@1\/dist\/ui.browser.js$/);
  assert.match(loads[1][1], /\/npm\/@clerk\/clerk-js@6\/dist\/clerk.browser.js$/);
  assert.equal(await auth.getToken('user_a'), 'token_a');
  let finish;
  clerk.session.getToken = () => new Promise(resolve => { finish = resolve; });
  const pending = auth.getToken('user_a');
  clerk.session = { user: { id: 'user_b' }, getToken: async () => 'token_b' };
  finish('token_a');
  await assert.rejects(pending, /account changed/);
  await assert.rejects(auth.getToken('user_a'), /account changed/);
  let sessionNotice;
  auth.subscribe(value => { sessionNotice = value; });
  await auth.signOut();
  assert.equal(sessionNotice, null);
});
test('sign-out cancels a pending SDK load before a sign-in modal can appear', async () => {
  let finishLoad;
  let calls = 0;
  const auth = createClerkAuth({ publishableKey: key, document: {}, window: { Clerk: {
    load: async () => {}, addListener: () => () => {}, mountSignIn() { throw new Error('Cancelled sign-in must not mount'); }
  } }, load: async () => { if (++calls === 1) await new Promise(resolve => { finishLoad = resolve; }); } });
  const pending = auth.signIn();
  await auth.signOut();
  finishLoad();
  await assert.rejects(pending, /cancelled/);
});
