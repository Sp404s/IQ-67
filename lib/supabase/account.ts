import type { User } from "@supabase/supabase-js";
import type { SideProfile } from "@/app/negotiation";
import { getSupabase } from "./client";

export type AccountProfile = { user: User; profile: SideProfile | null };

export async function getAccount(): Promise<AccountProfile | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("profile").eq("id", user.id).maybeSingle();
  return { user, profile: data?.profile as SideProfile | null };
}

export async function signIn(email: string, password: string) {
  const supabase = getSupabase();
  if (!supabase) return { error: "Supabase не настроен." };
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return { error: error?.message ?? null };
}

export async function signUp(email: string, password: string) {
  const supabase = getSupabase();
  if (!supabase) return { error: "Supabase не настроен.", confirmationRequired: false };
  const { data, error } = await supabase.auth.signUp({ email, password });
  return { error: error?.message ?? null, confirmationRequired: Boolean(data.user && !data.session) };
}

export async function signOut() {
  await getSupabase()?.auth.signOut();
}

export async function saveAccountProfile(profile: SideProfile) {
  const supabase = getSupabase();
  if (!supabase) return { error: "Supabase не настроен." };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Войдите в аккаунт." };
  const { error } = await supabase.from("profiles").upsert({ id: user.id, profile, updated_at: new Date().toISOString() });
  return { error: error?.message ?? null };
}
