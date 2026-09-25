import { createPlan, type NegotiationPlan, type RouteStep, type SideProfile } from "@/app/negotiation";

type PlanRequest = { player: SideProfile; opponent: SideProfile };
type GeminiResult = { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
const model = process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite";

function parsePlan(content: string, base: NegotiationPlan): NegotiationPlan {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = cleaned.indexOf("{"), end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return base;
  try {
    const data = JSON.parse(cleaned.slice(start, end + 1)) as { route?: unknown };
    if (!Array.isArray(data.route)) return base;
    const route = data.route.map((value, index): RouteStep | null => {
      if (!value || typeof value !== "object") return null;
      const row = value as Record<string, unknown>;
      const intent = String(row.intent ?? "").trim().slice(0, 180);
      const evidence = Array.isArray(row.evidence) ? row.evidence.map(String).map((item) => item.trim().slice(0, 90)).filter(Boolean).slice(0, 6) : [];
      return intent && evidence.length >= 2 ? { id: `step-${index + 1}`, intent, evidence } : null;
    }).filter((step): step is RouteStep => Boolean(step)).slice(0, 10);
    return route.length >= 5 ? { ...base, route, keywords: route.map((step) => step.id) } : base;
  } catch { return base; }
}

export async function POST(request: Request) {
  let body: PlanRequest;
  try { body = await request.json() as PlanRequest; } catch { return Response.json({ error: "Некорректный запрос." }, { status: 400 }); }
  if (!body.player?.goal || !body.opponent?.goal) return Response.json({ error: "Заполните цели обеих сторон." }, { status: 400 });
  const base = createPlan(body.player, body.opponent);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return Response.json({ plan: base, source: "local" });
  const prompt = `Создай скрытый логический маршрут учебных переговоров на русском языке. Пользователь: ${body.player.role}, цель: ${body.player.goal}. Оппонент: ${body.opponent.role}, цель: ${body.opponent.goal}, мотивация: ${body.opponent.motivation}, границы: ${body.opponent.boundaries}, скрытый интерес: ${body.opponent.hiddenInterest}. Маршрут должен вести от выяснения интересов к конкретной договорённости. Создай 6–9 последовательных смысловых шагов. Для каждого дай intent и 3–6 примеров фраз или смыслов evidence, которыми пользователь может раскрыть шаг. Не требуй точного совпадения слов. Не включай секреты оппонента в evidence. Верни JSON: {"route":[{"intent":"...","evidence":["...","..."]}]}`;
  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, messages: [{ role: "system", content: "Ты проектировщик учебных переговорных сценариев. Возвращай только JSON." }, { role: "user", content: prompt }], temperature: 0.25, max_completion_tokens: 1200, response_format: { type: "json_object" } }) });
    const data = await response.json() as GeminiResult;
    if (!response.ok) return Response.json({ plan: base, source: "local", warning: data.error?.message ?? "Маршрут создан локально." });
    return Response.json({ plan: parsePlan(data.choices?.[0]?.message?.content ?? "", base), source: "model" });
  } catch { return Response.json({ plan: base, source: "local", warning: "Маршрут создан локально." }); }
}
