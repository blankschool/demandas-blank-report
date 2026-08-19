export const SESSION_COOKIE = "blank_demandas_session";
export const SESSION_SECONDS = 8 * 60 * 60;

const encoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function jsonToBase64Url(value: unknown) {
  return bytesToBase64Url(encoder.encode(JSON.stringify(value)));
}

async function hmac(value: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET não configurado");
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function verifyPassword(password: string) {
  const encoded = process.env.APP_PASSWORD_HASH || "";
  const [algorithm, iterationsText, salt, expected] = encoded.split("$");
  if (algorithm !== "pbkdf2" || !iterationsText || !salt || !expected) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    hash: "SHA-256",
    salt: base64UrlToBytes(salt),
    iterations: Number(iterationsText),
  }, key, 256);
  const actual = new Uint8Array(derived);
  const expectedBytes = base64UrlToBytes(expected);
  if (actual.length !== expectedBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) difference |= actual[index] ^ expectedBytes[index];
  return difference === 0;
}

export async function createSession(username: string) {
  const payload = jsonToBase64Url({ username, expiresAt: Date.now() + SESSION_SECONDS * 1000 });
  return `${payload}.${await hmac(payload)}`;
}

export async function validateSession(token?: string | null) {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || (await hmac(payload)) !== signature) return null;
  try {
    const json = new TextDecoder().decode(base64UrlToBytes(payload));
    const session = JSON.parse(json) as { username: string; expiresAt: number };
    if (!session.username || session.expiresAt <= Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export function getCookie(request: Request, name: string) {
  const cookies = request.headers.get("cookie") || "";
  const item = cookies.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
}
