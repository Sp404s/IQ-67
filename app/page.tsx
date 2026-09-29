"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import type { User } from "@supabase/supabase-js";
import { applySemanticEvaluation, createInitialState, type Difficulty, type NegotiationPlan, type NegotiationState, type SemanticEvaluation, type SessionReport, type SideProfile } from "./negotiation";
import { createBranchSession, createSession, deleteEmptySessions, listSessionTimelines, loadSession, saveSessionReport, saveTurn, type SessionSummary, type SessionTimeline, type StoredMessage } from "@/lib/supabase/storage";
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
const randomOpponents = [{ name: "Андрей", patronymic: "Михайлович", role: "Строительные материалы" }, { name: "Елена", patronymic: "Викторовна", role: "Салон маникюра" }, { name: "Игорь", patronymic: "Алексеевич", role: "Ремонт автомобилей" }, { name: "Марина", patronymic: "Олеговна", role: "Кафе и доставка еды" }, { name: "Ольга", patronymic: "Сергеевна", role: "Частная стоматология" }, { name: "Денис", patronymic: "Андреевич", role: "Мебель на заказ" }];
const initialPlayer: SideProfile = { name: "", patronymic: "", side: "provider", role: "", goal: "", services: "", experienceStrengths: "", boundaries: "", person: "", motivation: "Развить навыки переговоров", character: characterOptions[0], hiddenInterest: "", speechStyle: speechOptions[0], habits: habitOptions[1], languageStyle: languageOptions[0], emotionality: "", difficulty: "normal", skillIds: [], situationTags: [] };
const initialOpponent: SideProfile = { name: "Андрей", patronymic: "Михайлович", side: "buyer", role: "Строительные материалы", goal: "Выбрать надёжного специалиста и согласовать условия проекта.", boundaries: boundaryOptions[0], person: "Привлечь больше клиентов и понятнее показать преимущества бизнеса", motivation: motivationOptions[2], character: characterOptions[1], hiddenInterest: interestOptions[4], speechStyle: speechOptions[4], habits: habitOptions[2], languageStyle: languageOptions[0], emotionality: "", difficulty: "normal", skillIds: [], situationTags: [] };
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
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const [, setSessions] = useState<SessionSummary[]>([]), [historyLoading, setHistoryLoading] = useState(false), [historyError, setHistoryError] = useState("");
  const [timelines, setTimelines] = useState<SessionTimeline[]>([]);
  const [historyTargetId, setHistoryTargetId] = useState<string | null>(null);
  const [rewrite, setRewrite] = useState<RewritePoint | null>(null);
  const [branchInfo, setBranchInfo] = useState<{ parentSessionId: string | null; branchedFromTurn: number | null; correctionNumber: number }>({ parentSessionId: null, branchedFromTurn: null, correctionNumber: 0 });
  const [report, setReport] = useState<SessionReport | null>(null), [reportLoading, setReportLoading] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() => typeof window !== "undefined" && window.localStorage.getItem("negotiation-theme") === "dark" ? "dark" : "light");
  const [language, setLanguage] = useState(() => typeof window !== "undefined" ? window.localStorage.getItem("negotiation-language") ?? "ru" : "ru");
  const isEnglish = language === "en";

  const lastSnapshot = useMemo(() => [...messages].reverse().find((message) => message.snapshot)?.snapshot, [messages]);
  const taskStage = useMemo(() => {
    const route = plan?.route ?? [];
    const need = route.filter((step) => step.id.startsWith("spin-"));
    if (need.some((step) => !state.matchedKeywords.includes(step.id))) return { title: "1. Выявление потребности", steps: need };
    const objection = route.filter((step) => step.id === "objection");
    if (objection.some((step) => !state.matchedKeywords.includes(step.id))) return { title: "2. Отработка возражения", steps: objection };
    return { title: "3. Завершение сделки", steps: route.filter((step) => step.id === "closing") };
  }, [plan, state.matchedKeywords]);
  const theoryTip = useMemo(() => {
    const current = taskStage.steps.find((step) => !state.matchedKeywords.includes(step.id));
    if (!current) return "Подведите итог сказанному и предложите один конкретный следующий шаг.";
    const tips: Record<string, string> = {
      "spin-s": "Сначала исследуйте текущую ситуацию заказчика. Задайте открытый вопрос о том, как сейчас устроен процесс, и не переходите к презентации услуги раньше времени.",
      "spin-p": "Помогите заказчику назвать конкретную проблему. Уточняйте, что именно не устраивает, мешает или требует лишних ресурсов.",
      "spin-i": "Раскройте последствия проблемы: потери времени, денег, клиентов или возможностей. Не преувеличивайте и опирайтесь на ответ заказчика.",
      "spin-n": "Выясните ценность результата. Спросите, что изменится для заказчика, если задача будет решена успешно.",
      objection: "Не спорьте с возражением сразу. Сначала уточните его причину, подтвердите, что поняли сомнение, и только затем отвечайте по существу.",
      closing: "Кратко соберите согласованные условия и предложите понятный следующий шаг с конкретным сроком или действием.",
    };
    return tips[current.id] ?? "Слушайте ответ заказчика и задавайте один точный вопрос за раз.";
  }, [taskStage, state.matchedKeywords]);

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
      if (account?.user) {
        const activeId = window.localStorage.getItem("negotiation-active-session");
        let restored = false;
        if (activeId) {
          const activeSession = await loadSession(activeId);
          if (activeSession?.state.status === "active") {
            setPlayer(activeSession.player); setOpponent(activeSession.opponent); setPlan(activeSession.plan); setState(activeSession.state); setMessages(activeSession.messages); setSessionId(activeSession.id); setReport(activeSession.report);
            setBranchInfo({ parentSessionId: activeSession.parentSessionId, branchedFromTurn: activeSession.branchedFromTurn, correctionNumber: activeSession.correctionNumber });
            setScreen(activeSession.report ? "result" : "talk"); restored = true;
          } else if (activeId) window.localStorage.removeItem("negotiation-active-session");
        }
        if (!restored) {
          try {
            const cached = JSON.parse(window.localStorage.getItem("negotiation-active-state") ?? "null") as { player?: SideProfile; opponent?: SideProfile; plan?: NegotiationPlan; state?: NegotiationState; messages?: Message[]; sessionId?: string | null; report?: SessionReport | null } | null;
            if (cached?.plan && cached.player && cached.opponent && cached.state?.status === "active" && Array.isArray(cached.messages)) {
              setPlayer(cached.player); setOpponent(cached.opponent); setPlan(cached.plan); setState(cached.state); setMessages(cached.messages); setSessionId(cached.sessionId ?? null); setReport(cached.report ?? null); setScreen(cached.report ? "result" : "talk");
            }
          } catch { window.localStorage.removeItem("negotiation-active-state"); }
        }
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

  useEffect(() => { document.documentElement.dataset.theme = theme; window.localStorage.setItem("negotiation-theme", theme); }, [theme]);
  useEffect(() => { document.documentElement.lang = language; window.localStorage.setItem("negotiation-language", language); }, [language]);
  useEffect(() => { if (sessionId && state.status === "active") window.localStorage.setItem("negotiation-active-session", sessionId); }, [sessionId, state.status]);
  useEffect(() => {
    if (!plan || !messages.length || state.status !== "active") return;
    window.localStorage.setItem("negotiation-active-state", JSON.stringify({ player, opponent, plan, state, messages, sessionId, report }));
  }, [player, opponent, plan, state, messages, sessionId, report]);
  useEffect(() => { const field = composerRef.current; if (!field) return; field.style.height = "0px"; field.style.height = `${Math.max(52, field.scrollHeight)}px`; }, [draft]);

  async function refreshHistory() {
    setHistoryLoading(true); setHistoryError("");
    try {
      await deleteEmptySessions(sessionId);
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
      if (!player.services?.trim()) throw new Error("В разделе «Профиль» заполните поле «Какие услуги вы продаёте?».");
      const difficulty = player.difficulty ?? "normal";
      const characterPool = difficulty === "easy" ? [characterOptions[3], characterOptions[0]] : difficulty === "serious" ? [characterOptions[1], characterOptions[2], characterOptions[4]] : characterOptions;
      const needs = ["привлечь больше клиентов и понятнее рассказать о бизнесе", "быстрее запустить продвижение", "повысить доверие клиентов к компании", "получить измеримый результат без срыва сроков"];
      const generatedOpponent = { ...opponent, difficulty, character: pick(characterPool), motivation: pick(motivationOptions), hiddenInterest: pick(interestOptions), speechStyle: pick(speechOptions), habits: pick(habitOptions), languageStyle: pick(languageOptions), boundaries: pick(boundaryOptions), person: pick(needs) };
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
      ? `Здравствуйте, ${player.name}${player.patronymic ? ` ${player.patronymic}` : ""}. В вашем профиле указано: «${player.services?.trim()}». Для моего бизнеса сейчас важно ${activeOpponent.person.toLowerCase()}. Расскажите, как ваша услуга поможет решить эту задачу?`
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
    if (targetSessionId) await saveSessionReport(targetSessionId, nextReport, targetState);
    return nextReport;
  }

  async function finishNegotiation() {
    const completedStatus: NegotiationState["status"] = state.routeProgress >= 80 && state.trust >= 55 && state.dealInterest >= 55
      ? "deal"
      : state.trust <= 20 || state.irritation >= 80 || state.dealInterest <= 20
        ? "walkaway"
        : "compromise";
    const completedState = { ...state, status: completedStatus };
    setState(completedState);
    window.localStorage.removeItem("negotiation-active-session");
    window.localStorage.removeItem("negotiation-active-state");
    await buildReport(completedState);
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

  async function returnToMain() {
    if (plan && messages.length) { setScreen(state.status === "active" ? "talk" : "result"); return; }
    try {
      const cached = JSON.parse(window.localStorage.getItem("negotiation-active-state") ?? "null") as { player?: SideProfile; opponent?: SideProfile; plan?: NegotiationPlan; state?: NegotiationState; messages?: Message[]; sessionId?: string | null; report?: SessionReport | null } | null;
      if (cached?.plan && cached.player && cached.opponent && cached.state && Array.isArray(cached.messages) && cached.messages.length) {
        setPlayer(cached.player); setOpponent(cached.opponent); setPlan(cached.plan); setState(cached.state); setMessages(cached.messages); setSessionId(cached.sessionId ?? null); setReport(cached.report ?? null); setScreen(cached.state.status === "active" ? "talk" : "result"); return;
      }
    } catch { window.localStorage.removeItem("negotiation-active-state"); }
    const activeId = window.localStorage.getItem("negotiation-active-session");
    if (activeId) {
      const loaded = await loadSession(activeId);
      if (loaded) { setPlayer(loaded.player); setOpponent(loaded.opponent); setPlan(loaded.plan); setState(loaded.state); setMessages(loaded.messages); setSessionId(loaded.id); setReport(loaded.report); setScreen(loaded.report || loaded.state.status !== "active" ? "result" : "talk"); return; }
    }
    setScreen("home");
  }

  function reset() {
    window.localStorage.removeItem("negotiation-active-session");
    window.localStorage.removeItem("negotiation-active-state");
    setPlayer(profile); setState(createInitialState()); setMessages([]); setSessionId(null); setSaveState("local"); setAiError(""); setPlan(null); setRewrite(null); setReport(null); setSuggestionUses(0); setBranchInfo({ parentSessionId: null, branchedFromTurn: null, correctionNumber: 0 }); setScreen("workspace");
  }

  if (authLoading) return <div className="auth-shell"><p>Проверяем аккаунт…</p></div>;
  if (!accountUser) return <AuthScreen />;

  return <div className="app-shell">
    <nav className="side-nav" aria-label="Основная навигация">
      <button className={`icon-button ${screen === "home" || screen === "talk" ? "active" : ""}`} data-tooltip={isEnglish ? "Home" : "Главная"} aria-label={isEnglish ? "Home" : "Главная"} onClick={() => void returnToMain()}><AppIcon name="home" /></button>
      <button className={`icon-button ${screen === "history" ? "active" : ""}`} data-tooltip="История диалога" aria-label="История диалога" onClick={() => { setHistoryTargetId(null); setScreen("history"); void refreshHistory(); }}><AppIcon name="history" /></button>
      <button className={`icon-button ${screen === "workspace" ? "active" : ""}`} data-tooltip="Новые переговоры" aria-label="Новые переговоры" onClick={reset}><AppIcon name="spark" /></button>
      <button className={`icon-button ${screen === "results" || screen === "result" ? "active" : ""}`} data-tooltip="Результаты" aria-label="Результаты" onClick={() => { setScreen("results"); void refreshHistory(); }}><AppIcon name="chart" /></button>
      <span className="nav-spacer" />
      <button className={`icon-button ${screen === "profile" ? "active" : ""}`} data-tooltip="Профиль" aria-label="Профиль" onClick={() => setScreen("profile")}><AppIcon name="profile" /></button>
      <button className={`icon-button ${screen === "settings" ? "active" : ""}`} data-tooltip="Настройки" aria-label="Настройки" onClick={() => setScreen("settings")}><AppIcon name="settings" /></button>
    </nav>
    {preparing && <div className="preparation-overlay" role="status"><div className="preparation-loader" /><strong>Создаём ситуацию и оппонента</strong><span>Подбираем сложность, цели и поведение…</span></div>}
    <main>
      {screen === "home" && <section className="hero dialogue-empty"><p className="kicker">{isEnglish ? "Personal practice" : "Персональная тренировка"}</p><h1>{isEnglish ? "Practice a negotiation with a virtual client." : "Проведите диалог с виртуальным оппонентом."}</h1><p className="hero-copy">{isEnglish ? "Set the difficulty and describe the client to begin." : "Настройте сложность и задайте собеседника."}</p><div className="hero-actions"><button className="primary" onClick={reset}>{isEnglish ? "Start negotiation" : "Начать диалог"}</button></div></section>}

      {screen === "history" && <HistoryLibrary timelines={timelines} loading={historyLoading} error={historyError} selectedSessionId={historyTargetId} onOpen={(id) => void openSavedSession(id)} onPoint={(id, message) => void openHistoryPoint(id, message)} onNew={reset} />}

      {screen === "results" && <ResultsArchive timelines={timelines} loading={historyLoading} onOpen={(id) => void openResult(id)} onNew={reset} />}

      {screen === "profile" && <section className="profile-view"><header><p className="kicker">{isEnglish ? "Your details" : "Ваши данные"}</p><h1>{isEnglish ? "Profile" : "Профиль"}</h1><p>{isEnglish ? "These details are used automatically in new negotiations." : "Эти данные автоматически используются при создании новых переговоров."}</p></header><ProfileForm profile={profile} onChange={changeProfile} /><section className="profile-account"><strong>{isEnglish ? "Account" : "Аккаунт"}</strong><p>{accountUser.email}</p><button className="logout-button" onClick={() => void signOut()}>{isEnglish ? "Sign out" : "Выйти из аккаунта"}</button></section><p className={`profile-saved ${profileSaveState === "error" ? "error" : ""}`}>{profileSaveState === "saving" ? (isEnglish ? "Saving…" : "Сохраняем…") : profileSaveState === "error" ? (isEnglish ? "Could not save profile." : "Не удалось сохранить профиль.") : (isEnglish ? "Profile saved." : "Профиль сохранён.")}</p></section>}

      {screen === "settings" && <section className="settings-view"><header className="section-header"><p className="kicker">{isEnglish ? "Application" : "Приложение"}</p><h1>{isEnglish ? "Settings" : "Настройки"}</h1><p>{isEnglish ? "Choose the interface language and appearance." : "Выберите язык интерфейса и оформление приложения."}</p></header><div className="settings-controls"><section className="settings-card"><h2>{isEnglish ? "Interface language" : "Язык интерфейса"}</h2><select value={language} onChange={(event) => setLanguage(event.target.value)}><option value="ru">Русский</option><option value="en">English</option></select><small>{isEnglish ? "The selected language is saved for this browser." : "Выбранный язык сохраняется для этого браузера."}</small></section><section className="settings-card"><h2>{isEnglish ? "Appearance" : "Оформление"}</h2><div className="theme-buttons"><button className={theme === "light" ? "selected" : ""} onClick={() => setTheme("light")}>{isEnglish ? "Light theme" : "Светлая тема"}</button><button className={theme === "dark" ? "selected" : ""} onClick={() => setTheme("dark")}>{isEnglish ? "Dark theme" : "Тёмная тема"}</button></div></section></div><div className="settings-grid"><article><AppIcon name="spark" /><div><strong>{isEnglish ? "AI opponent" : "Нейросеть"}</strong><p>{isEnglish ? "Gemini creates the client's behavior and provides coaching during the conversation." : "Gemini создаёт поведение заказчика и предлагает подсказки по ходу разговора."}</p></div></article><article><AppIcon name="history" /><div><strong>{isEnglish ? "Data storage" : "Хранение данных"}</strong><p>{isEnglish ? "Empty sessions are removed automatically; other data is stored for 7 days." : "Пустые сессии удаляются автоматически, остальные данные хранятся 7 дней."}</p></div></article></div></section>}

{screen === "workspace" && <section className="workspace session-setup"><header className="workspace-head"><p className="kicker">Настройка сессии</p><h1>Подготовьте заказчика</h1><p>Укажите сферу бизнеса и выберите сложность разговора.</p></header><div className="setup-grid"><section className="setup-card training-card"><p className="field-kicker">Сложность разговора</p><div className="difficulty-tabs">{([{ id: "easy", title: "Легко", text: "Заказчик открыт к предложению. Достаточно выявить ситуацию и желаемый результат." }, { id: "normal", title: "Нормально", text: "Заказчик сомневается. Нужно выявить ситуацию, проблему и ожидаемый результат." }, { id: "serious", title: "Сложно", text: "Заказчик недоверчив. Потребуется пройти все этапы SPIN и привести доказательства." }] as const).map((item) => <button key={item.id} className={player.difficulty === item.id ? "selected" : ""} onClick={() => setDifficulty(item.id)}>{item.title}</button>)}</div><p className="difficulty-description">{player.difficulty === "easy" ? "Заказчик открыт к предложению. Достаточно выявить ситуацию и желаемый результат." : player.difficulty === "serious" ? "Заказчик недоверчив. Потребуется пройти все этапы SPIN и привести доказательства." : "Заказчик сомневается. Нужно выявить ситуацию, проблему и ожидаемый результат."}</p><div className="method-selects"><label>Как отвечать на возражения<select value={player.objectionMethod ?? "clarify"} onChange={(event) => changePlayer({ ...player, objectionMethod: event.target.value as SideProfile["objectionMethod"] })}><option value="clarify">Уточнить и ответить</option><option value="agree">Согласиться и дополнить</option><option value="reframe">Переформулировать через выгоду</option></select><small>Выберите приём, который хотите отработать после появления сомнения у заказчика.</small></label><label>Как завершать переговоры<select value={player.closingMethod ?? "next-step"} onChange={(event) => changePlayer({ ...player, closingMethod: event.target.value as SideProfile["closingMethod"] })}><option value="next-step">Предложить следующий шаг</option><option value="alternative">Выбор из двух вариантов</option><option value="summary">Резюме договорённостей</option></select><small>Выберите способ, которым будете переводить разговор к договорённости.</small></label></div></section><section className="setup-card opponent-fields"><div className="setup-card-head"><p className="field-kicker">Данные заказчика</p><button className="random-opponent action-with-icon" type="button" onClick={randomizeOpponentData}><AppIcon name="shuffle" />Случайный заказчик</button></div><div className="name-fields opponent-name-fields"><label><span>Имя <small className="optional">обязательно</small></span><input value={opponent.name} onChange={(event) => changeOpponent({ ...opponent, name: event.target.value })} placeholder="Например, Андрей" /></label><label><span>Отчество <small className="optional">необязательно</small></span><input value={opponent.patronymic} onChange={(event) => changeOpponent({ ...opponent, patronymic: event.target.value })} placeholder="Например, Михайлович" /></label></div><label>Сфера бизнеса заказчика <span className="field-example">например: маникюр, строительные материалы</span><input value={opponent.role} onChange={(event) => changeOpponent({ ...opponent, role: event.target.value })} placeholder="Например, салон маникюра" /></label><label>Цель заказчика<textarea value={opponent.goal} onChange={(event) => changeOpponent({ ...opponent, goal: event.target.value })} placeholder="Например, привлечь больше клиентов и убедиться в соблюдении сроков" /></label></section></div>{aiError && <p className="ai-error">{aiError}</p>}<div className="controls"><button className="quiet" onClick={() => setScreen("home")}>Назад</button><button className="primary" onClick={() => void beginSession()} disabled={preparing || !opponent.name.trim() || !opponent.role.trim() || !opponent.goal.trim()}>{preparing ? "Подготавливаем…" : "Создать сессию"}</button></div></section>}

      {screen === "talk" && plan && <section className="negotiation negotiation-redesign"><div className="conversation"><section className="opponent-portrait"><div className="portrait-placeholder" aria-hidden="true" /><div className="portrait-copy"><p className="kicker">Ваш оппонент</p><h1>{opponent.name} {opponent.patronymic}</h1><p>{opponent.role}</p></div></section>{aiError && <p className="ai-error">{aiError}</p>}<div className="messages" aria-live="polite">{messages.map((message, index) => <article key={`${message.turn}-${message.role}-${index}`} className={`message ${message.role}`}><div className="message-meta"><span>{message.role === "player" ? `Вы · ход ${message.turn}` : opponent.name}</span>{message.role === "player" && sessionId && <button onClick={() => beginRewrite(message)} disabled={thinking}>Изменить отсюда</button>}</div><p>{message.text}</p>{message.role === "opponent" && message.snapshot?.nonverbalCue && <em className="nonverbal">{message.snapshot.nonverbalCue}</em>}</article>)}{thinking && <article className="message opponent thinking"><span>{opponent.name}</span><p>Формулирует ответ…</p></article>}</div><form className="composer dialogue-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}><textarea ref={composerRef} rows={1} aria-label="Ваша реплика" maxLength={800} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Напишите сообщение…" disabled={thinking || (state.status !== "active" && !rewrite)} /><span className="composer-actions"><button className={`voice-button icon-action ${voiceListening ? "recording" : ""}`} data-tooltip={voiceListening ? "Остановить запись" : "Голосовой ввод"} aria-label={voiceListening ? "Остановить запись" : "Голосовой ввод"} type="button" onClick={() => void startVoiceInput()} disabled={thinking}><AppIcon name="mic" /></button><button className="primary icon-action" data-tooltip="Отправить" aria-label="Отправить" disabled={!draft.trim() || thinking || (state.status !== "active" && !rewrite)}><AppIcon name="send" /></button></span></form></div><aside className="coaching-panel"><button className="finish-session action-with-icon" onClick={() => void finishNegotiation()} disabled={reportLoading}><AppIcon name="finish" />{reportLoading ? "Готовим результат…" : "Завершить диалог"}</button><section className="task-section"><p className="panel-title"><AppIcon name="finish" />Задачи</p><strong className="task-stage-title">{taskStage.title}</strong><div className="task-checklist">{taskStage.steps.map((step) => { const done = state.matchedKeywords.includes(step.id); return <label className={done ? "done" : ""} key={step.id}><input type="checkbox" checked={done} readOnly /><span>{step.intent}</span></label>; })}</div>{(rewrite || branchInfo.parentSessionId) && <div className="branch-context"><strong>{rewrite ? `Новая ветка от хода ${rewrite.turn}` : `Альтернативная ветка ${branchInfo.correctionNumber} из 3`}</strong><p>{rewrite ? "После отправки будет сохранён новый вариант. Исходный диалог останется в истории." : `Эта версия началась после хода ${branchInfo.branchedFromTurn}. Все варианты доступны на доске истории.`}</p><div><button type="button" onClick={() => { setHistoryTargetId(sessionId); setScreen("history"); void refreshHistory(); }}>Вернуться в дерево</button></div></div>}</section><section className="advice-section"><p className="panel-title"><AppIcon name="interest" />Советы</p>{lastSnapshot?.advice ? <><p className="advice-text">{theoryTip}</p><button type="button" className="use-advice" disabled={suggestionUses >= 3 || thinking} onClick={() => { setDraft(lastSnapshot.advice ?? ""); setSuggestionUses((value) => value + 1); }}>Использовать подсказку <span>{3 - suggestionUses} осталось</span></button></> : <p className="advice-empty">После вашей первой реплики здесь появится подсказка.</p>}</section></aside></section>}

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

function HistoryLibrary({ timelines, loading, error, selectedSessionId, onOpen, onPoint, onNew }: { timelines: SessionTimeline[]; loading: boolean; error: string; selectedSessionId: string | null; onOpen: (id: string) => void; onPoint: (id: string, message: StoredMessage) => void; onNew: () => void }) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(selectedSessionId);
  const [scale, setScale] = useState(.9);
  const [offset, setOffset] = useState({ x: 46, y: 70 });
  const drag = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  useEffect(() => {
    const release = () => { drag.current = null; };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("blur", release);
    return () => { window.removeEventListener("pointerup", release); window.removeEventListener("pointercancel", release); window.removeEventListener("blur", release); };
  }, []);
  const normalizedQuery = query.trim().toLocaleLowerCase("ru-RU");
  const roots = timelines.filter((session) => !session.parentSessionId);
  const visible = roots.filter((session) => { const family = timelines.filter((item) => (item.rootSessionId ?? item.id) === session.id); return !normalizedQuery || session.title.toLocaleLowerCase("ru-RU").includes(normalizedQuery) || family.some((item) => item.messages.some((message) => message.text.toLocaleLowerCase("ru-RU").includes(normalizedQuery))); });
  const selected = timelines.find((session) => session.id === selectedId) ?? null;
  const resetBoard = () => { setScale(.9); setOffset({ x: 46, y: 70 }); };
  if (!selected) return <section className="history-view history-library"><header className="history-head"><div><p className="kicker">История</p><h1>Ваши диалоги</h1><p>Выберите переговоры, чтобы открыть дерево реплик и ответвлений.</p></div><button className="primary" onClick={onNew}>Новые переговоры</button></header><div className="tree-search"><AppIcon name="chat" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти диалог, слово или фразу" /></div>{error && <p className="ai-error">{error}</p>}{loading ? <p className="history-empty">Загрузка диалогов…</p> : visible.length === 0 ? <p className="history-empty">Сохранённых переговоров пока нет.</p> : <div className="dialogue-tabs">{visible.map((session) => <button className="dialogue-tab" key={session.id} onClick={() => { setSelectedId(session.id); resetBoard(); }}><span><small>{new Date(session.updatedAt).toLocaleDateString("ru-RU")}</small><strong>{session.player.name} {session.player.patronymic} ↔ {session.opponent.name} {session.opponent.patronymic}</strong><em>{session.opponent.role}</em></span><b>{session.parentSessionId ? `Ветка ${session.correctionNumber}` : session.status === "active" ? "В процессе" : "Завершён"}</b></button>)}</div>}</section>;
  const selectedRoot = selected.rootSessionId ?? selected.id;
  const related = timelines.filter((session) => (session.rootSessionId ?? session.id) === selectedRoot).sort((a, b) => a.correctionNumber - b.correctionNumber);
  return <section className="history-view board-view"><header className="board-dialog-head"><button className="quiet" onClick={() => setSelectedId(null)}>← Все диалоги</button><div><strong>{selected.player.name} {selected.player.patronymic} ↔ {selected.opponent.name} {selected.opponent.patronymic}</strong><small>{new Date(selected.updatedAt).toLocaleDateString("ru-RU")} · {selected.opponent.role}</small></div><div className="zoom-controls"><button onClick={() => setScale((value) => Math.max(.5, value - .1))}>−</button><span>{Math.round(scale * 100)}%</span><button onClick={() => setScale((value) => Math.min(1.4, value + .1))}>+</button><button onClick={resetBoard}>По центру</button></div></header><div className="dialogue-board" onPointerDown={(event) => { if ((event.target as HTMLElement).closest("button")) return; event.preventDefault(); drag.current = { x: event.clientX, y: event.clientY, originX: offset.x, originY: offset.y }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (!drag.current || event.buttons === 0) { drag.current = null; return; } event.preventDefault(); setOffset({ x: drag.current.originX + event.clientX - drag.current.x, y: drag.current.originY + event.clientY - drag.current.y }); }} onPointerUp={(event) => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}><div className="board-stage dialogue-flow" style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}>{related.map((session) => { const branchMessages = session.parentSessionId ? session.messages.filter((message) => message.turn >= (session.branchedFromTurn ?? 0)) : session.messages; return <article className={`flow-branch ${session.parentSessionId ? "is-branch" : "is-root"}`} key={session.id}><header><span>{session.parentSessionId ? `Ветка ${session.correctionNumber} · после хода ${session.branchedFromTurn}` : "Основной диалог"}</span><button onClick={() => onOpen(session.id)}>Продолжить</button></header>{session.parentSessionId && <div className="fork-origin">Ответвление от основной линии</div>}<div className="flow-nodes">{branchMessages.map((message, index) => { const advice = message.role === "player" ? message.snapshot?.advice : undefined; return <button key={`${session.id}-${message.turn}-${index}`} className={`flow-node ${message.role} ${advice ? "has-advice" : ""}`} onClick={() => onPoint(session.id, message)}><small>{message.role === "player" ? "Вы" : session.opponent.name}</small><strong>{message.text}</strong>{advice && <span className="advice-popover"><small>Совет</small><strong>{advice}</strong></span>}</button>; })}</div></article>; })}</div></div></section>;
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
  return <section className={`profile-form setup-card ${highlighted ? "highlighted" : ""}`}><p className="field-kicker">Ваши данные</p><div className="name-fields"><label>Имя <span className="required">обязательно</span><input value={profile.name} onChange={(event) => onChange({ ...profile, name: event.target.value })} placeholder="Например, Александр" /></label><label>Отчество <span className="optional">необязательно</span><input value={profile.patronymic} onChange={(event) => onChange({ ...profile, patronymic: event.target.value })} placeholder="Например, Сергеевич" /></label></div><label>Профессия<input value={profile.role} onChange={(event) => onChange({ ...profile, role: event.target.value })} placeholder="Например, веб-дизайнер" /></label><label>Какие услуги вы продаёте?<textarea value={profile.services ?? ""} onChange={(event) => onChange({ ...profile, services: event.target.value, goal: event.target.value })} placeholder="Например, создаю сайты, логотипы и фирменный стиль" /></label><label>Опыт и сильные стороны<textarea value={profile.experienceStrengths ?? ""} onChange={(event) => onChange({ ...profile, experienceStrengths: event.target.value })} placeholder="Например, 3 года опыта, работаю по этапам и соблюдаю сроки" /></label></section>;
}

type AppIconName = "home" | "spark" | "chat" | "history" | "chart" | "profile" | "settings" | "trust" | "interest" | "irritation" | "ethics" | "understanding" | "mic" | "send" | "finish" | "shuffle";
function AppIcon({ name }: { name: AppIconName }) {
  const sources: Record<AppIconName, string> = {
    home: "/icons/logo.svg", spark: "/icons/history.svg", chat: "/icons/new-session.svg",
    history: "/icons/new-session.svg", chart: "/icons/statistics.svg", profile: "/icons/profile.svg",
    settings: "/icons/settings.png", trust: "/icons/tasks.svg", interest: "/icons/advice.svg",
    irritation: "/icons/advice.svg", ethics: "/icons/tasks.svg", understanding: "/icons/advice.svg",
    mic: "/icons/microphone.svg", send: "/icons/send.svg", finish: "/icons/tasks.svg",
    shuffle: "/icons/new-session.svg",
  };
  return <Image className="app-icon-image" src={sources[name]} width={47} height={47} alt="" aria-hidden="true" />;
}
function ResultRow({ label, value }: { label: string; value: string | number }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function ReportBlock({ title, items }: { title: string; items: string[] }) { return <article><h3>{title}</h3>{items.length ? <ul>{items.map((item, index) => <li key={`${title}-${index}`}>{item}</li>)}</ul> : <p>Не выявлено.</p>}</article>; }
