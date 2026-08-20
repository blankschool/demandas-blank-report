"use client";

import { forwardRef } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { chunkPdfItems, PDF_CHART_PAGE_SIZE, PDF_CLIENT_PAGE_SIZE } from "./lib/pdf-report.mjs";

export type PdfCountStat = { name: string; count: number };

export type PdfChart = {
  key: string;
  title: string;
  data: PdfCountStat[];
};

export type PdfClient = {
  name: string;
  total: number;
  active: number;
  overdue: number;
  progress: number;
  people: string[];
  nextDeadline: string;
};

export type PdfSnapshot = {
  generatedAt: string;
  syncedAt: string;
  totalSource: number;
  filters: string[];
  metrics: Array<{ label: string; value: number; detail: string }>;
  charts: PdfChart[];
  clients: PdfClient[];
  filteredDemands: number;
};

type PageProps = {
  page: number;
  total: number;
  children: React.ReactNode;
};

function PdfPage({ page, total, children }: PageProps) {
  return (
    <section className="pdf-page" data-pdf-page>
      <div className="pdf-page-content">{children}</div>
      <footer className="pdf-footer">
        <span>Dados sincronizados do Notion</span>
        <span>{page} / {total}</span>
      </footer>
    </section>
  );
}

function PdfChartGraphic({ data }: { data: PdfCountStat[] }) {
  if (!data.length) return <div className="pdf-empty">Nenhum dado disponível neste recorte.</div>;
  return (
    <div className="pdf-chart-graphic">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 24, right: 22, bottom: 128, left: 8 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke="#edece8"/>
          <XAxis
            dataKey="name"
            interval={0}
            angle={-36}
            textAnchor="end"
            height={126}
            tickLine={false}
            axisLine={false}
            tickMargin={14}
            tick={{ fill: "#4e4e4e", fontSize: 12 }}
          />
          <YAxis
            allowDecimals={false}
            axisLine={false}
            tickLine={false}
            tickMargin={10}
            width={52}
            tick={{ fill: "#8f8f8f", fontSize: 11 }}
          />
          <Bar dataKey="count" fill="#111111" stroke="none" radius={0} maxBarSize={52} minPointSize={2} isAnimationActive={false}/>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export const PdfReportSurface = forwardRef<HTMLDivElement, { snapshot: PdfSnapshot }>(function PdfReportSurface({ snapshot }, ref) {
  const chartSections = snapshot.charts.flatMap((chart) => {
    const chunks = chunkPdfItems(chart.data, PDF_CHART_PAGE_SIZE) as PdfCountStat[][];
    return chunks.map((data, index) => ({
      ...chart,
      data,
      part: index + 1,
      parts: chunks.length,
    }));
  });
  const clientSections = chunkPdfItems(snapshot.clients, PDF_CLIENT_PAGE_SIZE) as PdfClient[][];
  const totalPages = 1 + chartSections.length + clientSections.length;
  let page = 1;

  return (
    <div className="pdf-export-surface" ref={ref} aria-hidden="true">
      <PdfPage page={page++} total={totalPages}>
        <header className="pdf-cover-head">
          <div>
            <p>RELATÓRIO INTERNO</p>
            <h1>Operação time criação</h1>
          </div>
          <div className="pdf-cover-meta">
            <strong>Gerado em {formatDateTime(snapshot.generatedAt)}</strong>
            <span>{snapshot.syncedAt}</span>
            <small>{snapshot.totalSource.toLocaleString("pt-BR")} registros na fonte</small>
          </div>
        </header>
        <div className="pdf-filter-block">
          <span>Recorte exportado</span>
          <div>{snapshot.filters.map((filter) => <b key={filter}>{filter}</b>)}</div>
        </div>
        <div className="pdf-kpis">
          {snapshot.metrics.map((metric) => (
            <article key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value.toLocaleString("pt-BR")}</strong>
              <small>{metric.detail}</small>
            </article>
          ))}
        </div>
        <div className="pdf-cover-note">
          <strong>{snapshot.filteredDemands.toLocaleString("pt-BR")}</strong>
          <span>demandas no recorte atual</span>
        </div>
      </PdfPage>

      {chartSections.map((chart) => (
        <PdfPage page={page++} total={totalPages} key={`${chart.key}-${chart.part}`}>
          <header className="pdf-section-head">
            <div><p>ANÁLISE</p><h2>{chart.title}</h2></div>
            <span>{chart.parts > 1 ? `${chart.part} / ${chart.parts}` : "Todos os grupos"}</span>
          </header>
          <PdfChartGraphic data={chart.data}/>
        </PdfPage>
      ))}

      {clientSections.map((clientPage, index) => (
        <PdfPage page={page++} total={totalPages} key={`clients-${index + 1}`}>
          <header className="pdf-section-head">
            <div><p>VISÃO CONSOLIDADA</p><h2>Clientes</h2></div>
            <span>{index + 1} / {clientSections.length}</span>
          </header>
          {clientPage.length ? (
            <div className="pdf-client-table">
              <div className="pdf-client-row pdf-client-head">
                <span>Cliente</span><span>Demandas</span><span>Em aberto</span><span>Atrasadas</span><span>Progresso</span><span>Responsáveis</span><span>Próximo prazo</span>
              </div>
              {clientPage.map((client) => (
                <div className="pdf-client-row" key={client.name}>
                  <strong>{client.name}</strong>
                  <span>{client.total}</span>
                  <span>{client.active}</span>
                  <span>{client.overdue}</span>
                  <span>{client.progress}%</span>
                  <span>{client.people.join(", ") || "Não definido"}</span>
                  <span>{client.nextDeadline || "Sem prazo"}</span>
                </div>
              ))}
            </div>
          ) : <div className="pdf-empty">Nenhum cliente disponível neste recorte.</div>}
        </PdfPage>
      ))}
    </div>
  );
});
