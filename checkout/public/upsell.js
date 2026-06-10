/* ============================================================
   LÓGICA COMPARTILHADA DOS UPSELLS
   ------------------------------------------------------------
   Cada página define window.UPSELL_CONFIG = {
     valor: 27.95,                 // valor do upsell em reais
     descricao: "Taxa ...",        // descrição (vai no PIX)
     next: "/upsell2"              // próxima etapa após pagar
   };
   Os dados do cliente (nome, cpf, email, tel) chegam pela URL,
   vindos do checkout / etapa anterior.
   ============================================================ */
(function () {
  const cfg = window.UPSELL_CONFIG || {};
  const params = new URLSearchParams(window.location.search);

  // Dados do cliente herdados da etapa anterior
  const cliente = {
    nome: params.get("nome") || "",
    cpf: params.get("cpf") || "",
    email: params.get("email") || "",
    tel: params.get("tel") || "",
    txidOrigem: params.get("txid") || ""
  };

  const formatBRL = (n) =>
    "R$ " + Number(n).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");

  // Repassa os dados do cliente para a próxima página
  function urlProximaEtapa() {
    const p = new URLSearchParams({
      txid: cliente.txidOrigem,
      nome: cliente.nome,
      cpf: cliente.cpf,
      email: cliente.email,
      tel: cliente.tel
    });
    return `${cfg.next}?${p.toString()}`;
  }

  // ---- Contador regressivo da página ----
  function iniciarTimer(el, segundos) {
    if (!el) return;
    let restante = segundos;
    const tick = () => {
      const min = String(Math.floor(restante / 60)).padStart(2, "0");
      const seg = String(restante % 60).padStart(2, "0");
      el.innerHTML = `${min}<span class="sep">:</span>${seg}`;
      if (restante <= 0) clearInterval(intervalo);
      restante--;
    };
    tick();
    const intervalo = setInterval(tick, 1000);
  }

  // ---- Modal de PIX (injetado uma vez) ----
  let modal, qrImg, codeField, statusEl, copyBtn, loadingEl;

  function montarModal() {
    const overlay = document.createElement("div");
    overlay.className = "pix-overlay";
    overlay.innerHTML = `
      <div class="pix-modal">
        <button type="button" class="pix-modal-close" aria-label="Fechar">&times;</button>
        <h3>Pague com PIX para continuar</h3>
        <div class="pix-amount">${formatBRL(cfg.valor)}</div>
        <p class="pix-timer">Escaneie o QR Code abaixo</p>
        <div class="pix-loading">Gerando PIX...</div>
        <img class="pix-qr hidden" alt="QR Code PIX" />
        <textarea class="pix-code" readonly style="display:none"></textarea>
        <button type="button" class="pix-copy" style="display:none">COPIAR CÓDIGO PIX</button>
        <div class="pix-status"><span class="dot"></span> Aguardando pagamento...</div>
      </div>`;
    document.body.appendChild(overlay);

    modal = overlay;
    qrImg = overlay.querySelector(".pix-qr");
    codeField = overlay.querySelector(".pix-code");
    statusEl = overlay.querySelector(".pix-status");
    copyBtn = overlay.querySelector(".pix-copy");
    loadingEl = overlay.querySelector(".pix-loading");

    overlay.querySelector(".pix-modal-close").addEventListener("click", () => {
      overlay.classList.remove("visible");
    });
    copyBtn.addEventListener("click", () => {
      codeField.select();
      navigator.clipboard.writeText(codeField.value);
      copyBtn.textContent = "✓ COPIADO!";
      setTimeout(() => (copyBtn.textContent = "COPIAR CÓDIGO PIX"), 1500);
    });
  }

  // ---- Geração do PIX e polling ----
  let gerando = false;

  async function gerarPix(btns, errEl) {
    if (gerando) { modal.classList.add("visible"); return; }
    gerando = true;
    if (errEl) errEl.classList.remove("visible");
    btns.forEach((b) => (b.disabled = true));

    // mostra o modal já em estado "gerando"
    loadingEl.style.display = "";
    qrImg.classList.add("hidden");
    codeField.style.display = "none";
    copyBtn.style.display = "none";
    modal.classList.add("visible");

    // Rastreamento (UTMs / fbclid) salvo na entrada, se existir
    const utm = (window.Tracking && window.Tracking.getQueryString && window.Tracking.getQueryString()) || "";
    const getCookie = (name) => {
      const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
      return m ? decodeURIComponent(m[1]) : null;
    };

    try {
      const resp = await fetch("/api/pix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: cliente.nome || "Cliente",
          email: cliente.email,
          telefone: cliente.tel,
          cpf: cliente.cpf,
          valor: cfg.valor,
          utm,
          fbp: getCookie("_fbp"),
          fbc: getCookie("_fbc"),
          eventSourceUrl: window.location.href
        })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.erro || "Erro ao gerar PIX");

      loadingEl.style.display = "none";
      if (data.qrCode) {
        qrImg.src = data.qrCode;
        qrImg.classList.remove("hidden");
      }
      codeField.value = data.copiaECola || "";
      codeField.style.display = "";
      copyBtn.style.display = "";

      if (data.txid) iniciarChecagem(data.txid);
    } catch (e) {
      modal.classList.remove("visible");
      gerando = false;
      btns.forEach((b) => (b.disabled = false));
      if (errEl) errEl.classList.add("visible");
      else alert(e.message);
    }
  }

  function iniciarChecagem(txid) {
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

          // Facebook: venda do upsell confirmada
          if (window.fbq) {
            window.fbq("track", "Purchase", { value: cfg.valor, currency: "BRL" }, { eventID: txid });
          }

          statusEl.innerHTML = "✅ Pagamento confirmado!";
          setTimeout(() => { window.location.href = urlProximaEtapa(); }, 800);
        }
      } catch (_) {}
    }

    // Checa também no instante em que o cliente volta pra aba (após pagar no banco).
    const aoVoltar = () => { if (document.visibilityState === "visible") checar(); };

    const intervalo = setInterval(checar, 3000);
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", checar);
    checar();
  }

  // ---- Inicialização ----
  document.addEventListener("DOMContentLoaded", () => {
    montarModal();

    const timerEl = document.querySelector("[data-timer]");
    if (timerEl) {
      const segs = Number(timerEl.getAttribute("data-timer")) || 600;
      iniciarTimer(timerEl, segs);
    }

    const errEl = document.querySelector(".pay-error");
    const btns = Array.from(document.querySelectorAll(".js-pay"));
    btns.forEach((b) => b.addEventListener("click", () => gerarPix(btns, errEl)));
  });
})();
