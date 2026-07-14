const REPO_OWNER = 'tdrose01';
const REPO_NAME = 'word-garden';
const GITHUB_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues`;
const GITHUB_ISSUE_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/issues/new`;
const ISSUE_LABELS = ['type:test', 'area:testing', 'closed-test', 'word-garden'];
const MAX_JSON_BYTES = 8192;
const MAX_REPORT_BYTES = 4096;
const MAX_FIELD_LENGTH = 180;
const MAX_REPORT_LENGTH = 2500;
const VALID_CATEGORIES = new Map([
  ['bug', 'Bug'],
  ['puzzle', 'Puzzle'],
  ['controls', 'Controls'],
  ['performance', 'Performance'],
  ['idea', 'Idea']
]);
const VALID_MODES = new Set(['campaign', 'daily']);
const SAFE_LOCAL_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):(?:4173|5173|8788)$/;
const DEFAULT_ALLOWED_ORIGINS = new Set(['https://word-garden.pages.dev']);

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

function getAllowedOrigins(env = {}) {
  const origins = new Set(DEFAULT_ALLOWED_ORIGINS);
  for (const value of String(env.ALLOWED_FEEDBACK_ORIGINS || '').split(',')) {
    const origin = value.trim();
    if (/^https:\/\/[a-z0-9.-]+$/i.test(origin) || SAFE_LOCAL_ORIGIN.test(origin)) {
      origins.add(origin);
    }
  }
  return origins;
}

function getAllowedOrigin(request, env) {
  const origin = request.headers.get('origin') || '';
  if (!origin) return null;
  if (SAFE_LOCAL_ORIGIN.test(origin)) return origin;
  if (getAllowedOrigins(env).has(origin)) return origin;
  return null;
}

function sanitizeText(value, maxLength = MAX_FIELD_LENGTH) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function sanitizeReport(value) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, MAX_REPORT_LENGTH);
}

function buildReport(payload) {
  return [
    'Word Garden Tester Report',
    `Category: ${payload.categoryLabel}`,
    `Device: ${payload.device}`,
    `Browser: ${payload.browser}`,
    `Build: ${payload.build}`,
    `Mode: ${payload.mode}`,
    `Mode / level: ${payload.level}`,
    `Performance: ${payload.performance || 'Not provided'}`,
    '',
    'Report:',
    payload.report
  ].join('\n');
}

function buildDraftUrl(payload) {
  const params = new URLSearchParams({
    title: `[Playtest]: ${payload.categoryLabel} - ${payload.mode} - ${payload.level}`,
    labels: ISSUE_LABELS.join(','),
    body: buildReport(payload)
  });
  return `${GITHUB_ISSUE_URL}?${params.toString()}`;
}

function validatePayload(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Payload must be a JSON object.' };
  }

  const categoryValue = sanitizeText(input.category, 32).toLowerCase();
  const categoryLabel = VALID_CATEGORIES.get(categoryValue);
  if (!categoryLabel) return { error: 'Category is invalid.' };

  const mode = sanitizeText(input.mode, 32).toLowerCase();
  if (!VALID_MODES.has(mode)) return { error: 'Mode is invalid.' };

  const payload = {
    category: categoryValue,
    categoryLabel,
    device: sanitizeText(input.device),
    browser: sanitizeText(input.browser),
    build: sanitizeText(input.build),
    mode,
    level: sanitizeText(input.level),
    performance: sanitizeText(input.performance),
    report: sanitizeReport(input.report)
  };

  for (const key of ['device', 'browser', 'build', 'level', 'report']) {
    if (!payload[key]) return { error: `${key} is required.` };
  }

  if (new TextEncoder().encode(payload.report).length > MAX_REPORT_BYTES) {
    return { error: 'Report is too large.' };
  }

  return { payload };
}

async function parsePayload(request) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return { error: 'Content-Type must be application/json.' };
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_JSON_BYTES) {
    return { error: 'Payload is too large.' };
  }

  try {
    return validatePayload(JSON.parse(raw));
  } catch {
    return { error: 'Payload must be valid JSON.' };
  }
}

function buildGitHubIssue(payload) {
  return {
    title: `[Playtest]: ${payload.categoryLabel} - ${payload.mode} - ${payload.level}`,
    body: buildReport(payload),
    labels: ISSUE_LABELS
  };
}

async function createGitHubIssue(payload, env) {
  const token = env.GITHUB_TOKEN || env.GH_TOKEN;
  if (!token) return { ok: false, status: 503, error: 'GitHub token is not configured.' };

  const response = await fetch(GITHUB_API_URL, {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'word-garden-feedback',
      'x-github-api-version': '2022-11-28'
    },
    body: JSON.stringify(buildGitHubIssue(payload))
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status === 403 || response.status === 429 ? 429 : 502,
      error: 'GitHub issue creation failed.'
    };
  }

  if (!body?.html_url || typeof body.html_url !== 'string') {
    return { ok: false, status: 502, error: 'GitHub response did not include an issue URL.' };
  }

  return { ok: true, issueUrl: body.html_url };
}

export async function onRequestOptions({ request, env }) {
  const origin = getAllowedOrigin(request, env);
  if (!origin) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '600',
      'cache-control': 'no-store',
      vary: 'Origin'
    }
  });
}

export async function onRequestPost({ request, env }) {
  const origin = getAllowedOrigin(request, env);
  if (!origin) return jsonResponse({ ok: false, error: 'Origin is not allowed.' }, 403);

  const parsed = await parsePayload(request);
  if (parsed.error) return jsonResponse({ ok: false, error: parsed.error }, 400, origin);

  const draftUrl = buildDraftUrl(parsed.payload);
  try {
    const result = await createGitHubIssue(parsed.payload, env || {});
    if (result.ok) return jsonResponse({ ok: true, issueUrl: result.issueUrl, draftUrl }, 201, origin);
    return jsonResponse({ ok: false, error: result.error, draftUrl }, result.status, origin);
  } catch {
    return jsonResponse({ ok: false, error: 'GitHub issue creation failed.', draftUrl }, 502, origin);
  }
}

export const __test = {
  buildDraftUrl,
  buildGitHubIssue,
  getAllowedOrigin,
  validatePayload
};
