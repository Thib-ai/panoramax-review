let token: string | null = null;
const KEY = 'panoramax_session_token';

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
}

export interface BootUser {
  id: string;
  username: string;
  role: string;
  createdAt: string;
}

export async function bootstrapSession(): Promise<BootUser | null> {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.token) setToken(data.token);
    return data.user || null;
  } catch {
    return null;
  }
}
