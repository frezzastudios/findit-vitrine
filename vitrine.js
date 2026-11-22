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
  var estado = { q: "", cat: "", sub: "", ordem: "recentes", nota: 0, desejos: false, f: {}, pmin: null, pmax: null, mostrados: 0 };
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
    resumoFiltros: document.querySelector("#painel-filtros summary"),
    aplicados: document.getElementById("aplicados"),
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
  /* Departamento principal e os extras em que o produto também se encaixa
     (pedido do César em 21/11/2026: aspirador também aparece em Limpeza). */
  function paresDe(p) {
    return [[p.categoria, p.subcategoria]].concat(p.outras_categorias || []);
  }
  function unicos(lista) {
    return lista.filter(function (v, i) { return lista.indexOf(v) === i; });
  }
  function catsDe(p) { return unicos(paresDe(p).map(function (x) { return x[0]; })); }
  function subsDe(p, cat) {
    return unicos(paresDe(p).filter(function (x) { return !cat || x[0] === cat; })
      .map(function (x) { return cat ? x[1] : x[0] + "/" + x[1]; }));
  }
  function estaEm(p, cat, sub) {
    return paresDe(p).some(function (x) { return x[0] === cat && (!sub || x[1] === sub); });
  }

  function palavrasDo(p) {
    if (p._palavras) return p._palavras;
    var partes = [p.nome, p.marca, p.modelo, (p.modelo || "").replace(/[^A-Za-z0-9]/g, ""), p.resumo,
      (p.recursos || []).join(" ")];
    paresDe(p).forEach(function (x) {
      var cat = dados.categorias[x[0]] || { nome: "", sub: {} };
      partes.push(cat.nome, cat.sub[x[1]] || "");
    });
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

  /* A busca digitada vale para tudo. O nº da descoberta sozinho acha só ela. */
  function casaQ(p) {
    var q = estado.q.trim();
    if (!q) return true;
    if (/^\d+$/.test(q)) {
      var n = parseInt(q, 10);
      if (dados.produtos.some(function (o) { return o.numero === n; })) return p.numero === n;
      return casaBusca(p, [q]);
    }
    return casaBusca(p, palavrasDe(q));
  }

  /* Cada filtro é testado à parte. "sem" solta um grupo, para que esse grupo conte
     os produtos como se ele não estivesse marcado, como no Mercado Livre e na Magalu. */
  var desejosAgora = [];
  function passa(p, sem) {
    if (!casaQ(p)) return false;
    if (sem !== "cat" && estado.cat && !estaEm(p, estado.cat, sem === "sub" ? "" : estado.sub)) return false;
    if (sem !== "preco" && (estado.pmin !== null || estado.pmax !== null)) {
      if (!p.preco) return false;
      if (estado.pmin !== null && p.preco.valor < estado.pmin) return false;
      if (estado.pmax !== null && p.preco.valor > estado.pmax) return false;
    }
    if (sem !== "nota" && estado.nota && !(p.avaliacao && p.avaliacao.nota >= estado.nota)) return false;
    if (sem !== "desejos" && estado.desejos && desejosAgora.indexOf(p.numero) === -1) return false;
    return Object.keys(estado.f).every(function (nome) {
      if (nome === sem || !estado.f[nome].length) return true;
      var v = valoresDaFaceta(p, nome);
      return estado.f[nome].some(function (x) { return v.indexOf(x) !== -1; });
    });
  }

  function filtrar(sem) {
    desejosAgora = lerDesejos();
    return dados.produtos.filter(function (p) { return passa(p, sem); });
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

  function ordensDisponiveis() {
    return ORDENS.filter(function (o) {
      if (!o.precisa) return true;
      return dados.produtos.some(function (p) { return o.precisa === "preco" ? !!p.preco : !!p.avaliacao; });
    });
  }

  function montarOrdens() {
    var disponiveis = ordensDisponiveis();
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

  function departamento(icone, nome, n, ativa, aoClicar) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "departamento" + (n ? "" : " vazio");
    b.setAttribute("aria-pressed", ativa ? "true" : "false");
    b.setAttribute("aria-label", nome + (n ? " (" + n + ")" : " (em breve)"));
    var i = document.createElement("span"); i.className = "departamento-icone"; i.setAttribute("aria-hidden", "true"); i.textContent = icone || "•";
    var t = document.createElement("span"); t.className = "departamento-nome"; t.textContent = nome;
    b.append(i, t);
    b.addEventListener("click", aoClicar);
    return b;
  }

  // Setas nos cantos da faixa de departamentos (pedido do César em 21/11/2026):
  // cada clique anda quase uma tela para o lado; a seta some quando chega na ponta.
  var setas = (function () {
    var caixa = document.createElement("div");
    caixa.className = "departamentos-caixa";
    el.cats.parentNode.insertBefore(caixa, el.cats);
    caixa.appendChild(el.cats);
    function seta(lado, rotulo, simbolo) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "departamentos-seta " + lado;
      b.setAttribute("aria-label", rotulo);
      b.title = rotulo;
      b.textContent = simbolo;
      b.addEventListener("click", function () {
        var passo = Math.max(el.cats.clientWidth * 0.8, 120);
        el.cats.scrollBy({ left: lado === "esquerda" ? -passo : passo, behavior: "smooth" });
      });
      caixa.appendChild(b);
      return b;
    }
    var esq = seta("esquerda", "Ver departamentos anteriores", "‹");
    var dir = seta("direita", "Ver mais departamentos", "›");
    function atualizar() {
      var fim = el.cats.scrollWidth - el.cats.clientWidth;
      esq.hidden = el.cats.scrollLeft <= 2;
      dir.hidden = el.cats.scrollLeft >= fim - 2;
    }
    el.cats.addEventListener("scroll", atualizar, { passive: true });
    window.addEventListener("resize", atualizar);
    return atualizar;
  })();

  function montarPilulas(porCategoria) {
    var nCat = contarPor(dados.produtos, catsDe);
    el.cats.replaceChildren(departamento("✨", "Tudo", dados.produtos.length, !estado.cat, function () { mudar({ cat: "", sub: "" }); }));
    // Todos os departamentos aparecem, como na Amazon; os vazios ficam apagados até ganhar a primeira descoberta.
    Object.keys(dados.categorias).forEach(function (id) {
      var c = dados.categorias[id];
      el.cats.appendChild(departamento(c.icone, c.nome, nCat[id] || 0, estado.cat === id,
        function () { mudar({ cat: id, sub: "" }); }));
    });
    setas();
    el.subs.replaceChildren();
    el.subs.hidden = !estado.cat;
    if (!estado.cat) return;
    var subs = dados.categorias[estado.cat].sub;
    var nSub = contarPor(porCategoria, function (p) { return subsDe(p, estado.cat); });
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

  function chip(texto, n, ativa, aoClicar) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.setAttribute("aria-pressed", ativa ? "true" : "false");
    b.textContent = texto;
    if (n !== null && n !== undefined) {
      var s = document.createElement("span");
      s.className = "chip-qtd";
      s.textContent = " (" + n + ")";
      b.appendChild(s);
    }
    b.addEventListener("click", aoClicar);
    return b;
  }

  /* Grupo de opções em botões, como na Magalu. Passou de 10, o resto fica atrás de
     "Mostrar todos". */
  var LIMITE = 10;
  function grupoDeChips(titulo, itens) {
    var g = grupo(titulo);
    var caixaChips = document.createElement("div");
    caixaChips.className = "chips";
    itens.forEach(function (it, i) {
      var c = chip(it.texto, it.n, it.ativa, it.clicar);
      if (i >= LIMITE && !it.ativa) c.hidden = true;
      caixaChips.appendChild(c);
    });
    g.appendChild(caixaChips);
    if (itens.length > LIMITE) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "ver-mais";
      b.textContent = "Mostrar todos ▾";
      b.addEventListener("click", function () {
        var abrir = b.textContent.indexOf("todos") !== -1;
        caixaChips.querySelectorAll(".chip").forEach(function (c, k) {
          if (k >= LIMITE && c.getAttribute("aria-pressed") !== "true") c.hidden = !abrir;
        });
        b.textContent = abrir ? "Mostrar menos ▴" : "Mostrar todos ▾";
      });
      g.appendChild(b);
    }
    return g;
  }

  function contarPor(lista, valoresDe) {
    var c = {};
    lista.forEach(function (p) { valoresDe(p).forEach(function (v) { c[v] = (c[v] || 0) + 1; }); });
    return c;
  }

  function precoCurto(v) { return "R$ " + numeroBR(v); }

  var FAIXAS = [[null, 100], [100, 200], [200, 500], [500, 1000], [1000, 3000], [3000, 5000], [5000, null]];
  function nomeDaFaixa(min, max) {
    if (min === null) return "Até " + precoCurto(max);
    if (max === null) return "Acima de " + precoCurto(min);
    return precoCurto(min) + " a " + precoCurto(max);
  }

  function lerValor(texto) {
    var limpo = String(texto || "").replace(/[^\d,]/g, "").replace(",", ".");
    return limpo ? parseFloat(limpo) : null;
  }

  function grupoDePreco() {
    var base = filtrar("preco").filter(function (p) { return p.preco; });
    var g = grupo("Preço");
    var caixaChips = document.createElement("div");
    caixaChips.className = "chips";
    FAIXAS.forEach(function (fx) {
      var n = base.filter(function (p) {
        var v = p.preco.valor;
        return (fx[0] === null || v >= fx[0]) && (fx[1] === null || v <= fx[1]);
      }).length;
      var ativa = estado.pmin === fx[0] && estado.pmax === fx[1];
      if (!n && !ativa) return;
      caixaChips.appendChild(chip(nomeDaFaixa(fx[0], fx[1]), n, ativa, function () {
        mudar(ativa ? { pmin: null, pmax: null } : { pmin: fx[0], pmax: fx[1] });
      }));
    });
    g.appendChild(caixaChips);

    var form = document.createElement("form");
    form.className = "preco-livre";
    var min = document.createElement("input");
    var max = document.createElement("input");
    [[min, "Valor mínimo", estado.pmin], [max, "Valor máximo", estado.pmax]].forEach(function (x) {
      x[0].type = "text";
      x[0].inputMode = "decimal";
      x[0].placeholder = x[1];
      x[0].setAttribute("aria-label", x[1] + " em reais");
      if (x[2] !== null) x[0].value = numeroBR(x[2]);
    });
    var ir = document.createElement("button");
    ir.type = "submit";
    ir.className = "chip";
    ir.textContent = "Aplicar";
    form.append(min, max, ir);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var a = lerValor(min.value), b = lerValor(max.value);
      if (a !== null && b !== null && a > b) { var t = a; a = b; b = t; }
      mudar({ pmin: a, pmax: b });
    });
    g.appendChild(form);
    return g;
  }

  /* Lista do que está marcado, com um "×" em cada, como em "Filtros aplicados"
     do Mercado Livre. */
  function filtrosAplicados() {
    var itens = [];
    if (estado.cat) itens.push({ texto: dados.categorias[estado.cat].nome, tirar: { cat: "", sub: "" } });
    if (estado.sub && estado.cat) itens.push({ texto: dados.categorias[estado.cat].sub[estado.sub], tirar: { sub: "" } });
    Object.keys(estado.f).forEach(function (nome) {
      estado.f[nome].forEach(function (v) {
        var f = Object.assign({}, estado.f);
        var resto = f[nome].filter(function (x) { return x !== v; });
        if (resto.length) f[nome] = resto; else delete f[nome];
        itens.push({ texto: v, tirar: { f: f } });
      });
    });
    if (estado.pmin !== null || estado.pmax !== null) {
      itens.push({ texto: nomeDaFaixa(estado.pmin, estado.pmax), tirar: { pmin: null, pmax: null } });
    }
    if (estado.nota) itens.push({ texto: estado.nota + " ★ ou mais", tirar: { nota: 0 } });
    if (estado.desejos) itens.push({ texto: "♥ Lista de desejos", tirar: { desejos: false } });
    return itens;
  }

  function desenharAplicados(destino, comTitulo) {
    var itens = filtrosAplicados();
    destino.replaceChildren();
    destino.hidden = !itens.length;
    if (!itens.length) return 0;
    if (comTitulo) {
      var t = document.createElement("p");
      t.className = "aplicados-titulo";
      t.textContent = "Filtros aplicados";
      destino.appendChild(t);
    }
    var caixaChips = document.createElement("div");
    caixaChips.className = "chips";
    itens.forEach(function (it) {
      var c = chip(it.texto + " ×", null, true, function () { mudar(it.tirar); });
      c.setAttribute("aria-label", "Tirar o filtro " + it.texto);
      caixaChips.appendChild(c);
    });
    var limpar = document.createElement("button");
    limpar.type = "button";
    limpar.className = "ver-mais";
    limpar.textContent = "Limpar filtros";
    limpar.addEventListener("click", function () {
      mudar({ cat: "", sub: "", f: {}, pmin: null, pmax: null, nota: 0, desejos: false });
    });
    caixaChips.appendChild(limpar);
    destino.appendChild(caixaChips);
    return itens.length;
  }

  /* Coluna de filtros no modelo da Magalu e do Mercado Livre: filtros aplicados,
     ordenar, categoria, tipo de produto, marca, preço, avaliação, loja e as
     características de cada produto. Cada opção mostra quantos produtos tem. */
  function montarFacetas() {
    el.facetas.replaceChildren();

    var topo = document.createElement("div");
    topo.className = "aplicados";
    var nAplicados = desenharAplicados(topo, true);
    if (nAplicados) el.facetas.appendChild(topo);
    desenharAplicados(el.aplicados, false);
    el.resumoFiltros.textContent = nAplicados ? "Filtros (" + nAplicados + ")" : "Filtros";

    el.facetas.appendChild(grupoDeChips("Ordenar", ordensDisponiveis().map(function (o) {
      return { texto: o.nome, ativa: estado.ordem === o.id, clicar: function () { mudar({ ordem: o.id }); } };
    })));

    var nCat = contarPor(filtrar("cat"), catsDe);
    var cats = Object.keys(dados.categorias).filter(function (id) { return nCat[id] || estado.cat === id; });
    if (cats.length) {
      el.facetas.appendChild(grupoDeChips("Categoria", cats.map(function (id) {
        var ativa = estado.cat === id;
        return { texto: dados.categorias[id].nome, n: nCat[id] || 0, ativa: ativa,
          clicar: function () { mudar({ cat: ativa ? "" : id, sub: "" }); } };
      })));
    }

    var nSub = contarPor(filtrar("sub"), function (p) {
      return subsDe(p, estado.cat).map(function (v) { return estado.cat ? estado.cat + "/" + v : v; });
    });
    var subs = Object.keys(nSub);
    if (subs.length) {
      el.facetas.appendChild(grupoDeChips("Tipo de produto", subs.map(function (chave) {
        var par = chave.split("/");
        var ativa = estado.cat === par[0] && estado.sub === par[1];
        return { texto: dados.categorias[par[0]].sub[par[1]] || par[1], n: nSub[chave], ativa: ativa,
          clicar: function () { mudar(ativa ? { sub: "" } : { cat: par[0], sub: par[1] }); } };
      }).sort(function (a, b) { return a.texto.localeCompare(b.texto, "pt-BR"); })));
    }

    var nomes = ["Marca"];
    dados.produtos.forEach(function (p) {
      Object.keys(p.facetas || {}).forEach(function (k) { if (nomes.indexOf(k) === -1) nomes.push(k); });
    });

    function grupoDaFaceta(nome) {
      var contagem = contarPor(filtrar(nome), function (p) { return valoresDaFaceta(p, nome); });
      var marcados = estado.f[nome] || [];
      marcados.forEach(function (v) { if (!(v in contagem)) contagem[v] = 0; });
      var valores = Object.keys(contagem).sort(function (a, b) { return a.localeCompare(b, "pt-BR", { numeric: true }); });
      if (!valores.length) return;
      el.facetas.appendChild(grupoDeChips(nome, valores.map(function (v) {
        var ativa = marcados.indexOf(v) !== -1;
        return { texto: v, n: contagem[v], ativa: ativa, clicar: function () {
          var lista = marcados.filter(function (x) { return x !== v; });
          if (!ativa) lista.push(v);
          var f = Object.assign({}, estado.f);
          if (lista.length) f[nome] = lista; else delete f[nome];
          mudar({ f: f });
        } };
      })));
    }

    grupoDaFaceta("Marca");
    if (dados.produtos.some(function (p) { return p.preco; })) el.facetas.appendChild(grupoDePreco());

    var baseNota = filtrar("nota");
    if (baseNota.some(function (p) { return p.avaliacao; })) {
      el.facetas.appendChild(grupoDeChips("Avaliação", [4, 3, 2, 1].map(function (n) {
        var ativa = estado.nota === n;
        return { texto: n + " ★ ou mais", n: baseNota.filter(function (p) { return p.avaliacao && p.avaliacao.nota >= n; }).length,
          ativa: ativa, clicar: function () { mudar({ nota: ativa ? 0 : n }); } };
      })));
    }

    grupoDaFaceta("Loja");
    nomes.slice(1).forEach(grupoDaFaceta);

    var desejos = lerDesejos();
    if (desejos.length) {
      el.facetas.appendChild(grupoDeChips("Sua lista", [{ texto: "♥ Só a lista de desejos", n: desejos.length,
        ativa: estado.desejos, clicar: function () { mudar({ desejos: !estado.desejos }); } }]));
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
      var valorLink = document.createElement("a");
      valorLink.href = p.links[0].url;
      valorLink.target = "_blank";
      valorLink.rel = "sponsored noopener";
      valorLink.textContent = reais(p.preco.valor);
      valor.appendChild(valorLink);
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
    botao.href = p.links[0].url;
    botao.target = "_blank";
    botao.rel = "sponsored noopener";
    botao.textContent = "Comprar ↗";
    botao.setAttribute("aria-label", "Comprar " + p.nome + " (abre outro site)");
    corpo.appendChild(botao);

    li.appendChild(corpo);
    return li;
  }

  function desenhar(manterQuantos) {
    montarPilulas(dados.produtos.filter(function (p) { return estaEm(p, estado.cat, ""); }));
    montarOrdens();
    montarFacetas();
    var r = { lista: ordenar(filtrar()) };

    var total = r.lista.length;
    estado.mostrados = Math.min(total, Math.max(porPagina, manterQuantos || 0));
    el.grade.replaceChildren.apply(el.grade, r.lista.slice(0, estado.mostrados).map(cartao));
    var texto = total === 1 ? "1 resultado" : total + " resultados";
    if (total > estado.mostrados) texto = "1-" + estado.mostrados + " de " + texto;
    if (estado.q.trim()) texto += " para “" + estado.q.trim() + "”";
    el.contagem.textContent = texto;
    el.vazio.hidden = total > 0;
    if (!total) el.vazio.textContent = (estado.cat && !estado.q.trim() && !contarPor(dados.produtos, catsDe)[estado.cat])
      ? "Ainda não temos descobertas em " + dados.categorias[estado.cat].nome + ". Em breve."
      : "Nenhuma descoberta com essa busca. Tente outra palavra ou digite o nº da descoberta que aparece no vídeo.";
    el.mais.hidden = estado.mostrados >= total;
    el._lista = r.lista;
  }

  function salvarNoEndereco() {
    var params = new URLSearchParams();
    ["q", "cat", "sub"].forEach(function (k) { if (estado[k]) params.set(k, estado[k]); });
    if (estado.ordem !== "recentes") params.set("ordem", estado.ordem);
    if (estado.nota) params.set("nota", estado.nota);
    if (estado.desejos) params.set("desejos", "1");
    if (estado.pmin !== null) params.set("pmin", estado.pmin);
    if (estado.pmax !== null) params.set("pmax", estado.pmax);
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
    ["pmin", "pmax"].forEach(function (k) {
      var v = parseFloat(params.get(k));
      estado[k] = isNaN(v) ? null : v;
    });
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
    // Quando a janela passa para tamanho de computador, abre de novo: no computador o
    // título "Filtros" fica escondido e o painel fechado sumiria (visto em 20/11/2026).
    var telaGrande = window.matchMedia("(min-width: 900px)");
    if (telaGrande.matches) el.painel.open = true;
    var aoMudarTela = function (ev) { if (ev.matches) el.painel.open = true; };
    if (telaGrande.addEventListener) telaGrande.addEventListener("change", aoMudarTela);
    else if (telaGrande.addListener) telaGrande.addListener(aoMudarTela);
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
