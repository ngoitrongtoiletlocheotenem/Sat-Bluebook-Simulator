let csrfToken = '';
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}
export function json(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.method && options.method !== 'GET') headers.set('X-CSRF-Token', csrfToken);
  const response = await fetch(path.startsWith('/api/') ? path : `/api${path}`, {
    ...options,
    headers,
    credentials: 'same-origin',
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({ error: 'The server returned an unreadable response.' }));
  if (!response.ok)
    throw new ApiError(
      typeof data.error === 'string' ? data.error : 'Something went wrong. Please try again.',
      response.status,
      typeof data.code === 'string' ? data.code : undefined,
    );
  if (data.csrfToken) csrfToken = data.csrfToken;
  return data as T;
}
export async function download(path: string, filename: string) {
  const response = await fetch(path.startsWith('/api/') ? path : `/api${path}`, {
    credentials: 'same-origin',
  });
  if (!response.ok) throw new Error('Download failed.');
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
