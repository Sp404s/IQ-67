type GeminiAudioResult = { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; error?: { message?: string } };

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return Response.json({ error: "Распознавание речи не настроено." }, { status: 503 });
  try {
    const form = await request.formData();
    const audio = form.get("audio");
    if (!(audio instanceof File) || !audio.size) return Response.json({ error: "Запись пуста." }, { status: 400 });
    if (audio.size > 8_000_000) return Response.json({ error: "Запись слишком длинная." }, { status: 413 });
    const base64 = Buffer.from(await audio.arrayBuffer()).toString("base64");
    const model = process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite";
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
      body: JSON.stringify({ contents: [{ parts: [{ text: "Точно расшифруй русскую речь. Верни только произнесённый текст без комментариев." }, { inlineData: { mimeType: audio.type || "audio/webm", data: base64 } }] }], generationConfig: { temperature: 0, maxOutputTokens: 350 } }),
    });
    const data = await response.json() as GeminiAudioResult;
    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
    if (!response.ok || !text) return Response.json({ error: data.error?.message ?? "Не удалось распознать речь." }, { status: 502 });
    return Response.json({ text });
  } catch { return Response.json({ error: "Не удалось обработать запись." }, { status: 500 }); }
}
