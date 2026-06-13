/**
 * TRACKING COMPARTILHADO DO FUNIL
 * --------------------------------
 * Incluído no <head> de TODAS as páginas do funil (1, 2, confirmação, 3).
 *
 * Faz três coisas:
 *  1) Captura e PERSISTE os parâmetros de rastreamento (UTMs + click ids) em
 *     localStorage, e os RESTAURA na URL atual. Como os redirects internos do
 *     funil montam URLs novas (e perderiam os UTMs), essa rede de segurança
 *     garante que os parâmetros sobrevivam a todos os saltos até o checkout.
 *  2) Carrega o Pixel da Utmify (window.pixelId + pixel.js).
 *  3) Carrega o Pixel do Facebook (client-side) e dispara o PageView.
 *
 * OBS: o TOKEN da Conversions API do Facebook NÃO entra aqui — ele é
 * server-side (fica no .env do checkout). No navegador só vai o Pixel ID,
 * que é público por design.
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // 1) Persistência de UTMs / click ids (last-touch) + restauração na URL
  // ---------------------------------------------------------------------------
  var TRACK_KEYS = [
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
    "src", "sck",
    "fbclid",   // Facebook Ads
    "ttclid",   // TikTok Ads
    "gclid",    // Google Ads
    "click_id"  // Kwai Ads
  ];
  var STORAGE_KEY = "tracking_params";

  function load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function save(obj) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); } catch (e) {}
  }

  var url = new URL(window.location.href);
  var stored = load();
  var changed = false;

  // Captura da URL (only-if-present: não apaga o que já estava guardado)
  TRACK_KEYS.forEach(function (k) {
    var v = url.searchParams.get(k);
    if (v) { stored[k] = v; changed = true; }
  });
  if (changed) save(stored);

  // Restaura na URL atual o que está guardado mas não está na URL,
  // para que redirects baseados em window.location.search carreguem os UTMs.
  var restored = false;
  TRACK_KEYS.forEach(function (k) {
    if (stored[k] && !url.searchParams.get(k)) {
      url.searchParams.set(k, stored[k]);
      restored = true;
    }
  });
  if (restored) {
    try {
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    } catch (e) {}
  }

  // API pública (útil para montar query strings manualmente nos redirects)
  window.FunnelTracking = {
    getAll: load,
    getQueryString: function () {
      var d = load();
      return TRACK_KEYS
        .filter(function (k) { return d[k]; })
        .map(function (k) { return k + "=" + encodeURIComponent(d[k]); })
        .join("&");
    }
  };

  // ---------------------------------------------------------------------------
  // 2) Pixel da Utmify
  // ---------------------------------------------------------------------------
  window.pixelId = "6a2cf8b4a19c3fad27132378";
  var u = document.createElement("script");
  u.setAttribute("async", "");
  u.setAttribute("defer", "");
  u.setAttribute("src", "https://cdn.utmify.com.br/scripts/pixel/pixel.js");
  document.head.appendChild(u);

  // ---------------------------------------------------------------------------
  // 3) Pixel do Facebook (client-side) + PageView
  // ---------------------------------------------------------------------------
  !function (f, b, e, v, n, t, s) {
    if (f.fbq) return; n = f.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    };
    if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = "2.0";
    n.queue = []; t = b.createElement(e); t.async = !0;
    t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
  }(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");

  window.fbq("init", "1515956179949480");
  window.fbq("track", "PageView");
})();
