import assert from "node:assert/strict";
import test from "node:test";
import {
  dateValue,
  extractFirstJsonAfterMarker,
  googleDateSerial,
  googleSerialDate,
  HEADERS,
  normalizePages,
  storedDateValue,
  validateSchema,
} from "../automation/core.mjs";
import { buildApiWorkflow, buildSyncWorkflow } from "../automation/n8n-workflows.mjs";
import { dateSortValue, displayDateValue, localCalendarKey } from "../app/lib/dates.mjs";

test("extrai credencial JSON com chaves e strings aninhadas", () => {
  const content = '# Planilhas\n{ "client": { "text": "chave } interna" }, "ok": true }\n# Fim';
  assert.deepEqual(extractFirstJsonAfterMarker(content, "# Planilhas"), { client: { text: "chave } interna" }, ok: true });
});

test("remove horário sem converter o dia e preserva intervalo", () => {
  assert.equal(dateValue({ start: "2026-08-19T23:30:00-03:00", end: "2026-08-20T01:00:00+10:00" }), "19/08/2026 → 20/08/2026");
  assert.equal(dateValue({ start: "2026-08-19" }), "19/08/2026");
  assert.equal(dateValue(null), "");
});

test("converte datas nativas do Google Sheets de forma idempotente", () => {
  assert.equal(googleDateSerial("19/08/2026"), 46253);
  assert.equal(googleSerialDate(46253), "19/08/2026");
  assert.equal(storedDateValue("2026-08-19T11:13:00.000-03:00"), "19/08/2026");
  assert.equal(storedDateValue("2026-08-19T19:00:00.000-03:00 → 2026-08-20T11:00:00.000-03:00"), "19/08/2026 → 20/08/2026");
  assert.equal(storedDateValue(46253), "19/08/2026");
});

test("normaliza relações múltiplas, pessoas e células nativas", () => {
  const text = (plain_text) => ({ plain_text });
  const page = {
    id: "d1", url: "https://notion.so/d1", created_time: "2026-01-01", last_edited_time: "2026-01-02", archived: false,
    properties: {
      Nome: { title: [text("Peça A")] },
      Cliente: { relation: [{ id: "c1" }, { id: "c2" }] },
      "Responsável": { people: [{ name: "Ana" }, { name: "Bia" }] },
      Cargo: { select: { name: "Designer" } }, Formato: { select: { name: "Carrossel" } },
      Prioridade: { select: { name: "P2" } }, Status: { status: { name: "Em criação" } },
      "Prazo de Criação": { date: { start: "2026-08-20" } }, "Data de Postagem": { date: null },
      "Iniciado em": { date: null }, "Concluído em": { date: null },
      "Tempo gasto": { formula: { type: "string", string: null } }, "Total ↓": { number: 3 },
      "Link Notion": { url: "https://example.com" }, Obs: { rich_text: [text("Texto longo")] },
    },
  };
  const clients = [
    { id: "c1", properties: { Name: { type: "title", title: [text("Cliente 1")] } } },
    { id: "c2", properties: { Name: { type: "title", title: [text("Cliente 2")] } } },
  ];
  const { rows, metaRows } = normalizePages([page], clients, "2026-08-19T12:00:00Z");
  assert.equal(rows[0][1], "Cliente 1\nCliente 2");
  assert.equal(rows[0][2], "Ana\nBia");
  assert.equal(rows[0][11], "");
  assert.equal(rows[0][12], 3);
  assert.equal(metaRows[0][0], "d1");
  assert.equal(metaRows[0][6], 2);
});

test("interrompe quando o esquema muda", () => {
  validateSchema({ properties: Object.fromEntries(HEADERS.map((header) => [header, {}])) });
  assert.throws(() => validateSchema({ properties: { Nome: {} } }), /Esquema do Notion mudou/);
});

test("gera workflows válidos com datas tipadas e contrato DD/MM/AAAA", () => {
  const credentials = { id: "credential", name: "credential" };
  const options = {
    notionCredential: credentials,
    googleCredential: credentials,
    headerCredential: credentials,
    spreadsheetId: "sheet",
    mainSheetId: 1,
    metaSheetId: 2,
  };
  const sync = buildSyncWorkflow(options);
  const api = buildApiWorkflow(options);
  const syncCode = sync.nodes.find((node) => node.name === "Montar snapshot validado").parameters.jsCode;
  const apiCode = api.nodes.find((node) => node.name === "Montar resposta").parameters.jsCode;
  assert.doesNotThrow(() => new Function(syncCode));
  assert.doesNotThrow(() => new Function(apiCode));
  assert.match(syncCode, /pattern: 'dd\/mm\/yyyy'/);
  assert.match(apiCode, /schemaVersion: 2/);
});

test("ordena e filtra datas DD/MM/AAAA usando uma chave ISO", () => {
  assert.equal(dateSortValue("19/08/2026"), "2026-08-19");
  assert.equal(dateSortValue("19/08/2026 → 20/08/2026"), "2026-08-19");
  assert.equal(displayDateValue("19/08/2026 → 20/08/2026"), "19/08/2026 → 20/08/2026");
  assert.equal(dateSortValue("19/08/2026") >= "2026-08-19", true);
  assert.equal(dateSortValue("19/08/2026") >= "2030-01-01", false);
});

test("gera a chave de hoje pelo calendário local", () => {
  assert.equal(localCalendarKey(new Date(2026, 7, 19, 23, 30)), "2026-08-19");
});
