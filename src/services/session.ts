let token: string | null = null;
const KEY = 'panoramax_session_token';
const USER_KEY = 'panoramax_session_user';

export function getToken(): string | null {
  if (token) return token;
  token = sessionStorage.getItem(KEY);
  return token;
}

export function setToken(t: string) {
  token = t;
  sessionStorage.setItem(KEY, t);
}

export function clearToken() {
  token = null;
  sessionStorage.removeItem(KEY);
  sessionStorage.removeItem(USER_KEY);
}

export function getStoredUser(): BootUser | null {
  try {
    const raw = sessionStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) as BootUser : null;
  } catch {
    return null;
  }
}

export function setStoredUser(user: BootUser) {
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
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
