// src/routes/query.js
// Traduz a query string da requisicao nos filtros do storage.

const config = require("../config");
const { ESPORTES, ESTADOS } = require("../collector/taxonomy");
const { semAcento } = require("../util/text");

const IDS_ESPORTE = new Set(ESPORTES.map((e) => e.id));
const UFS = new Set(ESTADOS.map((e) => e.uf));
const STATUS = new Set(["aberta", "encerrada", "indefinida"]);
const GENEROS = new Set(["masculino", "feminino", "misto"]);
const ORDENACOES = new Set(["recentes", "antigos", "evento", "prazo", "confianca"]);

// Apelidos aceitos na query, para o front nao precisar saber os ids internos.
const APELIDOS_ESPORTE = {
  volei: "voleibol",
  voleibol: "voleibol",
  "volei-de-praia": "volei-de-praia",
  voleidepraia: "volei-de-praia",
  basket: "basquete",
  basquetebol: "basquete",
  "futebol-de-salao": "futsal",
  salao: "futsal",
  "table-tennis": "tenis-de-mesa",
  pingpong: "tenis-de-mesa",
  tenismesa: "tenis-de-mesa",
  "tenis-mesa": "tenis-de-mesa",
};

function multi(valor) {
  if (valor == null) return [];
  const bruto = Array.isArray(valor) ? valor : [valor];
  return bruto
    .flatMap((v) => String(v).split(","))
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizarEsporte(v) {
  const s = semAcento(v).replace(/\s+/g, "-");
  const alvo = APELIDOS_ESPORTE[s] || s;
  return IDS_ESPORTE.has(alvo) ? alvo : null;
}

function normalizarCategoria(v) {
  const m = semAcento(v).match(/(\d{1,2})/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 5 && n <= 23 ? `sub-${n}` : null;
}

function dataIso(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // dd/mm/aaaa
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function boolOuNulo(v) {
  if (v == null || v === "") return null;
  if (/^(1|true|sim|yes)$/i.test(String(v))) return true;
  if (/^(0|false|nao|não|no)$/i.test(String(v))) return false;
  return null;
}

function inteiro(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

/**
 * @returns {{ filtros: object, paginacao: object, avisos: string[] }}
 */
function montarFiltros(q) {
  const avisos = [];
  const filtros = {};

  const esportes = multi(q.esporte ?? q.esportes ?? q.modalidade);
  if (esportes.length) {
    const validos = [];
    for (const e of esportes) {
      const id = normalizarEsporte(e);
      if (id) validos.push(id);
      else avisos.push(`esporte desconhecido ignorado: ${e}`);
    }
    if (validos.length) filtros.esporte = [...new Set(validos)];
  }

  const ufs = multi(q.uf ?? q.estado);
  if (ufs.length) {
    const validos = [];
    for (const u of ufs) {
      const sigla = String(u).trim().toUpperCase();
      if (UFS.has(sigla)) validos.push(sigla);
      else {
        const achado = ESTADOS.find((e) => semAcento(e.nome) === semAcento(u));
        if (achado) validos.push(achado.uf);
        else avisos.push(`estado desconhecido ignorado: ${u}`);
      }
    }
    if (validos.length) filtros.uf = [...new Set(validos)];
  }

  const categorias = multi(q.categoria ?? q.categorias ?? q.sub);
  if (categorias.length) {
    const validas = categorias.map(normalizarCategoria).filter(Boolean);
    if (validas.length) filtros.categoria = [...new Set(validas)];
    else avisos.push("nenhuma categoria valida em 'categoria' (use sub-17, 17, etc.)");
  }

  const status = multi(q.status).map((s) => semAcento(s));
  if (status.length) {
    const validos = status.filter((s) => STATUS.has(s));
    if (validos.length) filtros.status = validos;
    else avisos.push("status invalido (use aberta, encerrada ou indefinida)");
  }

  const generos = multi(q.genero ?? q.sexo).map((g) => semAcento(g));
  if (generos.length) {
    const validos = generos.filter((g) => GENEROS.has(g));
    if (validos.length) filtros.genero = validos;
    else avisos.push("genero invalido (use masculino, feminino ou misto)");
  }

  if (q.cidade) filtros.cidade = String(q.cidade).slice(0, 80);
  if (q.clube) filtros.clube = String(q.clube).slice(0, 80);
  if (q.q ?? q.busca) filtros.q = String(q.q ?? q.busca).slice(0, 120);

  const fontes = multi(q.fonte ?? q.fontes);
  if (fontes.length) filtros.fonte = fontes.slice(0, 20);

  const gratuita = boolOuNulo(q.gratuita ?? q.gratis);
  if (gratuita !== null) filtros.gratuita = gratuita;

  const acionavel = boolOuNulo(q.acionavel ?? q.comContato);
  if (acionavel !== null) filtros.acionavel = acionavel;

  const taxaMax = Number(q.taxaMax ?? q.taxa_max);
  if (Number.isFinite(taxaMax) && taxaMax >= 0) filtros.taxaMax = taxaMax;

  const ano = inteiro(q.anoNascimento ?? q.ano_nascimento ?? q.ano, 1990, new Date().getUTCFullYear());
  if (ano !== null) filtros.anoNascimento = ano;

  const desde = dataIso(q.desde ?? q.de);
  if (desde) filtros.desde = desde;
  const ate = dataIso(q.ate ?? q.até);
  if (ate) filtros.ate = ate;
  const publicadoDesde = dataIso(q.publicadoDesde ?? q.publicado_desde);
  if (publicadoDesde) filtros.publicadoDesde = `${publicadoDesde}T00:00:00Z`;

  const confiancaMin = inteiro(q.confiancaMin ?? q.confianca_min, 0, 100);
  if (confiancaMin !== null) filtros.confiancaMin = confiancaMin;

  if (q.ordenar && ORDENACOES.has(String(q.ordenar))) filtros.ordenar = String(q.ordenar);
  else if (q.ordenar) avisos.push(`ordenacao invalida: ${q.ordenar}`);

  if (boolOuNulo(q.incluirTexto ?? q.incluir_texto) === true) filtros.incluirTexto = true;

  const limite = inteiro(q.limite ?? q.limit ?? q.porPagina, 1, 500) ?? config.limitePadrao;
  const pagina = inteiro(q.pagina ?? q.page, 1, 100000) ?? 1;
  const offset = inteiro(q.offset, 0, 1000000);

  filtros.limite = limite;
  filtros.offset = offset !== null ? offset : (pagina - 1) * limite;

  return {
    filtros,
    paginacao: { limite, pagina: offset !== null ? Math.floor(offset / limite) + 1 : pagina, offset: filtros.offset },
    avisos,
  };
}

module.exports = { montarFiltros, dataIso };
