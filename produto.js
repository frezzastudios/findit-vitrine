/* Página do produto, no modelo da Amazon (pedido do César em 13/11/2026):
   lista de desejos (coração), compartilhar, "Ver mais / Ver menos" e
   "Pesquisar nesta página". A lista de desejos fica guardada só no aparelho de quem visita. */
(function () {
  "use strict";

  var CHAVE = "findit-desejos";

  function lerDesejos() {
    try { return JSON.parse(localStorage.getItem(CHAVE) || "[]"); } catch (e) { return []; }
  }
  function gravarDesejos(lista) {
    try { localStorage.setItem(CHAVE, JSON.stringify(lista)); } catch (e) { /* sem armazenamento: segue sem guardar */ }
  }

  document.querySelectorAll("[data-desejo]").forEach(function (b) {
    var n = parseInt(b.getAttribute("data-desejo"), 10);
    function pintar() {
      var dentro = lerDesejos().indexOf(n) !== -1;
      b.setAttribute("aria-pressed", dentro ? "true" : "false");
      b.firstElementChild.textContent = dentro ? "♥" : "♡";
      b.lastChild.textContent = dentro ? " Na lista de desejos" : " Lista de desejos";
    }
    b.addEventListener("click", function () {
      var lista = lerDesejos();
      var i = lista.indexOf(n);
      if (i === -1) lista.push(n); else lista.splice(i, 1);
      gravarDesejos(lista);
      pintar();
    });
    pintar();
  });

  document.querySelectorAll("[data-compartilhar]").forEach(function (b) {
    b.addEventListener("click", function () {
      var dados = { title: document.title, url: location.href.split("#")[0] };
      if (navigator.share) { navigator.share(dados).catch(function () {}); return; }
      var texto = b.lastChild;
      function avisar(msg) { var antes = texto.textContent; texto.textContent = msg; setTimeout(function () { texto.textContent = antes; }, 2000); }
      if (navigator.clipboard) {
        navigator.clipboard.writeText(dados.url).then(function () { avisar(" Link copiado"); }, function () { avisar(" Copie o endereço da página"); });
      } else {
        avisar(" Copie o endereço da página");
      }
    });
  });

  document.querySelectorAll("[data-ver-mais]").forEach(function (lista) {
    var limite = parseInt(lista.getAttribute("data-ver-mais"), 10);
    var itens = lista.children;
    if (itens.length <= limite) return;
    var botao = document.createElement("button");
    botao.type = "button";
    botao.className = "ver-mais";
    var aberto = false;
    function aplicar() {
      for (var i = limite; i < itens.length; i++) itens[i].hidden = !aberto;
      botao.textContent = aberto ? "Ver menos ▴" : "Ver mais ▾";
      botao.setAttribute("aria-expanded", aberto ? "true" : "false");
    }
    botao.addEventListener("click", function () { aberto = !aberto; aplicar(); });
    lista.after(botao);
    aplicar();
  });

  function normalizar(t) { return String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }

  document.querySelectorAll("[data-pesquisar-pagina]").forEach(function (form) {
    var campo = form.querySelector("input");
    var saida = form.querySelector(".pesquisar-resultado");
    var achados = [], atual = -1, ultimo = "";
    function limpar() {
      document.querySelectorAll("mark.achado").forEach(function (m) { m.replaceWith(document.createTextNode(m.textContent)); });
      document.querySelectorAll("main").forEach(function (m) { m.normalize(); });
      achados = []; atual = -1;
    }
    function marcar(termo) {
      var alvo = normalizar(termo);
      var andador = document.createTreeWalker(document.querySelector("main"), NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) {
          if (!n.nodeValue.trim() || n.parentElement.closest("form, script, .galeria-miniaturas")) return NodeFilter.FILTER_REJECT;
          return normalizar(n.nodeValue).indexOf(alvo) !== -1 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      });
      var nos = [];
      while (andador.nextNode()) nos.push(andador.currentNode);
      nos.forEach(function (no) {
        var i = normalizar(no.nodeValue).indexOf(alvo);
        var resto = no.splitText(i);
        resto.splitText(termo.length);
        var m = document.createElement("mark");
        m.className = "achado";
        m.textContent = resto.nodeValue;
        resto.replaceWith(m);
        achados.push(m);
      });
    }
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var termo = campo.value.trim();
      if (termo !== ultimo) {
        limpar(); ultimo = termo;
        if (termo.length < 2) { saida.textContent = ""; return; }
        marcar(termo);
      }
      if (!achados.length) { saida.textContent = "Nada encontrado nesta página."; return; }
      atual = (atual + 1) % achados.length;
      var m = achados[atual];
      var escondido = m.closest("[hidden]");
      if (escondido) { var btn = escondido.parentElement.nextElementSibling; if (btn && btn.classList.contains("ver-mais")) btn.click(); }
      achados.forEach(function (a, k) { a.classList.toggle("atual", k === atual); });
      m.scrollIntoView({ behavior: "smooth", block: "center" });
      saida.textContent = (atual + 1) + " de " + achados.length + (achados.length > 1 ? " · Enter para o próximo" : "");
    });
  });
})();
