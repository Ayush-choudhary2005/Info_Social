import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  // Surfaces a clear error in the browser console instead of a silent failure
  // if .env.local hasn't been filled in yet.
  console.warn(
    'Supabase env vars are missing. Copy .env.example to .env.local and fill in the NEXT_PUBLIC_ values.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
