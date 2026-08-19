import { createSession, SESSION_COOKIE, SESSION_SECONDS, verifyPassword } from "../../../lib/auth";

const attempts = new Map<string, { count: number; resetAt: number }>();

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const current = attempts.get(ip);
  if (current && current.resetAt > now && current.count >= 5) {
    return Response.json({ error: "Muitas tentativas. Aguarde alguns minutos." }, { status: 429 });
  }

  const body = await request.json().catch(() => ({})) as { username?: string; password?: string };
  const expectedUsername = process.env.APP_USERNAME || "blank";
  const valid = body.username === expectedUsername && await verifyPassword(body.password || "");
  if (!valid) {
    const next = !current || current.resetAt <= now ? { count: 1, resetAt: now + 15 * 60 * 1000 } : { ...current, count: current.count + 1 };
    attempts.set(ip, next);
    return Response.json({ error: "Usuário ou senha inválidos." }, { status: 401 });
  }

  attempts.delete(ip);
  const token = await createSession(expectedUsername);
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return new Response(JSON.stringify({ authenticated: true, username: expectedUsername }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure}`,
    },
  });
}
