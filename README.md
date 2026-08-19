# Relatório de Demandas Blank

Relatório local somente leitura da operação criativa da Blank School, organizado por cliente e filtrável por pessoa, status, prioridade, formato e prazo. O fluxo é unidirecional: Notion → Google Sheets → webhook protegido do n8n → aplicação local.

## Executar

```bash
npm install
npm run dev
```

Acesse a URL exibida pelo terminal (normalmente `http://localhost:3000`). As credenciais ficam em `.env.local`, que não é versionado. Para gerar uma nova senha compartilhada:

```bash
npm run reset-password
```

Reinicie o servidor depois de trocar a senha.

## Operação

- `npm run provision`: reconcilia a planilha, credenciais e workflows usando o `.env` da pasta pai.
- `npm run fix-dates`: inspeciona as quatro colunas de data; use `npm run fix-dates -- --apply` para aplicar a correção pela API.
- `npm test`: testa normalização, proteção da API e renderização.
- `npm run lint`: executa as verificações estáticas.

O workflow de sincronização preserva o snapshot anterior quando o Notion muda de esquema ou uma chamada falha. O workflow de leitura exige `X-Demandas-Key`; esse segredo só existe no servidor local e no n8n.

Uma reconciliação completa roda a cada cinco minutos como rede de segurança. A execução manual permanece disponível para recuperação; quando o webhook oficial do Notion estiver assinado, ele poderá antecipar as atualizações entre duas reconciliações.
