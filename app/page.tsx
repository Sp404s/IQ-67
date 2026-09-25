"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { applySemanticEvaluation, createInitialState, sideLabels, type NegotiationPlan, type NegotiationState, type SemanticEvaluation, type SessionReport, type SideProfile } from "./negotiation";
import { createBranchSession, createSession, listSessionTimelines, loadSession, saveSessionReport, saveTurn, type SessionSummary, type SessionTimeline, type StoredMessage } from "@/lib/supabase/storage";

type Screen = "home" | "workspace" | "talk" | "result" | "history";
type Message = StoredMessage;
type RewritePoint = { turn: number; text: string };

const characterOptions = ["Уверенный и деловой", "Осторожный и недоверчивый", "Требовательный и прямолинейный", "Дружелюбный и открытый", "Аналитичный и сдержанный"];
const motivationOptions = ["Получить качественный результат без лишних расходов", "Запустить проект как можно быстрее", "Снизить личные и деловые риски", "Показать руководству сильный результат", "Найти надёжного партнёра для долгой работы"];
const boundaryOptions = ["Бюджет фиксирован, превышение невозможно", "Срок запуска нельзя переносить", "Предоплата должна быть минимальной", "Решение возможно только после подтверждения руководителя", "Качество важнее цены, но результат должен быть измеримым"];
const interestOptions = ["Хочет получить дополнительный объём работ без доплаты", "Готов заплатить больше за снижение риска", "Боится выглядеть некомпетентным перед руководством", "Ищет исполнителя для следующих проектов", "Хочет получить быстрый первый результат перед полным договором"];
const speechOptions = ["Коротко и по делу", "Подробно и аналитично", "Мягко и дипломатично", "Жёстко и прямолинейно", "Осторожно, часто уточняет"];
const habitOptions = ["Часто переспрашивает важные условия", "Возвращается к цифрам и срокам", "Делает паузу перед решением", "Использует примеры из опыта", "Иногда перебивает и требует конкретики"];
const languageOptions = ["Только нейтральная лексика", "Допускает разговорные выражения", "При раздражении может использовать резкие слова"];
const emotionalityOptions = ["Сдержанная", "Умеренная", "Высокая"];
const initialPlayer: SideProfile = { name: "Александр", patronymic: "Сергеевич", side: "provider", role: "Дизайнер", goal: "Продать услуги по разработке фирменного стиля и сайта.", boundaries: boundaryOptions[4], person: "Самостоятельный дизайнер с опытом коммерческих проектов.", motivation: motivationOptions[4], character: characterOptions[0], hiddenInterest: interestOptions[3], speechStyle: speechOptions[0], habits: habitOptions[1], languageStyle: languageOptions[0], emotionality: emotionalityOptions[1] };
const initialOpponent: SideProfile = { name: "Андрей", patronymic: "Михайлович", side: "buyer", role: "Владелец компании", goal: "Получить современный дизайн сайта в рамках бюджета и сроков.", boundaries: boundaryOptions[0], person: "Владелец небольшой компании. Раньше сталкивался со срывом сроков подрядчиком.", motivation: motivationOptions[2], character: characterOptions[1], hiddenInterest: interestOptions[4], speechStyle: speechOptions[4], habits: habitOptions[2], languageStyle: languageOptions[0], emotionality: emotionalityOptions[1] };
const pick = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)];

export default function Home() {
  const [screen, setScreen] = useState<Screen>("home");
  const [player, setPlayer] = useState(initialPlayer), [opponent, setOpponent] = useState(initialOpponent);
  const [plan, setPlan] = useState<NegotiationPlan | null>(null), [preparing, setPreparing] = useState(false);
  const [state, setState] = useState<NegotiationState>(() => createInitialState());
  const [messages, setMessages] = useState<Message[]>([]), [draft, setDraft] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null), [saveState, setSaveState] = useState<"local" | "saving" | "saved">("local");
  const [thinking, setThinking] = useState(false), [aiError, setAiError] = useState("");
  const [sessions, setSessions] = useState<SessionSummary[]>([]), [historyLoading, setHistoryLoading] = useState(false), [historyError, setHistoryError] = useState("");
  const [timelines, setTimelines] = useState<SessionTimeline[]>([]);
  const [rewrite, setRewrite] = useState<RewritePoint | null>(null);
  const [branchInfo, setBranchInfo] = useState<{ parentSessionId: string | null; branchedFromTurn: number | null; correctionNumber: number }>({ parentSessionId: null, branchedFromTurn: null, correctionNumber: 0 });
  const [report, setReport] = useState<SessionReport | null>(null), [reportLoading, setReportLoading] = useState(false);

  const lastSnapshot = useMemo(() => [...messages].reverse().find((message) => message.snapshot)?.snapshot, [messages]);
  const remaining = plan ? Math.max(0, plan.maxMessages - messages.length) : 0;
  const sessionNames = useMemo(() => new Map(sessions.map((session) => [session.id, session.title])), [sessions]);

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
  function swapSides() { setPlayer(opponent); setOpponent(player); setPlan(null); }
  async function prepareOpponent() {
    setPreparing(true); setAiError("");
    try {
      const response = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ player, opponent }) });
      const data = await response.json() as { plan?: NegotiationPlan; warning?: string; error?: string };
      if (!response.ok || !data.plan) throw new Error(data.error ?? "Не удалось построить маршрут.");
      setPlan(data.plan);
      if (data.warning) setAiError(`Маршрут создан локально: ${data.warning}`);
    } catch (error) { setAiError(error instanceof Error ? error.message : "Не удалось построить маршрут."); }
    finally { setPreparing(false); }
  }
  function randomizeOpponent() {
    setOpponent((current) => ({ ...current, character: pick(characterOptions), motivation: pick(motivationOptions), boundaries: pick(boundaryOptions), hiddenInterest: pick(interestOptions), speechStyle: pick(speechOptions), habits: pick(habitOptions), languageStyle: pick(languageOptions), emotionality: pick(emotionalityOptions) }));
    setPlan(null);
  }

  async function startNegotiation() {
    if (!plan) return;
    const opening = opponent.side === "buyer"
      ? `Здравствуйте, ${player.name} ${player.patronymic}. Я рассматриваю ваши услуги. Расскажите, что именно входит в ваше предложение?`
      : opponent.side === "provider"
        ? `Здравствуйте, ${player.name} ${player.patronymic}. Расскажите, какую задачу вы хотите решить, какой результат и сроки рассматриваете?`
        : `Здравствуйте, ${player.name} ${player.patronymic}. Предлагаю обозначить позиции сторон и ожидаемый результат разговора.`;
    const fresh = createInitialState();
    setState(fresh); setMessages([{ role: "opponent", text: opening, turn: 0 }]); setScreen("talk"); setSaveState("saving"); setRewrite(null); setReport(null); setBranchInfo({ parentSessionId: null, branchedFromTurn: null, correctionNumber: 0 });
    const id = await createSession(player, opponent, fresh, opening, plan);
    setSessionId(id); setSaveState(id ? "saved" : "local");
    if (!id) setAiError("Не удалось создать сессию в Supabase. Проверьте, применена ли новая миграция базы данных.");
    else void refreshHistory();
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

  function reset() {
    setState(createInitialState()); setMessages([]); setSessionId(null); setSaveState("local"); setAiError(""); setPlan(null); setRewrite(null); setReport(null); setBranchInfo({ parentSessionId: null, branchedFromTurn: null, correctionNumber: 0 }); setScreen("workspace");
  }

  return <div className="app-shell">
    <nav className="side-nav" aria-label="Основная навигация">
      <button className={`icon-button ${screen === "home" ? "active" : ""}`} data-tooltip="Главная" aria-label="Главная" onClick={() => setScreen("home")}><AppIcon name="home" /></button>
      <button className={`icon-button ${screen === "workspace" ? "active" : ""}`} data-tooltip="Новые переговоры" aria-label="Новые переговоры" onClick={() => setScreen("workspace")}><AppIcon name="spark" /></button>
      <button className={`icon-button ${screen === "talk" ? "active" : ""}`} data-tooltip="Текущий диалог" aria-label="Текущий диалог" disabled={!plan} onClick={() => plan && setScreen("talk")}><AppIcon name="chat" /></button>
      <button className={`icon-button ${screen === "history" ? "active" : ""}`} data-tooltip="История" aria-label="История" onClick={() => { setScreen("history"); void refreshHistory(); }}><AppIcon name="history" /></button>
      <span className="nav-spacer" />
      <button className={`icon-button ${screen === "result" ? "active" : ""}`} data-tooltip="Результаты" aria-label="Результаты" disabled={!report} onClick={() => report && setScreen("result")}><AppIcon name="chart" /></button>
    </nav>
    <header className="topbar">
      <button className="wordmark" onClick={() => setScreen("home")}>Арена переговоров</button>
      <div className="top-actions"><button className="nav-button" onClick={() => { setScreen("history"); void refreshHistory(); }}>История{sessions.length ? ` · ${sessions.length}` : ""}</button><span className="status">{saveState === "saved" ? "Сохранено в Supabase" : saveState === "saving" ? "Сохранение…" : "Локальный режим"}</span></div>
    </header>
    <main>
      {screen === "home" && <section className="hero"><p className="kicker">Тренажёр переговоров</p><h1>Создайте оппонента и найдите путь к соглашению.</h1><p className="hero-copy">Характер, мотивация и скрытые интересы управляют поведением оппонента. Каждая попытка сохраняется, а любую реплику можно исправить в новой ветке.</p><div className="hero-actions"><button className="primary" onClick={() => setScreen("workspace")}>Начать</button><button className="quiet" onClick={() => { setScreen("history"); void refreshHistory(); }}>Открыть историю</button></div></section>}

      {screen === "history" && <HistoryView timelines={timelines} loading={historyLoading} error={historyError} names={sessionNames} onOpen={(id) => void openSavedSession(id)} onPoint={(id, message) => void openHistoryPoint(id, message)} onNew={() => setScreen("workspace")} />}

      {screen === "workspace" && <section className="workspace"><header className="workspace-head"><p className="kicker">Настройка оппонента</p><h1>Поле переговоров</h1><p>Настройте обе стороны. Перед стартом система скрытно построит последовательный маршрут к соглашению.</p></header><div className="sides"><SideCard title="Вы играете" profile={player} onChange={changePlayer} /><button className="swap" onClick={swapSides}><span>⇄</span>Поменять стороны</button><SideCard title="Оппонент" profile={opponent} onChange={changeOpponent} onRandomize={randomizeOpponent} /></div><section className="plan-card"><div><p className="kicker">Подготовка переговоров</p><h2>{plan ? "Маршрут готов" : "Постройте маршрут перед стартом"}</h2><p>{plan ? `Создано ${plan.route.length} скрытых смысловых этапов. Лимит: ${plan.maxMessages} реплик.` : "Этапы, ключевые фразы и критерии прохождения будут сформированы заранее и останутся скрытыми до завершения сессии."}</p></div><button className="quiet" onClick={() => void prepareOpponent()} disabled={preparing}>{preparing ? "Подготовка…" : plan ? "Построить заново" : "Построить скрытый маршрут"}</button></section><div className="controls"><button className="quiet" onClick={() => setScreen("home")}>Назад</button><button className="primary" onClick={startNegotiation} disabled={!plan}>Начать переговоры</button></div></section>}

      {screen === "talk" && plan && <section className="negotiation"><div className="conversation"><div className="conversation-head"><div><p className="kicker">Реплика {messages.length} из {plan.maxMessages}</p><h1>{player.role}</h1></div><button className="quiet" onClick={() => void finishNegotiation()} disabled={reportLoading}>{reportLoading ? "Подготовка отчёта…" : "Завершить"}</button></div>{branchInfo.parentSessionId && <div className="branch-banner"><strong>Альтернативная ветка</strong><span>Исправление {branchInfo.correctionNumber} из 3, с хода {branchInfo.branchedFromTurn}. Исходный диалог сохранён.</span></div>}<div className="route-bar"><div><span>Путь к цели</span><strong>{state.routeProgress}%</strong></div><div className="route-track"><span style={{ width: `${state.routeProgress}%` }} /></div><small>Осталось реплик: {remaining}</small></div>{aiError && <p className="ai-error">{aiError}</p>}<div className="messages" aria-live="polite">{messages.map((message, index) => <article key={`${message.turn}-${message.role}-${index}`} className={`message ${message.role}`}><div className="message-meta"><span>{message.role === "player" ? `Вы · ход ${message.turn}` : opponent.role}</span>{message.role === "player" && sessionId && <button onClick={() => beginRewrite(message)} disabled={thinking}>Изменить отсюда</button>}</div><p>{message.text}</p>{message.role === "opponent" && message.snapshot?.nonverbalCue && <em className="nonverbal">{message.snapshot.nonverbalCue}</em>}</article>)}{thinking && <article className="message opponent thinking"><span>{opponent.role}</span><p>Формулирует ответ…</p></article>}</div>{state.status !== "active" && !rewrite && <p className="session-ended">Эта версия завершена. Выберите любую свою реплику выше и нажмите «Изменить отсюда», чтобы создать новую ветку.</p>}{rewrite && <div className="rewrite-banner"><div><strong>Создание новой ветки с хода {rewrite.turn}</strong><span>Следующие реплики будут заменены только в новой версии. Исходная история сохранится.</span></div><button type="button" onClick={() => { setRewrite(null); setDraft(""); }}>Отмена</button></div>}<form className="composer" onSubmit={(event) => { event.preventDefault(); void send(); }}><label htmlFor="reply">{rewrite ? "Исправленная реплика" : "Ваша реплика"}</label><textarea id="reply" maxLength={800} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Задайте вопрос или предложите обмен…" disabled={thinking || (state.status !== "active" && !rewrite)} /><div><span>{draft.length}/800</span><button className="primary" disabled={!draft.trim() || thinking || (state.status !== "active" && !rewrite)}>{thinking ? "Ожидание…" : rewrite ? "Создать ветку и отправить" : "Отправить"}</button></div></form></div><aside className="state-panel"><p className="kicker">Состояние оппонента</p><Meter label="Доверие" value={state.trust} /><Meter label="Интерес" value={state.dealInterest} /><Meter label="Раздражение" value={state.irritation} inverse /><Meter label="Этичность диалога" value={state.ethicalConduct} /><Meter label="Взаимопонимание" value={100 - state.misunderstanding} /><p className="route-summary">Пройдено этапов: <strong>{state.matchedKeywords.length} из {plan.route.length}</strong></p>{lastSnapshot && <div className="last-action"><strong>Последнее действие: {lastSnapshot.actionLabel}</strong>{lastSnapshot.rationale && <span>{lastSnapshot.rationale}</span>}</div>}<h3>Память оппонента</h3><div className="memory-summary"><span>Обещания: {state.memory.promises.length}</span><span>Уступки: {state.memory.concessions.length}</span><span>Противоречия: {state.memory.contradictions.length}</span><span>Договорённости: {state.memory.agreements.length}</span></div></aside></section>}

      {screen === "result" && <section className="results"><p className="kicker">Результат</p><h1>{state.status === "deal" ? "Маршрут пройден" : state.status === "walkaway" ? "Переговоры сорваны" : "Диалог завершён"}</h1><div className="result-grid"><article><span>Достижение цели</span><strong>{state.routeProgress}%</strong><p>{messages.length} реплик</p></article><div className="analysis-list"><ResultRow label="Доверие" value={state.trust} /><ResultRow label="Интерес" value={state.dealInterest} /><ResultRow label="Раздражение" value={state.irritation} /><ResultRow label="Этичность" value={state.ethicalConduct} /><ResultRow label="Взаимопонимание" value={100 - state.misunderstanding} /><ResultRow label="Смыслы" value={`${state.matchedKeywords.length}/${plan?.keywords.length ?? 0}`} /></div></div>{reportLoading && <p className="report-loading">ИИ готовит разбор переговоров…</p>}{report && <section className="session-report"><header><p className="kicker">Разбор сессии</p><h2>О чём вы договорились</h2><p>{report.summary}</p></header><div className="report-grid"><ReportBlock title="Согласовано" items={report.agreed} /><ReportBlock title="Осталось открытым" items={report.openQuestions} /><ReportBlock title="Интересы и мотивы" items={report.interests} /><ReportBlock title="Ошибки" items={report.mistakes} /><ReportBlock title="Советы тренера" items={report.advice} /><ReportBlock title="Риски" items={report.risks} /></div></section>}<div className="controls result-controls"><button className="quiet" onClick={() => setScreen("history")}>История версий</button>{messages.some((message) => message.role === "player") && branchInfo.correctionNumber < 3 && <button className="quiet" onClick={() => setScreen("talk")}>Исправить ошибку · осталось {3 - branchInfo.correctionNumber}</button>}<button className="primary" onClick={reset}>Новая попытка</button></div></section>}
    </main>
  </div>;
}

function HistoryView({ timelines, loading, error, names, onOpen, onPoint, onNew }: { timelines: SessionTimeline[]; loading: boolean; error: string; names: Map<string, string>; onOpen: (id: string) => void; onPoint: (id: string, message: StoredMessage) => void; onNew: () => void }) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase("ru-RU");
  const depthOf = (session: SessionTimeline) => {
    let depth = 0, parent = session.parentSessionId;
    const visited = new Set<string>();
    while (parent && depth < 3 && !visited.has(parent)) { visited.add(parent); depth += 1; parent = timelines.find((item) => item.id === parent)?.parentSessionId ?? null; }
    return depth;
  };
  const visible = timelines.filter((session) => !normalizedQuery || session.title.toLocaleLowerCase("ru-RU").includes(normalizedQuery) || session.messages.some((message) => message.text.toLocaleLowerCase("ru-RU").includes(normalizedQuery)));
  const matchCount = normalizedQuery ? visible.reduce((count, session) => count + session.messages.filter((message) => message.text.toLocaleLowerCase("ru-RU").includes(normalizedQuery)).length, 0) : 0;
  return <section className="history-view"><header className="history-head"><div><p className="kicker">Карта переговоров</p><h1>Дерево диалогов</h1><p>Каждая точка хранит реплику и состояние оппонента на этом ходе. Найдите нужное место и создайте альтернативную ветку — доступно до трёх исправлений.</p></div><button className="primary" onClick={onNew}>Новые переговоры</button></header><div className="tree-search"><AppIcon name="chat" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти слово или фразу во всех диалогах" aria-label="Поиск по истории диалогов" />{normalizedQuery && <span>{matchCount} совпад.</span>}</div>{error && <p className="ai-error">{error}</p>}{loading ? <p className="history-empty">Загрузка дерева…</p> : visible.length === 0 ? <p className="history-empty">{normalizedQuery ? "Совпадений не найдено." : "Сохранённых переговоров пока нет."}</p> : <div className="dialogue-tree">{visible.map((session) => { const depth = depthOf(session); return <article className={`tree-branch depth-${depth}`} key={session.id}><div className="branch-line" /><header className="tree-branch-head"><div><div className="history-badges"><span>{session.parentSessionId ? `Ветка ${session.correctionNumber} из 3 · после хода ${session.branchedFromTurn}` : "Основная линия"}</span><span>{session.status === "active" ? "В процессе" : session.status === "deal" ? "Сделка" : "Завершено"}</span></div><h2>{session.title}</h2><p>{session.player.name} {session.player.patronymic} ↔ {session.opponent.name} {session.opponent.patronymic}</p>{session.parentSessionId && <small>Ответвление от: {names.get(session.parentSessionId) ?? "предыдущая версия"}</small>}</div><button className="quiet" onClick={() => onOpen(session.id)}>Открыть полностью</button></header><div className="turn-nodes">{session.messages.map((message, index) => { const matched = normalizedQuery && message.text.toLocaleLowerCase("ru-RU").includes(normalizedQuery); const snapshot = message.snapshot; return <button className={`turn-node ${message.role} ${matched ? "match" : ""}`} key={`${session.id}-${message.turn}-${message.role}-${index}`} onClick={() => onPoint(session.id, message)} title="Вернуться к этой точке"><span className="node-dot"><AppIcon name={message.role === "player" ? "chat" : "spark"} /></span><span className="node-copy"><small>{message.role === "player" ? `Вы · ход ${message.turn}` : `${session.opponent.role} · ход ${message.turn}`}</small><strong>{message.text}</strong>{snapshot && <em>Доверие {snapshot.after.trust} · Интерес {snapshot.after.dealInterest} · Раздражение {snapshot.after.irritation}</em>}</span></button>; })}</div></article>; })}</div>}</section>;
}

function SideCard({ title, profile, onChange, onRandomize }: { title: string; profile: SideProfile; onChange: (value: SideProfile) => void; onRandomize?: () => void }) {
  const field = (key: keyof SideProfile, value: string) => onChange({ ...profile, [key]: value });
  return <article className="side-card"><div className="side-card-title"><p className="kicker">{title}</p>{onRandomize && <button className="randomize" type="button" onClick={onRandomize}>Случайная личность</button>}</div><div className="name-fields"><label>Имя<input value={profile.name} onChange={(e) => field("name", e.target.value)} /></label><label>Отчество<input value={profile.patronymic} onChange={(e) => field("patronymic", e.target.value)} /></label></div><label>Сторона переговоров<select value={profile.side} onChange={(e) => field("side", e.target.value)}>{Object.entries(sideLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Профессия или должность<input value={profile.role} onChange={(e) => field("role", e.target.value)} placeholder="Например: маркетолог" /></label><label>Цель переговоров<textarea value={profile.goal} onChange={(e) => field("goal", e.target.value)} /></label><label>Информация о человеке<textarea value={profile.person} onChange={(e) => field("person", e.target.value)} /></label><SelectField label="Характер" value={profile.character} options={characterOptions} onChange={(value) => field("character", value)} /><SelectField label="Личная мотивация" value={profile.motivation} options={motivationOptions} onChange={(value) => field("motivation", value)} /><SelectField label="Граница решения" value={profile.boundaries} options={boundaryOptions} onChange={(value) => field("boundaries", value)} /><SelectField label="Скрытый интерес" value={profile.hiddenInterest} options={interestOptions} onChange={(value) => field("hiddenInterest", value)} />{onRandomize && <div className="behavior-fields"><SelectField label="Стиль речи" value={profile.speechStyle} options={speechOptions} onChange={(value) => field("speechStyle", value)} /><SelectField label="Речевая привычка" value={profile.habits} options={habitOptions} onChange={(value) => field("habits", value)} /><SelectField label="Лексика" value={profile.languageStyle} options={languageOptions} onChange={(value) => field("languageStyle", value)} /><SelectField label="Эмоциональность" value={profile.emotionality} options={emotionalityOptions} onChange={(value) => field("emotionality", value)} /></div>}</article>;
}
function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) { return <label>{label}<select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option}>{option}</option>)}</select></label>; }
type AppIconName = "home" | "spark" | "chat" | "history" | "chart" | "trust" | "interest" | "irritation" | "ethics" | "understanding";
function AppIcon({ name }: { name: AppIconName }) {
  const paths: Record<AppIconName, ReactNode> = {
    home: <><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/></>,
    spark: <><path d="m12 3 1.2 4.2L17 9l-3.8 1.8L12 15l-1.2-4.2L7 9l3.8-1.8L12 3Z"/><path d="m19 15 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z"/></>,
    chat: <><path d="M4 5.5h16v11H9l-5 3v-14Z"/><path d="M8 10h8M8 13h5"/></>,
    history: <><path d="M4 5v5h5"/><path d="M5.6 17.5A8 8 0 1 0 4 10"/><path d="M12 7v5l3 2"/></>,
    chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>,
    trust: <><path d="M12 21s-8-4.8-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6.2-8 11-8 11Z"/></>,
    interest: <><circle cx="12" cy="12" r="3"/><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/></>,
    irritation: <><path d="M13 2 5 13h6l-1 9 9-13h-6V2Z"/></>,
    ethics: <><path d="M12 3v18M5 7h14M5 7l-3 6h6L5 7ZM19 7l-3 6h6l-3-6ZM8 21h8"/></>,
    understanding: <><path d="M9 18h6M10 21h4"/><path d="M8.2 14.5A7 7 0 1 1 15.8 14.5C14.6 15.3 14 16 14 17h-4c0-1-.6-1.7-1.8-2.5Z"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
function metricIcon(label: string): AppIconName { if (label.includes("Довер")) return "trust"; if (label.includes("Интерес")) return "interest"; if (label.includes("Раздраж")) return "irritation"; if (label.includes("Этич")) return "ethics"; return "understanding"; }
function Meter({ label, value, inverse = false }: { label: string; value: number; inverse?: boolean }) {
  const displayed = inverse ? 100 - value : value;
  return <div className="meter" tabIndex={0} data-tooltip={label} aria-label={`${label}: ${value}`}><div className="meter-ring" style={{ background: `conic-gradient(var(--ink) ${displayed}%, var(--line) ${displayed}% 100%)` }}><span><AppIcon name={metricIcon(label)} /></span></div><strong>{value}</strong></div>;
}
function ResultRow({ label, value }: { label: string; value: string | number }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function ReportBlock({ title, items }: { title: string; items: string[] }) { return <article><h3>{title}</h3>{items.length ? <ul>{items.map((item, index) => <li key={`${title}-${index}`}>{item}</li>)}</ul> : <p>Не выявлено.</p>}</article>; }


