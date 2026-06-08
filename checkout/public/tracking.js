/**
 * CAPTURA DE RASTREAMENTO (TRACKING)
 * ----------------------------------
 * Roda em TODA página (deve carregar o quanto antes, no <head>).
 *
 * 1) Lê fbclid (Facebook), ttclid (TikTok), click_id (Kwai) e os UTMs
 *    de window.location.search.
 * 2) Persiste no localStorage (last-touch: só sobrescreve quando o
 *    parâmetro vem presente na URL; se a pessoa navegar sem parâmetros,
 *    os valores capturados na entrada continuam guardados).
 * 3) Expõe window.Tracking.getQueryString() para montar o campo `utm`
 *    exigido pelo gateway no momento do checkout.
 */
(function () {
  var TRACK_KEYS = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "fbclid",   // Facebook Ads
    "ttclid",   // TikTok Ads
    "click_id"  // Kwai Ads
  ];
  var STORAGE_KEY = "tracking_params";

  function load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function save(obj) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch (e) {}
  }

  // 1 + 2) Captura da URL e persiste
  var params = new URLSearchParams(window.location.search);
  var stored = load();
  var changed = false;

  TRACK_KEYS.forEach(function (key) {
    var val = params.get(key);
    if (val) {
      stored[key] = val;
      changed = true;
    }
  });

  if (changed) save(stored);

  // 3) API pública
  window.Tracking = {
    // Objeto com tudo que está guardado
    getAll: function () {
      return load();
    },
    // Query string crua: "utm_source=facebook&utm_medium=cpc&fbclid=...&ttclid=...&click_id=..."
    getQueryString: function () {
      var data = load();
      return TRACK_KEYS
        .filter(function (k) {
          return data[k];
        })
        .map(function (k) {
          return k + "=" + encodeURIComponent(data[k]);
        })
        .join("&");
    }
  };
})();
