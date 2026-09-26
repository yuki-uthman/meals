import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// The single Supabase client, built from build-time public configuration.
//
// Only the project URL and the anon key are here, and both are safe to publish:
// row-level security, not key secrecy, is what separates two accounts. The
// service-role key never appears in a browser source.

const required = (name: string, value: unknown): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing build-time configuration: ${name}`);
  }
  return value;
};

export const createSupabaseClient = (): SupabaseClient =>
  createClient(
    required('VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL),
    required('VITE_SUPABASE_ANON_KEY', import.meta.env.VITE_SUPABASE_ANON_KEY),
    {
      auth: {
        // The client's own persisted session IS the session; the app keeps no
        // second copy to fall out of step with it.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    },
  );
