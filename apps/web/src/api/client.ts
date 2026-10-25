export class UnauthorizedError extends Error {
  constructor() {
    super('unauthorized');
    this.name = 'UnauthorizedError';
  }
}

let onUnauthorized: () => void = () => {};

/** Registers what happens after any API call answers 401 (the app shows the login form). */
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

/** Every web API call goes through here so a 401 always ends up at the login form. */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(path, { credentials: 'same-origin', ...init });
  if (response.status === 401) {
    onUnauthorized();
    throw new UnauthorizedError();
  }
  return response;
}
