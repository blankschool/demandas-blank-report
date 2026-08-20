"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Rectangle, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { BarShapeProps, TooltipContentProps } from "recharts";
import type { Demanda, DemandasResponse } from "./types";
import { filterDemandas } from "./lib/dashboard-filters.mjs";
import { dateSortValue, displayDateValue, localCalendarKey } from "./lib/dates.mjs";

const FINAL_STATUSES = new Set(["finalizado", "cancelado"]);
const READY_STATUS = "pronto para produzir";
const PRIORITY_LIMIT = 4;

type IconName =
  | "arrow"
  | "check"
  | "chevron"
  | "clock"
  | "close"
  | "external"
  | "filter"
  | "logout"
  | "people"
  | "search"
  | "spark"
  | "stack";

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    arrow: <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    close: <path d="M6 6l12 12M18 6 6 18"/>,
    external: <><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/></>,
    filter: <path d="M4 6h16M7 12h10M10 18h4"/>,
    logout: <><path d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10"/></>,
    people: <><path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 20v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    spark: <><path d="m12 3 1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z"/><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z"/></>,
    stack: <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>,
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function isFinished(item: Demanda) {
  return FINAL_STATUSES.has(normalize(item.status));
}

function isOverdue(item: Demanda) {
  const key = dateSortValue(item.prazoCriacao);
  if (!key || isFinished(item)) return false;
  return key < localCalendarKey();
}

function priorityNumber(value: string) {
  const match = value.match(/\d+/);
  return match ? Number(match[0]) : 99;
}

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "—";
}

function isReadablePerson(value: string) {
  return Boolean(value && !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value));
}

function relativeSync(value: string | null) {
  if (!value) return "Sincronização pendente";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sincronizado";
  return `Atualizado às ${date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

type ClientSummary = {
  name: string;
  items: Demanda[];
  active: number;
  completed: number;
  overdue: number;
  people: string[];
  nextDeadline: string;
  progress: number;
};

type SortDirection = "asc" | "desc";
type ChartDimension = "deadline" | "client" | "status" | "person";
type TodayKpi = "today" | "ready" | "completed";
type ChartPopupSelection = {
  dimension: ChartDimension | "indicator";
  value: string;
};

const CHART_DIMENSION_LABELS: Record<ChartDimension, string> = {
  deadline: "Prazo",
  client: "Cliente",
  status: "Status",
  person: "Responsável",
};

type DashboardFilters = {
  query: string;
  person: string;
  status: string;
  priority: string;
  format: string;
  deadline: string;
  client: string;
  exactDeadline: string;
};

type CountStat = {
  name: string;
  count: number;
};

type CountChartData = {
  data: CountStat[];
  total: number;
  largest: number;
};

function buildCountChartData(entries: Array<readonly [string, number]>): CountChartData {
  return {
    data: entries.map(([name, count]) => ({ name, count })),
    total: entries.reduce((sum, [, count]) => sum + count, 0),
    largest: entries.reduce((largest, [, count]) => Math.max(largest, count), 0),
  };
}

function sortContentItems(source: Demanda[]) {
  return source.slice().sort((a, b) => {
    const deadlineA = dateSortValue(a.prazoCriacao) || "9999-12-31";
    const deadlineB = dateSortValue(b.prazoCriacao) || "9999-12-31";
    return deadlineA.localeCompare(deadlineB)
      || priorityNumber(a.prioridade) - priorityNumber(b.prioridade)
      || (a.nome || "Sem nome").localeCompare(b.nome || "Sem nome", "pt-BR");
  });
}

function buildClientSummaries(source: Demanda[], direction: SortDirection): ClientSummary[] {
  const groups = new Map<string, Demanda[]>();
  for (const item of source) {
    const names = item.clientes.length ? item.clientes : ["Sem cliente"];
    for (const name of names) groups.set(name, [...(groups.get(name) || []), item]);
  }

  return [...groups].map(([name, clientItems]) => {
    const active = clientItems.filter((item) => !isFinished(item)).length;
    const completed = clientItems.filter((item) => normalize(item.status) === "finalizado").length;
    const deadlines = clientItems.map((item) => dateSortValue(item.prazoCriacao)).filter(Boolean).sort();
    return {
      name,
      items: clientItems,
      active,
      completed,
      overdue: clientItems.filter(isOverdue).length,
      people: [...new Set(clientItems.flatMap((item) => item.responsaveis).filter(isReadablePerson))],
      nextDeadline: deadlines.find((value) => value >= localCalendarKey()) || "",
      progress: clientItems.length ? Math.round((completed / clientItems.length) * 100) : 0,
    };
  }).sort((a, b) => {
    const volumeComparison = a.items.length - b.items.length || a.active - b.active;
    if (volumeComparison !== 0) return direction === "asc" ? volumeComparison : -volumeComparison;
    return a.name.localeCompare(b.name, "pt-BR");
  });
}

function Login({ onSuccess }: { onSuccess: (username: string) => void }) {
  const [username, setUsername] = useState("blank");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível entrar.");
      onSuccess(body.username || username);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível entrar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-access">
        <div className="login-card">
          <p className="eyebrow">ACESSO RESTRITO</p>
          <h2>ENTRE NO PAINEL</h2>
          <p className="login-intro">Use suas credenciais para consultar o panorama atualizado da operação.</p>
          <form onSubmit={submit}>
            <input type="hidden" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
            <label>Senha<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="••••••••" required /></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button" disabled={loading} type="submit">{loading ? "Entrando…" : "Acessar relatório"}<Icon name="arrow"/></button>
          </form>
          <p className="security-note">Sessão segura com duração de 8 horas.</p>
        </div>
      </section>
    </main>
  );
}

function LoadingScreen() {
  return <main className="loading-screen"><div className="loading-line"><span/></div><p>Carregando</p></main>;
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return <div className="empty-state"><div className="empty-icon"><Icon name="stack"/></div><strong>{title}</strong><span>{text}</span></div>;
}

function SortControl({ direction, onChange, label }: { direction: SortDirection; onChange: (direction: SortDirection) => void; label: string }) {
  return <div className="sort-control" role="group" aria-label={`Ordenar ${label}`}><span>Ordem</span><button type="button" className={direction === "asc" ? "is-active" : ""} onClick={() => onChange("asc")} aria-pressed={direction === "asc"} title="Ordem crescente">↑</button><button type="button" className={direction === "desc" ? "is-active" : ""} onClick={() => onChange("desc")} aria-pressed={direction === "desc"} title="Ordem decrescente">↓</button></div>;
}

function chartAxisLabel(value: string) {
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return value.slice(0, 5);
  return value;
}

function CountChartTooltip({ active, payload }: TooltipContentProps<number, string>) {
  const point = payload?.[0]?.payload as CountStat | undefined;
  if (!active || !point) return null;
  return <div className="chart-tooltip"><span>{point.name}</span><strong>{point.count.toLocaleString("pt-BR")}</strong><small>Toque para filtrar e ver conteúdos</small></div>;
}

type InteractiveChartBarProps = BarShapeProps & {
  selectedName?: string;
  onSelect?: (name: string) => void;
};

function InteractiveChartBar({ payload, selectedName, onSelect, ...rectangleProps }: InteractiveChartBarProps) {
  const point = payload as CountStat | undefined;
  if (!point) return null;
  const selected = selectedName === point.name;
  const muted = Boolean(selectedName && !selected);
  const select = () => onSelect?.(point.name);
  return <Rectangle
    {...rectangleProps}
    className={`chart-bar${selected ? " is-selected" : ""}${muted ? " is-muted" : ""}`}
    radius={0}
    fill={selected ? "var(--ink)" : muted ? "var(--faint)" : "var(--ink)"}
    stroke="none"
    role="button"
    tabIndex={0}
    aria-label={`${selected ? "Remover filtro de" : "Filtrar e ver conteúdos de"} ${point.name}: ${point.count} registros`}
    aria-pressed={selected}
    onClick={select}
    onKeyDown={(event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select();
      }
    }}
  />;
}

function CountBarChart({ data, total, emptyText, selectedLabel, selectedName = "", onSelect, dateAxis = false }: CountChartData & { emptyText: string; selectedLabel: string; selectedName?: string; onSelect?: (name: string) => void; dateAxis?: boolean }) {
  if (!data.length) return <EmptyState title="Sem dados" text={emptyText}/>;
  const selectedPoint = data.find((point) => point.name === selectedName);
  const selectedCount = selectedPoint?.count || 0;
  const categoryWidth = dateAxis ? 46 : 72;
  const canvasMinWidth = Math.max(520, data.length * categoryWidth);

  return (
    <div className={`bar-chart-card${selectedName ? " is-filtered" : ""}`}>
      {selectedName && <div className="chart-active-filter">
        <div><span>Filtrando por {selectedLabel}</span><strong>{selectedName}</strong><em>{selectedCount.toLocaleString("pt-BR")} {selectedCount === 1 ? "demanda" : "demandas"}</em></div>
        <button type="button" onClick={() => onSelect?.(selectedName)} aria-label={`Remover filtro de ${selectedLabel}: ${selectedName}`}>Remover filtro <b>×</b></button>
      </div>}
      <div className={`bar-chart${selectedName ? " is-filtered" : ""}`} role="img" aria-label={`Gráfico de barras com todos os ${data.length} grupos e ${total} registros no recorte${selectedName ? `; filtro ativo em ${selectedName}` : ""}`}>
        <div className="bar-chart-canvas" style={{ minWidth: canvasMinWidth }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart accessibilityLayer data={data} margin={{ top: 12, right: 14, bottom: 8, left: 0 }} barCategoryGap="32%">
              <CartesianGrid vertical={false} stroke="var(--line-soft)"/>
              <XAxis
                dataKey="name"
                tickLine={false}
                axisLine={false}
                tickMargin={14}
                interval={0}
                angle={-38}
                textAnchor="end"
                height={112}
                tickFormatter={chartAxisLabel}
              />
              <YAxis allowDecimals={false} axisLine={false} tickLine={false} tickMargin={8} width={42} domain={[0, "dataMax"]}/>
              <Tooltip content={<CountChartTooltip/>} cursor={{ fill: "var(--soft)" }}/>
              <Bar
                dataKey="count"
                maxBarSize={32}
                minPointSize={2}
                radius={0}
                isAnimationActive={false}
                shape={(props: BarShapeProps) => <InteractiveChartBar {...props} selectedName={selectedName} onSelect={onSelect}/>}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

export default function ReportDashboard() {
  const calendarInputRef = useRef<HTMLInputElement>(null);
  const [sessionState, setSessionState] = useState<"checking" | "guest" | "authenticated">("checking");
  const [data, setData] = useState<DemandasResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [person, setPerson] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [format, setFormat] = useState("");
  const [deadline, setDeadline] = useState("past30");
  const [clientFilter, setClientFilter] = useState("");
  const [chartDeadline, setChartDeadline] = useState("");
  const [statusDirection, setStatusDirection] = useState<SortDirection>("desc");
  const [deadlineDirection, setDeadlineDirection] = useState<SortDirection>("asc");
  const [clientDirection, setClientDirection] = useState<SortDirection>("desc");
  const [peopleDirection, setPeopleDirection] = useState<SortDirection>("desc");
  const [clientPage, setClientPage] = useState(1);
  const [clientPageSize, setClientPageSize] = useState(10);
  const [selectedClient, setSelectedClient] = useState<ClientSummary | null>(null);
  const [selectedDemand, setSelectedDemand] = useState<Demanda | null>(null);
  const [chartPopup, setChartPopup] = useState<ChartPopupSelection | null>(null);
  const [activeKpi, setActiveKpi] = useState<TodayKpi | null>(null);
  const [filterAnnouncement, setFilterAnnouncement] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/demandas", { cache: "no-store" });
      if (response.status === 401) {
        setSessionState("guest");
        setData(null);
        return;
      }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível carregar as demandas.");
      setData(body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível carregar as demandas.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/session", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!active) return;
        if (response.ok && body.authenticated) {
          setSessionState("authenticated");
          void loadData();
        } else setSessionState("guest");
      })
      .catch(() => active && setSessionState("guest"));
    return () => { active = false; };
  }, [loadData]);

  useEffect(() => {
    if (!chartPopup) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setChartPopup(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [chartPopup]);

  const items = useMemo(() => data?.items || [], [data]);
  const options = useMemo(() => {
    const people = new Set(items.flatMap((item) => item.responsaveis).filter(isReadablePerson));
    if (items.some((item) => !item.responsaveis.some(isReadablePerson))) people.add("Sem responsável");
    const statuses = new Set(items.map((item) => item.status).filter(Boolean));
    if (items.some((item) => !item.status)) statuses.add("Sem status");
    return {
      people: [...people].sort((a, b) => a.localeCompare(b, "pt-BR")),
      statuses: [...statuses].sort((a, b) => a.localeCompare(b, "pt-BR")),
      priorities: [...new Set(items.map((item) => item.prioridade).filter(Boolean))].sort((a, b) => priorityNumber(a) - priorityNumber(b)),
      formats: [...new Set(items.map((item) => item.formato).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    };
  }, [items]);

  const activeFilters = useMemo<DashboardFilters>(() => ({
    query,
    person,
    status,
    priority,
    format,
    deadline,
    client: clientFilter,
    exactDeadline: chartDeadline,
  }), [query, person, status, priority, format, deadline, clientFilter, chartDeadline]);

  const filtered = useMemo<Demanda[]>(() => filterDemandas(items, activeFilters) as Demanda[], [items, activeFilters]);
  const deadlineContext = useMemo<Demanda[]>(() => filterDemandas(items, activeFilters, "deadline") as Demanda[], [items, activeFilters]);
  const clientContext = useMemo<Demanda[]>(() => filterDemandas(items, activeFilters, "client") as Demanda[], [items, activeFilters]);
  const statusContext = useMemo<Demanda[]>(() => filterDemandas(items, activeFilters, "status") as Demanda[], [items, activeFilters]);
  const peopleContext = useMemo<Demanda[]>(() => filterDemandas(items, activeFilters, "person") as Demanda[], [items, activeFilters]);
  const chartPopupItems = useMemo(() => chartPopup ? sortContentItems(filtered) : [], [chartPopup, filtered]);

  const clients = useMemo<ClientSummary[]>(() => buildClientSummaries(filtered, clientDirection), [filtered, clientDirection]);

  const metrics = useMemo(() => {
    const active = filtered.filter((item) => !isFinished(item)).length;
    const high = filtered.filter((item) => priorityNumber(item.prioridade) <= PRIORITY_LIMIT && !isFinished(item)).length;
    const completed = filtered.filter((item) => normalize(item.status) === "finalizado").length;
    const todayKey = localCalendarKey();
    const today = filtered.filter((item) => dateSortValue(item.prazoCriacao) === todayKey);
    const readyToday = today.filter((item) => normalize(item.status) === READY_STATUS).length;
    const completedToday = today.filter((item) => normalize(item.status) === "finalizado").length;
    return { total: filtered.length, active, high, completed, clients: clients.length, today: today.length, readyToday, completedToday };
  }, [filtered, clients]);

  const clientPageCount = Math.max(1, Math.ceil(clients.length / clientPageSize));
  const currentClientPage = Math.min(clientPage, clientPageCount);
  const clientPageStart = clients.length ? (currentClientPage - 1) * clientPageSize + 1 : 0;
  const clientPageEnd = Math.min(currentClientPage * clientPageSize, clients.length);
  const pagedClients = useMemo(() => clients.slice(clientPageStart ? clientPageStart - 1 : 0, clientPageEnd), [clients, clientPageStart, clientPageEnd]);

  const statusStats = useMemo<CountChartData>(() => {
    const map = new Map<string, number>();
    for (const item of statusContext) map.set(item.status || "Sem status", (map.get(item.status || "Sem status") || 0) + 1);
    if (status && !map.has(status)) map.set(status, 0);
    const values = [...map].sort((a, b) => statusDirection === "asc" ? a[1] - b[1] : b[1] - a[1]);
    return buildCountChartData(values);
  }, [statusContext, status, statusDirection]);

  const deadlineStats = useMemo<CountChartData>(() => {
    const map = new Map<string, number>();
    for (const item of deadlineContext) {
      const key = dateSortValue(item.prazoCriacao);
      map.set(key || "Sem prazo", (map.get(key || "Sem prazo") || 0) + 1);
    }
    const selectedKey = chartDeadline === "Sem prazo" ? "Sem prazo" : dateSortValue(chartDeadline);
    if (selectedKey && !map.has(selectedKey)) map.set(selectedKey, 0);
    const values = [...map].sort((a, b) => {
      if (a[0] === "Sem prazo") return 1;
      if (b[0] === "Sem prazo") return -1;
      const comparison = a[0].localeCompare(b[0]);
      return deadlineDirection === "asc" ? comparison : -comparison;
    });
    return buildCountChartData(values.map(([name, count]) => [name === "Sem prazo" ? name : displayDateValue(name), count] as const));
  }, [deadlineContext, chartDeadline, deadlineDirection]);

  const clientStats = useMemo<CountChartData>(() => {
    const contextClients = buildClientSummaries(clientContext, clientDirection);
    const values: Array<readonly [string, number]> = contextClients.map((client) => [client.name, client.items.length] as const);
    if (clientFilter && !values.some(([name]) => name === clientFilter)) values.push([clientFilter, 0]);
    values.sort((a, b) => clientDirection === "asc" ? a[1] - b[1] || a[0].localeCompare(b[0], "pt-BR") : b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"));
    return buildCountChartData(values);
  }, [clientContext, clientFilter, clientDirection]);

  const peopleStats = useMemo<CountChartData>(() => {
    const map = new Map<string, number>();
    for (const item of peopleContext) {
      const people = item.responsaveis.filter(isReadablePerson);
      for (const name of people.length ? people : ["Sem responsável"]) map.set(name, (map.get(name) || 0) + 1);
    }
    if (person && !map.has(person)) map.set(person, 0);
    const values = [...map].sort((a, b) => peopleDirection === "asc" ? a[1] - b[1] || a[0].localeCompare(b[0], "pt-BR") : b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"));
    return buildCountChartData(values);
  }, [peopleContext, person, peopleDirection]);

  function updateDimensionFilter(dimension: ChartDimension, value: string) {
    const nextFilters = { ...activeFilters };
    if (dimension === "deadline") nextFilters.exactDeadline = value;
    if (dimension === "client") nextFilters.client = value;
    if (dimension === "status") nextFilters.status = value;
    if (dimension === "person") nextFilters.person = value;
    const resultCount = (filterDemandas(items, nextFilters) as Demanda[]).length;

    if (dimension === "deadline") setChartDeadline(value);
    if (dimension === "client") setClientFilter(value);
    if (dimension === "status") setStatus(value);
    if (dimension === "person") setPerson(value);
    if (dimension === "deadline" || dimension === "status") setActiveKpi(null);
    setChartPopup((current) => current?.dimension === dimension && current.value !== value ? null : current);
    setClientPage(1);
    setFilterAnnouncement(value
      ? `Filtro aplicado: ${CHART_DIMENSION_LABELS[dimension]}, ${value}. ${resultCount.toLocaleString("pt-BR")} ${resultCount === 1 ? "demanda encontrada" : "demandas encontradas"}.`
      : `Filtro de ${CHART_DIMENSION_LABELS[dimension]} removido. ${resultCount.toLocaleString("pt-BR")} ${resultCount === 1 ? "demanda encontrada" : "demandas encontradas"}.`);
  }

  function toggleDimensionFilter(dimension: ChartDimension, value: string) {
    const current = dimension === "deadline" ? chartDeadline
      : dimension === "client" ? clientFilter
      : dimension === "status" ? status
      : person;
    if (current === value) {
      updateDimensionFilter(dimension, "");
      setChartPopup(null);
      return;
    }
    updateDimensionFilter(dimension, value);
    setChartPopup({ dimension, value });
  }

  function openTodayKpi(kind: TodayKpi) {
    const labels: Record<TodayKpi, string> = {
      today: "Tarefas hoje",
      ready: "Pronto para produzir hoje",
      completed: "Finalizado hoje",
    };
    const requiredStatus = kind === "ready"
      ? options.statuses.find((value) => normalize(value) === READY_STATUS) || "Pronto para produzir"
      : kind === "completed"
        ? options.statuses.find((value) => normalize(value) === "finalizado") || "Finalizado"
        : status;
    const nextFilters = {
      ...activeFilters,
      deadline: "today",
      exactDeadline: "",
      status: requiredStatus,
    };
    const resultCount = (filterDemandas(items, nextFilters) as Demanda[]).length;

    setDeadline("today");
    setChartDeadline("");
    if (kind !== "today") setStatus(requiredStatus);
    setActiveKpi(kind);
    setChartPopup({ dimension: "indicator", value: labels[kind] });
    setClientPage(1);
    setFilterAnnouncement(`${labels[kind]}. ${resultCount.toLocaleString("pt-BR")} ${resultCount === 1 ? "demanda encontrada" : "demandas encontradas"}.`);
  }

  function updateCalendarDeadline(value: string) {
    const exactDeadline = value ? displayDateValue(value) : "";
    const nextDeadline = value ? "custom" : "past30";
    const nextFilters = { ...activeFilters, deadline: nextDeadline, exactDeadline };
    const resultCount = (filterDemandas(items, nextFilters) as Demanda[]).length;

    setDeadline(nextDeadline);
    setChartDeadline(exactDeadline);
    setActiveKpi(null);
    setChartPopup(null);
    setClientPage(1);
    setFilterAnnouncement(value
      ? `Data selecionada: ${exactDeadline}. ${resultCount.toLocaleString("pt-BR")} ${resultCount === 1 ? "demanda encontrada" : "demandas encontradas"}.`
      : "Data removida. Período restaurado para os últimos 30 dias.");
  }

  function openCalendarPicker() {
    const input = calendarInputRef.current;
    if (!input) return;
    input.focus();
    try {
      if (typeof input.showPicker === "function") input.showPicker();
    } catch {
      // O foco mantém o campo utilizável quando o navegador controla o seletor nativo.
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setData(null);
    setSessionState("guest");
  }

  function resetFilters() {
    setQuery(""); setPerson(""); setStatus(""); setPriority(""); setFormat(""); setDeadline("past30"); setClientFilter(""); setChartDeadline("");
    setChartPopup(null);
    setActiveKpi(null);
    setClientPage(1);
    setFilterAnnouncement("Filtros removidos. Período restaurado para os últimos 30 dias.");
  }

  if (sessionState === "checking") return <LoadingScreen/>;
  if (sessionState === "guest") return <Login onSuccess={() => { setSessionState("authenticated"); void loadData(); }}/>;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot">B</span>
          <div><strong>Blank School</strong></div>
        </div>
        <div className="topbar-actions">
          <label className="global-search"><Icon name="search" size={17}/><span className="sr-only">Buscar</span><input value={query} onChange={(event) => { setQuery(event.target.value); setClientPage(1); }} placeholder="Buscar demanda ou cliente"/><kbd>⌘ K</kbd></label>
          <button className="icon-button" onClick={logout} title="Sair" aria-label="Sair"><Icon name="logout"/></button>
        </div>
      </header>

      <div className="wrap" id="inicio">
        {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={loadData}>Tentar novamente</button></div>}

        <section className="hero">
          <div>
            <p className="eyebrow">RELATÓRIO INTERNO · {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "short", year: "numeric" }).toUpperCase()}</p>
            <h1>Operação time criação</h1>
          </div>
          <div className="hero-side">
            <span className="sync"><i className={loading ? "pulse" : ""}/><div><strong>{relativeSync(data?.meta.syncedAt || null)}</strong><small>{data?.meta.total || 0} registros · base Notion</small></div></span>
          </div>
        </section>

        <section className="filters" aria-label="Filtros do relatório">
          <label><span>Responsável</span><select value={person} onChange={(event) => updateDimensionFilter("person", event.target.value)}><option value="">Todas as pessoas</option>{options.people.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><span>Status</span><select value={status} onChange={(event) => updateDimensionFilter("status", event.target.value)}><option value="">Todos os status</option>{options.statuses.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><span>Prioridade</span><select value={priority} onChange={(event) => { setPriority(event.target.value); setClientPage(1); }}><option value="">Todas</option>{options.priorities.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><span>Formato</span><select value={format} onChange={(event) => { setFormat(event.target.value); setClientPage(1); }}><option value="">Todos</option>{options.formats.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><span>Prazo</span><select value={deadline} onChange={(event) => { setDeadline(event.target.value); setChartDeadline(""); setActiveKpi(null); setChartPopup(null); setClientPage(1); }}><option value="past30">Últimos 30 dias</option><option value="past7">Últimos 7 dias</option><option value="today">Hoje</option>{deadline === "custom" && <option value="custom">Data selecionada</option>}<option value="all">Qualquer data</option><option value="overdue">Atrasadas</option></select></label>
          <div className="calendar-filter">
            <button type="button" className="calendar-trigger" onClick={openCalendarPicker} aria-label="Abrir calendário para escolher uma data">Data</button>
            <input ref={calendarInputRef} type="date" value={chartDeadline === "Sem prazo" ? "" : dateSortValue(chartDeadline)} max={localCalendarKey()} onClick={openCalendarPicker} onChange={(event) => updateCalendarDeadline(event.target.value)} aria-label="Escolher data exata do prazo"/>
          </div>
          {person && <button className="chart-filter-chip" type="button" onClick={() => updateDimensionFilter("person", "")} aria-label={`Remover filtro de responsável ${person}`}><span>Responsável</span><strong>{person}</strong><b>×</b></button>}
          {status && <button className="chart-filter-chip" type="button" onClick={() => updateDimensionFilter("status", "")} aria-label={`Remover filtro de status ${status}`}><span>Status</span><strong>{status}</strong><b>×</b></button>}
          {clientFilter && <button className="chart-filter-chip" type="button" onClick={() => updateDimensionFilter("client", "")} aria-label={`Remover filtro de cliente ${clientFilter}`}><span>Cliente</span><strong>{clientFilter}</strong><b>×</b></button>}
          {chartDeadline && <button className="chart-filter-chip" type="button" onClick={() => updateDimensionFilter("deadline", "")} aria-label={`Remover filtro de prazo ${chartDeadline}`}><span>Prazo exato</span><strong>{chartDeadline}</strong><b>×</b></button>}
          <button className="clear-button" onClick={resetFilters} disabled={!query && !person && !status && !priority && !format && deadline === "past30" && !clientFilter && !chartDeadline}>Limpar</button>
          <p className="sr-only" role="status" aria-live="polite">{filterAnnouncement}</p>
        </section>

        <section className="kpis" aria-label="Indicadores principais">
          <article className="kpi"><header>Tarefas gerais <span className="chip">{metrics.clients} clientes</span></header><strong>{metrics.total.toLocaleString("pt-BR")}</strong><p>Recorte atual completo da base</p><div className="bar"><i style={{ width: "100%" }}/></div></article>
          <button type="button" className={`kpi kpi-action${activeKpi === "today" ? " is-active" : ""}`} onClick={() => openTodayKpi("today")} aria-pressed={activeKpi === "today"} aria-label={`Ver ${metrics.today.toLocaleString("pt-BR")} tarefas com prazo hoje`}><span className="kpi-header">Tarefas hoje <span className="chip">prazo</span></span><strong>{metrics.today.toLocaleString("pt-BR")}</strong><span className="kpi-description">Prazo de criação para hoje</span><span className="bar"><i style={{ width: `${Math.min(100, metrics.total ? Math.round((metrics.today / metrics.total) * 100) : 0)}%` }}/></span></button>
          <button type="button" className={`kpi kpi-action${activeKpi === "ready" ? " is-active" : ""}`} onClick={() => openTodayKpi("ready")} aria-pressed={activeKpi === "ready"} aria-label={`Ver ${metrics.readyToday.toLocaleString("pt-BR")} tarefas prontas para produzir hoje`}><span className="kpi-header">Pronto para produzir hoje <span className="chip">status</span></span><strong>{metrics.readyToday.toLocaleString("pt-BR")}</strong><span className="kpi-description">Com prazo de criação para hoje</span><span className="bar"><i style={{ width: `${Math.min(100, metrics.today ? Math.round((metrics.readyToday / metrics.today) * 100) : 0)}%` }}/></span></button>
          <button type="button" className={`kpi kpi-action${activeKpi === "completed" ? " is-active" : ""}`} onClick={() => openTodayKpi("completed")} aria-pressed={activeKpi === "completed"} aria-label={`Ver ${metrics.completedToday.toLocaleString("pt-BR")} tarefas finalizadas hoje`}><span className="kpi-header">Finalizado hoje <span className="chip">status</span></span><strong>{metrics.completedToday.toLocaleString("pt-BR")}</strong><span className="kpi-description">Finalizadas com prazo de criação hoje</span><span className="bar"><i style={{ width: `${Math.min(100, metrics.today ? Math.round((metrics.completedToday / metrics.today) * 100) : 0)}%` }}/></span></button>
        </section>

        <section className="chart-grid" aria-label="Gráficos do relatório">
          <article className={`card${chartDeadline ? " is-filtered" : ""}`}>
            <div className="card-head"><div><h2>Prazo de Criação</h2></div><div className="section-actions"><SortControl direction={deadlineDirection} onChange={setDeadlineDirection} label="prazo de criação"/></div></div>
            <CountBarChart {...deadlineStats} dateAxis selectedLabel="Prazo" selectedName={chartDeadline} onSelect={(name) => toggleDimensionFilter("deadline", name)} emptyText="Não há prazos no recorte atual."/>
          </article>
          <article className={`card${clientFilter ? " is-filtered" : ""}`}>
            <div className="card-head"><div><h2>Cliente</h2></div><div className="section-actions"><SortControl direction={clientDirection} onChange={(direction) => { setClientDirection(direction); setClientPage(1); }} label="clientes"/></div></div>
            <CountBarChart {...clientStats} selectedLabel="Cliente" selectedName={clientFilter} onSelect={(name) => toggleDimensionFilter("client", name)} emptyText="Nenhum cliente encontrado neste recorte."/>
          </article>
          <article className={`card${status ? " is-filtered" : ""}`}>
            <div className="card-head"><div><h2>Status</h2></div><div className="section-actions"><SortControl direction={statusDirection} onChange={setStatusDirection} label="status"/></div></div>
            <CountBarChart {...statusStats} selectedLabel="Status" selectedName={status} onSelect={(name) => toggleDimensionFilter("status", name)} emptyText="Nenhum status encontrado neste recorte."/>
          </article>
          <article className={`card${person ? " is-filtered" : ""}`}>
            <div className="card-head"><div><h2>Responsável</h2></div><div className="section-actions"><SortControl direction={peopleDirection} onChange={setPeopleDirection} label="responsáveis"/></div></div>
            <CountBarChart {...peopleStats} selectedLabel="Responsável" selectedName={person} onSelect={(name) => toggleDimensionFilter("person", name)} emptyText="Nenhum responsável encontrado neste recorte."/>
          </article>
        </section>

        <section className="clients" id="clientes">
          <div className="clients-toolbar"><div><h2>Clientes</h2><span className="sub">{clients.length} clientes · {filtered.length} demandas · {options.people.length} pessoas na operação</span></div><div className="tools"><SortControl direction={clientDirection} onChange={(direction) => { setClientDirection(direction); setClientPage(1); }} label="clientes por volume"/><label className="page-size"><span className="sr-only">Clientes por página</span><select value={clientPageSize} onChange={(event) => { setClientPageSize(Number(event.target.value)); setClientPage(1); }}><option value={10}>10 por página</option><option value={20}>20 por página</option></select></label></div></div>
          {clients.length ? <div role="table" aria-label="Resumo por cliente">
            <div className="trow thead" role="row"><span>Cliente</span><span>Demandas</span><span>Progresso</span><span>Responsáveis</span><span>Próximo prazo</span><span aria-hidden="true"/></div>
            {pagedClients.map((client, index) => <button className="trow" role="row" key={client.name} onClick={() => setSelectedClient(client)}>
                <span className="c-id"><i>{String(clientPageStart + index).padStart(2, "0")}</i><div><strong>{client.name}</strong><small title="Demandas ainda não finalizadas nem canceladas">{client.active} em aberto{client.overdue ? ` · ${client.overdue} atrasadas` : ""}</small></div></span>
                <span className="c-vol"><strong>{client.items.length}</strong><small>total</small></span>
                <span className="c-prog"><span><i style={{ width: `${client.progress}%` }}/></span><strong>{client.progress}%</strong></span>
                <span className="stack">{client.people.slice(0, 3).map((value) => <i key={value} title={value}>{initials(value)}</i>)}{client.people.length > 3 && <i className="more">+{client.people.length - 3}</i>}{!client.people.length && <small>Não definido</small>}</span>
                <span className="c-date"><Icon name="clock" size={15}/>{client.nextDeadline ? displayDateValue(client.nextDeadline) : "Sem prazo"}</span>
                <span className="go"><Icon name="arrow"/></span>
              </button>)}
          </div> : <EmptyState title="Nenhum cliente encontrado" text="Tente remover um ou mais filtros do relatório."/>}
          {clients.length > 0 && <div className="tfoot"><span>Exibindo {clientPageStart}–{clientPageEnd} de {clients.length}</span><div className="pages"><button type="button" onClick={() => setClientPage(Math.max(1, currentClientPage - 1))} disabled={currentClientPage === 1} aria-label="Página anterior">←</button>{Array.from({ length: clientPageCount }, (_, index) => index + 1).slice(0, 7).map((page) => <button type="button" key={page} className={page === currentClientPage ? "on" : ""} onClick={() => setClientPage(page)} aria-label={`Página ${page}`} aria-current={page === currentClientPage ? "page" : undefined}>{page}</button>)}<button type="button" onClick={() => setClientPage(Math.min(clientPageCount, currentClientPage + 1))} disabled={currentClientPage === clientPageCount} aria-label="Próxima página">→</button></div></div>}
        </section>

        <footer className="note">Relatório interno · dados sincronizados do <b>Notion</b> · Blank School</footer>
      </div>

      {selectedClient && <div className="overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSelectedClient(null)}><aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="client-title"><div className="drawer-head"><div><p className="eyebrow">VISÃO DO CLIENTE</p><h2 id="client-title">{selectedClient.name}</h2></div><button className="icon-button" onClick={() => setSelectedClient(null)} aria-label="Fechar"><Icon name="close"/></button></div><div className="drawer-metrics"><div><strong>{selectedClient.items.length}</strong><span>Demandas</span></div><div><strong>{selectedClient.active}</strong><span>Em aberto</span></div><div><strong>{selectedClient.progress}%</strong><span>Concluído</span></div></div><div className="drawer-team"><span>Equipe envolvida</span><div>{selectedClient.people.map((value) => <button key={value} onClick={() => { updateDimensionFilter("person", value); setSelectedClient(null); }}><i>{initials(value)}</i>{value}</button>)}</div></div><div className="drawer-list"><div className="drawer-list-title"><span>Demandas do cliente</span><small>{selectedClient.items.length} itens</small></div>{selectedClient.items.slice().sort((a,b) => dateSortValue(a.prazoCriacao).localeCompare(dateSortValue(b.prazoCriacao))).map((item) => <button key={item.id} onClick={() => { setSelectedClient(null); setSelectedDemand(item); }}><div><strong>{item.nome || "Sem nome"}</strong><span>{item.status || "Sem status"} · {item.formato || "Sem formato"}</span></div><time>{displayDateValue(item.prazoCriacao)}</time><Icon name="chevron" size={15}/></button>)}</div></aside></div>}

      {selectedDemand && <div className="overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSelectedDemand(null)}><aside className="drawer demand-drawer" role="dialog" aria-modal="true" aria-labelledby="demand-title"><div className="drawer-head"><div><p className="eyebrow">DETALHE DA DEMANDA</p><h2 id="demand-title">{selectedDemand.nome || "Sem nome"}</h2></div><button className="icon-button" onClick={() => setSelectedDemand(null)} aria-label="Fechar"><Icon name="close"/></button></div><div className="demand-status"><span>{selectedDemand.status || "Sem status"}</span><span>{selectedDemand.prioridade || "Sem prioridade"}</span></div><dl className="demand-fields"><div><dt>Cliente</dt><dd>{selectedDemand.clientes.join(", ") || "—"}</dd></div><div><dt>Responsável</dt><dd>{selectedDemand.responsaveis.join(", ") || "—"}</dd></div><div><dt>Cargo</dt><dd>{selectedDemand.cargo || "—"}</dd></div><div><dt>Formato</dt><dd>{selectedDemand.formato || "—"}</dd></div><div><dt>Prazo de criação</dt><dd>{displayDateValue(selectedDemand.prazoCriacao)}</dd></div><div><dt>Data de postagem</dt><dd>{displayDateValue(selectedDemand.dataPostagem)}</dd></div><div><dt>Iniciado em</dt><dd>{displayDateValue(selectedDemand.iniciadoEm)}</dd></div><div><dt>Concluído em</dt><dd>{displayDateValue(selectedDemand.concluidoEm)}</dd></div><div><dt>Tempo gasto</dt><dd>{selectedDemand.tempoGasto || "—"}</dd></div></dl>{selectedDemand.obs && <div className="demand-notes"><span>Observações</span><p>{selectedDemand.obs}</p></div>}<a className="primary-button" href={selectedDemand.linkNotion || selectedDemand.notionUrl} target="_blank" rel="noreferrer">Abrir no Notion<Icon name="external"/></a></aside></div>}

      {chartPopup && <div className="overlay chart-content-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setChartPopup(null)}>
        <section className="chart-content-popup" role="dialog" aria-modal="true" aria-labelledby="chart-content-title">
          <header className="chart-content-head">
            <div>
              <p className="eyebrow">CONTEÚDOS · {chartPopup.dimension === "indicator" ? "INDICADOR" : CHART_DIMENSION_LABELS[chartPopup.dimension].toUpperCase()}</p>
              <h2 id="chart-content-title">{chartPopup.value}</h2>
              <span>{chartPopupItems.length.toLocaleString("pt-BR")} {chartPopupItems.length === 1 ? "demanda encontrada" : "demandas encontradas"}</span>
            </div>
            <button className="icon-button" type="button" onClick={() => setChartPopup(null)} aria-label="Fechar conteúdos"><Icon name="close"/></button>
          </header>
          {chartPopupItems.length ? <div className="chart-content-list">
            {chartPopupItems.map((item) => <button className="chart-content-item" type="button" key={item.id} onClick={() => { setChartPopup(null); setSelectedDemand(item); }}>
              <div className="chart-content-primary">
                <strong>{item.nome || "Sem nome"}</strong>
                <span>{item.clientes.join(", ") || "Sem cliente"}</span>
              </div>
              <div className="chart-content-tags">
                <span>{item.status || "Sem status"}</span>
                <span>{item.prioridade || "Sem prioridade"}</span>
                <span>{item.formato || "Sem formato"}</span>
              </div>
              <div className="chart-content-meta">
                <span>{item.responsaveis.filter(isReadablePerson).join(", ") || "Sem responsável"}</span>
                <time>{displayDateValue(item.prazoCriacao)}</time>
              </div>
              <span className="go"><Icon name="arrow"/></span>
            </button>)}
          </div> : <EmptyState title="Nenhum conteúdo encontrado" text="Os demais filtros não retornaram demandas para este grupo."/>}
        </section>
      </div>}
    </main>
  );
}
