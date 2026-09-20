export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';
export const WS_URL = process.env.EXPO_PUBLIC_WS_URL ?? 'ws://localhost:8081/ws';
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const USE_DEV_AUTH = !SUPABASE_URL || process.env.EXPO_PUBLIC_DEV_AUTH === 'true';
