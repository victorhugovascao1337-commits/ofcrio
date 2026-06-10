// ---- Máscaras ----
const cpfInput = document.getElementById("document");
const telInput = document.getElementById("telephone");

cpfInput.addEventListener("input", () => {
  let v = cpfInput.value.replace(/\D/g, "").slice(0, 11);
  v = v.replace(/(\d{3})(\d)/, "$1.$2");
  v = v.replace(/(\d{3})(\d)/, "$1.$2");
  v = v.replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  cpfInput.value = v;
});

telInput.addEventListener("input", () => {
  let v = telInput.value.replace(/\D/g, "").slice(0, 11);
  v = v.replace(/(\d{2})(\d)/, "($1) $2");
  v = v.replace(/(\d{5})(\d)/, "$1-$2");
  telInput.value = v;
});

// ---- Pré-preenchimento via URL (?cpf= e ?name=) vindos do funil ----
(function preencherViaURL() {
  const params = new URLSearchParams(window.location.search);
  const nome = (params.get("name") || params.get("nome") || "").trim();
  const cpfRaw = params.get("cpf") || "";

  const nameInput = document.getElementById("name");

  // CPF já mascarado (mesma máscara do input)
  const cpfMascarado = (() => {
    let v = cpfRaw.replace(/\D/g, "").slice(0, 11);
    v = v.replace(/(\d{3})(\d)/, "$1.$2");
    v = v.replace(/(\d{3})(\d)/, "$1.$2");
    v = v.replace(/(\d{3})(\d{1,2})$/, "$1-$2");
    return v;
  })();

  // O usuário digitou de verdade? (autofill NÃO dispara keydown/paste)
  let userTyped = false;
  ["keydown", "paste"].forEach((ev) => {
    if (nameInput) nameInput.addEventListener(ev, () => (userTyped = true));
    cpfInput && cpfInput.addEventListener(ev, () => (userTyped = true));
  });

  function aplicar() {
    if (userTyped) return;
    if (nome && nameInput && nameInput.value.trim() !== nome) {
      nameInput.value = nome;
    }
    if (cpfMascarado && cpfInput && cpfInput.value !== cpfMascarado) {
      cpfInput.value = cpfMascarado;
    }
  }

  aplicar();
  // Rede de segurança contra o autofill do navegador, que dispara depois do
  // load e poderia sobrescrever os dados vindos do funil. Reaplica por um
  // curto período e para assim que o usuário começar a digitar.
  window.addEventListener("load", aplicar);
  [120, 350, 700].forEach((t) => setTimeout(aplicar, t));
})();

// "Não tenho e-mail"
const semEmail = document.getElementById("noEmail");
const emailInput = document.getElementById("email");
semEmail.addEventListener("change", () => {
  emailInput.disabled = semEmail.checked;
  if (semEmail.checked) emailInput.value = "";
});

// ---- Order Bumps ----
const BASE_VALUE = 47.59; // valor base da taxa
const bumpBoxes = Array.from(document.querySelectorAll(".bump-box"));

const sideTotalEl = document.getElementById("side-total");
const pixTotalEl = document.getElementById("pix-total");

const formatBRL = (n) =>
  "R$ " + n.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");

// Soma os preços de todos os bumps marcados
function bumpsSelecionados() {
  return bumpBoxes
    .filter((b) => b.classList.contains("selected"))
    .map((b) => ({ nome: b.querySelector(".bump-name")?.textContent.trim(), preco: Number(b.dataset.price) }));
}

function valorAtual() {
  return BASE_VALUE + bumpsSelecionados().reduce((soma, b) => soma + b.preco, 0);
}

function atualizarTotais() {
  const total = formatBRL(valorAtual());
  if (sideTotalEl) sideTotalEl.textContent = total;
  if (pixTotalEl) pixTotalEl.textContent = total;
}

bumpBoxes.forEach((box) => {
  box.addEventListener("click", () => {
    const ativo = box.classList.toggle("selected");
    const btn = box.querySelector(".bump-btn");
    if (btn) {
      btn.innerHTML = ativo
        ? '<span class="box"></span> OFERTA ADICIONADA'
        : '<span class="box"></span> PEGAR OFERTA';
    }
    atualizarTotais();
  });
});

// ---- Gerar Pix ----
const btnGerar = document.getElementById("finalize_pix_purchase");
const pixPage = document.getElementById("pix-page");
const checkoutHolder = document.querySelector(".checkout-holder");
const pixQrImg = document.getElementById("pix-qr-img");
const pixCodeField = document.getElementById("pix-code-field");
const pixCopyBtn = document.getElementById("pix-copy-btn");
const pixTimerEl = document.getElementById("pix-timer");
const warningBanner = document.querySelector(".warning-banner");
const loadingOverlay = document.getElementById("loading-overlay");

// HTML original do botão copiar (ícone + texto)
const pixCopyBtnHTML = pixCopyBtn.innerHTML;

// Contador regressivo (10 minutos)
function iniciarContador() {
  let restante = 10 * 60; // segundos
  const tick = () => {
    const min = String(Math.floor(restante / 60)).padStart(2, "0");
    const seg = String(restante % 60).padStart(2, "0");
    pixTimerEl.textContent = `${min}:${seg}`;
    if (restante <= 0) {
      clearInterval(intervalo);
      pixTimerEl.textContent = "00:00";
    }
    restante--;
  };
  tick();
  const intervalo = setInterval(tick, 1000);
}

btnGerar.addEventListener("click", async () => {
  const nameInput = document.getElementById("name");
  const urlParams = new URLSearchParams(window.location.search);

  // Rede de segurança: se o autofill não colou os dados do funil a tempo,
  // recupera nome/CPF direto da URL (corrige o falso "Preencha o nome completo"
  // e o Bad Request por dados incompletos quando o campo ficou vazio por timing).
  let nome = nameInput.value.trim();
  if (!nome) {
    nome = (urlParams.get("name") || urlParams.get("nome") || "").trim();
    if (nome) nameInput.value = nome;
  }

  let cpf = cpfInput.value.trim();
  if (cpf.replace(/\D/g, "").length !== 11) {
    const cpfUrl = (urlParams.get("cpf") || "").replace(/\D/g, "").slice(0, 11);
    if (cpfUrl.length === 11) {
      cpf = cpfUrl
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
      cpfInput.value = cpf;
    }
  }

  const email = emailInput.value.trim();
  const telefone = telInput.value.trim();

  if (!nome) return alert("Preencha o nome completo.");
  if (cpf.replace(/\D/g, "").length !== 11) return alert("CPF inválido.");
  if (!semEmail.checked && !email) return alert("Preencha o e-mail ou marque 'Não tenho e-mail'.");

  btnGerar.disabled = true;
  btnGerar.textContent = "Gerando...";

  // Mostra o loading e garante um tempo mínimo de exibição
  loadingOverlay.classList.add("visible");
  const loadingInicio = Date.now();

  // Recupera os parâmetros de rastreamento salvos na entrada (localStorage)
  const utm = (window.Tracking && window.Tracking.getQueryString()) || "";

  // Cookies do Pixel do Facebook — enviados ao backend para a Conversions API
  // casar (deduplicar) o evento server-side com o client-side.
  const getCookie = (name) => {
    const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : null;
  };
  const fbp = getCookie("_fbp");
  const fbc = getCookie("_fbc");

  try {
    const resp = await fetch("/api/pix", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome, email, telefone, cpf, valor: valorAtual(),
        bumps: bumpsSelecionados(), utm,
        fbp, fbc, eventSourceUrl: window.location.href
      })
    });
    const data = await resp.json();

    if (!resp.ok) throw new Error(data.erro || "Erro ao gerar Pix");

    // Mantém o loading visível por no mínimo 1,2s
    const decorrido = Date.now() - loadingInicio;
    if (decorrido < 1200) await new Promise((r) => setTimeout(r, 1200 - decorrido));

    // Mostrar página de PIX e ocultar checkout
    checkoutHolder.style.display = "none";
    if (warningBanner) warningBanner.style.display = "none";
    pixPage.classList.add("visible");
    loadingOverlay.classList.remove("visible");

    if (data.qrCode) {
      pixQrImg.src = data.qrCode;
    }
    pixCodeField.value = data.copiaECola || "";

    iniciarContador();
    if (data.txid) iniciarChecagem(data.txid, valorAtual());

    // Facebook: cliente iniciou o checkout (gerou o Pix)
    if (window.fbq) {
      window.fbq("track", "InitiateCheckout", {
        value: valorAtual(),
        currency: "BRL"
      }, data.txid ? { eventID: data.txid + "-ic" } : undefined);
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (e) {
    loadingOverlay.classList.remove("visible");
    alert(e.message);
  } finally {
    btnGerar.disabled = false;
    btnGerar.textContent = "Gerar Pix";
  }
});

// Copiar código
pixCopyBtn.addEventListener("click", () => {
  pixCodeField.select();
  navigator.clipboard.writeText(pixCodeField.value);
  pixCopyBtn.textContent = "✓ COPIADO!";
  setTimeout(() => (pixCopyBtn.innerHTML = pixCopyBtnHTML), 1500);
});

// Checa pagamento (fallback — o webhook é a fonte primária).
//
// IMPORTANTE no Pix: o cliente sai da aba pra pagar no app do banco. Aba em
// segundo plano tem o setInterval estrangulado pelo navegador (~1x/min), então
// o redirect pro upsell quase nunca dispara só com polling. A correção é checar
// o status TAMBÉM no instante em que ele volta pra aba (visibilitychange/focus).
function iniciarChecagem(txid, valor) {
  let finalizado = false;

  async function checar() {
    if (finalizado) return;
    try {
      const r = await fetch(`/api/pix/status/${encodeURIComponent(txid)}`);
      const d = await r.json();
      if (d.status === "COMPLETED" && !finalizado) {
        finalizado = true;
        clearInterval(intervalo);
        document.removeEventListener("visibilitychange", aoVoltar);
        window.removeEventListener("focus", checar);

        // Facebook: venda confirmada (Purchase) disparado pelo navegador.
        // Usa eventID = txid, o MESMO id do evento server-side (Conversions
        // API), para o Facebook deduplicar e não contar a venda duas vezes.
        if (window.fbq) {
          window.fbq("track", "Purchase", { value: valor, currency: "BRL" }, { eventID: txid });
        }

        // Redireciona para o upsell1, levando os dados do cliente para
        // gerar o PIX das próximas ofertas sem pedir tudo de novo.
        // Nome/CPF caem para a URL do próprio checkout caso o campo esteja
        // vazio no momento do redirect (garante o contexto no upsell).
        const pageParams = new URLSearchParams(window.location.search);
        const params = new URLSearchParams({
          txid: txid,
          nome: document.getElementById("name").value.trim() || pageParams.get("name") || pageParams.get("nome") || "",
          cpf: cpfInput.value.trim() || pageParams.get("cpf") || "",
          email: emailInput.value.trim(),
          tel: telInput.value.trim()
        });
        // Caminho RELATIVO (.html): funciona no local e em produção, onde o
        // checkout é servido sob /checkout/ como arquivo estático no Vercel.
        window.location.href = `upsell1.html?${params.toString()}`;
      }
    } catch (_) {}
  }

  // Quando o cliente VOLTA pra aba (após pagar no banco), checa na hora.
  const aoVoltar = () => { if (document.visibilityState === "visible") checar(); };

  const intervalo = setInterval(checar, 3000);          // polling de segurança
  document.addEventListener("visibilitychange", aoVoltar);
  window.addEventListener("focus", checar);
  checar();                                             // checa uma vez já de cara
}
