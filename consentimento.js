/* Find It: aviso de cookies e Tag do Pinterest (ID 2612577820689).
   Criado em 2026-11-20 com o "pode ir" do César.
   A tag do Pinterest só é carregada depois que a pessoa clica em "Aceitar".
   A escolha fica guardada no aparelho de quem visita (localStorage "findit-cookies").
   Eventos medidos: visita de página (pagevisit), busca no site (search)
   e clique em botão ou link de loja (lead, tipo "clique_loja"). */
(function () {
  var TAG_ID = "2612577820689";
  var CHAVE = "findit-cookies";
  var esteScript = document.currentScript;
  var base = esteScript ? esteScript.src.replace(/consentimento\.js.*$/, "") : "";
  var carregada = false;

  function le() { try { return localStorage.getItem(CHAVE); } catch (e) { return null; } }
  function grava(v) { try { localStorage.setItem(CHAVE, v); } catch (e) {} }

  function carregaTag() {
    if (carregada) return;
    carregada = true;
    !function (e) { if (!window.pintrk) { window.pintrk = function () { window.pintrk.queue.push(Array.prototype.slice.call(arguments)); }; var n = window.pintrk; n.queue = [], n.version = "3.0"; var t = document.createElement("script"); t.async = !0, t.src = e; var r = document.getElementsByTagName("script")[0]; r.parentNode.insertBefore(t, r); } }("https://s.pinimg.com/ct/core.js");
    window.pintrk("load", TAG_ID);
    window.pintrk("page");
    window.pintrk("track", "pagevisit");
  }

  document.addEventListener("click", function (ev) {
    if (!carregada || !ev.target.closest) return;
    if (ev.target.closest('a[rel~="sponsored"]')) {
      window.pintrk("track", "lead", { lead_type: "clique_loja" });
    }
  }, true);

  var busca = document.getElementById("busca");
  if (busca) {
    busca.addEventListener("submit", function () {
      if (!carregada) return;
      var campo = document.getElementById("campo-busca");
      window.pintrk("track", "search", { search_query: campo ? campo.value : "" });
    });
  }

  function estilo() {
    if (document.getElementById("findit-cookies-estilo")) return;
    var s = document.createElement("style");
    s.id = "findit-cookies-estilo";
    s.textContent =
      ".fi-cookies{position:fixed;left:16px;right:16px;bottom:16px;z-index:9999;max-width:640px;margin:0 auto;" +
      "background:#0C0D1D;color:#fff;border:1px solid #A715F7;border-radius:12px;padding:16px 18px;" +
      "font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35)}" +
      ".fi-cookies p{margin:0 0 12px}.fi-cookies a{color:#d9a6ff}" +
      ".fi-cookies .fi-botoes{display:flex;gap:10px;flex-wrap:wrap}" +
      ".fi-cookies button{cursor:pointer;border-radius:8px;padding:9px 16px;font:inherit;font-weight:600;border:1px solid #A715F7}" +
      ".fi-cookies .fi-aceitar{background:#A715F7;color:#fff}.fi-cookies .fi-recusar{background:transparent;color:#fff}";
    document.head.appendChild(s);
  }

  function mostraAviso() {
    if (document.getElementById("findit-cookies")) return;
    estilo();
    var caixa = document.createElement("div");
    caixa.id = "findit-cookies";
    caixa.className = "fi-cookies";
    caixa.setAttribute("role", "dialog");
    caixa.setAttribute("aria-label", "Aviso de cookies");
    caixa.innerHTML =
      '<p>Usamos a ferramenta de medição do Pinterest para saber quais publicações trazem você até aqui e melhorar o que mostramos. ' +
      'Ela só funciona se você aceitar. <a href="' + base + 'privacidade.html">Saiba mais</a>.</p>' +
      '<div class="fi-botoes"><button type="button" class="fi-aceitar">Aceitar</button>' +
      '<button type="button" class="fi-recusar">Recusar</button></div>';
    document.body.appendChild(caixa);
    caixa.querySelector(".fi-aceitar").addEventListener("click", function () {
      grava("aceito"); caixa.remove(); carregaTag();
    });
    caixa.querySelector(".fi-recusar").addEventListener("click", function () {
      var antes = le(); grava("recusado"); caixa.remove();
      if (antes === "aceito" || carregada) location.reload();
    });
  }

  window.finditCookies = { mudarEscolha: mostraAviso };

  var escolha = le();
  if (escolha === "aceito") carregaTag();
  else if (escolha !== "recusado") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mostraAviso);
    else mostraAviso();
  }
})();
