let token: string | null = null;
const KEY = 'panoramax_session_token';
const USER_KEY = 'panoramax_session_user';

// Persist in localStorage (NOT sessionStorage) so that closing the tab and
// reopening offline still restores the session. The token is re-validated
// against the server on the next online request; an expired token simply
// triggers the 401 → SSO redirect path in api.ts once back online.

export function getToken(): string | null {
  if (token) return token;
  token = localStorage.getItem(KEY);
  return token;
}

export function setToken(t: string) {
  token = t;
  localStorage.setItem(KEY, t);
}

export function clearToken() {
  token = null;
  localStorage.removeItem(KEY);
  localStorage.removeItem(USER_KEY);
}

export function getStoredUser(): BootUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) as BootUser : null;
  } catch {
    return null;
  }
}

export function setStoredUser(user: BootUser) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export interface BootUser {
  id: string;
  username: string;
  role: string;
  createdAt: string;
}

export async function bootstrapSession(): Promise<BootUser | null> {
  try {
    const base = import.meta.env.BASE_URL.replace(/\/$/, '');
    const res = await fetch(`${base}/api/auth/me`, { credentials: 'same-origin' });
    if (!res.ok) {
      // Server returned an error (401, 503 from SW when offline, etc.).
      // If we still have a token + stored user from a previous online
      // session, treat the session as still valid so the app boots into
      // the review UI. The token will be re-validated against the server
      // on the next online request.
      if (getToken()) {
        return getStoredUser();
      }
      return null;
    }
    const data = await res.json();
    if (data.token) setToken(data.token);
    if (data.user) setStoredUser(data.user as BootUser);
    return data.user || null;
  } catch {
    // Network failure (e.g. offline, no service worker). Same fallback: if
    // we still have a token + stored user, treat the session as valid.
    if (getToken()) {
      return getStoredUser();
    }
    return null;
  }
}
