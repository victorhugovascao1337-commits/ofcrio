require("dotenv").config();
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const QRCode = require("qrcode");

const app = express();
const PORT = process.env.PORT || 3000;

// ---- Facebook Conversions API (server-side) ----
// O PIXEL ID é público; o TOKEN é secreto e fica SÓ aqui (.env), nunca no front.
const FB_PIXEL_ID = process.env.FB_PIXEL_ID;
const FB_CAPI_TOKEN = process.env.FB_CAPI_TOKEN;
const FB_API_VERSION = "v21.0";

// ---- Supabase (store persistente do contexto do pedido) ----
// Necessário em serverless (Vercel): a memória do processo não sobrevive entre
// a criação do Pix e a confirmação. A SERVICE ROLE KEY é secreta (só backend).
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_TABLE = "pedidos";
const supabaseEnabled = !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

// URL ENCRIPTADA gerada no painel Duttyfy (Integrações e Chaves → Chaves API).
// NUNCA exponha a chave bruta no front-end. Toda chamada sai daqui (backend).
const DUTTYFY_URL = process.env.DUTTYFY_URL;

// Token da API de Pedidos da Utmify (fica só no backend, nunca no front).
const UTMIFY_TOKEN = process.env.UTMIFY_API_TOKEN;
const UTMIFY_URL = "https://api.utmify.com.br/api-credentials/orders";

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const onlyDigits = (s) => String(s || "").replace(/\D/g, "");

/**
 * STORE DO CONTEXTO DO PEDIDO
 * ---------------------------
 * Guarda, por txid: o pedido da Utmify (order_json), os dados do Facebook
 * (fb_json), o status de pago e os flags de idempotência ("já enviei o paid?").
 *
 * Dois backends:
 *  - Supabase (produção/serverless): sobrevive entre invocações.
 *  - Memória (fallback local, quando Supabase não está configurado).
 *
 * `claim*` faz a marcação de idempotência de forma ATÔMICA: retorna true só
 * para quem "ganhou" o direito de enviar o evento (evita enviar 2x).
 */
function makeMemoryStore() {
  const rows = new Map(); // txid -> record
  const get = (txid) =>
    rows.get(txid) ||
    { txid, order: null, fb: null, paid: false, paidAt: null, utmify_paid_sent: false, fb_purchase_sent: false };
  return {
    async saveOrder(txid, { order, fb }) {
      const r = get(txid);
      r.order = order;
      r.fb = fb;
      rows.set(txid, r);
    },
    async getOrder(txid) {
      return rows.has(txid) ? rows.get(txid) : null;
    },
    async markPaid(txid, paidAt) {
      const r = get(txid);
      r.paid = true;
      r.paidAt = paidAt;
      rows.set(txid, r);
    },
    async claimUtmifyPaid(txid) {
      const r = rows.get(txid);
      if (!r || r.utmify_paid_sent) return false;
      r.utmify_paid_sent = true;
      return true;
    },
    async claimFbPurchase(txid) {
      const r = rows.get(txid);
      if (!r || r.fb_purchase_sent) return false;
      r.fb_purchase_sent = true;
      return true;
    }
  };
}

function makeSupabaseStore() {
  const headers = (extra) => ({
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...extra
  });
  const url = (qs) => `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}${qs || ""}`;
  const eq = (txid) => `?txid=eq.${encodeURIComponent(txid)}`;

  // PATCH condicional que retorna as linhas afetadas: ganha o claim quem
  // efetivamente virou o flag de false→true (idempotência atômica no banco).
  async function claim(txid, flag) {
    try {
      const r = await fetch(url(`${eq(txid)}&${flag}=is.false`), {
        method: "PATCH",
        headers: headers({ Prefer: "return=representation" }),
        body: JSON.stringify({ [flag]: true })
      });
      if (!r.ok) return false;
      const arr = await r.json();
      return Array.isArray(arr) && arr.length > 0;
    } catch (e) {
      console.error("Supabase claim falha:", e.message);
      return false;
    }
  }

  return {
    async saveOrder(txid, { order, fb }) {
      try {
        await fetch(url(), {
          method: "POST",
          headers: headers({ Prefer: "resolution=merge-duplicates,return=minimal" }),
          body: JSON.stringify({ txid, order_json: order, fb_json: fb })
        });
      } catch (e) {
        console.error("Supabase saveOrder falha:", e.message);
      }
    },
    async getOrder(txid) {
      try {
        const r = await fetch(url(`${eq(txid)}&select=*`), { headers: headers() });
        if (!r.ok) return null;
        const arr = await r.json();
        const row = arr && arr[0];
        if (!row) return null;
        return {
          txid: row.txid,
          order: row.order_json,
          fb: row.fb_json,
          paid: row.paid,
          paidAt: row.paid_at,
          utmify_paid_sent: row.utmify_paid_sent,
          fb_purchase_sent: row.fb_purchase_sent
        };
      } catch (e) {
        console.error("Supabase getOrder falha:", e.message);
        return null;
      }
    },
    async markPaid(txid, paidAt) {
      try {
        await fetch(url(eq(txid)), {
          method: "PATCH",
          headers: headers({ Prefer: "return=minimal" }),
          body: JSON.stringify({ paid: true, paid_at: paidAt })
        });
      } catch (e) {
        console.error("Supabase markPaid falha:", e.message);
      }
    },
    claimUtmifyPaid: (txid) => claim(txid, "utmify_paid_sent"),
    claimFbPurchase: (txid) => claim(txid, "fb_purchase_sent")
  };
}

const store = supabaseEnabled ? makeSupabaseStore() : makeMemoryStore();

// Data/hora atual em UTC no formato exigido pela Utmify: "YYYY-MM-DD HH:MM:SS"
function nowUtc() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

// Converte a query string de rastreamento em trackingParameters da Utmify
function parseTracking(utmString) {
  const out = {
    src: null, sck: null,
    utm_source: null, utm_campaign: null,
    utm_medium: null, utm_content: null, utm_term: null
  };
  if (!utmString) return out;
  const p = new URLSearchParams(utmString);
  Object.keys(out).forEach((k) => {
    const v = p.get(k);
    if (v) out[k] = v;
  });
  return out;
}

// Envia um pedido para a Utmify (fire-and-forget; nunca derruba o checkout)
async function sendToUtmify(order) {
  if (!UTMIFY_TOKEN) {
    console.warn("⚠️  UTMIFY_API_TOKEN não configurado — pedido não enviado.");
    return;
  }
  try {
    const r = await fetch(UTMIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-token": UTMIFY_TOKEN },
      body: JSON.stringify(order)
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      console.error(`Utmify erro ${r.status}:`, txt);
    } else {
      console.log(`📊 Utmify: pedido ${order.orderId} → ${order.status}`);
    }
  } catch (e) {
    console.error("Utmify falha de rede:", e.message);
  }
}

// Marca o pedido como pago na Utmify (uma vez só por txid)
async function marcarPagoUtmify(txid) {
  if (!txid) return;
  const row = await store.getOrder(txid);
  if (!row || !row.order) return; // sem contexto não dá pra montar o pedido
  const won = await store.claimUtmifyPaid(txid);
  if (!won) return; // outro caminho já enviou o "paid"
  await sendToUtmify({
    ...row.order,
    status: "paid",
    approvedDate: nowUtc(),
    refundedAt: null
  });
}

// ---- Facebook Conversions API ----

// SHA-256 minúsculo/sem espaços, como exige o Facebook para dados pessoais.
function fbHash(value) {
  if (!value) return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return undefined;
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

// Envia o evento de Purchase para a Conversions API.
async function sendFbPurchase(txid) {
  if (!FB_PIXEL_ID || !FB_CAPI_TOKEN || !txid) return; // CAPI não configurada
  const row = await store.getOrder(txid);
  const fb = row && row.fb;
  if (!fb) return; // sem contexto não dá pra montar o evento
  const won = await store.claimFbPurchase(txid);
  if (!won) return; // já enviado

  // Telefone com DDI do Brasil para melhorar o match (55 + DDD + número).
  const phoneDigits = onlyDigits(fb.phone);
  const phoneForHash = phoneDigits
    ? (phoneDigits.startsWith("55") ? phoneDigits : "55" + phoneDigits)
    : null;

  const user_data = {
    em: fb.email ? [fbHash(fb.email)] : undefined,
    ph: phoneForHash ? [fbHash(phoneForHash)] : undefined,
    external_id: fb.document ? [fbHash(fb.document)] : undefined,
    client_ip_address: fb.ip || undefined,
    client_user_agent: fb.ua || undefined,
    fbp: fb.fbp || undefined,
    fbc: fb.fbc || undefined
  };

  const payload = {
    data: [
      {
        event_name: "Purchase",
        event_time: Math.floor(Date.now() / 1000),
        event_id: txid, // dedup com o evento client-side, se houver
        action_source: "website",
        event_source_url: fb.url || undefined,
        user_data,
        custom_data: {
          currency: "BRL",
          value: Number(((fb.valueCents || 0) / 100).toFixed(2))
        }
      }
    ]
  };

  const url = `https://graph.facebook.com/${FB_API_VERSION}/${FB_PIXEL_ID}/events?access_token=${encodeURIComponent(FB_CAPI_TOKEN)}`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      console.error(`Facebook CAPI erro ${r.status}:`, txt);
    } else {
      console.log(`📈 Facebook CAPI: Purchase enviado (txid ${txid})`);
    }
  } catch (e) {
    console.error("Facebook CAPI falha de rede:", e.message);
  }
}

// Marca o pedido como pago em todas as integrações (uma vez por txid).
// Em serverless é importante AGUARDAR antes de responder, senão a função pode
// "congelar" e os envios não completam.
async function marcarPago(txid) {
  await Promise.allSettled([marcarPagoUtmify(txid), sendFbPurchase(txid)]);
}

/**
 * CRIAR COBRANÇA PIX (POST)
 * O front envia: { nome, email, telefone, cpf, valor, utm }
 * Monta o body no formato Duttyfy e retorna { qrCode, copiaECola, txid, status }.
 */
app.post("/api/pix", async (req, res) => {
  const { nome, email, telefone, cpf, valor, utm, bumps, fbp, fbc, eventSourceUrl } = req.body;

  // Dados de rede do cliente, para o match da Conversions API do Facebook.
  const clientIp = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress || "";
  const clientUa = req.headers["user-agent"] || "";

  // Validação básica
  if (!nome || !cpf || !valor) {
    return res.status(400).json({ erro: "Dados incompletos." });
  }
  if (!DUTTYFY_URL) {
    return res
      .status(500)
      .json({ erro: "DUTTYFY_URL não configurada. Cole a URL encriptada no arquivo .env" });
  }

  const amount = Math.round(Number(valor) * 100); // valores SEMPRE em centavos
  const documento = onlyDigits(cpf); // CPF: 11 dígitos, só números
  const fone = onlyDigits(telefone); // telefone: DDD + número, só números

  const body = {
    amount,
    description: "Taxa de liberação - Correios",
    customer: {
      name: nome,
      document: documento,
      email: email || "",
      phone: fone
    },
    item: {
      title: "Taxa de liberação",
      price: amount,
      quantity: 1
    },
    paymentMethod: "PIX",
    utm: utm || "" // rastreamento (fbclid / ttclid / click_id / UTMs)
  };

  try {
    const resposta = await fetch(DUTTYFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await resposta.json();

    if (!resposta.ok || data.error) {
      return res.status(400).json({ erro: data.error || "Erro ao gerar Pix" });
    }

    // Gera a imagem do QR Code (base64) a partir do pixCode retornado
    let qrCode = null;
    if (data.pixCode) {
      qrCode = await QRCode.toDataURL(data.pixCode, { width: 300, margin: 1 });
    }

    const txid = data.transactionId || "";

    // ---- Integração Utmify: registra o pedido como "aguardando pagamento" ----
    if (txid) {
      const bumpsArr = Array.isArray(bumps) ? bumps : [];
      const bumpsCents = bumpsArr.reduce(
        (s, b) => s + Math.round(Number(b.preco) * 100),
        0
      );
      const baseCents = amount - bumpsCents; // valor da taxa sem os order bumps

      const products = [
        {
          id: "taxa-liberacao",
          name: "Taxa de liberação",
          planId: null,
          planName: null,
          quantity: 1,
          priceInCents: baseCents
        },
        ...bumpsArr.map((b, i) => ({
          id: `bump-${i + 1}`,
          name: b.nome || `Oferta ${i + 1}`,
          planId: null,
          planName: null,
          quantity: 1,
          priceInCents: Math.round(Number(b.preco) * 100)
        }))
      ];

      const order = {
        orderId: txid,
        platform: "CarHubCheckout",
        paymentMethod: "pix",
        status: "waiting_payment",
        createdAt: nowUtc(),
        approvedDate: null,
        refundedAt: null,
        customer: {
          name: nome,
          // Utmify exige e-mail; se o cliente não informou, gera um placeholder
          email: email || `${documento || "cliente"}@sememail.com`,
          phone: fone || null,
          document: documento || null,
          country: "BR"
        },
        products,
        trackingParameters: parseTracking(utm),
        commission: {
          totalPriceInCents: amount,
          gatewayFeeInCents: 0,
          userCommissionInCents: amount,
          currency: "BRL"
        },
        isTest: false
      };

      // Dados do Facebook guardados para o Purchase via CAPI na confirmação.
      const fb = {
        fbp: fbp || null,
        fbc: fbc || null,
        ip: clientIp || null,
        ua: clientUa || null,
        url: eventSourceUrl || null,
        email: email || null,
        phone: fone || null,
        document: documento || null,
        valueCents: amount
      };

      // Persiste o contexto ANTES de responder (crítico em serverless).
      await store.saveOrder(txid, { order, fb });
      sendToUtmify(order); // "aguardando pagamento": não bloqueia o checkout
    }

    return res.json({
      qrCode,
      copiaECola: data.pixCode || "",
      txid,
      status: data.status || "PENDING"
    });
  } catch (e) {
    console.error("Erro ao comunicar com Duttyfy:", e.message);
    return res.status(502).json({ erro: "Falha ao comunicar com o gateway." });
  }
});

/**
 * WEBHOOK (RECOMENDADO — fonte primária)
 * Configure esta URL em Integrações → Webhooks no painel Duttyfy.
 * Recebe POST quando o status muda (PENDING / COMPLETED).
 */
app.post("/api/webhook", async (req, res) => {
  const payload = req.body || {};

  // Em COMPLETED pode não vir transactionId; use _id.$oid como chave.
  const txid =
    payload.transactionId || (payload._id && payload._id.$oid) || null;
  // A chave do contexto é o transactionId (usado no /api/pix).
  const ctxId = payload.transactionId || txid;

  if (payload.status === "COMPLETED" && ctxId) {
    console.log(`✅ PIX confirmado via webhook: ${ctxId}`);
    await store.markPaid(ctxId, new Date().toISOString());
    // Marca como pago nas integrações (Utmify + Facebook CAPI).
    // AGUARDA para garantir o envio antes da função serverless encerrar.
    await marcarPago(ctxId);
  }

  // Responder 2xx para evitar retries
  return res.sendStatus(200);
});

/**
 * CONSULTAR STATUS (FALLBACK)
 * Primeiro checa o que o webhook já confirmou (memória);
 * se nada, faz GET na API do Duttyfy com o transactionId.
 */
app.get("/api/pix/status/:txid", async (req, res) => {
  const txid = req.params.txid;

  // 1) Fonte primária: já confirmado (webhook gravou no store)?
  const row = await store.getOrder(txid);
  if (row && row.paid) {
    await marcarPago(txid); // garante o envio do "paid" (idempotente)
    return res.json({ status: "COMPLETED", paidAt: row.paidAt });
  }

  // 2) Fallback: pergunta para a API
  if (!DUTTYFY_URL) return res.json({ status: "PENDING" });
  try {
    const sep = DUTTYFY_URL.includes("?") ? "&" : "?";
    const url = `${DUTTYFY_URL}${sep}transactionId=${encodeURIComponent(txid)}`;
    const resposta = await fetch(url);
    const data = await resposta.json();
    if (data.status === "COMPLETED") {
      await store.markPaid(txid, data.paidAt || new Date().toISOString());
      await marcarPago(txid); // confirma via polling também envia o "paid"
    }
    return res.json({
      status: data.status || "PENDING",
      paidAt: data.paidAt || null
    });
  } catch (e) {
    return res.json({ status: "PENDING" });
  }
});

// Em ambiente local roda como servidor próprio (node server.js).
// No Vercel (serverless) o arquivo é apenas importado — sem app.listen.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Checkout rodando em http://localhost:${PORT}`);
    if (!DUTTYFY_URL) {
      console.warn("⚠️  DUTTYFY_URL não configurada — cole a URL encriptada no .env");
    }
    if (FB_PIXEL_ID && FB_CAPI_TOKEN) {
      console.log(`📈 Facebook CAPI ativo (pixel ${FB_PIXEL_ID})`);
    } else {
      console.warn("⚠️  Facebook CAPI não configurada — defina FB_PIXEL_ID e FB_CAPI_TOKEN no .env");
    }
    if (supabaseEnabled) {
      console.log(`🗄️  Supabase store ativo (${SUPABASE_URL})`);
    } else {
      console.warn("⚠️  Supabase não configurado — usando store EM MEMÓRIA (ok no local; em serverless o tracking da venda fica instável). Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
    }
  });
}

// Exporta o app para o runtime serverless do Vercel (@vercel/node).
module.exports = app;
