const DEFAULT_ENDPOINT = '/api/cloud-save';

export class CloudSaveApiError extends Error {
  constructor(message, { status = 0, code = 'unknown', snapshot = null } = {}) {
    super(message);
    this.name = 'CloudSaveApiError';
    this.status = status;
    this.code = code;
    this.snapshot = snapshot;
  }
}

async function responseBody(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function createCloudSaveApi({ getToken, fetchImpl = fetch, endpoint = DEFAULT_ENDPOINT }) {
  if (typeof getToken !== 'function' || typeof fetchImpl !== 'function') {
    throw new TypeError('Cloud save requires token and fetch providers.');
  }

  async function request(method, body) {
    const token = await getToken();
    if (!token) throw new CloudSaveApiError('Sign in is required.', { status: 401, code: 'signed-out' });
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body ? { 'content-type': 'application/json' } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
    } catch {
      throw new CloudSaveApiError('Cloud backup is offline. Progress is still saved on this device.', {
        code: 'offline'
      });
    }

    const payload = await responseBody(response);
    if (response.ok) return payload;
    if (response.status === 404 && method === 'GET') return null;
    if (response.status === 409 && payload?.snapshot) {
      throw new CloudSaveApiError('Cloud progress changed on another device.', {
        status: 409, code: 'conflict', snapshot: payload.snapshot
      });
    }
    const code = response.status === 401 ? 'signed-out' :
      response.status === 413 ? 'too-large' :
      response.status === 429 ? 'rate-limited' :
      response.status >= 500 ? 'unavailable' : 'invalid';
    throw new CloudSaveApiError(payload?.error || 'Cloud backup failed. Local progress is unchanged.', {
      status: response.status,
      code
    });
  }

  return {
    get: async () => (await request('GET'))?.snapshot ?? null,
    put: (writeIntent) => request('PUT', writeIntent)
  };
}
