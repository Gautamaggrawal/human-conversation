import { getSupabase, isSupabaseConfigured } from './supabase';

// Empty = same origin (Vite proxy → Go). Override with VITE_API_URL if needed.
export const API_URL = import.meta.env.VITE_API_URL ?? '';

const TOKEN_KEY = 'hc_access_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  if (isSupabaseConfigured()) {
    void getSupabase().auth.signOut().catch(() => {});
  }
}

export async function api<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  let token = getToken();
  if (!token && isSupabaseConfigured()) {
    token = await refreshSessionIfNeeded();
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_URL}/api${path}`, { ...opts, headers });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export type AuthMode = 'supabase' | 'dev';

export function authMode(): AuthMode {
  return isSupabaseConfigured() ? 'supabase' : 'dev';
}

/** Send email OTP via Supabase, or no-op delay in local DEV_AUTH mode. */
export async function sendOTP(email: string): Promise<{ mode: AuthMode }> {
  sessionStorage.setItem('hc_pending_email', email);
  if (authMode() === 'dev') {
    await new Promise((r) => setTimeout(r, 400));
    return { mode: 'dev' };
  }
  const { error } = await getSupabase().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  if (error) throw error;
  return { mode: 'supabase' };
}

export async function verifyOTP(
  email: string,
  token: string,
): Promise<{ valid: boolean; expired?: boolean }> {
  // Supabase email OTP is often 8 digits; legacy/dev uses 6.
  if (!/^\d{6,8}$/.test(token)) return { valid: false };

  if (authMode() === 'dev') {
    // Local: any 6–8 digit code works except 000000 (expired demo)
    if (token === '000000') return { valid: false, expired: true };
    const res = await fetch(`${API_URL}/auth/dev-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) throw new Error('network');
    const data = await res.json();
    setToken(data.access_token);
    return { valid: true };
  }

  // email / magiclink for sign-in; signup for first-time confirm.
  let data: Awaited<ReturnType<ReturnType<typeof getSupabase>['auth']['verifyOtp']>>['data'] | null =
    null;
  let error: { message?: string } | null = null;
  for (const type of ['email', 'magiclink', 'signup'] as const) {
    const res = await getSupabase().auth.verifyOtp({ email, token, type });
    if (!res.error && res.data.session?.access_token) {
      data = res.data;
      error = null;
      break;
    }
    error = res.error;
    data = res.data;
  }
  if (error || !data?.session?.access_token) {
    const msg = (error?.message || '').toLowerCase();
    if (msg.includes('expired') || msg.includes('otp_expired')) {
      return { valid: false, expired: true };
    }
    if (msg.includes('invalid') || msg.includes('otp') || msg.includes('token')) {
      return { valid: false };
    }
    if (error) throw error;
    return { valid: false };
  }
  setToken(data.session.access_token);
  return { valid: true };
}

/**
 * After a magic-link / confirm-email redirect, pull the Supabase session into
 * localStorage so the Go API can use the access token.
 */
export async function consumeAuthRedirect(): Promise<boolean> {
  if (authMode() !== 'supabase') return false;
  const { data, error } = await getSupabase().auth.getSession();
  if (error || !data.session?.access_token) return false;
  setToken(data.session.access_token);
  // Drop tokens from the address bar.
  if (typeof window !== 'undefined' && (window.location.hash || window.location.search.includes('access_token'))) {
    window.history.replaceState({}, '', window.location.pathname);
  }
  return true;
}

/** Refresh access token from Supabase session if available. */
export async function refreshSessionIfNeeded(): Promise<string | null> {
  if (authMode() !== 'supabase') return getToken();
  const { data, error } = await getSupabase().auth.getSession();
  if (error || !data.session) return getToken();
  setToken(data.session.access_token);
  return data.session.access_token;
}

export async function updateProfile(displayName: string) {
  await api('/me', {
    method: 'PATCH',
    body: JSON.stringify({ display_name: displayName }),
  });
}

export type MeProfile = {
  id: string;
  email: string;
  role: string;
  display_name: string;
  phone?: string;
  bio?: string;
};

export async function fetchMe() {
  return api<MeProfile>('/me');
}

export async function ensureCredits(min = 100) {
  const token = getToken();
  if (!token) throw new Error('not authenticated');
  const w = (await api('/wallet')) as { available: number };
  if ((w.available ?? 0) < min) {
    await api('/wallet/purchase', {
      method: 'POST',
      body: JSON.stringify({ credits: Math.max(500, min) }),
    });
  }
}

export async function submitRating(opts: {
  callId: string;
  listenerId: string;
  rating: number;
  favorite: boolean;
  tags: string[];
}) {
  await api(`/calls/${opts.callId}/rating`, {
    method: 'POST',
    body: JSON.stringify({
      rating: opts.rating,
      listener_id: opts.listenerId,
      favorite: opts.favorite,
      tags: opts.tags,
    }),
  });
}

export type PersonDTO = {
  id: string;
  display_name: string;
  initials: string;
  color?: string;
  online?: boolean;
  busy?: boolean;
  status?: string;
  descriptor?: string;
};

export async function fetchAvailableListeners() {
  return api<{
    listeners: PersonDTO[];
    count: number;
    busy?: number;
    online?: number;
  }>('/listeners/available');
}

export async function fetchPresence() {
  return api<{ online: number; available: number; busy: number }>('/presence');
}

export async function fetchFavorites() {
  return api<{ favorites: { listener_id: string; display_name: string }[] }>('/me/favorites');
}

export async function fetchCalls() {
  return api<{
    calls: {
      id: string;
      listener_id?: string;
      other_name?: string;
      billable_seconds?: number;
      status: string;
      created_at: string;
    }[];
  }>('/me/calls');
}
