import { createPlan, type SideProfile } from "@/app/negotiation";

type PlanRequest = { player: SideProfile; opponent: SideProfile };

export async function POST(request: Request) {
  let body: PlanRequest;
  try { body = await request.json() as PlanRequest; }
  catch { return Response.json({ error: "Некорректный запрос." }, { status: 400 }); }
  if (!body.player?.name || !body.opponent?.goal) return Response.json({ error: "Заполните профиль и цель оппонента." }, { status: 400 });
  return Response.json({ plan: createPlan(body.player, body.opponent), source: "training-framework" });
}
