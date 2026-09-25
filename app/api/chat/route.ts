import type { NegotiationPlan, NegotiationState, PartySide, PlayerAction, SemanticEvaluation, SideProfile } from "@/app/negotiation";

type ChatMessage = { role: "player" | "opponent"; text: string };
type ChatRequest = { player: SideProfile; opponent: SideProfile; plan: NegotiationPlan; state: NegotiationState; messages: ChatMessage[]; messageCount: number; sessionId?: string | null };
type GeminiResult = { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string }; model?: string };
const model = process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite";
const actions = new Set<PlayerAction>(["question", "offer", "trade", "pressure", "alternative", "statement"]);
const concerns = new Set<SemanticEvaluation["ethicalConcern"]>(["none", "ambiguity", "disrespect", "deception", "coercion"]);
const clampDelta = (value: unknown) => Math.max(-15, Math.min(15, Math.round(Number(value) || 0)));

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
      ethicalConcern: typeof raw.ethicalConcern === "string" && concerns.has(raw.ethicalConcern as SemanticEvaluation["ethicalConcern"]) ? raw.ethicalConcern as SemanticEvaluation["ethicalConcern"] : "none",
      nonverbalCue: String(raw.nonverbalCue ?? "сохраняет нейтральное выражение").slice(0, 100),
      memoryUpdates: { promises: list("promises"), concessions: list("concessions"), contradictions: list("contradictions"), threats: list("threats"), agreements: list("agreements"), openQuestions: list("openQuestions") },
    };
  } catch { return null; }
}

async function complete(apiKey: string, messages: Array<{ role: string; content: string }>, json = false) {
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, messages, temperature: json ? 0.15 : 0.65, max_completion_tokens: json ? 900 : 350, response_format: json ? { type: "json_object" } : undefined }) });
  const data = await response.json() as GeminiResult;
  if (!response.ok) throw new Error(data.error?.message ?? `Gemini вернул ошибку ${response.status}.`);
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("Модель вернула пустой ответ.");
  return { content, model: data.model ?? model };
}

export async function GET() { return Response.json({ configured: Boolean(process.env.GEMINI_API_KEY), provider: "gemini", model }); }

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return Response.json({ error: "Google AI Studio не подключён. Добавьте GEMINI_API_KEY в .env.local." }, { status: 503 });
  let body: ChatRequest;
  try { body = await request.json() as ChatRequest; } catch { return Response.json({ error: "Некорректный запрос." }, { status: 400 }); }
  if (!body.opponent?.goal || !body.plan?.opponentPrompt || !Array.isArray(body.plan.route) || !body.messages?.length) return Response.json({ error: "Не хватает данных переговоров." }, { status: 400 });
  const latest = [...body.messages].reverse().find((message) => message.role === "player")?.text ?? "";
  const side = resolveSide(body.opponent);
  const sideRule = side === "buyer" ? "Ты заказчик: оцениваешь предложение и не продаёшь пользователю услуги." : side === "provider" ? "Ты исполнитель: предлагаешь услугу и не изображаешь заказчика." : "Строго соблюдай указанную роль.";
  const history = body.messages.slice(-16).map((message) => ({ role: message.role === "player" ? "user" : "assistant", content: message.text.slice(0, 1200) }));
  const dialogueSystem = `Ты — оппонент в реалистичном симуляторе переговоров. Отвечай только репликой персонажа на русском языке, без JSON и пояснений. ${sideRule}\n${body.plan.opponentPrompt}\nСостояние: доверие ${body.state.trust}, интерес ${body.state.dealInterest}, раздражение ${body.state.irritation}, недопонимание ${body.state.misunderstanding}. Память: ${JSON.stringify(body.state.memory)}. Продвигай собственную цель, реагируй на конкретный смысл последней реплики. Не повторяй формулировки из предыдущих ответов. Если вопрос неясен — уточни, что именно непонятно. 1–4 предложения.`;
  try {
    let replyResult = await complete(apiKey, [{ role: "system", content: dialogueSystem }, ...history]);
    if (repeatsHistory(replyResult.content, body.messages) || hasRoleConfusion(replyResult.content, side)) {
      replyResult = await complete(apiKey, [{ role: "system", content: `${dialogueSystem}\nПредыдущий вариант повторялся или нарушал роль. Дай содержательно новый ответ, опираясь именно на последнюю реплику: «${latest.slice(0, 900)}».` }, ...history]);
    }
    if (repeatsHistory(replyResult.content, body.messages) || hasRoleConfusion(replyResult.content, side)) throw new Error("Модель повторила прежний ответ или перепутала роли. Попробуйте переформулировать реплику.");
    const route = body.plan.route.map((step) => `${step.id}: ${step.intent}; признаки: ${step.evidence.join(" | ")}`).join("\n");
    const evaluationPrompt = `Ты — независимый аналитик переговоров. Оцени только последнюю реплику пользователя по смыслу. Не оценивай ответ оппонента как достижение пользователя.\nПоследняя реплика: «${latest.slice(0, 1200)}»\nОтвет оппонента: «${replyResult.content.slice(0, 1200)}»\nСкрытый маршрут:\n${route}\nТекущее состояние: ${JSON.stringify(body.state)}\nВерни только JSON со всеми полями: {"action":"question|offer|trade|pressure|alternative|statement","trustDelta":0,"irritationDelta":0,"dealInterestDelta":0,"ethicalConductDelta":0,"misunderstandingDelta":0,"matchedKeywords":["только id действительно раскрытых шагов"],"reserveFound":false,"reserveUsed":false,"rationale":"...","interpretation":"...","ethicalConcern":"none|ambiguity|disrespect|deception|coercion","nonverbalCue":"...","memoryUpdates":{"promises":[],"concessions":[],"contradictions":[],"threats":[],"agreements":[],"openQuestions":[]}}`;
    const evaluationResult = await complete(apiKey, [{ role: "system", content: "Ты независимый аналитик переговоров. Возвращай только JSON." }, { role: "user", content: evaluationPrompt }], true);
    const evaluation = parseEvaluation(evaluationResult.content, body.plan.keywords);
    if (!evaluation) throw new Error("Аналитик вернул некорректную оценку хода.");
    return Response.json({ reply: replyResult.content, evaluation, model: replyResult.model });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось получить ответ модели." }, { status: 502 });
  }
}
