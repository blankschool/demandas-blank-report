import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPdfFilterLabels,
  chunkPdfItems,
  countPdfPages,
  pdfFilename,
} from "../app/lib/pdf-report.mjs";

test("divide gráficos e clientes sem perder ou duplicar registros", () => {
  const source = Array.from({ length: 29 }, (_, index) => ({ id: index + 1 }));
  const chunks = chunkPdfItems(source, 12);
  assert.deepEqual(chunks.map((chunk) => chunk.length), [12, 12, 5]);
  assert.deepEqual(chunks.flat(), source);
  assert.equal(new Set(chunks.flat().map((item) => item.id)).size, source.length);
});

test("mantém uma página vazia para seções sem dados", () => {
  assert.deepEqual(chunkPdfItems([], 12), [[]]);
});

test("monta filtros legíveis incluindo o período padrão", () => {
  const labels = buildPdfFilterLabels({
    query: "painel",
    person: "Thayna Cavalari",
    status: "Finalizado",
    priority: "P1",
    format: "Carrossel",
    deadline: "past30",
    client: "Cubo Itaú",
    exactDeadline: "",
  });
  assert.deepEqual(labels, [
    "Busca: painel",
    "Responsável: Thayna Cavalari",
    "Status: Finalizado",
    "Prioridade: P1",
    "Formato: Carrossel",
    "Cliente: Cubo Itaú",
    "Prazo: Últimos 30 dias",
  ]);
});

test("gera nome estável com a data local", () => {
  assert.equal(pdfFilename(new Date(2026, 7, 20, 12)), "relatorio-operacao-criativa-2026-08-20.pdf");
});

test("calcula capa, páginas de gráficos e todos os clientes", () => {
  const charts = [
    { data: Array.from({ length: 25 }) },
    { data: Array.from({ length: 1 }) },
    { data: [] },
    { data: Array.from({ length: 13 }) },
  ];
  const clients = Array.from({ length: 25 });
  assert.equal(countPdfPages(charts, clients), 11);
});
