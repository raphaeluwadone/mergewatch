const API = 'https://api.github.com';

export class GithubAuthError extends Error {}
export class GithubHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export class GithubNotFoundError extends Error {}
export class GithubForbiddenError extends Error {}
export class GithubRateLimitError extends Error {
  constructor(public resetAt: Date) {
    super(`GitHub rate limit until ${resetAt.toISOString()}`);
  }
}

function rateLimitReset(res: Response): Date | null {
  const retryAfter = res.headers.get('retry-after');
  if (retryAfter) return new Date(Date.now() + Number(retryAfter) * 1000);
  if (res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    if (reset) return new Date(reset * 1000);
  }
  return null;
}

async function request(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'mergewatch',
      ...init.headers,
    },
  });
  if (res.status === 401) throw new GithubAuthError('GitHub token rejected');
  if (res.status === 403 || res.status === 429) {
    const reset = rateLimitReset(res);
    if (reset) throw new GithubRateLimitError(reset);
    throw new GithubForbiddenError(`GitHub returned ${res.status} for ${new URL(url).pathname}`);
  }
  if (res.status === 404) throw new GithubNotFoundError(`Not found: ${new URL(url).pathname}`);
  if (!res.ok) throw new GithubHttpError(res.status, `GitHub ${res.status} for ${new URL(url).pathname}`);
  return res;
}

export async function rest<T>(token: string, path: string): Promise<T> {
  const res = await request(token, `${API}${path}`);
  return (await res.json()) as T;
}

/** A write call. Only the merge and branch-delete routes use this; everything else reads. */
export async function restSend<T>(token: string, method: 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T | null> {
  const res = await request(token, `${API}${path}`, {
    method,
    ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : null;
}

export async function restText(token: string, path: string): Promise<string> {
  const res = await request(token, `${API}${path}`);
  return res.text();
}

interface GraphqlError {
  type?: string;
  message: string;
}

export async function graphql<T>(token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await request(token, `${API}/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json()) as { data?: T; errors?: GraphqlError[] };
  const errors = body.errors ?? [];
  if (errors.some((e) => e.type === 'RATE_LIMITED')) {
    throw new GithubRateLimitError(rateLimitReset(res) ?? new Date(Date.now() + 60_000));
  }
  // NOT_FOUND on one node of a batch still returns data for the rest, so only fail when nothing came back.
  if (!body.data) {
    if (errors.some((e) => e.type === 'NOT_FOUND')) throw new GithubNotFoundError(errors[0]!.message);
    throw new Error(`GitHub GraphQL error: ${errors.map((e) => e.message).join('; ')}`);
  }
  return body.data;
}

export class GithubMutationError extends Error {
  constructor(public messages: string[]) {
    super(messages.join('; '));
  }
}

/** For mutations: any error means it didn't happen, even if GitHub returned partial data. */
export async function graphqlStrict<T>(token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await request(token, `${API}/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json()) as { data?: T; errors?: GraphqlError[] };
  if (body.errors?.length || !body.data) throw new GithubMutationError((body.errors ?? []).map((e) => e.message));
  return body.data;
}
