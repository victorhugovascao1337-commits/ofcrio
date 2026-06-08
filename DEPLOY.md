# Deploy no Vercel (um projeto só)

O funil (estático) e o checkout (Node/Express → serverless) sobem no **mesmo
projeto/domínio**. A configuração está em [`vercel.json`](vercel.json).

## Estrutura de URLs em produção

| URL                         | Serve                                            |
| --------------------------- | ------------------------------------------------ |
| `/` → `/1/index.html`       | Início do funil (redirect 308)                   |
| `/1/`, `/2/`, `/3/`         | Páginas do funil (estático)                      |
| `/funnel-tracking.js`       | Tracking compartilhado do funil (UTMs + pixels)  |
| `/checkout/`                | Frontend do checkout (`checkout/public`)         |
| `/api/*`                    | Backend do checkout (`checkout/server.js`)       |

O redirect do funil para o checkout é automático: em produção vai para
`/checkout/` (mesmo domínio); em local continua indo para `http://localhost:3002/`.

## 1) Variáveis de ambiente (OBRIGATÓRIO)

O `.env` **não** sobe (está no `.gitignore` e no `.vercelignore`). Configure no
painel do Vercel em **Settings → Environment Variables** (marque Production e
Preview):

| Variável                      | Valor                                                |
| ----------------------------- | ---------------------------------------------------- |
| `DUTTYFY_URL`                 | a URL encriptada do Duttyfy                          |
| `UTMIFY_API_TOKEN`            | o token da API da Utmify                             |
| `FB_PIXEL_ID`                 | `1168881985393738`                                  |
| `FB_CAPI_TOKEN`               | o token da Conversions API do Facebook (secreto)    |
| `SUPABASE_URL`                | `https://lkagzshiwxjisuljpnhy.supabase.co`          |
| `SUPABASE_SERVICE_ROLE_KEY`   | a *service role key* do Supabase (secreta)          |

**Não** defina `PORT` (o Vercel ignora). Os valores estão no seu `checkout/.env`
local — copie de lá.

### Tabela do Supabase (rode 1x)

No painel do Supabase do projeto → **SQL Editor** → cole e rode:

```sql
create table if not exists public.pedidos (
  txid              text primary key,
  order_json        jsonb,
  fb_json           jsonb,
  paid              boolean     not null default false,
  paid_at           timestamptz,
  utmify_paid_sent  boolean     not null default false,
  fb_purchase_sent  boolean     not null default false,
  created_at        timestamptz not null default now()
);

-- Bloqueia acesso público: só a service role (backend) lê/escreve.
alter table public.pedidos enable row level security;
```

A `service role key` fica em **Settings → API → service_role**. Cole ela no
`checkout/.env` (local) e nas Environment Variables do Vercel.

## 2) Subir

**Opção A — Vercel CLI** (a pasta não é um repositório git):
```bash
npm i -g vercel
cd ofcrio
vercel            # primeira vez: cria o projeto e pergunta as configs
vercel --prod     # publica em produção
```
Quando perguntar o Framework Preset, escolha **Other**.

**Opção B — GitHub:** suba a pasta `ofcrio` para um repositório e importe no
Vercel. O `.gitignore` já protege `node_modules` e os `.env`.

## 3) Pós-deploy — apontar o webhook do Duttyfy

No painel do Duttyfy (Integrações → Webhooks), aponte para:
```
https://SEU-DOMINIO.vercel.app/api/webhook
```

## Tracking da venda (importante)

Os eventos disparam assim:

- **PageView** — todas as páginas (funil e checkout), client-side.
- **InitiateCheckout** — ao gerar o Pix, client-side.
- **Purchase** — quando o pagamento confirma:
  - **Client-side (confiável em serverless):** o navegador dispara o `Purchase`
    quando o status vira `COMPLETED`, com `eventID = txid`.
  - **Server-side (Conversions API):** o servidor também tenta enviar o
    `Purchase` com o **mesmo** `event_id`, então o Facebook **deduplica** (não
    conta a venda duas vezes).

### Persistência (Supabase)

O contexto do pedido (`txid → cliente, valor, UTMs, fbp/fbc...`) é guardado no
**Supabase** (tabela `pedidos`). Isso resolve o problema do serverless: o
contexto sobrevive entre a criação do Pix e a confirmação, então **todos** os
eventos de venda disparam de forma confiável:

- ✅ **Purchase do Facebook** — client-side **e** Conversions API (com dedup por `event_id`).
- ✅ **`paid` da Utmify** — server-side, com idempotência atômica no banco.

Se `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` não estiverem definidas, o servidor
cai automaticamente para um **store em memória** (ok para rodar local; não use
assim em produção serverless).
