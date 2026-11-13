/* Vitrine da Find It: lê produtos.json e monta a lista no navegador do visitante.
   Sem servidor e sem biblioteca de fora. Busca no modelo da Amazon (pedido do César
   em 13/11/2026): caixa "Todos" com as categorias ao lado do campo, filtros do lado
   (no celular, numa gaveta) e "Classificar por".
   A busca ignora acento e maiúscula, aceita um erro de digitação em palavras de
   4 letras ou mais, entende medida com ou sem espaço ("40 cm" = "40cm", "220 v" = "220v"),
   código de modelo ("vsp-40") e o nº da descoberta sozinho. */
(function () {
  "use strict";

  var ORDENS = [
    { id: "recentes", nome: "Mais recentes" },
    { id: "avaliados", nome: "Avaliação média", precisa: "avaliacao" },
    { id: "avaliacoes", nome: "Mais avaliados", precisa: "avaliacao" },
    { id: "menor-preco", nome: "Preço: do menor para o maior", precisa: "preco" },
    { id: "maior-preco", nome: "Preço: do maior para o menor", precisa: "preco" }
  ];
  var CHAVE_DESEJOS = "findit-desejos";

  var dados = null;
  var estado = { q: "", cat: "", sub: "", ordem: "recentes", nota: 0, desejos: false, f: {}, mostrados: 0 };
  var porPagina = window.matchMedia("(min-width: 768px)").matches ? 24 : 12;

  var el = {
    campo: document.getElementById("campo-busca"),
    form: document.getElementById("busca"),
    buscaCat: document.getElementById("busca-cat"),
    ordem: document.getElementById("filtro-ordem"),
    cats: document.getElementById("pilulas-categoria"),
    subs: document.getElementById("pilulas-sub"),
    facetas: document.getElementById("facetas"),
    painel: document.getElementById("painel-filtros"),
    contagem: document.getElementById("contagem"),
    grade: document.getElementById("grade"),
    vazio: document.getElementById("vazio"),
    mais: document.getElementById("carregar-mais")
  };

  function lerDesejos() {
    try { return JSON.parse(localStorage.getItem(CHAVE_DESEJOS) || "[]"); } catch (e) { return []; }
  }

  function normalizar(texto) {
    return String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/(\d),(\d)/g, "$1.$2")
      // junta número e unidade: "40 cm" vira "40cm", "220 v" vira "220v"
      .replace(/(\d)\s+(cm|mm|m|v|w|kg|g|l|ml|pol|polegadas|a|kwh)\b/g, "$1$2");
  }

  function palavrasDe(texto) { return normalizar(texto).split(/[^a-z0-9.]+/).filter(Boolean); }

  function numeroComZeros(n) { return String(n).padStart(3, "0"); }
  function enderecoDoProduto(p) { return "p/" + numeroComZeros(p.numero) + "-" + p.slug + "/"; }

  function dataBR(iso) {
    if (!iso) return "";
    var partes = iso.slice(0, 10).split("-");
    return partes[2] + "/" + partes[1] + "/" + partes[0];
  }
  function reais(valor) { return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
  function numeroBR(v, casas) { return v.toLocaleString("pt-BR", { minimumFractionDigits: casas || 0, maximumFractionDigits: casas || 0 }); }

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

  /* Tudo o que a busca enxerga: nome, marca, modelo, resumo, categoria, recursos,
     especificações e variações. */
  function palavrasDo(p) {
    if (p._palavras) return p._palavras;
    var cat = dados.categorias[p.categoria] || { nome: "", sub: {} };
    var partes = [p.nome, p.marca, p.modelo, (p.modelo || "").replace(/[^A-Za-z0-9]/g, ""), p.resumo,
      cat.nome, cat.sub[p.subcategoria] || "", (p.recursos || []).join(" ")];
    (p.especificacoes || []).forEach(function (par) { partes.push(par[0], par[1]); });
    (p.variacoes || []).forEach(function (v) { partes.push(v[0], v[1].join(" ")); });
    p._palavras = palavrasDe(partes.join(" "));
    return p._palavras;
  }

  function casaTermo(t, palavras) {
    return palavras.some(function (w) {
      if (w.indexOf(t) === 0) return true;
      if (/\d/.test(t)) return false;           // número e medida têm de bater certo
      return t.length >= 4 && (umErro(t, w) || umErro(t, w.slice(0, t.length + 1)));
    });
  }

  /* Plural simples: "ventiladores" acha "ventilador", "pás" acha "pá". */
  function variantes(t) {
    var v = [t];
    if (/[a-z]{4,}es$/.test(t)) v.push(t.slice(0, -2));
    if (/[a-z]{3,}s$/.test(t)) v.push(t.slice(0, -1));
    return v;
  }

  function casaBusca(p, termos) {
    var palavras = palavrasDo(p);
    return termos.every(function (t) {
      return variantes(t).some(function (x) { return casaTermo(x, palavras); });
    });
  }

  function valoresDaFaceta(p, nome) {
    if (nome === "Loja") return [dados.lojas[p.loja].rotulo];
    return (p.facetas && p.facetas[nome]) || [];
  }

  function filtrar(semFaceta) {
    var lista = dados.produtos;
    if (estado.cat) lista = lista.filter(function (p) { return p.categoria === estado.cat; });
    var porCategoria = lista;
    if (estado.sub) lista = lista.filter(function (p) { return p.subcategoria === estado.sub; });

    var q = estado.q.trim();
    if (/^\d+$/.test(q)) {
      var n = parseInt(q, 10);
      var porNumero = lista.filter(function (p) { return p.numero === n; });
      lista = porNumero.length ? porNumero : lista.filter(function (p) { return casaBusca(p, [q]); });
    } else if (q) {
      var termos = palavrasDe(q);
      lista = lista.filter(function (p) { return casaBusca(p, termos); });
    }
    var antesDasFacetas = lista;

    if (estado.nota) lista = lista.filter(function (p) { return p.avaliacao && p.avaliacao.nota >= estado.nota; });
    if (estado.desejos) {
      var desejos = lerDesejos();
      lista = lista.filter(function (p) { return desejos.indexOf(p.numero) !== -1; });
    }
    Object.keys(estado.f).forEach(function (nome) {
      if (nome === semFaceta || !estado.f[nome].length) return;
      lista = lista.filter(function (p) {
        var v = valoresDaFaceta(p, nome);
        return estado.f[nome].some(function (x) { return v.indexOf(x) !== -1; });
      });
    });
    return { lista: ordenar(lista.slice()), porCategoria: porCategoria, antesDasFacetas: antesDasFacetas };
  }

  function valorDaOrdem(p, ordem) {
    if (ordem === "menor-preco" || ordem === "maior-preco") return p.preco ? p.preco.valor : null;
    if (ordem === "avaliados") return p.avaliacao ? p.avaliacao.nota : null;
    if (ordem === "avaliacoes") return p.avaliacao ? p.avaliacao.total : null;
    return null;
  }

  function ordenar(lista) {
    var ordem = estado.ordem;
    return lista.sort(function (a, b) {
      if (ordem !== "recentes") {
        var va = valorDaOrdem(a, ordem), vb = valorDaOrdem(b, ordem);
        if (va === null && vb !== null) return 1;
        if (vb === null && va !== null) return -1;
        if (va !== null && vb !== null && va !== vb) return ordem === "menor-preco" ? va - vb : vb - va;
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

  function montarBuscaCat() {
    Object.keys(dados.categorias).forEach(function (id) {
      el.buscaCat.appendChild(opcao(id, dados.categorias[id].nome));
    });
    el.buscaCat.value = estado.cat;
  }

  function montarOrdens(base) {
    var disponiveis = ORDENS.filter(function (o) {
      if (!o.precisa) return true;
      return base.some(function (p) { return o.precisa === "preco" ? !!p.preco : !!p.avaliacao; });
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

  function montarPilulas(porCategoria) {
    var nCat = contar(dados.produtos, "categoria");
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
    el.subs.appendChild(pilula("Toda a categoria", !estado.sub, function () { mudar({ sub: "" }); }));
    Object.keys(subs).forEach(function (id) {
      if (!nSub[id]) return;
      el.subs.appendChild(pilula(subs[id] + " (" + nSub[id] + ")", estado.sub === id,
        function () { mudar({ sub: id }); }));
    });
  }

  function grupo(titulo) {
    var g = document.createElement("fieldset");
    g.className = "faceta";
    var l = document.createElement("legend");
    l.textContent = titulo;
    g.appendChild(l);
    return g;
  }

  function caixa(texto, marcada, aoMudar) {
    var label = document.createElement("label");
    var c = document.createElement("input");
    c.type = "checkbox";
    c.checked = marcada;
    c.addEventListener("change", function () { aoMudar(c.checked); });
    label.appendChild(c);
    label.appendChild(document.createTextNode(" " + texto));
    return label;
  }

  /* Filtros do lado, como na Amazon: cada grupo mostra só os valores que existem
     nos resultados, com a quantidade. */
  function montarFacetas(base) {
    el.facetas.replaceChildren();

    if (base.some(function (p) { return p.avaliacao; })) {
      var gn = grupo("Avaliação do cliente");
      [4, 3].forEach(function (n) {
        var qtd = base.filter(function (p) { return p.avaliacao && p.avaliacao.nota >= n; }).length;
        if (!qtd) return;
        gn.appendChild(caixa("★".repeat(n) + "☆".repeat(5 - n) + " e mais (" + qtd + ")", estado.nota === n,
          function (on) { mudar({ nota: on ? n : 0 }); }));
      });
      el.facetas.appendChild(gn);
    }

    var nomes = ["Loja"];
    base.forEach(function (p) {
      Object.keys(p.facetas || {}).forEach(function (k) { if (nomes.indexOf(k) === -1) nomes.push(k); });
    });
    nomes.forEach(function (nome) {
      var contagem = {};
      filtrar(nome).antesDasFacetas.forEach(function (p) {
        valoresDaFaceta(p, nome).forEach(function (v) { contagem[v] = (contagem[v] || 0) + 1; });
      });
      var valores = Object.keys(contagem).sort();
      if (!valores.length) return;
      var g = grupo(nome);
      var marcados = estado.f[nome] || [];
      valores.forEach(function (v, i) {
        var label = caixa(v + " (" + contagem[v] + ")", marcados.indexOf(v) !== -1, function (on) {
          var lista = (estado.f[nome] || []).filter(function (x) { return x !== v; });
          if (on) lista.push(v);
          var f = Object.assign({}, estado.f);
          if (lista.length) f[nome] = lista; else delete f[nome];
          mudar({ f: f });
        });
        if (i >= 6) label.hidden = true;
        g.appendChild(label);
      });
      if (valores.length > 6) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "ver-mais";
        b.textContent = "Ver mais ▾";
        b.addEventListener("click", function () {
          var abrir = b.textContent.indexOf("mais") !== -1;
          g.querySelectorAll("label").forEach(function (l, k) { if (k >= 6) l.hidden = !abrir; });
          b.textContent = abrir ? "Ver menos ▴" : "Ver mais ▾";
        });
        g.appendChild(b);
      }
      el.facetas.appendChild(g);
    });

    var desejos = lerDesejos();
    if (desejos.length) {
      var gd = grupo("Sua lista");
      gd.appendChild(caixa("♥ Só a lista de desejos (" + desejos.length + ")", estado.desejos,
        function (on) { mudar({ desejos: on }); }));
      el.facetas.appendChild(gd);
    }
  }

  function estrelas(nota) {
    var s = document.createElement("span");
    s.className = "estrelas";
    s.setAttribute("role", "img");
    s.setAttribute("aria-label", numeroBR(nota, 1) + " de 5 estrelas");
    var dentro = document.createElement("span");
    dentro.style.width = Math.round(nota / 5 * 100) + "%";
    s.appendChild(dentro);
    return s;
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

    if (p.avaliacao) {
      var nota = document.createElement("p");
      nota.className = "nota-linha";
      var forte = document.createElement("strong");
      forte.textContent = numeroBR(p.avaliacao.nota, 1);
      nota.appendChild(forte);
      nota.appendChild(document.createTextNode(" "));
      nota.appendChild(estrelas(p.avaliacao.nota));
      var qtd = document.createElement("span");
      qtd.textContent = " (" + numeroBR(p.avaliacao.total) + ")";
      nota.appendChild(qtd);
      corpo.appendChild(nota);
    }

    var resumo = document.createElement("p");
    resumo.className = "resumo";
    resumo.textContent = p.resumo;
    corpo.appendChild(resumo);

    if (p.preco) {
      var preco = document.createElement("p");
      preco.className = "preco-cartao";
      var valor = document.createElement("strong");
      valor.textContent = reais(p.preco.valor);
      preco.appendChild(valor);
      var quando = document.createElement("span");
      quando.textContent = "Último preço visto em " + dataBR(p.preco.data) + " na " + loja.rotulo;
      preco.appendChild(quando);
      corpo.appendChild(preco);
    } else {
      var info = document.createElement("p");
      info.className = "info";
      info.textContent = loja.rotulo;
      corpo.appendChild(info);
    }

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
    montarPilulas(r.porCategoria);
    montarOrdens(r.antesDasFacetas);
    montarFacetas(r.antesDasFacetas);
    r = filtrar();

    var total = r.lista.length;
    estado.mostrados = Math.min(total, Math.max(porPagina, manterQuantos || 0));
    el.grade.replaceChildren.apply(el.grade, r.lista.slice(0, estado.mostrados).map(cartao));
    var texto = total === 1 ? "1 resultado" : total + " resultados";
    if (total > estado.mostrados) texto = "1-" + estado.mostrados + " de " + texto;
    if (estado.q.trim()) texto += " para “" + estado.q.trim() + "”";
    el.contagem.textContent = texto;
    el.vazio.hidden = total > 0;
    el.mais.hidden = estado.mostrados >= total;
    el._lista = r.lista;
  }

  function salvarNoEndereco() {
    var params = new URLSearchParams();
    ["q", "cat", "sub"].forEach(function (k) { if (estado[k]) params.set(k, estado[k]); });
    if (estado.ordem !== "recentes") params.set("ordem", estado.ordem);
    if (estado.nota) params.set("nota", estado.nota);
    if (estado.desejos) params.set("desejos", "1");
    Object.keys(estado.f).forEach(function (nome) { params.set("f." + nome, estado.f[nome].join("|")); });
    var busca = params.toString();
    history.replaceState(null, "", busca ? "?" + busca : location.pathname);
  }

  function mudar(novo) {
    Object.keys(novo).forEach(function (k) { estado[k] = novo[k]; });
    if ("cat" in novo) el.buscaCat.value = estado.cat;
    salvarNoEndereco();
    desenhar();
  }

  function lerDoEndereco() {
    var params = new URLSearchParams(location.search);
    ["q", "cat", "sub", "ordem"].forEach(function (k) { if (params.get(k)) estado[k] = params.get(k); });
    estado.nota = parseInt(params.get("nota"), 10) || 0;
    estado.desejos = params.get("desejos") === "1";
    params.forEach(function (v, k) { if (k.indexOf("f.") === 0 && v) estado.f[k.slice(2)] = v.split("|"); });
    // Endereço antigo com ?loja= continua funcionando como filtro de loja.
    var lojaAntiga = params.get("loja");
    if (lojaAntiga && dados.lojas[lojaAntiga]) estado.f.Loja = [dados.lojas[lojaAntiga].rotulo];
    if (estado.cat && !dados.categorias[estado.cat]) { estado.cat = ""; estado.sub = ""; }
    el.campo.value = estado.q;
  }

  function ligarEventos() {
    el.campo.addEventListener("input", function () { mudar({ q: el.campo.value }); });
    el.buscaCat.addEventListener("change", function () { mudar({ cat: el.buscaCat.value, sub: "" }); });
    el.form.addEventListener("submit", function (e) {
      e.preventDefault();
      var lista = el._lista || [];
      if (/^\d+$/.test(estado.q.trim()) && lista.length === 1 && lista[0].numero === parseInt(estado.q, 10)) {
        location.href = enderecoDoProduto(lista[0]);
      }
    });
    el.ordem.addEventListener("change", function () { mudar({ ordem: el.ordem.value }); });
    el.mais.addEventListener("click", function () { desenhar(estado.mostrados + porPagina); });
    // Filtros abertos no computador; no celular ficam fechados na gaveta.
    if (window.matchMedia("(min-width: 900px)").matches) el.painel.open = true;
  }

  fetch("produtos.json")
    .then(function (r) { return r.json(); })
    .then(function (json) {
      dados = json;
      lerDoEndereco();
      montarBuscaCat();
      ligarEventos();
      desenhar();
    })
    .catch(function () {
      el.contagem.textContent = "Não foi possível carregar as descobertas. Recarregue a página.";
    });
})();
