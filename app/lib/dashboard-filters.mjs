import { dateSortValue, displayDateValue, localCalendarKey } from "./dates.mjs";

const FINAL_STATUSES = new Set(["finalizado", "cancelado"]);

function normalize(value = "") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function isReadablePerson(value = "") {
  return Boolean(value && !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value));
}

function isFinished(item) {
  return FINAL_STATUSES.has(normalize(item.status));
}

export function filterDemandas(items, filters, omittedDimension = "", now = new Date()) {
  const needle = normalize(filters.query);
  const todayKey = localCalendarKey(now);
  const limit = new Date(now);
  const deadlineDays = Number.parseInt(filters.deadline, 10);
  if (Number.isFinite(deadlineDays)) limit.setDate(limit.getDate() + deadlineDays);
  const limitKey = Number.isFinite(deadlineDays) ? localCalendarKey(limit) : "";

  return items.filter((item) => {
    const searchable = normalize([
      item.nome,
      ...(item.clientes || []),
      ...(item.responsaveis || []),
      item.status,
      item.formato,
      item.cargo,
      item.obs,
    ].join(" "));
    const dateKey = dateSortValue(item.prazoCriacao);
    const dateLabel = dateKey ? displayDateValue(dateKey) : "Sem prazo";
    const clientNames = item.clientes?.length ? item.clientes : ["Sem cliente"];
    const readablePeople = (item.responsaveis || []).filter(isReadablePerson);
    const deadlineMatch = filters.deadline === "all"
      || (filters.deadline === "overdue"
        ? Boolean(dateKey && dateKey < todayKey && !isFinished(item))
        : Boolean(dateKey && dateKey >= todayKey && dateKey <= limitKey));

    return (!needle || searchable.includes(needle))
      && (omittedDimension === "person" || !filters.person || (filters.person === "Sem responsável" ? !readablePeople.length : readablePeople.includes(filters.person)))
      && (omittedDimension === "status" || !filters.status || (item.status || "Sem status") === filters.status)
      && (!filters.priority || item.prioridade === filters.priority)
      && (!filters.format || item.formato === filters.format)
      && (omittedDimension === "client" || !filters.client || clientNames.includes(filters.client))
      && (omittedDimension === "deadline" || !filters.exactDeadline || dateLabel === filters.exactDeadline)
      && deadlineMatch;
  });
}
