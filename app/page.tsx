"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { applySemanticEvaluation, createInitialState, type Difficulty, type NegotiationPlan, type NegotiationState, type SemanticEvaluation, type SessionReport, type SideProfile } from "./negotiation";
import { createBranchSession, createSession, listSessionTimelines, loadSession, saveSessionReport, saveTurn, type SessionSummary, type SessionTimeline, type StoredMessage } from "@/lib/supabase/storage";
import { getAccount, resendConfirmation, saveAccountProfile, signIn, signOut, signUp } from "@/lib/supabase/account";
import { getSupabase } from "@/lib/supabase/client";

type Screen = "home" | "workspace" | "talk" | "result" | "history" | "results" | "profile" | "settings";
type Message = StoredMessage;
type RewritePoint = { turn: number; text: string };

const characterOptions = ["Уверенный и деловой", "Осторожный и недоверчивый", "Требовательный и прямолинейный", "Дружелюбный и открытый", "Аналитичный и сдержанный"];
const motivationOptions = ["Снизить риск неудачного проекта", "Запустить проект раньше конкурентов", "Уложиться в утверждённый бюджет", "Показать руководству сильный результат", "Найти надёжного партнёра надолго", "Избежать личной ответственности за ошибку", "Освободить команду от лишней нагрузки", "Получить доказуемый результат", "Сохранить контроль над проектом", "Ускорить принятие решения"];
const boundaryOptions = ["Бюджет фиксирован, превышение невозможно", "Срок запуска нельзя переносить", "Предоплата должна быть минимальной", "Решение возможно только после подтверждения руководителя", "Качество важнее цены, но результат должен быть измеримым"];
const interestOptions = ["Хочет получить дополнительный объём работ без доплаты", "Готов заплатить больше за снижение риска", "Боится выглядеть некомпетентным перед руководством", "Ищет исполнителя для следующих проектов", "Хочет увидеть быстрый первый результат", "Сравнивает предложение с более дешёвым конкурентом", "Хочет разделить оплату на этапы", "Нуждается в аргументах для партнёра", "Проверяет способность исполнителя держать слово", "Готов расширить проект после успешного старта"];
const speechOptions = ["Коротко и по делу", "Подробно и аналитично", "Мягко и дипломатично", "Жёстко и прямолинейно", "Осторожно, часто уточняет"];
const habitOptions = ["Часто переспрашивает важные условия", "Возвращается к цифрам и срокам", "Делает паузу перед решением", "Использует примеры из опыта", "Иногда перебивает и требует конкретики"];
const languageOptions = ["Только нейтральная лексика", "Допускает разговорные выражения", "При раздражении может использовать резкие слова"];
const opponentGoalOptions = ["Выбрать надёжного специалиста и согласовать условия проекта.", "Снизить стоимость работ без потери качества.", "Получить гарантии соблюдения сроков и прозрачный план работы.", "Проверить компетентность исполнителя перед заключением договора.", "Согласовать небольшой тестовый этап перед основным проектом."];
const randomOpponents = [{ name: "Андрей", patronymic: "Михайлович", role: "Владелец небольшой компании" }, { name: "Елена", patronymic: "Викторовна", role: "Руководитель отдела маркетинга" }, { name: "Игорь", patronymic: "Алексеевич", role: "Предприниматель и заказчик проекта" }, { name: "Марина", patronymic: "Олеговна", role: "Директор по развитию" }];
const initialPlayer: SideProfile = { name: "", patronymic: "", side: "provider", role: "", goal: "", services: "", experienceStrengths: "", boundaries: "", person: "", motivation: "Развить навыки переговоров", character: characterOptions[0], hiddenInterest: "", speechStyle: speechOptions[0], habits: habitOptions[1], languageStyle: languageOptions[0], emotionality: "", difficulty: "normal", skillIds: [], situationTags: [] };
const initialOpponent: SideProfile = { name: "Андрей", patronymic: "Михайлович", side: "buyer", role: "Заказчик дизайн-проекта", goal: "Выбрать надёжного дизайнера и согласовать условия проекта.", boundaries: boundaryOptions[0], person: "", motivation: motivationOptions[2], character: characterOptions[1], hiddenInterest: interestOptions[4], speechStyle: speechOptions[4], habits: habitOptions[2], languageStyle: languageOptions[0], emotionality: "", difficulty: "normal", skillIds: [], situationTags: [] };
const pick = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)];
function storedPlayerProfile() {
  if (typeof window === "undefined") return initialPlayer;
  try { const stored = window.localStorage.getItem("negotiation-player-profile"); return stored ? { ...initialPlayer, ...JSON.parse(stored) as SideProfile } : initialPlayer; }
  catch { return initialPlayer; }
}

export default function Home() {
  const [accountUser, setAccountUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileReady, setProfileReady] = useState(false);
  const [profileSaveState, setProfileSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [screen, setScreen] = useState<Screen>("home");
  const [profile, setProfile] = useState<SideProfile>(storedPlayerProfile);
  const [player, setPlayer] = useState<SideProfile>(storedPlayerProfile), [opponent, setOpponent] = useState(initialOpponent);
  const [plan, setPlan] = useState<NegotiationPlan | null>(null), [preparing, setPreparing] = useState(false);
  const [state, setState] = useState<NegotiationState>(() => createInitialState());
  const [messages, setMessages] = useState<Message[]>([]), [draft, setDraft] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null), [, setSaveState] = useState<"local" | "saving" | "saved">("local");
  const [thinking, setThinking] = useState(false), [aiError, setAiError] = useState("");
  const [voiceListening, setVoiceListening] = useState(false);
  const [suggestionUses, setSuggestionUses] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]), [historyLoading, setHistoryLoading] = useState(false), [historyError, setHistoryError] = useState("");
  const [timelines, setTimelines] = useState<SessionTimeline[]>([]);
  const [rewrite, setRewrite] = useState<RewritePoint | null>(null);
  const [branchInfo, setBranchInfo] = useState<{ parentSessionId: string | null; branchedFromTurn: number | null; correctionNumber: number }>({ parentSessionId: null, branchedFromTurn: null, correctionNumber: 0 });
  const [report, setReport] = useState<SessionReport | null>(null), [reportLoading, setReportLoading] = useState(false);

  const lastSnapshot = useMemo(() => [...messages].reverse().find((message) => message.snapshot)?.snapshot, [messages]);
  const sessionNames = useMemo(() => new Map(sessions.map((session) => [session.id, session.title])), [sessions]);

  useEffect(() => {
    let active = true;
    const hydrateAccount = async () => {
      const account = await getAccount();
      if (!active) return;
      setAccountUser(account?.user ?? null);
      if (account?.profile) {
        const loaded = { ...initialPlayer, ...account.profile };
        setProfile(loaded); setPlayer(loaded);
        if (!loaded.name || !loaded.role || !loaded.services) setScreen("profile");
      } else if (account?.user) {
        setScreen("profile");
      }
      setProfileReady(Boolean(account?.user));
      setAuthLoading(false);
    };
    void hydrateAccount();
    const listener = getSupabase()?.auth.onAuthStateChange(() => { void hydrateAccount(); });
    return () => { active = false; listener?.data.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    window.localStorage.setItem("negotiation-player-profile", JSON.stringify(profile));
    if (!accountUser || !profileReady) return;
    const timeout = window.setTimeout(async () => {
      const result = await saveAccountProfile(profile);
      setProfileSaveState(result.error ? "error" : "saved");
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [profile, accountUser, profileReady]);

  async function refreshHistory() {
    setHistoryLoading(true); setHistoryError("");
    try {
      const loaded = await listSessionTimelines();
      setTimelines(loaded);
      setSessions(loaded);
      return loaded;
    } catch {
      setHistoryError("История пока недоступна: примените миграцию 002_session_history_and_branches.sql в Supabase.");
      return [];
    } finally {
      setHistoryLoading(false);
    }
  }

  const changePlayer = (value: SideProfile) => { setPlayer(value); setPlan(null); };
  const changeOpponent = (value: SideProfile) => { setOpponent(value); setPlan(null); };
  const changeProfile = (value: SideProfile) => { setProfileSaveState("saving"); setProfile(value); };
  function setDifficulty(difficulty: Difficulty) { changePlayer({ ...player, difficulty }); changeProfile({ ...profile, difficulty }); setOpponent((current) => ({ ...current, difficulty })); }
  async function prepareOpponent() {
    setPreparing(true); setAiError("");
    try {
      if (!player.name.trim()) throw new Error("Сначала укажите имя в разделе «Профиль».");
      const difficulty = player.difficulty ?? "normal";
      const characterPool = difficulty === "easy" ? [characterOptions[3], characterOptions[0]] : difficulty === "serious" ? [characterOptions[1], characterOptions[2], characterOptions[4]] : characterOptions;
      const generatedOpponent = { ...opponent, difficulty, character: pick(characterPool), motivation: pick(motivationOptions), hiddenInterest: pick(interestOptions), speechStyle: pick(speechOptions), habits: pick(habitOptions), languageStyle: pick(languageOptions), boundaries: pick(boundaryOptions), person: "Переговоры по заданной пользователем цели" };
      setOpponent(generatedOpponent);
      const response = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ player, opponent: generatedOpponent }) });
      const data = await response.json() as { plan?: NegotiationPlan; warning?: string; error?: string };
      if (!response.ok || !data.plan) throw new Error(data.error ?? "Не удалось построить маршрут.");
      setPlan(data.plan);
      if (data.warning) setAiError(`Маршрут создан локально: ${data.warning}`);
      return { plan: data.plan, opponent: generatedOpponent };
    } catch (error) { setAiError(error instanceof Error ? error.message : "Не удалось подготовить переговоры."); return null; }
    finally { setPreparing(false); }
  }
  function randomizeOpponentData() { const person = pick(randomOpponents); changeOpponent({ ...opponent, ...person, goal: pick(opponentGoalOptions) }); }

  async function startNegotiation(activePlan: NegotiationPlan, activeOpponent = opponent) {
    const opening = activeOpponent.side === "buyer"
      ? `Здравствуйте, ${player.name} ${player.patronymic}. Я рассматриваю ваши услуги. Расскажите, что именно входит в ваше предложение?`
      : opponent.side === "provider"
        ? `Здравствуйте, ${player.name} ${player.patronymic}. Расскажите, какую задачу вы хотите решить, какой результат и сроки рассматриваете?`
        : `Здравствуйте, ${player.name} ${player.patronymic}. Предлагаю обозначить позиции сторон и ожидаемый результат разговора.`;
    const fresh = createInitialState();
    setState(fresh); setMessages([{ role: "opponent", text: opening, turn: 0 }]); setScreen("talk"); setSaveState("saving"); setRewrite(null); setReport(null); setBranchInfo({ parentSessionId: null, branchedFromTurn: null, correctionNumber: 0 });
    const id = await createSession(player, activeOpponent, fresh, opening, activePlan);
    setSessionId(id); setSaveState(id ? "saved" : "local");
    if (!id) setAiError("Не удалось создать сессию в Supabase. Проверьте, применена ли новая миграция базы данных.");
    else void refreshHistory();
  }

  async function beginSession() {
    const prepared = await prepareOpponent();
    if (prepared) await startNegotiation(prepared.plan, prepared.opponent);
  }

  function beginRewrite(message: Message) {
    if (thinking || message.role !== "player") return;
    setRewrite({ turn: message.turn, text: message.text });
    setDraft(message.text);
    setAiError("");
  }

  async function buildReport(targetState = state, targetMessages = messages, targetSessionId = sessionId) {
    setReportLoading(true);
    let nextReport: SessionReport = {
      summary: "Переговоры завершены. Подробный разбор нейросети временно недоступен.",
      agreed: targetState.memory.agreements,
      openQuestions: targetState.memory.openQuestions,
      interests: [],
      mistakes: [...targetState.memory.contradictions, ...targetState.memory.threats],
      advice: ["Проверьте открытые вопросы и сформулируйте условия точнее."],
      risks: targetState.memory.promises,
    };
    try {
      const response = await fetch("/api/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ player, opponent, state: targetState, messages: targetMessages }) });
      const data = await response.json() as { report?: SessionReport; error?: string };
      if (!response.ok || !data.report) throw new Error(data.error ?? "Отчёт не получен.");
      nextReport = data.report;
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "Не удалось создать подробный отчёт.");
    }
    setReport(nextReport); setReportLoading(false);
    if (targetSessionId) void saveSessionReport(targetSessionId, nextReport);
    return nextReport;
  }

  async function finishNegotiation() {
    await buildReport();
    setScreen("result");
  }

  async function startVoiceInput() {
    if (voiceListening && recorderRef.current) { recorderRef.current.stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setAiError("Этот браузер не поддерживает запись с микрофона."); return; }
    try {
      setAiError("");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => { stream.getTracks().forEach((track) => track.stop()); setVoiceListening(false); setAiError("Не удалось записать голос. Проверьте разрешение на микрофон."); };
      recorder.onstop = async () => {
        setVoiceListening(false); recorderRef.current = null;
        stream.getTracks().forEach((track) => track.stop());
        const form = new FormData(); form.append("audio", new Blob(chunks, { type: recorder.mimeType || "audio/webm" }), "speech.webm");
        try {
          const response = await fetch("/api/transcribe", { method: "POST", body: form });
          const data = await response.json() as { text?: string; error?: string };
          if (!response.ok || !data.text) throw new Error(data.error ?? "Речь не распознана.");
          setDraft((current) => `${current}${current ? " " : ""}${data.text}`.slice(0, 800));
        } catch (error) { setAiError(error instanceof Error ? error.message : "Не удалось распознать речь."); }
      };
      recorder.start(); setVoiceListening(true);
    } catch { setAiError("Доступ к микрофону запрещён. Разрешите его в настройках браузера."); }
  }

  async function send() {
    const text = draft.trim();
    if (!text || (!rewrite && state.status !== "active") || thinking || !plan) return;

    let workingState = state;
    let workingMessages = messages;
    let activeSessionId = sessionId;
    if (rewrite) {
      if (!sessionId) { setAiError("Для создания ветки сначала нужна сохранённая сессия Supabase."); return; }
      const previousSnapshot = [...messages].reverse().find((message) => message.turn < rewrite.turn && message.snapshot)?.snapshot;
      workingState = previousSnapshot?.after ?? createInitialState();
      workingState = { ...workingState, status: "active" };
      workingMessages = messages.filter((message) => message.turn < rewrite.turn);
      setThinking(true); setSaveState("saving");
      const branch = await createBranchSession(sessionId, rewrite.turn, player, opponent, plan, workingState);
      if (!branch?.id) {
        setThinking(false); setSaveState("local"); setAiError(branch?.limitReached ? "Доступно не больше трёх исправлений для одной исходной сессии." : "Не удалось создать ветку. Примените миграцию 002_session_history_and_branches.sql в Supabase."); return;
      }
      activeSessionId = branch.id;
      setSessionId(branch.id); setMessages(workingMessages); setState(workingState); setReport(null);
      setBranchInfo({ parentSessionId: sessionId, branchedFromTurn: rewrite.turn, correctionNumber: branch.correctionNumber });
      setRewrite(null);
    }

    const turn = workingState.turn + 1;
    const nextCount = workingMessages.length + 2;
    const nextMessages: Message[] = [...workingMessages, { role: "player", text, turn }];
    setDraft(""); setThinking(true); setAiError(""); setMessages(nextMessages);
    let reply = "";
    let result: ReturnType<typeof applySemanticEvaluation> | null = null;
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ player, opponent, plan, state: workingState, messages: nextMessages, sessionId: activeSessionId, messageCount: nextCount }) });
      const data = await response.json() as { reply?: string; evaluation?: SemanticEvaluation; error?: string };
      if (!response.ok || !data.reply) throw new Error(data.error ?? "Нейросеть не ответила.");
      if (!data.evaluation) throw new Error("Не удалось оценить ход. Реплика не сохранена.");
      reply = data.reply;
      result = applySemanticEvaluation(workingState, data.evaluation, plan, nextCount);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "Не удалось получить ответ модели.");
      setMessages(workingMessages); setDraft(text); setThinking(false); setSaveState(activeSessionId ? "saved" : "local"); return;
    }
    if (!result) return;
    const opponentMessage: Message = { role: "opponent", text: reply, turn: result.snapshot.turn, snapshot: result.snapshot };
    setState(result.state); setMessages((current) => [...current, opponentMessage]); setThinking(false);
    if (activeSessionId) {
      setSaveState("saving");
      setSaveState(await saveTurn(activeSessionId, text, reply, result.snapshot) ? "saved" : "local");
      void refreshHistory();
    }
    if (result.state.status !== "active") { await buildReport(result.state, [...nextMessages, opponentMessage], activeSessionId); setScreen("result"); }
  }

  async function openSavedSession(id: string) {
    setHistoryLoading(true); setHistoryError("");
    const loaded = await loadSession(id);
    setHistoryLoading(false);
    if (!loaded) { setHistoryError("Не удалось открыть эту сессию."); return; }
    setPlayer(loaded.player); setOpponent(loaded.opponent); setPlan(loaded.plan); setState(loaded.state); setMessages(loaded.messages); setSessionId(loaded.id);
    setBranchInfo({ parentSessionId: loaded.parentSessionId, branchedFromTurn: loaded.branchedFromTurn, correctionNumber: loaded.correctionNumber });
    setReport(loaded.report); setRewrite(null); setDraft(""); setAiError(""); setSaveState("saved"); setScreen("talk");
  }

  async function openHistoryPoint(id: string, selected: Message) {
    setHistoryLoading(true); setHistoryError("");
    const loaded = await loadSession(id);
    setHistoryLoading(false);
    if (!loaded) { setHistoryError("Не удалось восстановить выбранный ход."); return; }
    const rewriteTurn = selected.role === "player" ? selected.turn : selected.turn + 1;
    const visibleMessages = loaded.messages.filter((message) => message.turn < rewriteTurn);
    const previousSnapshot = [...visibleMessages].reverse().find((message) => message.snapshot)?.snapshot;
    const restoredState = { ...(previousSnapshot?.after ?? createInitialState()), status: "active" as const };
    setPlayer(loaded.player); setOpponent(loaded.opponent); setPlan(loaded.plan); setState(restoredState); setMessages(visibleMessages); setSessionId(loaded.id);
    setBranchInfo({ parentSessionId: loaded.parentSessionId, branchedFromTurn: loaded.branchedFromTurn, correctionNumber: loaded.correctionNumber });
    setReport(null); setRewrite({ turn: rewriteTurn, text: selected.role === "player" ? selected.text : "" }); setDraft(selected.role === "player" ? selected.text : ""); setAiError(""); setSaveState("saved"); setScreen("talk");
  }

  async function openResult(id: string) {
    setHistoryLoading(true);
    const loaded = await loadSession(id);
    setHistoryLoading(false);
    if (!loaded) { setHistoryError("Не удалось открыть результат сессии."); return; }
    setPlayer(loaded.player); setOpponent(loaded.opponent); setPlan(loaded.plan); setState(loaded.state); setMessages(loaded.messages); setSessionId(loaded.id); setReport(loaded.report);
    setBranchInfo({ parentSessionId: loaded.parentSessionId, branchedFromTurn: loaded.branchedFromTurn, correctionNumber: loaded.correctionNumber });
    setScreen(loaded.report ? "result" : "talk");
  }

  function reset() {
    setPlayer(profile); setState(createInitialState()); setMessages([]); setSessionId(null); setSaveState("local"); setAiError(""); setPlan(null); setRewrite(null); setReport(null); setSuggestionUses(0); setBranchInfo({ parentSessionId: null, branchedFromTurn: null, correctionNumber: 0 }); setScreen("workspace");
  }

  if (authLoading) return <div className="auth-shell"><p>Проверяем аккаунт…</p></div>;
  if (!accountUser) return <AuthScreen />;

  return <div className="app-shell">
    <nav className="side-nav" aria-label="Основная навигация">
      <button className={`icon-button ${screen === "home" || screen === "talk" ? "active" : ""}`} data-tooltip="Главная · диалог" aria-label="Главная · диалог" onClick={() => setScreen(plan ? "talk" : "home")}><AppIcon name="home" /></button>
      <button className={`icon-button ${screen === "history" ? "active" : ""}`} data-tooltip="История диалога" aria-label="История диалога" onClick={() => { setScreen("history"); void refreshHistory(); }}><AppIcon name="history" /></button>
      <button className={`icon-button ${screen === "workspace" ? "active" : ""}`} data-tooltip="Новые переговоры" aria-label="Новые переговоры" onClick={reset}><AppIcon name="spark" /></button>
      <button className={`icon-button ${screen === "results" || screen === "result" ? "active" : ""}`} data-tooltip="Результаты" aria-label="Результаты" onClick={() => { setScreen("results"); void refreshHistory(); }}><AppIcon name="chart" /></button>
      <span className="nav-spacer" />
      <button className={`icon-button ${screen === "profile" ? "active" : ""}`} data-tooltip="Профиль" aria-label="Профиль" onClick={() => setScreen("profile")}><AppIcon name="profile" /></button>
      <button className={`icon-button ${screen === "settings" ? "active" : ""}`} data-tooltip="Настройки" aria-label="Настройки" onClick={() => setScreen("settings")}><AppIcon name="settings" /></button>
    </nav>
    {preparing && <div className="preparation-overlay" role="status"><div className="preparation-loader" /><strong>Создаём ситуацию и оппонента</strong><span>Подбираем сложность, цели и поведение…</span></div>}
    <main>
      {screen === "home" && <section className="hero dialogue-empty"><p className="kicker">Персональная тренировка</p><h1>Проведите диалог с виртуальным оппонентом.</h1><p className="hero-copy">Настройте сложность, выберите навыки для развития и задайте собеседника.</p><div className="hero-actions"><button className="primary" onClick={reset}>Начать диалог</button></div></section>}

      {screen === "history" && <HistoryView timelines={timelines} loading={historyLoading} error={historyError} names={sessionNames} onOpen={(id) => void openSavedSession(id)} onPoint={(id, message) => void openHistoryPoint(id, message)} onNew={reset} />}

      {screen === "results" && <ResultsArchive timelines={timelines} loading={historyLoading} onOpen={(id) => void openResult(id)} onNew={reset} />}

      {screen === "profile" && <section className="profile-view"><header><p className="kicker">Ваши данные</p><h1>Профиль переговорщика</h1><p>Имя сохранится в аккаунте и автоматически подставится в следующую сессию.</p></header><ProfileForm profile={profile} onChange={changeProfile} /><p className={`profile-saved ${profileSaveState === "error" ? "error" : ""}`}>{profileSaveState === "saving" ? "Сохраняем…" : profileSaveState === "error" ? "Не удалось сохранить профиль." : "Профиль сохранён в Supabase."}</p></section>}

      {screen === "settings" && <section className="settings-view"><p className="kicker">Сервис</p><h1>Настройки</h1><div className="settings-grid"><article><AppIcon name="spark" /><div><strong>Нейросеть</strong><p>Gemini анализирует реплики, создаёт оппонента и предлагает более сильные формулировки.</p></div></article><article><AppIcon name="history" /><div><strong>Хранение данных</strong><p>Сессии, сообщения и снимки состояния автоматически удаляются через 7 дней.</p></div></article><article><AppIcon name="profile" /><div><strong>Аккаунт</strong><p>{accountUser.email}. Профиль и история доступны только этому пользователю.</p><button className="text-action" onClick={() => void signOut()}>Выйти из аккаунта</button></div></article></div></section>}

{screen === "workspace" && <section className="workspace session-setup"><header className="workspace-head"><p className="kicker">Настройка сессии</p><h1>Подготовьте собеседника</h1><p>Выберите сложность и укажите, с кем предстоит разговор.</p></header><div className="setup-grid"><section className="setup-card training-card"><p className="field-kicker">Сложность разговора</p><div className="difficulty-grid">{([{ id: "easy", title: "Легко", text: "Оппонент открыт и готов обсуждать" }, { id: "normal", title: "Нормально", text: "Оппонент сомневается и задаёт вопросы" }, { id: "serious", title: "Сложно", text: "Оппонент недоверчив и требует доказательств" }] as const).map((item) => <button key={item.id} className={`choice-card ${player.difficulty === item.id ? "selected" : ""}`} onClick={() => setDifficulty(item.id)}><strong>{item.title}</strong><span>{item.text}</span></button>)}</div><div className="training-methods"><strong>Во время разговора тренируем</strong><span>Выявление потребности по SPIN</span><span>Отработку возражений</span><span>Завершение сделки</span></div></section><section className="setup-card opponent-fields"><div className="setup-card-head"><p className="field-kicker">Данные оппонента</p><button className="random-opponent action-with-icon" type="button" onClick={randomizeOpponentData}><AppIcon name="shuffle" />Случайный оппонент</button></div><div className="name-fields"><label>Имя<input value={opponent.name} onChange={(event) => changeOpponent({ ...opponent, name: event.target.value })} placeholder="Например, Андрей" /></label><label>Отчество <span className="optional">необязательно</span><input value={opponent.patronymic} onChange={(event) => changeOpponent({ ...opponent, patronymic: event.target.value })} placeholder="Например, Михайлович" /></label></div><label>Кем является оппонент<input value={opponent.role} onChange={(event) => changeOpponent({ ...opponent, role: event.target.value })} placeholder="Например, владелец компании или заказчик" /></label><label>Цель оппонента<textarea value={opponent.goal} onChange={(event) => changeOpponent({ ...opponent, goal: event.target.value })} placeholder="Например, снизить стоимость и убедиться в соблюдении сроков" /></label></section></div>{aiError && <p className="ai-error">{aiError}</p>}<div className="controls"><button className="quiet" onClick={() => setScreen("home")}>Назад</button><button className="primary" onClick={() => void beginSession()} disabled={preparing || !opponent.name.trim() || !opponent.role.trim() || !opponent.goal.trim()}>{preparing ? "Подготавливаем…" : "Создать сессию"}</button></div></section>}

      {screen === "talk" && plan && <section className="negotiation negotiation-redesign"><div className="conversation"><section className="opponent-portrait"><div className="portrait-placeholder" aria-hidden="true" /><div className="portrait-copy"><p className="kicker">Ваш оппонент</p><h1>{opponent.name} {opponent.patronymic}</h1><p>{opponent.role}</p></div><div className="attention-tip"><small>Обратите внимание</small><strong>{plan.route.find((step) => !state.matchedKeywords.includes(step.id))?.intent ?? "Зафиксируйте итоговые условия и следующий шаг"}</strong></div></section><div className="conversation-head compact"><div><p className="kicker">Диалог · {messages.length} из {plan.maxMessages}</p></div><button className="quiet action-with-icon" onClick={() => void finishNegotiation()} disabled={reportLoading}><AppIcon name="finish" />{reportLoading ? "Готовим результат…" : "Завершить"}</button></div>{branchInfo.parentSessionId && <div className="branch-banner"><strong>Альтернативная ветка</strong><span>Исправление {branchInfo.correctionNumber} из 3, с хода {branchInfo.branchedFromTurn}.</span></div>}{aiError && <p className="ai-error">{aiError}</p>}<div className="messages" aria-live="polite">{messages.map((message, index) => <article key={`${message.turn}-${message.role}-${index}`} className={`message ${message.role}`}><div className="message-meta"><span>{message.role === "player" ? `Вы · ход ${message.turn}` : opponent.name}</span>{message.role === "player" && sessionId && <button onClick={() => beginRewrite(message)} disabled={thinking}>Изменить отсюда</button>}</div><p>{message.text}</p>{message.role === "opponent" && message.snapshot?.nonverbalCue && <em className="nonverbal">{message.snapshot.nonverbalCue}</em>}</article>)}{thinking && <article className="message opponent thinking"><span>{opponent.name}</span><p>Формулирует ответ…</p></article>}</div>{rewrite && <div className="rewrite-banner"><div><strong>Новая ветка с хода {rewrite.turn}</strong><span>Исходная версия останется в истории.</span></div><button type="button" onClick={() => { setRewrite(null); setDraft(""); }}>Отмена</button></div>}<form className="composer dialogue-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}><textarea aria-label="Ваша реплика" maxLength={800} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Напишите сообщение оппоненту…" disabled={thinking || (state.status !== "active" && !rewrite)} /><div><span>{draft.length}/800</span><span className="composer-actions"><button className={`voice-button icon-action ${voiceListening ? "recording" : ""}`} data-tooltip={voiceListening ? "Остановить запись" : "Голосовой ввод"} aria-label={voiceListening ? "Остановить запись" : "Голосовой ввод"} type="button" onClick={() => void startVoiceInput()} disabled={thinking}><AppIcon name="mic" /></button><button className="primary icon-action" data-tooltip="Отправить" aria-label="Отправить" disabled={!draft.trim() || thinking || (state.status !== "active" && !rewrite)}><AppIcon name="send" /></button></span></div></form></div><aside className="coaching-panel"><section className="task-section"><p className="panel-title">Задачи</p><details className="spin-guide"><summary>Подсказки SPIN</summary><p><b>S</b> — уточните текущую ситуацию.</p><p><b>P</b> — выясните проблему.</p><p><b>I</b> — раскройте последствия.</p><p><b>N</b> — определите ценность результата.</p></details><div className="task-checklist">{plan.route.map((step) => { const done = state.matchedKeywords.includes(step.id); return <label className={done ? "done" : ""} key={step.id}><input type="checkbox" checked={done} readOnly /><span>{step.intent}</span></label>; })}</div></section><section className="advice-section"><p className="panel-title">Советы</p>{lastSnapshot?.advice ? <><p className="advice-text">{lastSnapshot.advice}</p><button type="button" className="use-advice" disabled={suggestionUses >= 3 || thinking} onClick={() => { setDraft(lastSnapshot.advice ?? ""); setSuggestionUses((value) => value + 1); }}>Использовать ответ <span>{3 - suggestionUses} осталось</span></button></> : <p className="advice-empty">Совет появится после вашей первой реплики.</p>}</section></aside></section>}

      {screen === "result" && <section className="results"><p className="kicker">Результат</p><h1>{state.status === "deal" ? "Выигрыш" : state.status === "walkaway" ? "Проигрыш" : "Компромисс"}</h1><div className="result-grid"><article><span>Итог SPIN</span><strong>{["spin-s", "spin-p", "spin-i", "spin-n"].filter((id) => state.matchedKeywords.includes(id)).length}/4</strong><p>{messages.length} реплик · {state.matchedKeywords.includes("objection") ? "возражение отработано" : "возражение не отработано"}</p></article><div className="analysis-list"><ResultRow label="Доверие" value={state.trust} /><ResultRow label="Интерес" value={state.dealInterest} /><ResultRow label="Раздражение" value={state.irritation} /><ResultRow label="Этичность" value={state.ethicalConduct} /><ResultRow label="Взаимопонимание" value={100 - state.misunderstanding} /><ResultRow label="Смыслы" value={`${state.matchedKeywords.length}/${plan?.keywords.length ?? 0}`} /></div></div>{reportLoading && <p className="report-loading">ИИ готовит разбор переговоров…</p>}{report && <section className="session-report"><header><p className="kicker">Разбор сессии</p><h2>О чём вы договорились</h2><p>{report.summary}</p></header><div className="report-grid"><ReportBlock title="Согласовано" items={report.agreed} /><ReportBlock title="Осталось открытым" items={report.openQuestions} /><ReportBlock title="Интересы и мотивы" items={report.interests} /><ReportBlock title="Ошибки" items={report.mistakes} /><ReportBlock title="Советы тренера" items={report.advice} /><ReportBlock title="Риски" items={report.risks} /></div></section>}<div className="controls result-controls"><button className="quiet" onClick={() => setScreen("history")}>История версий</button>{messages.some((message) => message.role === "player") && branchInfo.correctionNumber < 3 && <button className="quiet" onClick={() => setScreen("talk")}>Исправить ошибку · осталось {3 - branchInfo.correctionNumber}</button>}<button className="primary" onClick={reset}>Новая попытка</button></div></section>}
    </main>
  </div>;
}

function AuthScreen() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmationEmail, setConfirmationEmail] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage("");
    const result = mode === "signin" ? await signIn(email.trim(), password) : await signUp(email.trim(), password);
    setBusy(false);
    if (result.error) { setMessage(translateAuthError(result.error)); return; }
    if ("confirmationRequired" in result && result.confirmationRequired) { setConfirmationEmail(email.trim()); setMessage("Аккаунт создан. Откройте новое письмо Supabase и подтвердите email, затем войдите."); }
  }

  async function resend() {
    if (!confirmationEmail || busy) return;
    setBusy(true);
    const result = await resendConfirmation(confirmationEmail);
    setBusy(false);
    setMessage(result.error ? translateAuthError(result.error) : "Новое письмо отправлено. Используйте ссылку только из последнего письма.");
  }

  return <main className="auth-shell"><section className="auth-card"><p className="kicker">Арена переговоров</p><h1>{mode === "signin" ? "Вход в аккаунт" : "Создание аккаунта"}</h1><p>Профиль, история и результаты переговоров будут доступны только вам.</p><form onSubmit={submit}><label>Email<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" /></label><label>Пароль<input type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Минимум 8 символов" /></label>{message && <p className="auth-message">{message}</p>}{confirmationEmail && <button className="resend-action" type="button" onClick={() => void resend()} disabled={busy}>Отправить письмо повторно</button>}<button className="primary" disabled={busy}>{busy ? "Подождите…" : mode === "signin" ? "Войти" : "Создать аккаунт"}</button></form><button className="auth-switch" type="button" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setMessage(""); setConfirmationEmail(""); }}>{mode === "signin" ? "Нет аккаунта? Создать" : "Уже есть аккаунт? Войти"}</button></section></main>;
}

function translateAuthError(message: string) {
  if (/invalid login credentials/i.test(message)) return "Неверный email или пароль.";
  if (/user already registered/i.test(message)) return "Аккаунт с таким email уже существует.";
  if (/password should be/i.test(message)) return "Пароль слишком короткий. Используйте минимум 8 символов.";
  if (/email not confirmed/i.test(message)) return "Сначала подтвердите email по ссылке из письма.";
  return `Не удалось выполнить вход: ${message}`;
}

function HistoryView({ timelines, loading, error, names, onOpen, onPoint, onNew }: { timelines: SessionTimeline[]; loading: boolean; error: string; names: Map<string, string>; onOpen: (id: string) => void; onPoint: (id: string, message: StoredMessage) => void; onNew: () => void }) {
  const [query, setQuery] = useState("");
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  const [scale, setScale] = useState(0.9);
  const [offset, setOffset] = useState({ x: 34, y: 34 });
  const drag = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase("ru-RU");
  const depthOf = (session: SessionTimeline) => {
    let depth = 0, parent = session.parentSessionId;
    const visited = new Set<string>();
    while (parent && depth < 3 && !visited.has(parent)) { visited.add(parent); depth += 1; parent = timelines.find((item) => item.id === parent)?.parentSessionId ?? null; }
    return depth;
  };
  const visible = timelines.filter((session) => !normalizedQuery || session.title.toLocaleLowerCase("ru-RU").includes(normalizedQuery) || session.messages.some((message) => message.text.toLocaleLowerCase("ru-RU").includes(normalizedQuery)));
  const matchCount = normalizedQuery ? visible.reduce((count, session) => count + session.messages.filter((message) => message.text.toLocaleLowerCase("ru-RU").includes(normalizedQuery)).length, 0) : 0;
  const resetBoard = () => { setScale(0.9); setOffset({ x: 34, y: 34 }); };
  return <section className="history-view board-view"><header className="history-head"><div><p className="kicker">Карта переговоров</p><h1>Доска диалогов</h1><p>Перемещайте доску, меняйте масштаб и исследуйте ветки. Наведите курсор на свою реплику, чтобы увидеть совет нейросети.</p></div><button className="primary" onClick={onNew}>Новые переговоры</button></header><div className="board-toolbar"><div className="tree-search"><AppIcon name="chat" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти слово или фразу" aria-label="Поиск по истории диалогов" />{normalizedQuery && <span>{matchCount} совпад.</span>}</div><div className="zoom-controls"><button onClick={() => setScale((value) => Math.max(.5, value - .1))} aria-label="Уменьшить масштаб">−</button><span>{Math.round(scale * 100)}%</span><button onClick={() => setScale((value) => Math.min(1.4, value + .1))} aria-label="Увеличить масштаб">+</button><button onClick={resetBoard}>По центру</button></div></div>{error && <p className="ai-error">{error}</p>}{loading ? <p className="history-empty">Загрузка дерева…</p> : visible.length === 0 ? <p className="history-empty">{normalizedQuery ? "Совпадений не найдено." : "Сохранённых переговоров пока нет."}</p> : <div className="dialogue-board" onPointerDown={(event) => { if ((event.target as HTMLElement).closest("button,input")) return; drag.current = { x: event.clientX, y: event.clientY, originX: offset.x, originY: offset.y }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (!drag.current) return; setOffset({ x: drag.current.originX + event.clientX - drag.current.x, y: drag.current.originY + event.clientY - drag.current.y }); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}><div className="board-stage" style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}>{visible.map((session) => { const depth = depthOf(session); return <article className={`tree-branch depth-${depth}`} key={session.id}><div className="branch-line" /><header className="tree-branch-head"><div><div className="history-badges"><span>{session.parentSessionId ? `Ветка ${session.correctionNumber} из 3 · после хода ${session.branchedFromTurn}` : "Основная линия"}</span><span>{session.status === "active" ? "В процессе" : session.status === "deal" ? "Сделка" : "Завершено"}</span></div><h2>{session.title}</h2><p>{session.player.name} {session.player.patronymic} ↔ {session.opponent.name} {session.opponent.patronymic}</p>{session.parentSessionId && <small>Ответвление от: {names.get(session.parentSessionId) ?? "предыдущая версия"}</small>}</div><div className="branch-actions"><button className="quiet" onClick={() => setExpandedSession((current) => current === session.id ? null : session.id)}>{expandedSession === session.id ? "Скрыть ветку" : "Показать ветку"}</button><button className="quiet" onClick={() => onOpen(session.id)}>Открыть сессию</button></div></header>{expandedSession === session.id && <div className="turn-nodes">{session.messages.map((message, index) => { const matched = normalizedQuery && message.text.toLocaleLowerCase("ru-RU").includes(normalizedQuery); const snapshot = message.snapshot; const advice = message.role === "player" ? snapshot?.advice : undefined; return <button className={`turn-node ${message.role} ${matched ? "match" : ""} ${advice ? "has-advice" : ""}`} key={`${session.id}-${message.turn}-${message.role}-${index}`} onClick={() => onPoint(session.id, message)}><span className="node-dot"><AppIcon name={message.role === "player" ? "chat" : "spark"} /></span><span className="node-copy"><small>{message.role === "player" ? `Вы · ход ${message.turn}` : `${session.opponent.role} · ход ${message.turn}`}</small><strong>{message.text}</strong>{snapshot && <em>Доверие {snapshot.after.trust} · Интерес {snapshot.after.dealInterest} · Раздражение {snapshot.after.irritation}</em>}</span>{advice && <span className="advice-popover"><small>Совет нейросети</small><strong>{advice}</strong></span>}</button>; })}</div>}</article>; })}</div></div>}</section>;
}

function ResultsArchive({ timelines, loading, onOpen, onNew }: { timelines: SessionTimeline[]; loading: boolean; onOpen: (id: string) => void; onNew: () => void }) {
  const completed = timelines.filter((session) => session.report || session.status !== "active");
  const average = (key: "routeProgress" | "trust" | "dealInterest") => completed.length ? Math.round(completed.reduce((sum, session) => sum + session.state[key], 0) / completed.length) : 0;
  const wins = completed.filter((session) => session.status === "deal").length;
  const losses = completed.filter((session) => session.status === "walkaway").length;
  const compromises = completed.length - wins - losses;
  return <section className="results-archive"><header className="history-head"><div><p className="kicker">Архив</p><h1>Результаты переговоров</h1><p>Каждый завершённый разговор хранится отдельно: участники, итог, прогресс и рекомендации тренера.</p></div><button className="primary" onClick={onNew}>Новые переговоры</button></header>{completed.length > 0 && <div className="stats-strip outcome-stats"><article><span>Выигрыш</span><strong>{wins}</strong><i style={{ width: `${completed.length ? wins / completed.length * 100 : 0}%` }} /></article><article><span>Компромисс</span><strong>{compromises}</strong><i style={{ width: `${completed.length ? compromises / completed.length * 100 : 0}%` }} /></article><article><span>Проигрыш</span><strong>{losses}</strong><i style={{ width: `${completed.length ? losses / completed.length * 100 : 0}%` }} /></article><article><span>Среднее доверие</span><strong>{average("trust")}%</strong><i style={{ width: `${average("trust")}%` }} /></article></div>}{loading ? <p className="history-empty">Загрузка результатов…</p> : completed.length === 0 ? <p className="history-empty">Завершённых переговоров пока нет.</p> : <div className="results-list">{completed.map((session, index) => <button className="result-session-card" key={session.id} onClick={() => onOpen(session.id)}><span className="result-number">{String(index + 1).padStart(2, "0")}</span><span className="result-parties"><small>{new Date(session.updatedAt).toLocaleDateString("ru-RU")}</small><strong>{session.player.name} {session.player.patronymic} · {session.player.role}</strong><em>с {session.opponent.name} {session.opponent.patronymic} · {session.opponent.role}</em><p>{session.report?.summary ?? "Сессия завершена без итогового отчёта."}</p></span><span className={`result-score outcome-${session.status}`}><strong>{session.status === "deal" ? "Выигрыш" : session.status === "walkaway" ? "Проигрыш" : "Компромисс"}</strong><small>результат</small></span></button>)}</div>}</section>;
}

function ProfileForm({ profile, onChange, highlighted = false }: { profile: SideProfile; onChange: (value: SideProfile) => void; highlighted?: boolean }) {
  return <section className={`profile-form setup-card ${highlighted ? "highlighted" : ""}`}><p className="field-kicker">Данные переговорщика</p><div className="name-fields"><label>Имя <span className="required">обязательно</span><input value={profile.name} onChange={(event) => onChange({ ...profile, name: event.target.value })} placeholder="Например, Александр" /></label><label>Отчество <span className="optional">необязательно</span><input value={profile.patronymic} onChange={(event) => onChange({ ...profile, patronymic: event.target.value })} placeholder="Например, Сергеевич" /></label></div><label>Профессия<input value={profile.role} onChange={(event) => onChange({ ...profile, role: event.target.value })} placeholder="Например, веб-дизайнер" /></label><label>Описание услуг<textarea value={profile.services ?? ""} onChange={(event) => onChange({ ...profile, services: event.target.value, goal: event.target.value })} placeholder="Например, создаю корпоративные сайты и фирменный стиль" /></label><label>Опыт и сильные стороны<textarea value={profile.experienceStrengths ?? ""} onChange={(event) => onChange({ ...profile, experienceStrengths: event.target.value })} placeholder="Например, 3 года опыта, работаю по этапам и соблюдаю сроки" /></label></section>;
}

type AppIconName = "home" | "spark" | "chat" | "history" | "chart" | "profile" | "settings" | "trust" | "interest" | "irritation" | "ethics" | "understanding" | "mic" | "send" | "finish" | "shuffle";
function AppIcon({ name }: { name: AppIconName }) {
  const paths: Record<AppIconName, ReactNode> = {
    home: <><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/></>,
    spark: <><path d="m12 3 1.2 4.2L17 9l-3.8 1.8L12 15l-1.2-4.2L7 9l3.8-1.8L12 3Z"/><path d="m19 15 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z"/></>,
    chat: <><path d="M4 5.5h16v11H9l-5 3v-14Z"/><path d="M8 10h8M8 13h5"/></>,
    history: <><path d="M4 5v5h5"/><path d="M5.6 17.5A8 8 0 1 0 4 10"/><path d="M12 7v5l3 2"/></>,
    chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>,
    profile: <><circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    trust: <><path d="M12 21s-8-4.8-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6.2-8 11-8 11Z"/></>,
    interest: <><circle cx="12" cy="12" r="3"/><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/></>,
    irritation: <><path d="M13 2 5 13h6l-1 9 9-13h-6V2Z"/></>,
    ethics: <><path d="M12 3v18M5 7h14M5 7l-3 6h6L5 7ZM19 7l-3 6h6l-3-6ZM8 21h8"/></>,
    understanding: <><path d="M9 18h6M10 21h4"/><path d="M8.2 14.5A7 7 0 1 1 15.8 14.5C14.6 15.3 14 16 14 17h-4c0-1-.6-1.7-1.8-2.5Z"/></>,
    mic: <><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/></>,
    send: <><path d="m3 11 18-8-8 18-2-8-8-2Z"/><path d="m11 13 5-5"/></>,
    finish: <><path d="M5 3v18M6 5h12l-3 4 3 4H6"/></>,
    shuffle: <><path d="M4 7h3c5 0 5 10 10 10h3"/><path d="m17 14 3 3-3 3M4 17h3c2 0 3-1.5 4-3M15 7h5M17 4l3 3-3 3"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
function ResultRow({ label, value }: { label: string; value: string | number }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function ReportBlock({ title, items }: { title: string; items: string[] }) { return <article><h3>{title}</h3>{items.length ? <ul>{items.map((item, index) => <li key={`${title}-${index}`}>{item}</li>)}</ul> : <p>Не выявлено.</p>}</article>; }


