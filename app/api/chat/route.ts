import type { NegotiationPlan, NegotiationState, PartySide, PlayerAction, SemanticEvaluation, SideProfile } from "@/app/negotiation";
import { createClient } from "@supabase/supabase-js";

type ChatMessage = { role: "player" | "opponent"; text: string };
type ChatRequest = { player: SideProfile; opponent: SideProfile; plan: NegotiationPlan; state: NegotiationState; messages: ChatMessage[]; messageCount: number; sessionId?: string | null };
type GeminiResult = { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string }; model?: string };
const model = process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite";
const actions = new Set<PlayerAction>(["question", "offer", "trade", "pressure", "alternative", "statement"]);
const concerns = new Set<SemanticEvaluation["ethicalConcern"]>(["none", "ambiguity", "disrespect", "deception", "coercion"]);
const clampDelta = (value: unknown) => Math.max(-15, Math.min(15, Math.round(Number(value) || 0)));

type StoredContext = {
  player: SideProfile;
  opponent: SideProfile;
  plan: NegotiationPlan;
  state: NegotiationState;
  messages: ChatMessage[];
};

async function loadStoredContext(request: Request, sessionId?: string | null): Promise<StoredContext | null> {
  const authorization = request.headers.get("authorization");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!authorization?.startsWith("Bearer ") || !sessionId || !url || !key) return null;
  const supabase = createClient(url, key, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const [sessionResult, messagesResult] = await Promise.all([
    supabase.from("negotiation_sessions").select("player,opponent,plan,current_state").eq("id", sessionId).single(),
    supabase.from("negotiation_messages").select("role,content,turn,id").eq("session_id", sessionId).order("turn").order("id").limit(120),
  ]);
  if (sessionResult.error || messagesResult.error || !sessionResult.data) return null;
  const row = sessionResult.data;
  return {
    player: row.player as SideProfile,
    opponent: row.opponent as SideProfile,
    plan: row.plan as NegotiationPlan,
    state: row.current_state as NegotiationState,
    messages: (messagesResult.data ?? []).map((message) => ({ role: message.role as ChatMessage["role"], text: String(message.content) })),
  };
}

function resolveSide(profile: SideProfile): PartySide {
  if (["buyer", "provider", "neutral"].includes(profile.side)) return profile.side;
  if (/заказчик|покупатель|клиент/i.test(profile.role)) return "buyer";
  if (/дизайнер|исполнитель|подрядчик|поставщик|продавец|консультант|разработчик/i.test(profile.role)) return "provider";
  return "neutral";
}

function words(value: string) { return new Set(value.toLowerCase().replace(/[^а-яёa-z0-9 ]/gi, " ").split(/\s+/).filter((word) => word.length > 3)); }
function similarity(left: string, right: string) {
  const a = words(left), b = words(right); if (!a.size || !b.size) return 0;
  const common = [...a].filter((word) => b.has(word)).length;
  return common / Math.min(a.size, b.size);
}
function repeatsHistory(reply: string, messages: ChatMessage[]) {
  return messages.filter((message) => message.role === "opponent").slice(-5).some((message) => similarity(reply, message.text) >= 0.72);
}
function hasRoleConfusion(reply: string, side: PartySide) {
  if (side === "buyer") return /(предлага(?:ю|ем) вам (?:наши )?(?:услуги|решение)|мы (?:разработаем|создадим)|я (?:разработаю|создам)|для вашего бизнеса)/i.test(reply);
  if (side === "provider") return /(я выступаю заказчиком|мне нужен (?:сайт|дизайн|проект)|какие услуги вы можете предложить)/i.test(reply);
  return false;
}

function parseEvaluation(content: string, allowedIds: string[]): SemanticEvaluation | null {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = cleaned.indexOf("{"), end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const raw = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    const allowed = new Set(allowedIds);
    const action = typeof raw.action === "string" && actions.has(raw.action as PlayerAction) ? raw.action as PlayerAction : "statement";
    const memory = raw.memoryUpdates && typeof raw.memoryUpdates === "object" ? raw.memoryUpdates as Record<string, unknown> : {};
    const list = (key: string) => Array.isArray(memory[key]) ? (memory[key] as unknown[]).map(String).map((item) => item.slice(0, 180)).slice(0, 5) : [];
    return {
      action, trustDelta: clampDelta(raw.trustDelta), irritationDelta: clampDelta(raw.irritationDelta), dealInterestDelta: clampDelta(raw.dealInterestDelta), ethicalConductDelta: clampDelta(raw.ethicalConductDelta), misunderstandingDelta: clampDelta(raw.misunderstandingDelta),
      matchedKeywords: Array.isArray(raw.matchedKeywords) ? raw.matchedKeywords.map(String).filter((id) => allowed.has(id)) : [],
      reserveFound: raw.reserveFound === true, reserveUsed: raw.reserveUsed === true,
      rationale: String(raw.rationale ?? "Смысловая оценка выполнена.").slice(0, 240), interpretation: String(raw.interpretation ?? "Смысл реплики понят.").slice(0, 240),
      betterReply: String(raw.betterReply ?? "Сформулируйте мысль конкретнее и свяжите её с интересами обеих сторон.").slice(0, 500),
      ethicalConcern: typeof raw.ethicalConcern === "string" && concerns.has(raw.ethicalConcern as SemanticEvaluation["ethicalConcern"]) ? raw.ethicalConcern as SemanticEvaluation["ethicalConcern"] : "none",
      nonverbalCue: String(raw.nonverbalCue ?? "сохраняет нейтральное выражение").slice(0, 100),
      memoryUpdates: { promises: list("promises"), concessions: list("concessions"), contradictions: list("contradictions"), threats: list("threats"), agreements: list("agreements"), openQuestions: list("openQuestions") },
    };
  } catch { return null; }
}

function parseCombined(content: string, allowedIds: string[]) {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = cleaned.indexOf("{"), end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const raw = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    const reply = String(raw.reply ?? "").trim().slice(0, 1400);
    const evaluation = parseEvaluation(cleaned, allowedIds);
    return reply && evaluation ? { reply, evaluation } : null;
  } catch { return null; }
}

async function complete(apiKey: string, messages: Array<{ role: string; content: string }>, json = false) {
  const retryableStatuses = new Set([429, 500, 502, 503, 504]);
  let lastStatus = 0;
  let lastMessage = "Gemini временно недоступен.";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, messages, temperature: json ? 0.45 : 0.65, max_completion_tokens: json ? 1400 : 600, response_format: json ? { type: "json_object" } : undefined }), cache: "no-store" });
      const data = await response.json().catch(() => ({})) as GeminiResult;
      if (response.ok) {
        const content = data.choices?.[0]?.message?.content?.trim();
        if (!content) throw new Error("Модель вернула пустой ответ.");
        return { content, model: data.model ?? model };
      }

      lastStatus = response.status;
      lastMessage = data.error?.message ?? `Gemini вернул ошибку ${response.status}.`;
      if (!retryableStatuses.has(response.status) || attempt === 2) break;
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : "Ошибка соединения с Gemini.";
      if (attempt === 2 || /пустой ответ/i.test(lastMessage)) break;
    }

    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
  }

  if (lastStatus === 503) throw new Error("Gemini временно перегружен. Подождите несколько секунд и отправьте реплику ещё раз.");
  if (lastStatus === 429) throw new Error("Достигнут лимит запросов Gemini. Подождите минуту и повторите попытку.");
  throw new Error(lastMessage);
}

export async function GET() { return Response.json({ configured: Boolean(process.env.GEMINI_API_KEY), provider: "gemini", model }); }

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return Response.json({ error: "Google AI Studio не подключён. Добавьте GEMINI_API_KEY в .env.local." }, { status: 503 });
  let body: ChatRequest;
  try { body = await request.json() as ChatRequest; } catch { return Response.json({ error: "Некорректный запрос." }, { status: 400 }); }
  if (!body.opponent?.goal || !body.plan?.opponentPrompt || !Array.isArray(body.plan.route) || !body.messages?.length) return Response.json({ error: "Не хватает данных переговоров." }, { status: 400 });
  const stored = await loadStoredContext(request, body.sessionId);
  const player = stored?.player ?? body.player;
  const opponent = stored?.opponent ?? body.opponent;
  const plan = stored?.plan ?? body.plan;
  const state = stored?.state ?? body.state;
  const latest = [...body.messages].reverse().find((message) => message.role === "player")?.text ?? "";
  const contextMessages = stored ? [...stored.messages] : body.messages;
  const storedLast = contextMessages.at(-1);
  if (latest && (storedLast?.role !== "player" || storedLast.text.trim() !== latest.trim())) contextMessages.push({ role: "player", text: latest });
  const side = resolveSide(opponent);
  const sideRule = side === "buyer" ? "Ты заказчик: оцениваешь предложение и не продаёшь пользователю услуги." : side === "provider" ? "Ты исполнитель: предлагаешь услугу и не изображаешь заказчика." : "Строго соблюдай указанную роль.";
  const history = contextMessages.slice(-30).map((message) => ({ role: message.role === "player" ? "user" : "assistant", content: message.text.slice(0, 1600) }));
  const remainingSpin = plan.route.filter((step) => step.id.startsWith("spin-") && !state.matchedKeywords.includes(step.id));
  const phase = remainingSpin.length ? "выявление потребности" : !state.matchedKeywords.includes("objection") ? "обсуждение предложения и возражений" : "фиксация условий и следующего шага";
  const emotionalMode = state.irritation >= 65 ? "раздражён, отвечает короче и требует конкретики" : state.trust >= 70 ? "доверяет собеседнику и готов раскрывать детали" : state.dealInterest >= 70 ? "заинтересован, но продолжает проверять риски" : "спокоен, осторожен и оценивает полезность предложения";
  const dataSource = stored ? "Сведения ниже загружены из сохранённой сессии Supabase и являются источником истины." : "Используй сведения текущей сессии как источник истины.";
  const dialogueSystem = `Ты играешь живого человека в учебном симуляторе переговоров и отдельно оцениваешь последний ход игрока. ${sideRule}
${dataSource}

РОЛИ И ПРЕДМЕТ РАЗГОВОРА
- Игрок: ${player.name} ${player.patronymic}; профессия: ${player.role || "не указана"}; продаёт: «${player.services || player.goal || "услуга не указана"}»; опыт и сильные стороны: ${player.experienceStrengths || "не указаны"}.
- Ты: ${opponent.name} ${opponent.patronymic}, заказчик из сферы «${opponent.role}».
- Твоя деловая цель: ${opponent.goal}.
- Твоя ситуация и потребность: ${opponent.person}.
- Личная мотивация: ${opponent.motivation}. Ограничения: ${opponent.boundaries}. Скрытый интерес: ${opponent.hiddenInterest}.
- Характер: ${opponent.character}. Речь: ${opponent.speechStyle}. Привычка: ${opponent.habits}. Лексика: ${opponent.languageStyle}.
- Текущий этап разговора: ${phase}. Текущее отношение: ${emotionalMode}.

КАК ВЕСТИ ДИАЛОГ
1. Сначала пойми по смыслу услугу игрока. Разговорную формулировку нормализуй молча: «создаю сайты» означает разработку сайтов. Никогда не повторяй её в неграмотной конструкции.
2. Реагируй на конкретное содержание последней реплики. Если задан вопрос — сначала ответь на него. Если предложены условия — оцени их относительно своей цели, ограничений и уже сказанного.
3. Говори от первого лица заказчика. Не предлагай услуги игроку, не становись продавцом, консультантом или тренером.
4. Раскрывай информацию постепенно. Не перечисляй сразу все скрытые параметры. Детали, которых нет в контексте, можно осторожно конкретизировать только если они правдоподобны для указанной сферы и не меняют цель, бюджет, сроки или договорённости.
5. Поддерживай отношения: замечай полезные уточнения, помни обещания и договорённости, при давлении становись сдержаннее, при ясной выгоде проявляй интерес.
6. Продвигай разговор на один шаг. Задавай не больше одного содержательного вопроса за ответ. Иногда уместна реакция без вопроса.
7. Не повторяй приветствие, прежние ответы, одинаковые вводные и уже закрытые вопросы. Не употребляй канцелярские заготовки вроде «Для меня важно следующее».
8. Ответ должен звучать как естественная русская речь: 1–3 предложения, обычно 20–70 слов.

Состояние: доверие ${state.trust}, интерес ${state.dealInterest}, раздражение ${state.irritation}, недопонимание ${state.misunderstanding}.
Память разговора: ${JSON.stringify(state.memory)}.
Дополнительная карточка роли: ${plan.opponentPrompt}`;
  try {
    const route = plan.route.map((step) => `${step.id}: ${step.intent}; признаки: ${step.evidence.join(" | ")}`).join("\n");
    const basePrompt = `${dialogueSystem}\nСкрытые цели оценки:\n${route}\nПоследняя реплика пользователя: «${latest.slice(0, 1200)}»\nВерни только компактный JSON. Поле reply — естественный ответ оппонента. Остальные поля — смысловая оценка только последней реплики пользователя. Засчитывай этап только при наличии смысла, а не отдельного похожего слова. betterReply — более сильный вариант реплики пользователя от первого лица исполнителя. Это совет пользователю, поэтому не пиши его от лица заказчика, не обращайся к пользователю по имени и не повторяй reply. Максимум 3 предложения. Схема: {"reply":"ответ оппонента","action":"question|offer|trade|pressure|alternative|statement","trustDelta":0,"irritationDelta":0,"dealInterestDelta":0,"ethicalConductDelta":0,"misunderstandingDelta":0,"matchedKeywords":["только достигнутые id"],"reserveFound":false,"reserveUsed":false,"rationale":"...","interpretation":"...","betterReply":"...","ethicalConcern":"none|ambiguity|disrespect|deception|coercion","nonverbalCue":"...","memoryUpdates":{"promises":[],"concessions":[],"contradictions":[],"threats":[],"agreements":[],"openQuestions":[]}}`;
    let lastModel = model;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const correction = attempt ? "\nПредыдущий вариант был отклонён: он повторялся или путал роли. Сформулируй новый ответ заказчика другими словами, сохрани факты и продолжи разговор логично." : "";
      const result = await complete(apiKey, [{ role: "system", content: basePrompt + correction }, ...history], true);
      lastModel = result.model;
      const parsed = parseCombined(result.content, plan.keywords);
      if (parsed && !repeatsHistory(parsed.reply, contextMessages) && !hasRoleConfusion(parsed.reply, side)) {
        return Response.json({ reply: parsed.reply, evaluation: parsed.evaluation, model: lastModel, contextSource: stored ? "supabase" : "request" });
      }
    }
    throw new Error("Модель не смогла продолжить разговор без повторения или смешения ролей. Отправьте реплику ещё раз.");
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось получить ответ модели." }, { status: 502 });
  }
}
