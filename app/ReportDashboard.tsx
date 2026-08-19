"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { Demanda, DemandasResponse } from "./types";
import { dateSortValue, displayDateValue, localCalendarKey } from "./lib/dates.mjs";

const FINAL_STATUSES = new Set(["finalizado", "cancelado"]);
const PRIORITY_LIMIT = 4;
const DEADLINES_PER_PAGE = 4;

type IconName =
  | "arrow"
  | "calendar"
  | "check"
  | "chevron"
  | "clock"
  | "close"
  | "external"
  | "filter"
  | "logout"
  | "people"
  | "refresh"
  | "search"
  | "spark"
  | "stack";

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    arrow: <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    close: <path d="M6 6l12 12M18 6 6 18"/>,
    external: <><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/></>,
    filter: <path d="M4 6h16M7 12h10M10 18h4"/>,
    logout: <><path d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10"/></>,
    people: <><path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 20v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></>,
    refresh: <><path d="M20 7v5h-5"/><path d="M19 12a7 7 0 1 0-2 5"/></>,
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

export default function ReportDashboard() {
  const [sessionState, setSessionState] = useState<"checking" | "guest" | "authenticated">("checking");
  const [username, setUsername] = useState("blank");
  const [data, setData] = useState<DemandasResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [person, setPerson] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [format, setFormat] = useState("");
  const [deadline, setDeadline] = useState("all");
  const [statusDirection, setStatusDirection] = useState<SortDirection>("desc");
  const [deadlineDirection, setDeadlineDirection] = useState<SortDirection>("asc");
  const [clientDirection, setClientDirection] = useState<SortDirection>("desc");
  const [deadlinePage, setDeadlinePage] = useState(1);
  const [clientPage, setClientPage] = useState(1);
  const [clientPageSize, setClientPageSize] = useState(10);
  const [selectedClient, setSelectedClient] = useState<ClientSummary | null>(null);
  const [selectedDemand, setSelectedDemand] = useState<Demanda | null>(null);

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
          setUsername(body.username || "blank");
          setSessionState("authenticated");
          void loadData();
        } else setSessionState("guest");
      })
      .catch(() => active && setSessionState("guest"));
    return () => { active = false; };
  }, [loadData]);

  const items = useMemo(() => data?.items || [], [data]);
  const options = useMemo(() => ({
    people: [...new Set(items.flatMap((item) => item.responsaveis).filter(isReadablePerson))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    statuses: [...new Set(items.map((item) => item.status).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    priorities: [...new Set(items.map((item) => item.prioridade).filter(Boolean))].sort((a, b) => priorityNumber(a) - priorityNumber(b)),
    formats: [...new Set(items.map((item) => item.formato).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")),
  }), [items]);

  const filtered = useMemo(() => {
    const needle = normalize(query);
    const today = new Date();
    const todayKey = localCalendarKey(today);
    const limit = new Date(today);
    const deadlineDays = Number.parseInt(deadline, 10);
    if (Number.isFinite(deadlineDays)) limit.setDate(limit.getDate() + deadlineDays);
    const limitKey = Number.isFinite(deadlineDays) ? limit.toISOString().slice(0, 10) : "";
    return items.filter((item) => {
      const searchable = normalize([item.nome, ...item.clientes, ...item.responsaveis, item.status, item.formato, item.cargo, item.obs].join(" "));
      const dateKey = dateSortValue(item.prazoCriacao);
      const deadlineMatch = deadline === "all"
        || (deadline === "overdue" ? Boolean(dateKey && dateKey < todayKey && !isFinished(item)) : Boolean(dateKey && dateKey >= todayKey && dateKey <= limitKey));
      return (!needle || searchable.includes(needle))
        && (!person || item.responsaveis.includes(person))
        && (!status || item.status === status)
        && (!priority || item.prioridade === priority)
        && (!format || item.formato === format)
        && deadlineMatch;
    });
  }, [items, query, person, status, priority, format, deadline]);

  const clients = useMemo<ClientSummary[]>(() => {
    const groups = new Map<string, Demanda[]>();
    for (const item of filtered) {
      const names = item.clientes.length ? item.clientes : ["Sem cliente"];
      for (const name of names) groups.set(name, [...(groups.get(name) || []), item]);
    }
    const summaries = [...groups].map(([name, clientItems]) => {
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
    });
    return summaries.sort((a, b) => {
      const volumeComparison = a.items.length - b.items.length || a.active - b.active;
      if (volumeComparison !== 0) return clientDirection === "asc" ? volumeComparison : -volumeComparison;
      return a.name.localeCompare(b.name, "pt-BR");
    });
  }, [filtered, clientDirection]);

  const metrics = useMemo(() => {
    const active = filtered.filter((item) => !isFinished(item)).length;
    const high = filtered.filter((item) => priorityNumber(item.prioridade) <= PRIORITY_LIMIT && !isFinished(item)).length;
    const completed = filtered.filter((item) => normalize(item.status) === "finalizado").length;
    return { total: filtered.length, active, high, completed, clients: clients.length };
  }, [filtered, clients]);

  const clientPageCount = Math.max(1, Math.ceil(clients.length / clientPageSize));
  const currentClientPage = Math.min(clientPage, clientPageCount);
  const clientPageStart = clients.length ? (currentClientPage - 1) * clientPageSize + 1 : 0;
  const clientPageEnd = Math.min(currentClientPage * clientPageSize, clients.length);
  const pagedClients = useMemo(() => clients.slice(clientPageStart ? clientPageStart - 1 : 0, clientPageEnd), [clients, clientPageStart, clientPageEnd]);

  const statusStats = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of filtered) map.set(item.status || "Sem status", (map.get(item.status || "Sem status") || 0) + 1);
    const values = [...map].sort((a, b) => statusDirection === "asc" ? a[1] - b[1] : b[1] - a[1]);
    const max = Math.max(1, ...values.map((entry) => entry[1]));
    return values.slice(0, 7).map(([name, count]) => ({ name, count, width: Math.max(5, Math.round((count / max) * 100)) }));
  }, [filtered, statusDirection]);

  const spectrumColors = ["#111111", "#4e4e4e", "#7a7a7a", "#a5a5a2", "#c7c6c2", "#e3e2de", "#edece8"];
  const maxStatusCount = Math.max(1, ...statusStats.map((entry) => entry.count));

  const upcoming = useMemo(() => {
    const todayKey = localCalendarKey();
    return filtered
      .filter((item) => !isFinished(item) && dateSortValue(item.prazoCriacao) >= todayKey)
      .sort((a, b) => {
        const dateComparison = dateSortValue(a.prazoCriacao).localeCompare(dateSortValue(b.prazoCriacao));
        const orderedDate = deadlineDirection === "asc" ? dateComparison : -dateComparison;
        return orderedDate || priorityNumber(a.prioridade) - priorityNumber(b.prioridade);
      });
  }, [filtered, deadlineDirection]);

  const deadlinePageCount = Math.max(1, Math.ceil(upcoming.length / DEADLINES_PER_PAGE));
  const currentDeadlinePage = Math.min(deadlinePage, deadlinePageCount);
  const deadlinePageStart = upcoming.length ? (currentDeadlinePage - 1) * DEADLINES_PER_PAGE + 1 : 0;
  const deadlinePageEnd = Math.min(currentDeadlinePage * DEADLINES_PER_PAGE, upcoming.length);
  const pagedDeadlines = useMemo(
    () => upcoming.slice(deadlinePageStart ? deadlinePageStart - 1 : 0, deadlinePageEnd),
    [upcoming, deadlinePageStart, deadlinePageEnd],
  );

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setData(null);
    setSessionState("guest");
  }

  function resetFilters() {
    setQuery(""); setPerson(""); setStatus(""); setPriority(""); setFormat(""); setDeadline("all");
    setDeadlinePage(1);
    setClientPage(1);
  }

  if (sessionState === "checking") return <LoadingScreen/>;
  if (sessionState === "guest") return <Login onSuccess={(name) => { setUsername(name); setSessionState("authenticated"); void loadData(); }}/>;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot">B</span>
          <div><strong>Blank School</strong></div>
        </div>
        <div className="topbar-actions">
          <label className="global-search"><Icon name="search" size={17}/><span className="sr-only">Buscar</span><input value={query} onChange={(event) => { setQuery(event.target.value); setDeadlinePage(1); setClientPage(1); }} placeholder="Buscar demanda ou cliente"/><kbd>⌘ K</kbd></label>
          <button className="icon-button" onClick={loadData} disabled={loading} title="Atualizar" aria-label="Atualizar dados"><Icon name="refresh"/></button>
          <span className="avatar">{initials(username)}</span>
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
          <label><span>Responsável</span><select value={person} onChange={(event) => { setPerson(event.target.value); setDeadlinePage(1); setClientPage(1); }}><option value="">Todas as pessoas</option>{options.people.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><span>Status</span><select value={status} onChange={(event) => { setStatus(event.target.value); setDeadlinePage(1); setClientPage(1); }}><option value="">Todos os status</option>{options.statuses.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><span>Prioridade</span><select value={priority} onChange={(event) => { setPriority(event.target.value); setDeadlinePage(1); setClientPage(1); }}><option value="">Todas</option>{options.priorities.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><span>Formato</span><select value={format} onChange={(event) => { setFormat(event.target.value); setDeadlinePage(1); setClientPage(1); }}><option value="">Todos</option>{options.formats.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><span>Prazo</span><select value={deadline} onChange={(event) => { setDeadline(event.target.value); setDeadlinePage(1); setClientPage(1); }}><option value="all">Qualquer data</option><option value="7">Próximos 7 dias</option><option value="30">Próximos 30 dias</option><option value="overdue">Atrasadas</option></select></label>
          <button className="clear-button" onClick={resetFilters} disabled={!query && !person && !status && !priority && !format && deadline === "all"}>Limpar</button>
        </section>

        <section className="kpis" aria-label="Indicadores principais">
          <article className="kpi"><header>Demandas visíveis <span className="chip chip--cobalt">{metrics.clients} clientes</span></header><strong>{metrics.total.toLocaleString("pt-BR")}</strong><p>Recorte atual completo da base</p><div className="bar"><i style={{ width: "68%" }}/></div></article>
          <article className="kpi"><header>Em andamento <span className="chip chip--warn">{metrics.total ? Math.round((metrics.active / metrics.total) * 100) : 0}%</span></header><strong>{metrics.active.toLocaleString("pt-BR")}</strong><p>Do volume consultado</p><div className="bar"><i style={{ width: `${metrics.total ? Math.round((metrics.active / metrics.total) * 100) : 0}%` }}/></div></article>
          <article className="kpi kpi--accent"><header>Prioridade P1–P4 <span className="chip chip--warn">atenção</span></header><strong>{metrics.high.toLocaleString("pt-BR")}</strong><p>Demandas em aberto que pedem ação</p><div className="bar"><i style={{ width: `${Math.min(100, metrics.active ? Math.round((metrics.high / metrics.active) * 100) : 0)}%` }}/></div></article>
          <article className="kpi"><header>Concluídas <span className="chip chip--up">{metrics.total ? Math.round((metrics.completed / metrics.total) * 100) : 0}%</span></header><strong>{metrics.completed.toLocaleString("pt-BR")}</strong><p>Do recorte selecionado</p><div className="bar"><i style={{ width: `${metrics.total ? Math.round((metrics.completed / metrics.total) * 100) : 0}%` }}/></div></article>
        </section>

        <section className="grid-2">
          <article className="card">
            <div className="card-head"><div><p className="eyebrow">DISTRIBUIÇÃO</p><h2>Etapas</h2></div><div className="section-actions"><span className="pill">{metrics.total} demandas</span><SortControl direction={statusDirection} onChange={setStatusDirection} label="etapas"/></div></div>
            {statusStats.length ? <><div className="spectrum" aria-hidden="true">{statusStats.map((entry, index) => <i key={entry.name} style={{ flex: entry.count, background: spectrumColors[index] || "#edece8" }} title={`${entry.name} · ${entry.count}`}/>)}</div><div className="spectrum-legend">{statusStats.slice(0, 6).map((entry, index) => <span key={entry.name}><b style={{ background: spectrumColors[index] || "#edece8" }}/>{entry.name}</span>)}</div><div className="flow">{statusStats.map((entry, index) => <div className="flow-row" key={entry.name}><span className="name">{entry.name}</span><span className="track"><i style={{ width: `${Math.max(2, Math.round((entry.count / maxStatusCount) * 100))}%`, background: spectrumColors[index] || "#111111" }}/></span><strong>{entry.count}</strong></div>)}</div></> : <EmptyState title="Nenhum dado neste recorte" text="Ajuste os filtros para ampliar a visualização."/>}
            <div className="card-foot"><span>Volume por etapa do fluxo</span><span>Base atual do Notion</span></div>
          </article>

          <article className="card" id="prazos">
            <div className="card-head"><div><p className="eyebrow">AGENDA</p><h2>Próximos prazos</h2></div><div className="section-actions"><span className="pill">{upcoming.length} no radar</span><SortControl direction={deadlineDirection} onChange={(direction) => { setDeadlineDirection(direction); setDeadlinePage(1); }} label="próximos prazos"/></div></div>
            {upcoming.length ? <><div className="deadlines">{pagedDeadlines.map((item) => {
              const dateKey = dateSortValue(item.prazoCriacao);
              const isToday = dateKey === localCalendarKey();
              return <button className={`deadline ${isToday ? "today" : ""}`} key={item.id} onClick={() => setSelectedDemand(item)}><time><b>{displayDateValue(item.prazoCriacao).slice(0, 2)}</b><span>{new Date(`${dateKey}T12:00:00`).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}</span></time><div><strong>{item.nome || "Sem nome"}</strong><span>{item.clientes.join(", ") || "Sem cliente"}</span></div><span className="ptag">{item.prioridade || "—"}</span></button>;
            })}</div><div className="mini-pg"><span>{deadlinePageStart}–{deadlinePageEnd} de {upcoming.length} prazos</span><div><button type="button" onClick={() => setDeadlinePage(Math.max(1, currentDeadlinePage - 1))} disabled={currentDeadlinePage === 1} aria-label="Página anterior de prazos">←</button><strong>{currentDeadlinePage}/{deadlinePageCount}</strong><button type="button" onClick={() => setDeadlinePage(Math.min(deadlinePageCount, currentDeadlinePage + 1))} disabled={currentDeadlinePage === deadlinePageCount} aria-label="Próxima página de prazos">→</button></div></div></> : <EmptyState title="Sem prazos próximos" text="Nenhuma demanda ativa com data neste recorte."/>}
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

      {selectedClient && <div className="overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSelectedClient(null)}><aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="client-title"><div className="drawer-head"><div><p className="eyebrow">VISÃO DO CLIENTE</p><h2 id="client-title">{selectedClient.name}</h2></div><button className="icon-button" onClick={() => setSelectedClient(null)} aria-label="Fechar"><Icon name="close"/></button></div><div className="drawer-metrics"><div><strong>{selectedClient.items.length}</strong><span>Demandas</span></div><div><strong>{selectedClient.active}</strong><span>Em aberto</span></div><div><strong>{selectedClient.progress}%</strong><span>Concluído</span></div></div><div className="drawer-team"><span>Equipe envolvida</span><div>{selectedClient.people.map((value) => <button key={value} onClick={() => { setPerson(value); setSelectedClient(null); }}><i>{initials(value)}</i>{value}</button>)}</div></div><div className="drawer-list"><div className="drawer-list-title"><span>Demandas do cliente</span><small>{selectedClient.items.length} itens</small></div>{selectedClient.items.slice().sort((a,b) => dateSortValue(a.prazoCriacao).localeCompare(dateSortValue(b.prazoCriacao))).map((item) => <button key={item.id} onClick={() => { setSelectedClient(null); setSelectedDemand(item); }}><div><strong>{item.nome || "Sem nome"}</strong><span>{item.status || "Sem status"} · {item.formato || "Sem formato"}</span></div><time>{displayDateValue(item.prazoCriacao)}</time><Icon name="chevron" size={15}/></button>)}</div></aside></div>}

      {selectedDemand && <div className="overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSelectedDemand(null)}><aside className="drawer demand-drawer" role="dialog" aria-modal="true" aria-labelledby="demand-title"><div className="drawer-head"><div><p className="eyebrow">DETALHE DA DEMANDA</p><h2 id="demand-title">{selectedDemand.nome || "Sem nome"}</h2></div><button className="icon-button" onClick={() => setSelectedDemand(null)} aria-label="Fechar"><Icon name="close"/></button></div><div className="demand-status"><span>{selectedDemand.status || "Sem status"}</span><span>{selectedDemand.prioridade || "Sem prioridade"}</span></div><dl className="demand-fields"><div><dt>Cliente</dt><dd>{selectedDemand.clientes.join(", ") || "—"}</dd></div><div><dt>Responsável</dt><dd>{selectedDemand.responsaveis.join(", ") || "—"}</dd></div><div><dt>Cargo</dt><dd>{selectedDemand.cargo || "—"}</dd></div><div><dt>Formato</dt><dd>{selectedDemand.formato || "—"}</dd></div><div><dt>Prazo de criação</dt><dd>{displayDateValue(selectedDemand.prazoCriacao)}</dd></div><div><dt>Data de postagem</dt><dd>{displayDateValue(selectedDemand.dataPostagem)}</dd></div><div><dt>Iniciado em</dt><dd>{displayDateValue(selectedDemand.iniciadoEm)}</dd></div><div><dt>Concluído em</dt><dd>{displayDateValue(selectedDemand.concluidoEm)}</dd></div><div><dt>Tempo gasto</dt><dd>{selectedDemand.tempoGasto || "—"}</dd></div></dl>{selectedDemand.obs && <div className="demand-notes"><span>Observações</span><p>{selectedDemand.obs}</p></div>}<a className="primary-button" href={selectedDemand.linkNotion || selectedDemand.notionUrl} target="_blank" rel="noreferrer">Abrir no Notion<Icon name="external"/></a></aside></div>}
    </main>
  );
}
