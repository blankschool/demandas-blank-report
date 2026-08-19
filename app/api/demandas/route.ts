import { getCookie, SESSION_COOKIE, validateSession } from "../../lib/auth";

export async function GET(request: Request) {
  const session = await validateSession(getCookie(request, SESSION_COOKIE));
  if (!session) return Response.json({ error: "Não autorizado" }, { status: 401 });

  const webhookUrl = process.env.N8N_WEBHOOK_URL;
  const webhookSecret = process.env.N8N_WEBHOOK_SECRET;
  if (!webhookUrl || !webhookSecret) return Response.json({ error: "Integração não configurada" }, { status: 503 });

  try {
    const upstream = await fetch(webhookUrl, {
      headers: { "X-Demandas-Key": webhookSecret },
      cache: "no-store",
    });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") || "application/json", "cache-control": "no-store" },
    });
  } catch {
    return Response.json({ error: "Não foi possível consultar as demandas agora." }, { status: 502 });
  }
}
