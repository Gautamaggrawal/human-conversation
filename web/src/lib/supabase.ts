import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? '';
const anon = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ?? '';

let client: SupabaseClient | null = null;

/** True when web is configured for real Supabase Email OTP. */
export function isSupabaseConfigured(): boolean {
  return Boolean(url && anon && !url.includes('YOUR_PROJECT'));
}

export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured');
  }
  if (!client) {
    client = createClient(url, anon, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Magic-link / confirm-email redirects land with tokens in the URL.
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}
