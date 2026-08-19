import assert from "node:assert/strict";
import test from "node:test";
import { filterDemandas } from "../app/lib/dashboard-filters.mjs";

const items = [
  { id: "1", nome: "Peça A", clientes: ["Cubo Itaú"], responsaveis: ["Thayna Cavalari"], status: "Finalizado", prioridade: "P1", formato: "Carrossel", cargo: "", obs: "", prazoCriacao: "19/08/2026" },
  { id: "2", nome: "Peça B", clientes: ["Cubo Itaú"], responsaveis: ["Henrique Ikeda"], status: "Em aprovação", prioridade: "P2", formato: "Carrossel", cargo: "", obs: "", prazoCriacao: "20/08/2026" },
  { id: "3", nome: "Peça C", clientes: [], responsaveis: [], status: "", prioridade: "P3", formato: "", cargo: "", obs: "", prazoCriacao: "" },
];

const baseFilters = {
  query: "",
  person: "",
  status: "",
  priority: "",
  format: "",
  deadline: "all",
  client: "",
  exactDeadline: "",
};

test("combina filtros de dimensões diferentes", () => {
  const result = filterDemandas(items, { ...baseFilters, client: "Cubo Itaú", status: "Finalizado" }, "", new Date(2026, 7, 19));
  assert.deepEqual(result.map((item) => item.id), ["1"]);
});

test("preserva o contexto ao omitir a dimensão do próprio gráfico", () => {
  const filters = { ...baseFilters, client: "Cubo Itaú", status: "Finalizado" };
  assert.deepEqual(filterDemandas(items, filters, "", new Date(2026, 7, 19)).map((item) => item.id), ["1"]);
  assert.deepEqual(filterDemandas(items, filters, "status", new Date(2026, 7, 19)).map((item) => item.id), ["1", "2"]);
});

test("mantém grupos vazios e relações ausentes filtráveis", () => {
  const withoutClient = filterDemandas(items, { ...baseFilters, client: "Sem cliente" }, "", new Date(2026, 7, 19));
  const withoutPerson = filterDemandas(items, { ...baseFilters, person: "Sem responsável" }, "", new Date(2026, 7, 19));
  assert.deepEqual(withoutClient.map((item) => item.id), ["3"]);
  assert.deepEqual(withoutPerson.map((item) => item.id), ["3"]);
});
