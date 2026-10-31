// src/collector/sources.js
// Carrega e valida o catalogo de fontes (src/collector/sources.json).
//
// Para acrescentar uma fonte, edite o JSON. Campos aceitos:
//   id            (obrigatorio) identificador unico, kebab-case
//   nome          (obrigatorio) nome exibido na API
//   base          (obrigatorio) origem https, sem barra final
//   tipo          (obrigatorio) wordpress | rss | sitemap | html
//   ativo         false desliga a fonte sem remove-la
//   prioridade    1 a 4; 1 coleta mais fundo e com mais frequencia
//   esportePadrao usado quando o texto nao diz o esporte
//   ufPadrao      / cidadePadrao  idem para a localidade
//   termos        (wordpress) termos de busca na REST API
//   maxPaginas    (wordpress) paginas de 100 posts por termo
//   feeds         (rss) caminhos ou URLs completas dos feeds
//   maxEnriquecer (rss) quantos artigos buscar por completo
//   sitemaps      (sitemap) caminhos dos sitemaps
//   maxArtigos    (sitemap/html) quantas paginas buscar
//   paginas       (html) paginas de listagem
//   seletores     (html) { item, titulo, link, resumo, data }

const path = require("path");
const { ESPORTES, ESTADOS } = require("./taxonomy");

const TIPOS = new Set(["wordpress", "rss", "sitemap", "html"]);
const IDS_ESPORTE = new Set(ESPORTES.map((e) => e.id));
const UFS = new Set(ESTADOS.map((e) => e.uf));

const bruto = require(path.join(__dirname, "sources.json"));

/** Valida uma entrada do catalogo; devolve lista de problemas. */
function validar(f, idsVistos) {
  const p = [];
  if (!f.id) p.push("sem id");
  else if (idsVistos.has(f.id)) p.push(`id duplicado: ${f.id}`);
  if (!f.nome) p.push(`${f.id}: sem nome`);
  if (!f.base || !/^https:\/\/[^/]+$/.test(f.base)) p.push(`${f.id}: base invalida (${f.base})`);
  if (!TIPOS.has(f.tipo)) p.push(`${f.id}: tipo invalido (${f.tipo})`);
  if (f.esportePadrao && !IDS_ESPORTE.has(f.esportePadrao)) {
    p.push(`${f.id}: esportePadrao desconhecido (${f.esportePadrao})`);
  }
  if (f.ufPadrao && !UFS.has(f.ufPadrao)) p.push(`${f.id}: ufPadrao desconhecida (${f.ufPadrao})`);
  if (f.tipo === "rss" && (!Array.isArray(f.feeds) || !f.feeds.length)) p.push(`${f.id}: rss sem feeds`);
  if (f.tipo === "sitemap" && (!Array.isArray(f.sitemaps) || !f.sitemaps.length)) {
    p.push(`${f.id}: sitemap sem sitemaps`);
  }
  if (f.tipo === "html" && (!Array.isArray(f.paginas) || !f.paginas.length)) p.push(`${f.id}: html sem paginas`);
  return p;
}

const problemas = [];
const idsVistos = new Set();
const FONTES = [];

for (const f of bruto) {
  const p = validar(f, idsVistos);
  if (p.length) {
    problemas.push(...p);
    continue;
  }
  idsVistos.add(f.id);
  FONTES.push({ ativo: true, prioridade: 4, ...f, base: f.base.replace(/\/$/, "") });
}

/** Fontes ativas, opcionalmente filtradas. */
function listarFontes({ apenasAtivas = true, prioridadeMaxima, tipo, ids } = {}) {
  return FONTES.filter((f) => {
    if (apenasAtivas && !f.ativo) return false;
    if (prioridadeMaxima != null && f.prioridade > prioridadeMaxima) return false;
    if (tipo && f.tipo !== tipo) return false;
    if (ids && ids.length && !ids.includes(f.id)) return false;
    return true;
  }).sort((a, b) => a.prioridade - b.prioridade || a.id.localeCompare(b.id));
}

function obterFonte(id) {
  return FONTES.find((f) => f.id === id) || null;
}

function resumoCatalogo() {
  const porTipo = {};
  const porPrioridade = {};
  for (const f of FONTES) {
    porTipo[f.tipo] = (porTipo[f.tipo] || 0) + 1;
    porPrioridade[f.prioridade] = (porPrioridade[f.prioridade] || 0) + 1;
  }
  return {
    total: FONTES.length,
    ativas: FONTES.filter((f) => f.ativo).length,
    porTipo,
    porPrioridade,
    problemas,
  };
}

module.exports = { FONTES, listarFontes, obterFonte, resumoCatalogo, problemas };
