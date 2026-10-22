/**
 * Shared HTTP plumbing for the party remote.
 *
 * Every request is tenant scoped. Problem responses keep their HTTP status,
 * stable code, and body on the thrown Error so a section can contain a
 * conflict or a validation failure without parsing the message text.
 */
export const TENANT = '11111111-1111-7111-8111-111111111111';

export function problemMessage(body, fallback) {
  if (!body || typeof body !== 'object') return fallback;
  const summary = body.message || body.detail || body.title || fallback;
  const details = [];
  if (body.details && typeof body.details === 'object' && !Array.isArray(body.details)) {
    for (const [field, message] of Object.entries(body.details)) {
      details.push(`${field}: ${message}`);
    }
  }
  if (Array.isArray(body.errors)) {
    for (const error of body.errors) {
      details.push(`${error.field || 'request'}: ${error.message || error.code || 'is invalid'}`);
    }
  }
  return details.length > 0 ? `${summary} (${details.join('; ')})` : summary;
}

export async function api(path, options = {}) {
  const headers = { 'X-EIA-Tenant': TENANT };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.book) headers['X-EIA-Book'] = options.book;
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(problemMessage(body, `Request failed: ${response.status}`));
    error.status = response.status;
    error.code = body?.code;
    error.body = body;
    throw error;
  }
  return body;
}
