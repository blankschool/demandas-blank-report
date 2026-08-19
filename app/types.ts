export type Demanda = {
  id: string;
  notionUrl: string;
  nome: string;
  clientes: string[];
  responsaveis: string[];
  cargo: string;
  formato: string;
  prioridade: string;
  status: string;
  prazoCriacao: string;
  dataPostagem: string;
  iniciadoEm: string;
  concluidoEm: string;
  tempoGasto: string;
  total: number | null;
  linkNotion: string;
  obs: string;
};

export type DemandasResponse = {
  items: Demanda[];
  meta: {
    total: number;
    source: string;
    schemaVersion: number;
    syncedAt: string | null;
  };
};
