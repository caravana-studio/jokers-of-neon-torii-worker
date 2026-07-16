import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../env.js';

let client: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(
    env.SUPABASE_URL &&
    (env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY)
  );
}

export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error(
      'Supabase is not configured (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY)'
    );
  }
  if (!client) {
    client = createClient(
      env.SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    );
  }
  return client;
}

if (!isSupabaseConfigured()) {
  console.warn(
    `[supabase] configured=false queueMemoryOnly=${env.TRANSACTION_QUEUE_ENABLED} required=SUPABASE_URL+(SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ANON_KEY)`
  );
}

/** @deprecated Prefer getSupabase() — lazy; only valid when configured */
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const resolved = getSupabase();
    const value = resolved[prop as keyof SupabaseClient];
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(resolved) : value;
  },
});
