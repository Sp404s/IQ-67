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
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, messages, temperature: json ? 0.25 : 0.55, max_completion_tokens: json ? 1200 : 500, response_format: json ? { type: "json_object" } : undefined }), cache: "no-store" });
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
  const latest = [...body.messages].reverse().find((message) => message.role === "player")?.text ?? "";
  const side = resolveSide(body.opponent);
  const sideRule = side === "buyer" ? "Ты заказчик: оцениваешь предложение и не продаёшь пользователю услуги." : side === "provider" ? "Ты исполнитель: предлагаешь услугу и не изображаешь заказчика." : "Строго соблюдай указанную роль.";
  const history = body.messages.slice(-24).map((message) => ({ role: message.role === "player" ? "user" : "assistant", content: message.text.slice(0, 1600) }));
  const dialogueSystem = `Ты одновременно играешь оппонента и оцениваешь последний ход в учебном симуляторе переговоров. ${sideRule}\n${body.plan.opponentPrompt}\nПеред ответом молча выполни алгоритм: 1) определи предмет услуги из профиля; 2) пойми намерение последней реплики; 3) найди уже известные факты в истории и памяти; 4) выбери один следующий логичный шаг разговора; 5) проверь, что ответ звучит от лица заказчика и относится к указанной услуге. Данные профиля — факты, а не готовые фразы. Никогда не вставляй «создаю сайты» после слов «услуга» или «предложение»: преобразуй в «разработка сайта» либо перефразируй предложение. Не повторяй приветствие, уже заданный вопрос или прежний ответ. Не перескакивай на другую услугу. Если пользователь дал конкретику, отреагируй на неё до нового вопроса. Состояние: доверие ${body.state.trust}, интерес ${body.state.dealInterest}, раздражение ${body.state.irritation}, недопонимание ${body.state.misunderstanding}. Память: ${JSON.stringify(body.state.memory)}. Ответ оппонента: 1–4 цельных предложения.`;
  try {
    const route = body.plan.route.map((step) => `${step.id}: ${step.intent}; признаки: ${step.evidence.join(" | ")}`).join("\n");
    const prompt = `${dialogueSystem}\nСкрытые цели оценки:\n${route}\nПоследняя реплика пользователя: «${latest.slice(0, 1200)}»\nВерни только компактный JSON. Поле reply — ответ оппонента. Остальные поля — смысловая оценка только последней реплики пользователя. betterReply — более сильный вариант реплики пользователя от первого лица исполнителя. Это совет пользователю, поэтому не пиши его от лица заказчика, не обращайся к пользователю по имени и не повторяй reply. Максимум 3 предложения. Схема: {"reply":"ответ оппонента","action":"question|offer|trade|pressure|alternative|statement","trustDelta":0,"irritationDelta":0,"dealInterestDelta":0,"ethicalConductDelta":0,"misunderstandingDelta":0,"matchedKeywords":["только достигнутые id"],"reserveFound":false,"reserveUsed":false,"rationale":"...","interpretation":"...","betterReply":"...","ethicalConcern":"none|ambiguity|disrespect|deception|coercion","nonverbalCue":"...","memoryUpdates":{"promises":[],"concessions":[],"contradictions":[],"threats":[],"agreements":[],"openQuestions":[]}}`;
    const result = await complete(apiKey, [{ role: "system", content: prompt }, ...history], true);
    const parsed = parseCombined(result.content, body.plan.keywords);
    if (!parsed) throw new Error("Модель вернула некорректный ответ.");
    if (repeatsHistory(parsed.reply, body.messages) || hasRoleConfusion(parsed.reply, side)) throw new Error("Модель повторила ответ или перепутала роли. Отправьте реплику ещё раз.");
    return Response.json({ reply: parsed.reply, evaluation: parsed.evaluation, model: result.model });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось получить ответ модели." }, { status: 502 });
  }
}
