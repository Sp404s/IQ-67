type GeminiAudioResult = { candidates?: Array<{ content?: { parts?: Array<{ text?: string; audioTranscription?: { text?: string } }> } }>; error?: { message?: string } };

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return Response.json({ error: "Распознавание речи не настроено." }, { status: 503 });
  try {
    const form = await request.formData();
    const audio = form.get("audio");
    if (!(audio instanceof File) || !audio.size) return Response.json({ error: "Запись пуста." }, { status: 400 });
    if (audio.size > 8_000_000) return Response.json({ error: "Запись слишком длинная." }, { status: 413 });
    const base64 = Buffer.from(await audio.arrayBuffer()).toString("base64");
    const model = process.env.GEMINI_TRANSCRIBE_MODEL ?? "gemini-3.5-transcribe";
    const rawMimeType = audio.type.split(";", 1)[0].toLowerCase();
    const mimeType = rawMimeType === "audio/mp4" ? "audio/m4a" : rawMimeType || "audio/webm";
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ inlineData: { mimeType, data: base64 } }] }], generationConfig: { audioTranscriptionConfig: { languageCodes: ["ru-RU"], mode: "SMART" } } }),
    });
    const data = await response.json() as GeminiAudioResult;
    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.audioTranscription?.text ?? part.text ?? "").join("").trim();
    if (!response.ok || !text) return Response.json({ error: data.error?.message ?? "Не удалось распознать речь." }, { status: 502 });
    return Response.json({ text });
  } catch { return Response.json({ error: "Не удалось обработать запись." }, { status: 500 }); }
}
