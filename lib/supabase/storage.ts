import { createInitialState, createPlan, type NegotiationPlan, type NegotiationState, type PlayerAction, type SessionReport, type SideProfile, type TurnSnapshot } from "@/app/negotiation";
import { getSupabase } from "./client";

export type StoredMessage = { role: "player" | "opponent"; text: string; turn: number; snapshot?: TurnSnapshot };
export type SessionSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: NegotiationState["status"];
  player: SideProfile;
  opponent: SideProfile;
  parentSessionId: string | null;
  branchedFromTurn: number | null;
  messageCount: number;
  correctionNumber: number;
};
export type LoadedSession = {
  id: string;
  player: SideProfile;
  opponent: SideProfile;
  plan: NegotiationPlan;
  state: NegotiationState;
  messages: StoredMessage[];
  parentSessionId: string | null;
  branchedFromTurn: number | null;
  correctionNumber: number;
  report: SessionReport | null;
};
export type SessionTimeline = SessionSummary & { messages: StoredMessage[] };

async function ensureUser() {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  if (data.user) return supabase;
  const { error } = await supabase.auth.signInAnonymously();
  return error ? null : supabase;
}

function normalizeState(value: Partial<NegotiationState> | null | undefined): NegotiationState {
  const initial = createInitialState();
  return { ...initial, ...(value ?? {}), matchedKeywords: Array.isArray(value?.matchedKeywords) ? value.matchedKeywords : [], memory: value?.memory ?? initial.memory };
}

function normalizeProfile(value: SideProfile): SideProfile {
  const side = value.side === "buyer" || value.side === "provider" || value.side === "neutral"
    ? value.side
    : /заказчик|покупатель|клиент/i.test(value.role) ? "buyer" : /дизайнер|исполнитель|подрядчик|поставщик|продавец|консультант|разработчик/i.test(value.role) ? "provider" : "neutral";
  return { ...value, side, speechStyle: value.speechStyle ?? "Деловой и прямой", habits: value.habits ?? "Иногда переспрашивает важные условия", languageStyle: value.languageStyle ?? "Без грубой лексики", emotionality: value.emotionality ?? "Сдержанная" };
}

function normalizePlan(value: unknown, player: SideProfile, opponent: SideProfile): NegotiationPlan {
  const base = createPlan(player, opponent);
  if (!value || typeof value !== "object") return base;
  const stored = value as Partial<NegotiationPlan> & { npcPrompt?: string };
  const route = Array.isArray(stored.route) && stored.route.length ? stored.route : base.route;
  return {
    opponentPrompt: stored.opponentPrompt ?? stored.npcPrompt ?? base.opponentPrompt,
    route,
    keywords: route.map((step) => step.id),
    maxMessages: typeof stored.maxMessages === "number" ? stored.maxMessages : base.maxMessages,
  };
}

function sessionTitle(player: SideProfile, opponent: SideProfile) {
  return `${player.role} — ${opponent.role}`.slice(0, 120);
}

export async function createSession(player: SideProfile, opponent: SideProfile, state: NegotiationState, openingMessage: string, plan: NegotiationPlan) {
  const supabase = await ensureUser(); if (!supabase) return null;
  const payload = { player, opponent, plan, current_state: state, status: state.status, title: sessionTitle(player, opponent) };
  const { data, error } = await supabase.from("negotiation_sessions").insert(payload).select("id").single();
  if (error || !data) return null;
  const openingAction = { type: "statement", label: "начало переговоров", rationale: "Исходное состояние оппонента.", before: state };
  const [messageResult, snapshotResult] = await Promise.all([
    supabase.from("negotiation_messages").insert({ session_id: data.id, turn: 0, role: "opponent", content: openingMessage }),
    supabase.from("negotiation_snapshots").insert({ session_id: data.id, turn: 0, state, action: openingAction }),
  ]);
  if (messageResult.error || snapshotResult.error) return null;
  return data.id as string;
}

export async function saveTurn(sessionId: string, playerText: string, opponentText: string, snapshot: TurnSnapshot) {
  const supabase = await ensureUser(); if (!supabase) return false;
  const { error } = await supabase.from("negotiation_messages").insert([
    { session_id: sessionId, turn: snapshot.turn, role: "player", content: playerText },
    { session_id: sessionId, turn: snapshot.turn, role: "opponent", content: opponentText },
  ]);
  if (error) return false;
  const action = { type: snapshot.action, label: snapshot.actionLabel, rationale: snapshot.rationale, before: snapshot.before, nonverbalCue: snapshot.nonverbalCue };
  const results = await Promise.all([
    supabase.from("negotiation_snapshots").insert({ session_id: sessionId, turn: snapshot.turn, state: snapshot.after, action }),
    supabase.from("negotiation_sessions").update({ current_state: snapshot.after, status: snapshot.after.status, updated_at: new Date().toISOString() }).eq("id", sessionId),
  ]);
  return results.every((result) => !result.error);
}

export async function listSessions(): Promise<SessionSummary[]> {
  const supabase = await ensureUser(); if (!supabase) return [];
  const { data, error } = await supabase
    .from("negotiation_sessions")
    .select("id,title,created_at,updated_at,status,player,opponent,parent_session_id,branched_from_turn,correction_number,negotiation_messages(count)")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  if (!data) return [];
  return data.map((row) => ({
    id: String(row.id),
    title: String(row.title || sessionTitle(row.player as SideProfile, row.opponent as SideProfile)),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at || row.created_at),
    status: row.status as NegotiationState["status"],
    player: normalizeProfile(row.player as SideProfile),
    opponent: normalizeProfile(row.opponent as SideProfile),
    parentSessionId: row.parent_session_id ? String(row.parent_session_id) : null,
    branchedFromTurn: typeof row.branched_from_turn === "number" ? row.branched_from_turn : null,
    messageCount: Array.isArray(row.negotiation_messages) ? Number(row.negotiation_messages[0]?.count ?? 0) : 0,
    correctionNumber: Number(row.correction_number ?? 0),
  }));
}

export async function loadSession(sessionId: string): Promise<LoadedSession | null> {
  const supabase = await ensureUser(); if (!supabase) return null;
  const [sessionResult, messagesResult, snapshotsResult] = await Promise.all([
    supabase.from("negotiation_sessions").select("id,player,opponent,plan,current_state,parent_session_id,branched_from_turn,correction_number,report").eq("id", sessionId).single(),
    supabase.from("negotiation_messages").select("id,turn,role,content").eq("session_id", sessionId).order("turn").order("id"),
    supabase.from("negotiation_snapshots").select("turn,state,action").eq("session_id", sessionId).order("turn"),
  ]);
  if (sessionResult.error || messagesResult.error || snapshotsResult.error || !sessionResult.data) return null;
  const session = sessionResult.data;
  const player = normalizeProfile(session.player as SideProfile);
  const opponent = normalizeProfile(session.opponent as SideProfile);
  const plan = normalizePlan(session.plan, player, opponent);
  let previous = createInitialState();
  const snapshots = new Map<number, TurnSnapshot>();
  for (const row of snapshotsResult.data ?? []) {
    const action = (row.action ?? {}) as { type?: PlayerAction; label?: string; rationale?: string; before?: NegotiationState };
    const after = normalizeState(row.state as Partial<NegotiationState>);
    const snapshot: TurnSnapshot = {
      turn: Number(row.turn),
      before: action.before ? normalizeState(action.before) : previous,
      after,
      action: action.type ?? "statement",
      actionLabel: action.label ?? "позиция",
      rationale: action.rationale,
      nonverbalCue: typeof (action as { nonverbalCue?: unknown }).nonverbalCue === "string" ? (action as { nonverbalCue: string }).nonverbalCue : undefined,
    };
    snapshots.set(snapshot.turn, snapshot);
    previous = after;
  }
  const messages: StoredMessage[] = (messagesResult.data ?? []).map((row) => ({
    role: row.role as StoredMessage["role"],
    text: String(row.content),
    turn: Number(row.turn),
    snapshot: snapshots.get(Number(row.turn)) ?? (Number(row.turn) === 0 ? { turn: 0, before: createInitialState(), after: createInitialState(), action: "statement", actionLabel: "начало переговоров" } : undefined),
  }));
  return {
    id: String(session.id), player, opponent, plan,
    state: normalizeState(session.current_state as Partial<NegotiationState>), messages,
    parentSessionId: session.parent_session_id ? String(session.parent_session_id) : null,
    branchedFromTurn: typeof session.branched_from_turn === "number" ? session.branched_from_turn : null,
    correctionNumber: Number(session.correction_number ?? 0),
    report: session.report as SessionReport | null,
  };
}

export async function listSessionTimelines(): Promise<SessionTimeline[]> {
  const summaries = await listSessions();
  const loaded = await Promise.all(summaries.map(async (summary) => {
    const session = await loadSession(summary.id);
    return session ? { ...summary, messages: session.messages } : null;
  }));
  return loaded.filter((session): session is SessionTimeline => Boolean(session));
}

export async function createBranchSession(sourceSessionId: string, fromTurn: number, player: SideProfile, opponent: SideProfile, plan: NegotiationPlan, baseState: NegotiationState) {
  const supabase = await ensureUser(); if (!supabase) return null;
  const { data: source, error: sourceError } = await supabase.from("negotiation_sessions").select("id,root_session_id").eq("id", sourceSessionId).single();
  if (sourceError || !source) return null;
  const rootId = source.root_session_id ? String(source.root_session_id) : sourceSessionId;
  const { count, error: countError } = await supabase.from("negotiation_sessions").select("id", { count: "exact", head: true }).eq("root_session_id", rootId);
  if (countError) return null;
  const correctionNumber = (count ?? 0) + 1;
  if (correctionNumber > 3) return { id: null, limitReached: true, correctionNumber: 3 };
  const { data: branch, error } = await supabase.from("negotiation_sessions").insert({
    player, opponent, plan, current_state: baseState, status: "active",
    title: `${sessionTitle(player, opponent)} · ветка ${fromTurn}`,
    parent_session_id: sourceSessionId,
    root_session_id: rootId,
    branched_from_turn: fromTurn,
    correction_number: correctionNumber,
  }).select("id").single();
  if (error || !branch) return null;
  const branchId = String(branch.id);
  const [messagesResult, snapshotsResult] = await Promise.all([
    supabase.from("negotiation_messages").select("id,turn,role,content").eq("session_id", sourceSessionId).lt("turn", fromTurn).order("turn").order("id"),
    supabase.from("negotiation_snapshots").select("turn,state,action").eq("session_id", sourceSessionId).lt("turn", fromTurn).order("turn"),
  ]);
  if (messagesResult.error || snapshotsResult.error) return null;
  const copiedMessages = (messagesResult.data ?? []).map((row) => ({ session_id: branchId, turn: row.turn, role: row.role, content: row.content }));
  const copiedSnapshots = (snapshotsResult.data ?? []).map((row) => ({ session_id: branchId, turn: row.turn, state: row.state, action: row.action }));
  const copies = await Promise.all([
    copiedMessages.length ? supabase.from("negotiation_messages").insert(copiedMessages) : Promise.resolve({ error: null }),
    copiedSnapshots.length ? supabase.from("negotiation_snapshots").insert(copiedSnapshots) : Promise.resolve({ error: null }),
  ]);
  if (copies.some((result) => result.error)) return null;
  return { id: branchId, limitReached: false, correctionNumber };
}

export async function saveSessionReport(sessionId: string, report: SessionReport) {
  const supabase = await ensureUser(); if (!supabase) return false;
  const { error } = await supabase.from("negotiation_sessions").update({ report, updated_at: new Date().toISOString() }).eq("id", sessionId);
  return !error;
}
