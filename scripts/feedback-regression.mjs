import assert from 'node:assert/strict';
import { onRequestOptions, onRequestPost, __test } from '../functions/api/feedback.js';

const allowedOrigin = 'http://127.0.0.1:5173';
const validPayload = {
  category: 'bug',
  device: 'Pixel 9 Android 16',
  browser: 'Chrome 126',
  build: '0.1.0-test',
  mode: 'campaign',
  level: 'Level 3/60 - Orchard (Seedling Path)',
  performance: 'Smooth',
  report: 'Solved word stayed blank after reopening the daily puzzle.'
};

function feedbackRequest(body, origin = allowedOrigin) {
  return new Request('https://word-garden.pages.dev/api/feedback', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin
    },
    body: JSON.stringify(body)
  });
}

const originalFetch = globalThis.fetch;

try {
  const preflight = await onRequestOptions({
    request: new Request('https://word-garden.pages.dev/api/feedback', {
      method: 'OPTIONS',
      headers: { origin: allowedOrigin }
    }),
    env: {}
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), allowedOrigin);

  const blocked = await onRequestPost({
    request: feedbackRequest(validPayload, 'https://example.com'),
    env: { GITHUB_TOKEN: 'test-token' }
  });
  assert.equal(blocked.status, 403);

  const invalidCategory = await onRequestPost({
    request: feedbackRequest({ ...validPayload, category: 'other' }),
    env: { GITHUB_TOKEN: 'test-token' }
  });
  assert.equal(invalidCategory.status, 400);
  assert.equal((await invalidCategory.json()).ok, false);

  const invalidMode = await onRequestPost({
    request: feedbackRequest({ ...validPayload, mode: 'arcade' }),
    env: { GITHUB_TOKEN: 'test-token' }
  });
  assert.equal(invalidMode.status, 400);

  let githubRequest = null;
  globalThis.fetch = async (url, init) => {
    githubRequest = { url, init };
    return new Response(JSON.stringify({ html_url: 'https://github.com/tdrose01/word-garden/issues/99' }), {
      status: 201,
      headers: { 'content-type': 'application/json' }
    });
  };

  const created = await onRequestPost({
    request: feedbackRequest(validPayload),
    env: { GITHUB_TOKEN: 'test-token' }
  });
  assert.equal(created.status, 201);
  assert.equal(created.headers.get('access-control-allow-origin'), allowedOrigin);
  assert.equal(githubRequest.url, 'https://api.github.com/repos/tdrose01/word-garden/issues');
  assert.equal(githubRequest.init.headers.authorization, 'Bearer test-token');
  const createdBody = JSON.parse(githubRequest.init.body);
  assert.equal(createdBody.title, '[Playtest]: Bug - campaign - Level 3/60 - Orchard (Seedling Path)');
  assert.deepEqual(createdBody.labels, ['type:test', 'area:testing', 'closed-test', 'word-garden']);
  assert.match(createdBody.body, /Word Garden Tester Report/);
  assert.match(createdBody.body, /Solved word stayed blank/);
  const createdResponse = await created.json();
  assert.equal(createdResponse.issueUrl, 'https://github.com/tdrose01/word-garden/issues/99');
  assert.equal(JSON.stringify(createdResponse).includes('test-token'), false);

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: 'rate limited' }), {
      status: 403,
      headers: { 'content-type': 'application/json' }
    });
  const fallback = await onRequestPost({
    request: feedbackRequest(validPayload),
    env: { GITHUB_TOKEN: 'test-token' }
  });
  assert.equal(fallback.status, 429);
  const fallbackBody = await fallback.json();
  assert.equal(fallbackBody.ok, false);
  assert.match(fallbackBody.draftUrl, /^https:\/\/github.com\/tdrose01\/word-garden\/issues\/new\?/);
  assert.match(new URL(fallbackBody.draftUrl).searchParams.get('body'), /Word Garden Tester Report/);
  assert.equal(JSON.stringify(fallbackBody).includes('test-token'), false);

  const noToken = await onRequestPost({
    request: feedbackRequest(validPayload),
    env: {}
  });
  assert.equal(noToken.status, 503);
  assert.match((await noToken.json()).draftUrl, /^https:\/\/github.com\/tdrose01\/word-garden\/issues\/new\?/);

  const validated = __test.validatePayload({ ...validPayload, report: 'x'.repeat(3000) });
  assert.equal(validated.payload.report.length, 2500);

  console.log('feedback regression passed');
} finally {
  globalThis.fetch = originalFetch;
}
