export const PDF_CHART_PAGE_SIZE = 12;
export const PDF_CLIENT_PAGE_SIZE = 12;

export function chunkPdfItems(items, size) {
  if (!Array.isArray(items) || items.length === 0) return [[]];
  const chunkSize = Math.max(1, Number(size) || 1);
  const chunks = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

export function pdfFilename(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `relatorio-operacao-criativa-${year}-${month}-${day}.pdf`;
}

export function buildPdfFilterLabels(filters) {
  const deadlineLabels = {
    past30: "Últimos 30 dias",
    past7: "Últimos 7 dias",
    today: "Hoje",
    all: "Qualquer data",
    overdue: "Atrasadas",
    custom: filters.exactDeadline || "Data selecionada",
  };
  const labels = [
    filters.query && `Busca: ${filters.query}`,
    filters.person && `Responsável: ${filters.person}`,
    filters.status && `Status: ${filters.status}`,
    filters.priority && `Prioridade: ${filters.priority}`,
    filters.format && `Formato: ${filters.format}`,
    filters.client && `Cliente: ${filters.client}`,
    `Prazo: ${deadlineLabels[filters.deadline] || filters.deadline || "Qualquer data"}`,
    filters.deadline !== "custom" && filters.exactDeadline && `Prazo exato: ${filters.exactDeadline}`,
  ];
  return labels.filter(Boolean);
}

export function countPdfPages(charts, clients) {
  const chartPages = charts.reduce(
    (total, chart) => total + Math.max(1, Math.ceil(chart.data.length / PDF_CHART_PAGE_SIZE)),
    0,
  );
  return 1 + chartPages + Math.max(1, Math.ceil(clients.length / PDF_CLIENT_PAGE_SIZE));
}
