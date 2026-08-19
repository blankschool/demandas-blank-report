import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  googleDateSerial,
  HEADERS,
  parseEnv,
  readCredentials,
  refreshGoogleToken,
  storedDateValue,
} from "./core.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, "..");
const sourceEnvPath = resolve(projectDir, "../.env");
const localEnvPath = resolve(projectDir, ".env.local");
const provisionStatePath = resolve(projectDir, ".provision-state.json");
const apply = process.argv.includes("--apply");
const DATE_START_COLUMN = 7;
const DATE_END_COLUMN = 11;

async function fileExists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function googleRequest(accessToken, path, options = {}) {
  const response = await fetch(`https://sheets.googleapis.com/v4${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Google Sheets ${response.status}: ${data.error?.message || "erro desconhecido"}`);
  return data;
}

function dateCell(value) {
  if (!value) return {};
  const serial = googleDateSerial(value);
  return serial == null
    ? { userEnteredValue: { stringValue: value } }
    : { userEnteredValue: { numberValue: serial } };
}

function classify(value) {
  if (value === "" || value == null) return "blank";
  if (typeof value === "number") return "nativeDate";
  const text = String(value);
  if (text.includes(" → ")) return "interval";
  if (text.includes("T")) return "timestamp";
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) return "displayDate";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return "isoDate";
  return "invalid";
}

function summarize(rows) {
  const stats = { blank: 0, nativeDate: 0, timestamp: 0, interval: 0, displayDate: 0, isoDate: 0, invalid: 0 };
  for (const row of rows) {
    for (let column = DATE_START_COLUMN; column < DATE_END_COLUMN; column += 1) {
      stats[classify(row[column])] += 1;
    }
  }
  return stats;
}

function checksumNonDate(rows) {
  const values = rows.map((row) => row.filter((_, index) => index < DATE_START_COLUMN || index >= DATE_END_COLUMN));
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

async function readRows(accessToken, spreadsheetId, valueRenderOption = "UNFORMATTED_VALUE") {
  const result = await googleRequest(
    accessToken,
    `/spreadsheets/${spreadsheetId}/values/Demandas!A1:O5000?valueRenderOption=${valueRenderOption}&dateTimeRenderOption=SERIAL_NUMBER`,
  );
  return result.values || [];
}

async function main() {
  const credentials = await readCredentials(sourceEnvPath);
  const localEnv = (await fileExists(localEnvPath)) ? parseEnv(await readFile(localEnvPath, "utf8")) : {};
  const provisionState = (await fileExists(provisionStatePath)) ? JSON.parse(await readFile(provisionStatePath, "utf8")) : {};
  const spreadsheetId = localEnv.SPREADSHEET_ID || provisionState.spreadsheetId;
  if (!spreadsheetId) throw new Error("SPREADSHEET_ID não encontrado.");

  const token = await refreshGoogleToken(credentials.google);
  const spreadsheet = await googleRequest(token.access_token, `/spreadsheets/${spreadsheetId}?fields=properties,sheets.properties`);
  const sheet = spreadsheet.sheets.find((item) => item.properties.title === "Demandas");
  if (!sheet) throw new Error("A aba Demandas não foi encontrada.");

  const values = await readRows(token.access_token, spreadsheetId);
  const headers = values[0] || [];
  if (JSON.stringify(headers) !== JSON.stringify(HEADERS)) throw new Error("Os 15 cabeçalhos da aba Demandas não correspondem ao esquema esperado.");
  const rows = values.slice(1);
  const normalized = rows.map((row, rowIndex) => {
    const dateValues = [];
    for (let column = DATE_START_COLUMN; column < DATE_END_COLUMN; column += 1) {
      const original = row[column] ?? "";
      const value = storedDateValue(original);
      if (original !== "" && original != null && !value) {
        throw new Error(`Data inválida na linha ${rowIndex + 2}, coluna ${HEADERS[column]}: ${String(original)}`);
      }
      dateValues.push(value);
    }
    return dateValues;
  });

  const before = summarize(rows);
  const report = {
    mode: apply ? "apply" : "inspect",
    spreadsheetId,
    locale: spreadsheet.properties.locale,
    timeZone: spreadsheet.properties.timeZone,
    rows: rows.length,
    headers: headers.length,
    nonDateChecksum: checksumNonDate(rows),
    before,
    wouldChange: before.timestamp + before.isoDate,
    intervals: before.interval,
  };

  if (!apply) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const requests = [
    {
      updateCells: {
        range: { sheetId: sheet.properties.sheetId, startRowIndex: 1, endRowIndex: 5000, startColumnIndex: DATE_START_COLUMN, endColumnIndex: DATE_END_COLUMN },
        fields: "userEnteredValue",
      },
    },
    {
      updateCells: {
        start: { sheetId: sheet.properties.sheetId, rowIndex: 1, columnIndex: DATE_START_COLUMN },
        rows: normalized.map((row) => ({ values: row.map(dateCell) })),
        fields: "userEnteredValue",
      },
    },
    {
      repeatCell: {
        range: { sheetId: sheet.properties.sheetId, startRowIndex: 1, endRowIndex: 5000, startColumnIndex: DATE_START_COLUMN, endColumnIndex: DATE_END_COLUMN },
        cell: { userEnteredFormat: { numberFormat: { type: "DATE", pattern: "dd/mm/yyyy" } } },
        fields: "userEnteredFormat.numberFormat",
      },
    },
  ];
  await googleRequest(token.access_token, `/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ requests }),
  });

  const afterRows = (await readRows(token.access_token, spreadsheetId)).slice(1);
  const formattedRows = (await readRows(token.access_token, spreadsheetId, "FORMATTED_VALUE")).slice(1);
  const after = summarize(afterRows);
  const formatted = summarize(formattedRows);
  if (after.timestamp || after.isoDate || after.invalid) throw new Error("A verificação encontrou datas antigas ou inválidas após a migração.");
  if (checksumNonDate(afterRows) !== report.nonDateChecksum) throw new Error("Uma coluna fora de H–K foi alterada durante a migração.");
  if (formatted.displayDate + formatted.interval === 0) throw new Error("A máscara dd/mm/yyyy não apareceu nos valores formatados.");

  console.log(JSON.stringify({ ...report, after, formatted, success: true }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
