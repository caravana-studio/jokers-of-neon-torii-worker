import { createClient } from '@supabase/supabase-js';
import { env } from '../env.js';

if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
  console.warn('⚠️  Supabase configuration incomplete');
  console.warn('⚠️  Transaction queue will work in memory-only mode');
  console.log('Required variables: SUPABASE_URL, SUPABASE_ANON_KEY');
}

export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
