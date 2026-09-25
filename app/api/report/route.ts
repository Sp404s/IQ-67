import type { NegotiationState, SessionReport, SideProfile } from "@/app/negotiation";

type ReportRequest = { player: SideProfile; opponent: SideProfile; state: NegotiationState; messages: Array<{ role: "player" | "opponent"; text: string }> };
type GeminiResult = { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };

function strings(value: unknown) { return Array.isArray(value) ? value.map(String).map((item) => item.slice(0, 240)).slice(0, 8) : []; }
function parseReport(content: string): SessionReport | null {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = cleaned.indexOf("{"), end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const data = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    return { summary: String(data.summary ?? "Переговоры завершены.").slice(0, 800), agreed: strings(data.agreed), openQuestions: strings(data.openQuestions), interests: strings(data.interests), mistakes: strings(data.mistakes), advice: strings(data.advice), risks: strings(data.risks) };
  } catch { return null; }
}

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return Response.json({ error: "Google AI Studio не подключён." }, { status: 503 });
  let body: ReportRequest;
  try { body = await request.json() as ReportRequest; } catch { return Response.json({ error: "Некорректный запрос." }, { status: 400 }); }
  if (!body.player || !body.opponent || !body.state || !Array.isArray(body.messages)) return Response.json({ error: "Не хватает данных сессии." }, { status: 400 });
  const transcript = body.messages.slice(-60).map((message) => `${message.role === "player" ? body.player.name : body.opponent.name}: ${String(message.text).slice(0, 1000)}`).join("\n");
  const prompt = `Ты тренер по переговорам. Проанализируй завершённый учебный диалог на русском языке.
Участник: ${body.player.name} ${body.player.patronymic}, ${body.player.role}, цель: ${body.player.goal}.
Оппонент: ${body.opponent.name} ${body.opponent.patronymic}, ${body.opponent.role}, цель: ${body.opponent.goal}.
Итоговые показатели: доверие ${body.state.trust}, интерес ${body.state.dealInterest}, раздражение ${body.state.irritation}, этичность ${body.state.ethicalConduct}, взаимопонимание ${100 - body.state.misunderstanding}.
Память: ${JSON.stringify(body.state.memory)}.
Диалог:\n${transcript}

Отделяй реальные договорённости от предложений и намерений. Не объявляй условие согласованным, если вторая сторона явно его не приняла. Советы должны быть конкретными и ссылаться на поведение участника. Верни только JSON:
{"summary":"краткий итог","agreed":["что точно согласовано"],"openQuestions":["что осталось открытым"],"interests":["выявленные интересы и мотивы"],"mistakes":["ошибки участника"],"advice":["как исправить ключевые реплики"],"risks":["риски и невыполнимые обещания"]}`;
  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite", messages: [{ role: "system", content: "Ты тренер по переговорам. Возвращай только JSON." }, { role: "user", content: prompt }], temperature: 0.25, max_completion_tokens: 1200, response_format: { type: "json_object" } }) });
    const data = await response.json() as GeminiResult;
    if (!response.ok) return Response.json({ error: data.error?.message ?? "Не удалось создать отчёт." }, { status: response.status });
    const report = parseReport(data.choices?.[0]?.message?.content ?? "");
    if (!report) return Response.json({ error: "Модель вернула отчёт в неверном формате." }, { status: 502 });
    return Response.json({ report });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось создать отчёт." }, { status: 502 });
  }
}
