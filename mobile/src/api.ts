import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL, SUPABASE_ANON_KEY, SUPABASE_URL, USE_DEV_AUTH } from './config';
import { createClient } from '@supabase/supabase-js';

const TOKEN_KEY = 'hc_access_token';

export const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function setToken(token: string) {
  await AsyncStorage.setItem(TOKEN_KEY, token);
}

export async function clearToken() {
  await AsyncStorage.removeItem(TOKEN_KEY);
}

export async function api<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_URL}/api${path}`, { ...opts, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json();
}

/** Super-simple auth: email OTP via Supabase, or dev-login when no Supabase. */
export async function requestEmailOtp(email: string) {
  if (USE_DEV_AUTH || !supabase) {
    return { mode: 'dev' as const };
  }
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  if (error) throw error;
  return { mode: 'otp' as const };
}

export async function verifyEmailOtp(email: string, token: string) {
  if (USE_DEV_AUTH || !supabase) {
    const res = await fetch(`${API_URL}/auth/dev-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'login failed');
    await setToken(data.access_token);
    return data;
  }
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: 'email',
  });
  if (error) throw error;
  const access = data.session?.access_token;
  if (!access) throw new Error('no session');
  await setToken(access);
  return data;
}
