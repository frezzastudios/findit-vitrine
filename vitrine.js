/* Vitrine da Find It: lê produtos.json e monta a lista no navegador do visitante.
   Sem servidor e sem biblioteca de fora. A busca ignora acento e maiúscula, aceita
   um erro de digitação em palavras de 4 letras ou mais, e o número sozinho acha a descoberta. */
(function () {
  "use strict";

  var ORDENS = [
    { id: "recentes", nome: "Mais recentes" },
    { id: "menor-preco", nome: "Menor preço", precisa: "preco" },
    { id: "maior-preco", nome: "Maior preço", precisa: "preco" },
    { id: "vistos", nome: "Mais vistos", precisa: "visitas" },
    { id: "avaliados", nome: "Mais bem avaliados", precisa: "avaliacao" }
  ];

  var dados = null;
  var estado = { q: "", loja: "", cat: "", sub: "", ordem: "recentes", mostrados: 0 };
  var porPagina = window.matchMedia("(min-width: 768px)").matches ? 24 : 12;

  var el = {
    campo: document.getElementById("campo-busca"),
    form: document.getElementById("busca"),
    loja: document.getElementById("filtro-loja"),
    ordem: document.getElementById("filtro-ordem"),
    cats: document.getElementById("pilulas-categoria"),
    subs: document.getElementById("pilulas-sub"),
    contagem: document.getElementById("contagem"),
    grade: document.getElementById("grade"),
    vazio: document.getElementById("vazio"),
    mais: document.getElementById("carregar-mais")
  };

  function normalizar(texto) {
    return String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }

  function numeroComZeros(n) { return String(n).padStart(3, "0"); }

  function enderecoDoProduto(p) { return "p/" + numeroComZeros(p.numero) + "-" + p.slug + "/"; }

  function dataBR(iso) {
    if (!iso) return "";
    var partes = iso.slice(0, 10).split("-");
    return partes[2] + "/" + partes[1] + "/" + partes[0];
  }

  function reais(valor) {
    return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  /* Distância de edição limitada a 1: basta saber se cabe um erro. */
  function umErro(a, b) {
    if (Math.abs(a.length - b.length) > 1) return false;
    var i = 0, j = 0, erros = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++erros > 1) return false;
      if (a.length > b.length) i++;
      else if (a.length < b.length) j++;
      else { i++; j++; }
    }
    return erros + (a.length - i) + (b.length - j) <= 1;
  }

  function palavrasDo(p) {
    if (p._palavras) return p._palavras;
    var cat = dados.categorias[p.categoria] || { nome: "", sub: {} };
    var texto = [p.nome, p.marca, p.resumo, cat.nome, cat.sub[p.subcategoria] || ""].join(" ");
    p._palavras = normalizar(texto).split(/[^a-z0-9]+/).filter(Boolean);
    return p._palavras;
  }

  function casaBusca(p, termos) {
    var palavras = palavrasDo(p);
    return termos.every(function (t) {
      return palavras.some(function (w) {
        return w.indexOf(t) === 0 || (t.length >= 4 && umErro(t, w.slice(0, t.length + 1)) ) || (t.length >= 4 && umErro(t, w));
      });
    });
  }

  function filtrar() {
    var lista = dados.produtos;
    if (estado.loja) lista = lista.filter(function (p) { return p.loja === estado.loja; });
    var porLoja = lista;
    if (estado.cat) lista = lista.filter(function (p) { return p.categoria === estado.cat; });
    var porCategoria = lista;
    if (estado.sub) lista = lista.filter(function (p) { return p.subcategoria === estado.sub; });

    var q = estado.q.trim();
    if (/^\d+$/.test(q)) {
      lista = lista.filter(function (p) { return p.numero === parseInt(q, 10); });
    } else if (q) {
      var termos = normalizar(q).split(/[^a-z0-9]+/).filter(Boolean);
      lista = lista.filter(function (p) { return casaBusca(p, termos); });
    }
    return { lista: ordenar(lista.slice()), porLoja: porLoja, porCategoria: porCategoria };
  }

  function valorDaOrdem(p, ordem) {
    if (ordem === "menor-preco" || ordem === "maior-preco") return p.preco ? p.preco.valor : null;
    if (ordem === "vistos") return typeof p.visitas === "number" ? p.visitas : null;
    if (ordem === "avaliados") return p.avaliacao ? p.avaliacao.nota : null;
    return null;
  }

  function ordenar(lista) {
    var ordem = estado.ordem;
    return lista.sort(function (a, b) {
      if (ordem !== "recentes") {
        var va = valorDaOrdem(a, ordem), vb = valorDaOrdem(b, ordem);
        if (va === null && vb !== null) return 1;
        if (vb === null && va !== null) return -1;
        if (va !== null && vb !== null && va !== vb) {
          return ordem === "menor-preco" ? va - vb : vb - va;
        }
      }
      var ea = a.entrada || "", eb = b.entrada || "";
      if (ea !== eb) return ea < eb ? 1 : -1;
      return b.numero - a.numero;
    });
  }

  function opcao(valor, texto) {
    var o = document.createElement("option");
    o.value = valor;
    o.textContent = texto;
    return o;
  }

  function montarLojas() {
    el.loja.replaceChildren(opcao("", "Todas as lojas"));
    Object.keys(dados.lojas).forEach(function (id) {
      if (dados.produtos.some(function (p) { return p.loja === id; })) {
        el.loja.appendChild(opcao(id, dados.lojas[id].rotulo));
      }
    });
    el.loja.value = estado.loja;
  }

  /* Ordem de preço só aparece quando há preço à mostra no recorte atual;
     na loja com o preço desligado, ela some. O mesmo vale para visitas e nota. */
  function montarOrdens(porLoja) {
    var disponiveis = ORDENS.filter(function (o) {
      if (!o.precisa) return true;
      return porLoja.some(function (p) {
        if (o.precisa === "preco") return !!p.preco;
        if (o.precisa === "visitas") return typeof p.visitas === "number";
        return !!p.avaliacao;
      });
    });
    if (!disponiveis.some(function (o) { return o.id === estado.ordem; })) estado.ordem = "recentes";
    el.ordem.replaceChildren.apply(el.ordem, disponiveis.map(function (o) { return opcao(o.id, o.nome); }));
    el.ordem.value = estado.ordem;
  }

  function pilula(texto, ativa, aoClicar) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "pilula";
    b.textContent = texto;
    b.setAttribute("aria-pressed", ativa ? "true" : "false");
    b.addEventListener("click", aoClicar);
    return b;
  }

  function contar(lista, campo) {
    var c = {};
    lista.forEach(function (p) { c[p[campo]] = (c[p[campo]] || 0) + 1; });
    return c;
  }

  function montarPilulas(porLoja, porCategoria) {
    var nCat = contar(porLoja, "categoria");
    if (estado.cat && !nCat[estado.cat]) { estado.cat = ""; estado.sub = ""; }
    el.cats.replaceChildren(pilula("Tudo", !estado.cat, function () { mudar({ cat: "", sub: "" }); }));
    Object.keys(dados.categorias).forEach(function (id) {
      if (!nCat[id]) return;
      el.cats.appendChild(pilula(dados.categorias[id].nome + " (" + nCat[id] + ")", estado.cat === id,
        function () { mudar({ cat: id, sub: "" }); }));
    });

    el.subs.replaceChildren();
    el.subs.hidden = !estado.cat;
    if (!estado.cat) return;
    var subs = dados.categorias[estado.cat].sub;
    var nSub = contar(porCategoria, "subcategoria");
    if (estado.sub && !nSub[estado.sub]) estado.sub = "";
    el.subs.appendChild(pilula("Toda a categoria", !estado.sub, function () { mudar({ sub: "" }); }));
    Object.keys(subs).forEach(function (id) {
      if (!nSub[id]) return;
      el.subs.appendChild(pilula(subs[id] + " (" + nSub[id] + ")", estado.sub === id,
        function () { mudar({ sub: id }); }));
    });
  }

  function cartao(p) {
    var loja = dados.lojas[p.loja];
    var li = document.createElement("li");
    li.className = "cartao-produto";

    var linkFoto = document.createElement("a");
    linkFoto.href = enderecoDoProduto(p);
    linkFoto.className = "foto";
    linkFoto.tabIndex = -1;
    linkFoto.setAttribute("aria-hidden", "true");
    if (p.foto) {
      var img = document.createElement("img");
      img.src = p.foto;
      img.alt = "";
      img.loading = "lazy";
      img.width = 400;
      img.height = 400;
      linkFoto.appendChild(img);
    }
    li.appendChild(linkFoto);

    var corpo = document.createElement("div");
    corpo.className = "corpo";

    var etiquetas = document.createElement("p");
    etiquetas.className = "etiquetas";
    var n = document.createElement("span");
    n.className = "etiqueta";
    n.textContent = "Descoberta nº " + numeroComZeros(p.numero);
    etiquetas.appendChild(n);
    if (p.status === "rascunho") {
      var r = document.createElement("span");
      r.className = "etiqueta rascunho";
      r.textContent = "Rascunho";
      etiquetas.appendChild(r);
    }
    corpo.appendChild(etiquetas);

    var h2 = document.createElement("h2");
    var linkNome = document.createElement("a");
    linkNome.href = enderecoDoProduto(p);
    linkNome.textContent = p.nome;
    h2.appendChild(linkNome);
    corpo.appendChild(h2);

    var resumo = document.createElement("p");
    resumo.className = "resumo";
    resumo.textContent = p.resumo;
    corpo.appendChild(resumo);

    var info = document.createElement("p");
    info.className = "info";
    var partes = [loja.rotulo];
    if (p.preco) partes.push(reais(p.preco.valor) + " em " + dataBR(p.preco.data));
    info.textContent = partes.join(" · ");
    corpo.appendChild(info);

    var botao = document.createElement("a");
    botao.className = "botao-loja";
    if (p.links.length === 1) {
      botao.href = p.links[0].url;
      botao.target = "_blank";
      botao.rel = "sponsored noopener";
      botao.textContent = loja.texto_botao + " ↗";
      botao.setAttribute("aria-label", loja.texto_botao + ": " + p.nome + " (abre outro site)");
    } else {
      botao.href = enderecoDoProduto(p) + "#comprar";
      botao.textContent = "Escolher: " + p.links.map(function (l) { return l.rotulo; }).join(" ou ");
    }
    corpo.appendChild(botao);

    li.appendChild(corpo);
    return li;
  }

  function desenhar(manterQuantos) {
    var r = filtrar();
    montarOrdens(r.porLoja);
    montarPilulas(r.porLoja, r.porCategoria);
    r = filtrar();

    var total = r.lista.length;
    estado.mostrados = Math.min(total, Math.max(porPagina, manterQuantos || 0));
    el.grade.replaceChildren.apply(el.grade, r.lista.slice(0, estado.mostrados).map(cartao));
    el.contagem.textContent = total === 1 ? "1 descoberta" : total + " descobertas";
    el.vazio.hidden = total > 0;
    el.mais.hidden = estado.mostrados >= total;
    el._lista = r.lista;
  }

  function salvarNoEndereco() {
    var params = new URLSearchParams();
    ["q", "loja", "cat", "sub"].forEach(function (k) { if (estado[k]) params.set(k, estado[k]); });
    if (estado.ordem !== "recentes") params.set("ordem", estado.ordem);
    var busca = params.toString();
    history.replaceState(null, "", busca ? "?" + busca : location.pathname);
  }

  function mudar(novo) {
    Object.keys(novo).forEach(function (k) { estado[k] = novo[k]; });
    salvarNoEndereco();
    desenhar();
  }

  function lerDoEndereco() {
    var params = new URLSearchParams(location.search);
    ["q", "loja", "cat", "sub", "ordem"].forEach(function (k) { if (params.get(k)) estado[k] = params.get(k); });
    if (estado.loja && !dados.lojas[estado.loja]) estado.loja = "";
    if (estado.cat && !dados.categorias[estado.cat]) { estado.cat = ""; estado.sub = ""; }
    el.campo.value = estado.q;
  }

  function ligarEventos() {
    el.campo.addEventListener("input", function () { mudar({ q: el.campo.value }); });
    el.form.addEventListener("submit", function (e) {
      e.preventDefault();
      var lista = el._lista || [];
      if (/^\d+$/.test(estado.q.trim()) && lista.length === 1) location.href = enderecoDoProduto(lista[0]);
    });
    el.loja.addEventListener("change", function () { mudar({ loja: el.loja.value }); });
    el.ordem.addEventListener("change", function () { mudar({ ordem: el.ordem.value }); });
    el.mais.addEventListener("click", function () { desenhar(estado.mostrados + porPagina); });
  }

  fetch("produtos.json")
    .then(function (r) { return r.json(); })
    .then(function (json) {
      dados = json;
      lerDoEndereco();
      montarLojas();
      ligarEventos();
      desenhar();
    })
    .catch(function () {
      el.contagem.textContent = "Não foi possível carregar as descobertas. Recarregue a página.";
    });
})();
