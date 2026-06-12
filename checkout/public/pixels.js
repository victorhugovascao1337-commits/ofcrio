/**
 * PIXELS DO CHECKOUT (client-side)
 * --------------------------------
 * Carrega o Pixel da Utmify e o Pixel do Facebook na página de checkout.
 * A captura de UTMs já é feita por tracking.js.
 *
 * O TOKEN da Conversions API do Facebook NÃO entra aqui — é server-side
 * (fica no .env e é usado por server.js no evento de Purchase). No navegador
 * só vai o Pixel ID, que é público.
 */
(function () {
  "use strict";

  // ---- Pixel da Utmify ----
  window.pixelId = "6a2a746ba410b6b8f5fe7220";
  var u = document.createElement("script");
  u.setAttribute("async", "");
  u.setAttribute("defer", "");
  u.setAttribute("src", "https://cdn.utmify.com.br/scripts/pixel/pixel.js");
  document.head.appendChild(u);

  // ---- Pixel do Facebook + PageView ----
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
