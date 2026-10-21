export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`Request failed with ${status}`);
  }
}

/** The custom header is the server's CSRF guard for state-changing calls. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? 'GET',
    credentials: 'same-origin',
    headers: { 'x-mergewatch': '1', ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

export const post = <T = { ok: true }>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} });
export const put = <T>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body });
