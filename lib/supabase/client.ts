import { createClient, type SupabaseClient } from "@supabase/supabase-js";
let client: SupabaseClient | null | undefined;
export function getSupabase() {
  if (client !== undefined) return client;
  // The project URL is public configuration. Keep the fallback so the browser
  // can still connect when Vercel mistakenly stores NEXT_PUBLIC_SUPABASE_URL
  // as a write-only Secret instead of Config.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dxwtqqbkbqvvwmwoihpt.supabase.co";
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    || "sb_publishable_GL__LrjIFc211LIp4VTQvg_e_NmNWoo";
  client = url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } }) : null;
  return client;
}
