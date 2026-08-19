import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HEADERS,
  META_HEADERS,
  SOURCE_DATA_SOURCE_ID,
  CLIENTS_DATA_SOURCE_ID,
  generatePassword,
  generatePasswordHash,
  googleDateSerial,
  normalizePages,
  notionRequest,
  parseEnv,
  queryAll,
  randomSecret,
  readCredentials,
  refreshGoogleToken,
  validateSchema,
} from "./core.mjs";
import { buildApiWorkflow, buildSyncWorkflow } from "./n8n-workflows.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, "..");
const sourceEnvPath = resolve(projectDir, "../.env");
const localEnvPath = resolve(projectDir, ".env.local");
const exampleEnvPath = resolve(projectDir, ".env.example");
const provisionStatePath = resolve(projectDir, ".provision-state.json");
const N8N_BASE = "https://n8n.srv909496.hstgr.cloud";

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

async function n8nRequest(apiKey, path, options = {}) {
  const response = await fetch(`${N8N_BASE}/api/v1${path}`, {
    ...options,
    headers: {
      "x-n8n-api-key": apiKey,
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`n8n ${response.status}: ${data.message || text || "erro desconhecido"}`);
  return data;
}

const DATE_COLUMN_INDEXES = new Set([7, 8, 9, 10]);

const cell = (value, asDate = false) => {
  if (value === "" || value == null) return {};
  const serial = asDate ? googleDateSerial(value) : null;
  if (serial != null) return { userEnteredValue: { numberValue: serial } };
  if (typeof value === "number" && Number.isFinite(value)) return { userEnteredValue: { numberValue: value } };
  if (typeof value === "boolean") return { userEnteredValue: { boolValue: value } };
  return { userEnteredValue: { stringValue: String(value) } };
};

const rowData = (rows, typedDates = false) => rows.map((row, rowIndex) => ({
  values: row.map((value, columnIndex) => cell(value, typedDates && rowIndex > 0 && DATE_COLUMN_INDEXES.has(columnIndex))),
}));

async function createSpreadsheet(accessToken) {
  return googleRequest(accessToken, "/spreadsheets", {
    method: "POST",
    body: JSON.stringify({
      properties: { title: "Demandas Criação Blank", locale: "pt_BR", timeZone: "America/Sao_Paulo" },
      sheets: [
        { properties: { title: "Demandas", gridProperties: { rowCount: 5000, columnCount: 15, frozenRowCount: 1 } } },
        { properties: { title: "_sync_meta", hidden: true, gridProperties: { rowCount: 5000, columnCount: 8, frozenRowCount: 1 } } },
      ],
    }),
  });
}

function formatRequests(mainSheetId, rowCount) {
  const widths = [300, 180, 170, 110, 130, 100, 180, 180, 180, 180, 180, 120, 90, 240, 300];
  const requests = [
    {
      updateSheetProperties: {
        properties: { sheetId: mainSheetId, gridProperties: { frozenRowCount: 1, hideGridlines: true } },
        fields: "gridProperties.frozenRowCount,gridProperties.hideGridlines",
      },
    },
    {
      repeatCell: {
        range: { sheetId: mainSheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 15 },
        cell: {
          userEnteredFormat: {
            backgroundColorStyle: { rgbColor: { red: 0.10, green: 0.11, blue: 0.09 } },
            textFormat: { foregroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } }, bold: true, fontSize: 10 },
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat(backgroundColorStyle,textFormat,verticalAlignment)",
      },
    },
    {
      repeatCell: {
        range: { sheetId: mainSheetId, startRowIndex: 1, endRowIndex: rowCount + 1, startColumnIndex: 0, endColumnIndex: 15 },
        cell: { userEnteredFormat: { wrapStrategy: "WRAP", verticalAlignment: "TOP" } },
        fields: "userEnteredFormat.wrapStrategy,userEnteredFormat.verticalAlignment",
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId: mainSheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 38 },
        fields: "pixelSize",
      },
    },
    {
      setBasicFilter: { filter: { range: { sheetId: mainSheetId, startRowIndex: 0, endRowIndex: rowCount + 1, startColumnIndex: 0, endColumnIndex: 15 } } },
    },
  ];
  widths.forEach((pixelSize, index) => requests.push({
    updateDimensionProperties: {
      range: { sheetId: mainSheetId, dimension: "COLUMNS", startIndex: index, endIndex: index + 1 },
      properties: { pixelSize },
      fields: "pixelSize",
    },
  }));
  return requests;
}

async function writeSnapshot(accessToken, spreadsheetId, mainSheetId, metaSheetId, snapshot, includeFormatting) {
  const requests = [
    { updateCells: { range: { sheetId: mainSheetId, startRowIndex: 0, endRowIndex: 5000, startColumnIndex: 0, endColumnIndex: 15 }, fields: "userEnteredValue" } },
    { updateCells: { range: { sheetId: metaSheetId, startRowIndex: 0, endRowIndex: 5000, startColumnIndex: 0, endColumnIndex: 8 }, fields: "userEnteredValue" } },
    { updateCells: { start: { sheetId: mainSheetId, rowIndex: 0, columnIndex: 0 }, rows: rowData([HEADERS, ...snapshot.rows], true), fields: "userEnteredValue" } },
    { updateCells: { start: { sheetId: metaSheetId, rowIndex: 0, columnIndex: 0 }, rows: rowData([META_HEADERS, ...snapshot.metaRows]), fields: "userEnteredValue" } },
    {
      repeatCell: {
        range: { sheetId: mainSheetId, startRowIndex: 1, endRowIndex: 5000, startColumnIndex: 7, endColumnIndex: 11 },
        cell: { userEnteredFormat: { numberFormat: { type: "DATE", pattern: "dd/mm/yyyy" } } },
        fields: "userEnteredFormat.numberFormat",
      },
    },
  ];
  if (includeFormatting) requests.push(...formatRequests(mainSheetId, snapshot.rows.length));
  await googleRequest(accessToken, `/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ requests }),
  });
}

async function ensureCredential(apiKey, existingCredentials, name, type, data) {
  const existing = existingCredentials.find((credential) => credential.name === name && credential.type === type);
  if (existing) return { id: existing.id, name };
  const created = await n8nRequest(apiKey, "/credentials", {
    method: "POST",
    body: JSON.stringify({ name, type, data }),
  });
  existingCredentials.push(created);
  return { id: created.id, name };
}

async function listAllWorkflows(apiKey) {
  const workflows = [];
  let cursor;
  do {
    const suffix = cursor ? `?limit=100&cursor=${encodeURIComponent(cursor)}` : "?limit=100";
    const page = await n8nRequest(apiKey, `/workflows${suffix}`);
    workflows.push(...(page.data || []));
    cursor = page.nextCursor || undefined;
  } while (cursor);
  return workflows;
}

async function ensureWorkflow(apiKey, existingWorkflows, workflow) {
  const existing = existingWorkflows.find((item) => item.name === workflow.name);
  if (existing) {
    const updated = await n8nRequest(apiKey, `/workflows/${existing.id}`, {
      method: "PUT",
      body: JSON.stringify(workflow),
    });
    return updated;
  }
  const created = await n8nRequest(apiKey, "/workflows", {
    method: "POST",
    body: JSON.stringify(workflow),
  });
  existingWorkflows.push(created);
  return created;
}

async function activateWorkflow(apiKey, workflowId) {
  const workflow = await n8nRequest(apiKey, `/workflows/${workflowId}`);
  if (workflow.active) {
    await n8nRequest(apiKey, `/workflows/${workflowId}/deactivate`, { method: "POST", body: "{}" });
  }
  return n8nRequest(apiKey, `/workflows/${workflowId}/activate`, { method: "POST", body: "{}" });
}

async function main() {
  const credentials = await readCredentials(sourceEnvPath);
  const localEnv = (await fileExists(localEnvPath)) ? parseEnv(await readFile(localEnvPath, "utf8")) : {};
  const provisionState = (await fileExists(provisionStatePath)) ? JSON.parse(await readFile(provisionStatePath, "utf8")) : {};
  const initialPassword = localEnv.APP_PASSWORD_HASH ? null : generatePassword();
  const appUsername = localEnv.APP_USERNAME || "blank";
  const passwordHash = localEnv.APP_PASSWORD_HASH || generatePasswordHash(initialPassword);
  const sessionSecret = localEnv.SESSION_SECRET || randomSecret();
  const webhookSecret = localEnv.N8N_WEBHOOK_SECRET || randomSecret();

  const googleToken = await refreshGoogleToken(credentials.google);
  const notionSchema = await notionRequest(credentials.notion, `/data_sources/${SOURCE_DATA_SOURCE_ID}`);
  validateSchema(notionSchema);
  const [pages, clients] = await Promise.all([
    queryAll(credentials.notion, SOURCE_DATA_SOURCE_ID),
    queryAll(credentials.notion, CLIENTS_DATA_SOURCE_ID),
  ]);
  const snapshot = normalizePages(pages, clients);
  if (!snapshot.rows.length) throw new Error("A fonte do Notion retornou zero registros; criação cancelada.");

  let spreadsheetId = localEnv.SPREADSHEET_ID || provisionState.spreadsheetId;
  let spreadsheet;
  let createdSpreadsheet = false;
  if (spreadsheetId) {
    spreadsheet = await googleRequest(googleToken.access_token, `/spreadsheets/${spreadsheetId}?fields=spreadsheetId,spreadsheetUrl,sheets.properties`);
  } else {
    spreadsheet = await createSpreadsheet(googleToken.access_token);
    spreadsheetId = spreadsheet.spreadsheetId;
    createdSpreadsheet = true;
    await writeFile(provisionStatePath, JSON.stringify({
      spreadsheetId,
      spreadsheetUrl: spreadsheet.spreadsheetUrl,
      createdAt: new Date().toISOString(),
    }, null, 2));
  }
  const mainSheet = spreadsheet.sheets.find((sheet) => sheet.properties.title === "Demandas");
  const metaSheet = spreadsheet.sheets.find((sheet) => sheet.properties.title === "_sync_meta");
  if (!mainSheet || !metaSheet) throw new Error("As abas Demandas e _sync_meta não foram encontradas.");
  await writeSnapshot(
    googleToken.access_token,
    spreadsheetId,
    mainSheet.properties.sheetId,
    metaSheet.properties.sheetId,
    snapshot,
    createdSpreadsheet,
  );

  const credentialsPage = await n8nRequest(credentials.n8n, "/credentials?limit=250");
  const existingCredentials = credentialsPage.data || [];
  const notionCredential = await ensureCredential(credentials.n8n, existingCredentials, "Notion | Demandas Blank", "notionApi", {
    apiKey: credentials.notion,
  });
  const googleCredential = await ensureCredential(credentials.n8n, existingCredentials, "Google Sheets | Demandas Blank", "googleSheetsOAuth2Api", {
    clientId: credentials.google.client_id,
    clientSecret: credentials.google.client_secret,
    serverUrl: "https://www.googleapis.com",
    sendAdditionalBodyProperties: false,
    additionalBodyProperties: {},
    oauthTokenData: {
      access_token: googleToken.access_token,
      refresh_token: credentials.google.refresh_token,
      token_type: googleToken.token_type || "Bearer",
      scope: (credentials.google.scopes || []).join(" "),
      expires_in: googleToken.expires_in || 3599,
    },
  });
  const headerCredentialName = `Header | Demandas Blank | ${webhookSecret.slice(0, 8)}`;
  const headerCredential = await ensureCredential(credentials.n8n, existingCredentials, headerCredentialName, "httpHeaderAuth", {
    name: "X-Demandas-Key",
    value: webhookSecret,
    useCustomAuth: false,
  });

  const workflowList = await listAllWorkflows(credentials.n8n);
  const syncWorkflow = await ensureWorkflow(credentials.n8n, workflowList, buildSyncWorkflow({
    notionCredential,
    googleCredential,
    headerCredential,
    spreadsheetId,
    mainSheetId: mainSheet.properties.sheetId,
    metaSheetId: metaSheet.properties.sheetId,
  }));
  const apiWorkflow = await ensureWorkflow(credentials.n8n, workflowList, buildApiWorkflow({
    googleCredential,
    headerCredential,
    spreadsheetId,
  }));
  await activateWorkflow(credentials.n8n, syncWorkflow.id);
  await activateWorkflow(credentials.n8n, apiWorkflow.id);

  const spreadsheetUrl = spreadsheet.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  await writeFile(provisionStatePath, JSON.stringify({
    ...provisionState,
    spreadsheetId,
    spreadsheetUrl,
    updatedAt: new Date().toISOString(),
  }, null, 2));
  const encodedPasswordHash = passwordHash.includes("\\$") ? passwordHash : passwordHash.replaceAll("$", "\\$");
  const envLines = [
    `APP_USERNAME=${appUsername}`,
    `APP_PASSWORD_HASH=${encodedPasswordHash}`,
    `SESSION_SECRET=${sessionSecret}`,
    `N8N_WEBHOOK_URL=${N8N_BASE}/webhook/demandas-blank`,
    `N8N_WEBHOOK_SECRET=${webhookSecret}`,
    `SPREADSHEET_ID=${spreadsheetId}`,
    `SPREADSHEET_URL=${spreadsheetUrl}`,
  ];
  await writeFile(localEnvPath, `${envLines.join("\n")}\n`, { mode: 0o600 });
  await writeFile(exampleEnvPath, [
    "APP_USERNAME=blank",
    "APP_PASSWORD_HASH=pbkdf2$iterations$salt$hash",
    "SESSION_SECRET=replace-with-a-random-secret",
    "N8N_WEBHOOK_URL=https://your-n8n.example/webhook/demandas-blank",
    "N8N_WEBHOOK_SECRET=replace-with-a-random-secret",
    "SPREADSHEET_ID=google-spreadsheet-id",
    "SPREADSHEET_URL=https://docs.google.com/spreadsheets/d/id/edit",
  ].join("\n") + "\n");

  const summary = {
    rows: snapshot.rows.length,
    headers: HEADERS.length,
    spreadsheetId,
    spreadsheetUrl,
    syncWorkflowId: syncWorkflow.id,
    apiWorkflowId: apiWorkflow.id,
    initialPassword,
    username: appUsername,
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
