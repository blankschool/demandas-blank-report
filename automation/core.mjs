import { createHash, pbkdf2Sync, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

export const NOTION_VERSION = "2025-09-03";
export const SOURCE_DATA_SOURCE_ID = "1e2d77361cee83ad861607606871b482";
export const SOURCE_DATABASE_ID = "39cd77361cee805a81bdcb77a6da8240";
export const CLIENTS_DATA_SOURCE_ID = "57177705fc2b42659c4a04e85e39db86";
export const CLIENTS_DATABASE_ID = "4262baa1820347a99b39d761f32c88d3";
export const SOURCE_NAME = "1 - Lista de Demandas Criação Blank";

export const HEADERS = [
  "Nome",
  "Cliente",
  "Responsável",
  "Cargo",
  "Formato",
  "Prioridade",
  "Status",
  "Prazo de Criação",
  "Data de Postagem",
  "Iniciado em",
  "Concluído em",
  "Tempo gasto",
  "Total ↓",
  "Link Notion",
  "Obs",
];

export const META_HEADERS = [
  "notion_page_id",
  "notion_page_url",
  "created_time",
  "last_edited_time",
  "archived",
  "row_hash",
  "row_number",
  "synced_at",
];

export const STATUS_ORDER = [
  "Rascunho",
  "Em Briefing",
  "Escrita",
  "Pronto para produzir",
  "Aguardando bruto",
  "Pronto para criação",
  "Em criação",
  "Em ajuste de criação",
  "Em aprovação",
  "Finalizado",
  "Cancelado",
];

export function extractFirstJsonAfterMarker(content, marker) {
  const markerIndex = content.indexOf(marker);
  if (markerIndex < 0) throw new Error(`Seção ausente: ${marker}`);
  const start = content.indexOf("{", markerIndex + marker.length);
  if (start < 0) throw new Error(`JSON ausente depois de ${marker}`);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < content.length; index += 1) {
    const char = content[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(content.slice(start, index + 1));
    }
  }
  throw new Error(`JSON incompleto depois de ${marker}`);
}

export function extractFirstValueAfterMarker(content, marker) {
  const markerIndex = content.indexOf(marker);
  if (markerIndex < 0) throw new Error(`Seção ausente: ${marker}`);
  return content
    .slice(markerIndex + marker.length)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#"));
}

export async function readCredentials(path) {
  const content = await readFile(path, "utf8");
  return {
    google: extractFirstJsonAfterMarker(content, "# Planilhas"),
    n8n: extractFirstValueAfterMarker(content, "# N8N"),
    notion: extractFirstValueAfterMarker(content, "# Notion"),
  };
}

export async function refreshGoogleToken(google) {
  const body = new URLSearchParams({
    client_id: google.client_id,
    client_secret: google.client_secret,
    refresh_token: google.refresh_token,
    grant_type: "refresh_token",
  });
  const response = await fetch(google.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Falha ao renovar Google OAuth: ${data.error_description || data.error}`);
  return data;
}

export async function notionRequest(token, path, options = {}) {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      "notion-version": NOTION_VERSION,
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Notion ${response.status}: ${data.message || "erro desconhecido"}`);
  return data;
}

export async function queryAll(token, dataSourceId) {
  const results = [];
  let cursor;
  do {
    const payload = { page_size: 100 };
    if (cursor) payload.start_cursor = cursor;
    const page = await notionRequest(token, `/data_sources/${dataSourceId}/query`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    results.push(...page.results);
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);
  return results;
}

export function richText(value = []) {
  return value.map((part) => part.plain_text ?? part.text?.content ?? "").join("");
}

function validCalendarDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function displayDatePart(value) {
  const text = String(value || "").trim();
  const displayMatch = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (displayMatch) {
    const [, day, month, year] = displayMatch;
    return validCalendarDate(Number(year), Number(month), Number(day)) ? `${day}/${month}/${year}` : "";
  }
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!isoMatch) return "";
  const [, year, month, day] = isoMatch;
  return validCalendarDate(Number(year), Number(month), Number(day)) ? `${day}/${month}/${year}` : "";
}

export function dateValue(value) {
  if (!value?.start) return "";
  const start = displayDatePart(value.start);
  if (!start) return "";
  const end = displayDatePart(value.end);
  return end ? `${start} → ${end}` : start;
}

export function googleDateSerial(value) {
  const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  if (!validCalendarDate(Number(year), Number(month), Number(day))) return null;
  return Date.UTC(Number(year), Number(month) - 1, Number(day)) / 86400000 + 25569;
}

export function googleSerialDate(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  const date = new Date(Math.round((value - 25569) * 86400000));
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getUTCFullYear()}`;
}

export function storedDateValue(value) {
  if (value === "" || value == null) return "";
  if (typeof value === "number") return googleSerialDate(value);
  const parts = String(value).split(" → ");
  const normalized = parts.map(displayDatePart).filter(Boolean);
  if (!normalized.length) return "";
  return normalized.length > 1 ? `${normalized[0]} → ${normalized[1]}` : normalized[0];
}

export function formulaValue(value) {
  if (!value?.type) return "";
  const result = value[value.type];
  if (result == null) return "";
  if (value.type === "date") return dateValue(result);
  if (value.type === "boolean") return result ? "true" : "false";
  return result;
}

export function stableHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function titleFromPage(page, preferred = "Name") {
  const properties = page?.properties || {};
  const titleProperty = properties[preferred] || Object.values(properties).find((item) => item?.type === "title");
  return richText(titleProperty?.title || []);
}

export function normalizePages(pages, clientPages, syncedAt = new Date().toISOString()) {
  const clientNames = new Map(clientPages.map((page) => [page.id, titleFromPage(page, "Name")]));
  const rows = [];
  const metaRows = [];

  for (const [index, page] of pages.entries()) {
    const p = page.properties || {};
    const row = [
      richText(p.Nome?.title),
      (p.Cliente?.relation || []).map((relation) => clientNames.get(relation.id) || relation.id).join("\n"),
      (p["Responsável"]?.people || []).map((person) => person.name || person.id).join("\n"),
      p.Cargo?.select?.name || "",
      p.Formato?.select?.name || "",
      p.Prioridade?.select?.name || "",
      p.Status?.status?.name || "",
      dateValue(p["Prazo de Criação"]?.date),
      dateValue(p["Data de Postagem"]?.date),
      dateValue(p["Iniciado em"]?.date),
      dateValue(p["Concluído em"]?.date),
      formulaValue(p["Tempo gasto"]?.formula),
      p["Total ↓"]?.number ?? "",
      p["Link Notion"]?.url || "",
      richText(p.Obs?.rich_text),
    ];
    rows.push(row);
    metaRows.push([
      page.id,
      page.url || "",
      page.created_time || "",
      page.last_edited_time || "",
      Boolean(page.archived),
      stableHash(row),
      index + 2,
      syncedAt,
    ]);
  }
  return { rows, metaRows, syncedAt };
}

export function validateSchema(schema) {
  const actual = Object.keys(schema.properties || {}).sort();
  const expected = [...HEADERS].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const missing = expected.filter((name) => !actual.includes(name));
    const extra = actual.filter((name) => !expected.includes(name));
    throw new Error(`Esquema do Notion mudou. Ausentes: ${missing.join(", ") || "nenhuma"}. Extras: ${extra.join(", ") || "nenhuma"}.`);
  }
}

export function generatePassword() {
  return randomBytes(18).toString("base64url");
}

export function generatePasswordHash(password) {
  const iterations = 210000;
  const saltBytes = randomBytes(16);
  const salt = saltBytes.toString("base64url");
  const hash = pbkdf2Sync(password, saltBytes, iterations, 32, "sha256").toString("base64url");
  return `pbkdf2$${iterations}$${salt}$${hash}`;
}

export function randomSecret(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function parseEnv(content = "") {
  return Object.fromEntries(
    content
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}
