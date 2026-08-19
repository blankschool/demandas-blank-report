import { randomUUID } from "node:crypto";
import {
  CLIENTS_DATABASE_ID,
  HEADERS,
  META_HEADERS,
  SOURCE_DATABASE_ID,
  SOURCE_NAME,
} from "./core.mjs";

const node = (name, type, typeVersion, position, parameters = {}, credentials, extra = {}) => ({
  id: randomUUID(),
  ...(type === "n8n-nodes-base.webhook" ? { webhookId: randomUUID() } : {}),
  name,
  type,
  typeVersion,
  position,
  parameters,
  ...(credentials ? { credentials } : {}),
  ...extra,
});

const connection = (target) => ({ main: [[{ node: target, type: "main", index: 0 }]] });
const sourceConnections = () => ({
  main: [[
    { node: "Ler demandas", type: "main", index: 0 },
    { node: "Ler clientes", type: "main", index: 0 },
  ]],
});

function snapshotCode(mainSheetId, metaSheetId) {
  return `const demandas = $('Ler demandas').all().map(item => item.json);
const clientes = $('Ler clientes').all().map(item => item.json);
const HEADERS = ${JSON.stringify(HEADERS)};
const META_HEADERS = ${JSON.stringify(META_HEADERS)};
const EXPECTED = [...HEADERS].sort();

const rich = value => (value || []).map(part => part.plain_text ?? part.text?.content ?? '').join('');
const title = (page, preferred = 'Name') => {
  const properties = page?.properties || {};
  const property = properties[preferred] || Object.values(properties).find(value => value?.type === 'title');
  return rich(property?.title || []);
};
const displayDatePart = value => {
  const match = String(value || '').match(/^(\\d{4})-(\\d{2})-(\\d{2})/);
  return match ? match[3] + '/' + match[2] + '/' + match[1] : '';
};
const dateValue = value => {
  if (!value?.start) return '';
  const start = displayDatePart(value.start);
  const end = displayDatePart(value.end);
  return end ? start + ' → ' + end : start;
};
const formulaValue = value => {
  if (!value?.type) return '';
  const result = value[value.type];
  if (result == null) return '';
  return value.type === 'date' ? dateValue(result) : result;
};
const hash = input => {
  const text = JSON.stringify(input);
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(16).padStart(8, '0');
};
const DATE_COLUMNS = new Set([7, 8, 9, 10]);
const dateSerial = value => {
  const match = String(value || '').match(/^(\\d{2})\\/(\\d{2})\\/(\\d{4})$/);
  if (!match) return null;
  return Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])) / 86400000 + 25569;
};
const cell = (value, asDate = false) => {
  if (value === '' || value == null) return {};
  const serial = asDate ? dateSerial(value) : null;
  if (serial != null) return { userEnteredValue: { numberValue: serial } };
  if (typeof value === 'number' && Number.isFinite(value)) return { userEnteredValue: { numberValue: value } };
  if (typeof value === 'boolean') return { userEnteredValue: { boolValue: value } };
  return { userEnteredValue: { stringValue: String(value) } };
};
const rowData = (values, typedDates = false) => values.map((row, rowIndex) => ({
  values: row.map((value, columnIndex) => cell(value, typedDates && rowIndex > 0 && DATE_COLUMNS.has(columnIndex))),
}));

if (!demandas.length) throw new Error('A fonte do Notion retornou zero demandas; o snapshot anterior foi preservado.');
const actual = Object.keys(demandas[0].properties || {}).sort();
if (JSON.stringify(actual) !== JSON.stringify(EXPECTED)) {
  const missing = EXPECTED.filter(name => !actual.includes(name));
  const extra = actual.filter(name => !EXPECTED.includes(name));
  throw new Error('Esquema do Notion mudou. Ausentes: ' + (missing.join(', ') || 'nenhuma') + '. Extras: ' + (extra.join(', ') || 'nenhuma') + '.');
}

const clientNames = new Map(clientes.map(page => [page.id, title(page, 'Name')]));
const syncedAt = new Date().toISOString();
const rows = demandas.map(page => {
  const p = page.properties || {};
  return [
    rich(p.Nome?.title),
    (p.Cliente?.relation || []).map(relation => clientNames.get(relation.id) || relation.id).join('\\n'),
    (p['Responsável']?.people || []).map(person => person.name || person.id).join('\\n'),
    p.Cargo?.select?.name || '',
    p.Formato?.select?.name || '',
    p.Prioridade?.select?.name || '',
    p.Status?.status?.name || '',
    dateValue(p['Prazo de Criação']?.date),
    dateValue(p['Data de Postagem']?.date),
    dateValue(p['Iniciado em']?.date),
    dateValue(p['Concluído em']?.date),
    formulaValue(p['Tempo gasto']?.formula),
    p['Total ↓']?.number ?? '',
    p['Link Notion']?.url || '',
    rich(p.Obs?.rich_text),
  ];
});
const metaRows = demandas.map((page, index) => [
  page.id,
  page.url || '',
  page.created_time || '',
  page.last_edited_time || '',
  Boolean(page.archived),
  hash(rows[index]),
  index + 2,
  syncedAt,
]);

const requests = [
  { updateCells: { range: { sheetId: ${mainSheetId}, startRowIndex: 0, endRowIndex: 5000, startColumnIndex: 0, endColumnIndex: 15 }, fields: 'userEnteredValue' } },
  { updateCells: { range: { sheetId: ${metaSheetId}, startRowIndex: 0, endRowIndex: 5000, startColumnIndex: 0, endColumnIndex: 8 }, fields: 'userEnteredValue' } },
  { updateCells: { start: { sheetId: ${mainSheetId}, rowIndex: 0, columnIndex: 0 }, rows: rowData([HEADERS, ...rows], true), fields: 'userEnteredValue' } },
  { updateCells: { start: { sheetId: ${metaSheetId}, rowIndex: 0, columnIndex: 0 }, rows: rowData([META_HEADERS, ...metaRows]), fields: 'userEnteredValue' } },
  { repeatCell: { range: { sheetId: ${mainSheetId}, startRowIndex: 1, endRowIndex: 5000, startColumnIndex: 7, endColumnIndex: 11 }, cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' } } }, fields: 'userEnteredFormat.numberFormat' } },
];

return [{ json: { batchBody: { requests }, summary: { total: rows.length, syncedAt, source: ${JSON.stringify(SOURCE_NAME)} } } }];`;
}

const apiResponseCode = `const response = $('Ler planilha').first().json;
const ranges = response.valueRanges || [];
const mainRows = ranges.find(item => String(item.valueRange?.range || '').startsWith('Demandas!'))?.valueRange?.values || [];
const metaRows = ranges.find(item => String(item.valueRange?.range || '').includes('_sync_meta'))?.valueRange?.values || [];
if (!mainRows.length) throw new Error('A planilha ainda não possui cabeçalhos.');
const headers = mainRows[0];
const metadata = new Map(metaRows.slice(1).map(row => [Number(row[6]), row]));
const split = value => String(value || '').split('\\n').map(item => item.trim()).filter(Boolean);
const displayDatePart = value => {
  const text = String(value || '');
  const display = text.match(/^(\\d{2})\\/(\\d{2})\\/(\\d{4})$/);
  if (display) return text;
  const iso = text.match(/^(\\d{4})-(\\d{2})-(\\d{2})/);
  return iso ? iso[3] + '/' + iso[2] + '/' + iso[1] : '';
};
const dateText = value => {
  if (value === '' || value == null) return '';
  if (typeof value === 'number') {
    const date = new Date(Math.round((value - 25569) * 86400000));
    return String(date.getUTCDate()).padStart(2, '0') + '/' + String(date.getUTCMonth() + 1).padStart(2, '0') + '/' + date.getUTCFullYear();
  }
  const parts = String(value).split(' → ').map(displayDatePart).filter(Boolean);
  return parts.length > 1 ? parts[0] + ' → ' + parts[1] : (parts[0] || '');
};
const items = mainRows.slice(1).map((row, index) => {
  const values = Object.fromEntries(headers.map((header, column) => [header, row[column] ?? '']));
  const meta = metadata.get(index + 2) || [];
  return {
    id: meta[0] || 'row-' + (index + 2),
    notionUrl: meta[1] || '',
    nome: values['Nome'] || 'Sem nome',
    clientes: split(values['Cliente']),
    responsaveis: split(values['Responsável']),
    cargo: values['Cargo'] || '',
    formato: values['Formato'] || '',
    prioridade: values['Prioridade'] || '',
    status: values['Status'] || '',
    prazoCriacao: dateText(values['Prazo de Criação']),
    dataPostagem: dateText(values['Data de Postagem']),
    iniciadoEm: dateText(values['Iniciado em']),
    concluidoEm: dateText(values['Concluído em']),
    tempoGasto: values['Tempo gasto'] || '',
    total: values['Total ↓'] === '' ? null : Number(values['Total ↓']),
    linkNotion: values['Link Notion'] || '',
    obs: values['Obs'] || '',
  };
});
const lastMeta = metaRows.at(-1) || [];
return [{ json: { items, meta: { total: items.length, source: ${JSON.stringify(SOURCE_NAME)}, schemaVersion: 2, syncedAt: lastMeta[7] || null } } }];`;

export function buildSyncWorkflow({ notionCredential, googleCredential, headerCredential, spreadsheetId, mainSheetId, metaSheetId }) {
  const nodes = [
    node("Reconciliação a cada 5 minutos", "n8n-nodes-base.scheduleTrigger", 1.3, [-900, 40], {
      rule: { interval: [{ field: "minutes", minutesInterval: 5 }] },
    }),
    node("Executar manualmente", "n8n-nodes-base.manualTrigger", 1, [-900, 180]),
    node("Sincronizar por API", "n8n-nodes-base.webhook", 2.1, [-900, 320], {
      httpMethod: "POST",
      path: "demandas-blank-sync",
      authentication: "headerAuth",
      responseMode: "lastNode",
      options: {},
    }, { httpHeaderAuth: headerCredential }),
    node("Ler demandas", "n8n-nodes-base.notion", 2.2, [-620, 160], {
      resource: "databasePage",
      operation: "getAll",
      databaseId: { __rl: true, value: SOURCE_DATABASE_ID, mode: "id" },
      returnAll: true,
      simple: false,
      filterType: "manual",
      matchType: "allFilters",
      filters: { conditions: [] },
      options: {},
    }, { notionApi: notionCredential }, { retryOnFail: true, maxTries: 8, waitBetweenTries: 5000 }),
    node("Ler clientes", "n8n-nodes-base.notion", 2.2, [-620, 320], {
      resource: "databasePage",
      operation: "getAll",
      databaseId: { __rl: true, value: CLIENTS_DATABASE_ID, mode: "id" },
      returnAll: true,
      simple: false,
      filterType: "manual",
      matchType: "allFilters",
      filters: { conditions: [] },
      options: {},
    }, { notionApi: notionCredential }, { retryOnFail: true, maxTries: 8, waitBetweenTries: 5000 }),
    node("Aguardar fontes", "n8n-nodes-base.merge", 3.2, [-330, 200], {
      mode: "combine",
      combineBy: "combineByPosition",
      options: {},
    }),
    node("Montar snapshot validado", "n8n-nodes-base.code", 2, [-60, 200], {
      jsCode: snapshotCode(mainSheetId, metaSheetId),
    }),
    node("Aplicar snapshot atômico", "n8n-nodes-base.httpRequest", 4.2, [180, 160], {
      method: "POST",
      url: `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      authentication: "predefinedCredentialType",
      nodeCredentialType: "googleSheetsOAuth2Api",
      sendBody: true,
      contentType: "raw",
      rawContentType: "application/json",
      body: "={{ JSON.stringify($json.batchBody) }}",
      options: { timeout: 120000 },
    }, { googleSheetsOAuth2Api: googleCredential }),
    node("Relatório da sincronização", "n8n-nodes-base.code", 2, [460, 160], {
      jsCode: "const summary = $('Montar snapshot validado').first().json.summary; return [{ json: { ...summary, success: true } }];",
    }),
  ];

  return {
    name: "Demandas Blank | Notion → Google Sheets",
    nodes,
    connections: {
      "Reconciliação a cada 5 minutos": sourceConnections(),
      "Executar manualmente": sourceConnections(),
      "Sincronizar por API": sourceConnections(),
      "Ler demandas": { main: [[{ node: "Aguardar fontes", type: "main", index: 0 }]] },
      "Ler clientes": { main: [[{ node: "Aguardar fontes", type: "main", index: 1 }]] },
      "Aguardar fontes": connection("Montar snapshot validado"),
      "Montar snapshot validado": connection("Aplicar snapshot atômico"),
      "Aplicar snapshot atômico": connection("Relatório da sincronização"),
    },
    settings: { executionOrder: "v1" },
  };
}

export function buildApiWorkflow({ googleCredential, headerCredential, spreadsheetId }) {
  const nodes = [
    node("GET demandas", "n8n-nodes-base.webhook", 2.1, [-420, 0], {
      httpMethod: "GET",
      path: "demandas-blank",
      authentication: "headerAuth",
      responseMode: "responseNode",
      options: {},
    }, { httpHeaderAuth: headerCredential }),
    node("Ler planilha", "n8n-nodes-base.httpRequest", 4.2, [-140, 0], {
      method: "POST",
      url: `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGetByDataFilter`,
      authentication: "predefinedCredentialType",
      nodeCredentialType: "googleSheetsOAuth2Api",
      sendBody: true,
      contentType: "raw",
      rawContentType: "application/json",
      body: "={{ JSON.stringify({ dataFilters: [{ a1Range: \"'Demandas'!A1:O5000\" }, { a1Range: \"'_sync_meta'!A1:H5000\" }], majorDimension: 'ROWS', valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING' }) }}",
      options: { timeout: 90000 },
    }, { googleSheetsOAuth2Api: googleCredential }),
    node("Montar resposta", "n8n-nodes-base.code", 2, [140, 0], { jsCode: apiResponseCode }),
    node("Responder JSON", "n8n-nodes-base.respondToWebhook", 1.4, [420, 0], {
      respondWith: "json",
      responseBody: "={{ $json }}",
      options: { responseHeaders: { entries: [{ name: "Cache-Control", value: "private, max-age=60" }] } },
    }),
  ];

  return {
    name: "API | Demandas Blank (somente leitura)",
    nodes,
    connections: {
      "GET demandas": connection("Ler planilha"),
      "Ler planilha": connection("Montar resposta"),
      "Montar resposta": connection("Responder JSON"),
    },
    settings: { executionOrder: "v1" },
  };
}
