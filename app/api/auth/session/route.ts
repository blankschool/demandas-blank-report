import { getCookie, SESSION_COOKIE, validateSession } from "../../../lib/auth";

export async function GET(request: Request) {
  const session = await validateSession(getCookie(request, SESSION_COOKIE));
  return Response.json(session ? { authenticated: true, username: session.username } : { authenticated: false }, {
    status: session ? 200 : 401,
    headers: { "cache-control": "no-store" },
  });
}
