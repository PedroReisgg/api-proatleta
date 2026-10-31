// src/collector/adapters/rss.js
// Adaptador para feeds RSS 2.0 e Atom. Quando o feed traz apenas resumo,
// busca a pagina do artigo para obter o texto completo.

const { XMLParser } = require("fast-xml-parser");
const { obter } = require("../../util/http");
const { htmlParaTexto, semAcento, temTermo } = require("../../util/text");
const { buscarArtigo } = require("./artigo");
const { primeiraImagemDoHtml, escolherImagem } = require("../imagem");
const { SINAIS_FORTES, SINAIS_MEDIOS } = require("../taxonomy");

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  parseTagValue: false,
  cdataPropName: "__cdata",
});

/** Normaliza um valor que pode vir como string, objeto CDATA ou array. */
function texto(v) {
  if (v == null) return "";
  if (Array.isArray(v)) return texto(v[0]);
  if (typeof v === "object") return String(v.__cdata ?? v["#text"] ?? v["@_href"] ?? "");
  return String(v);
}

function lista(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Converte um <item> de RSS num item bruto do coletor. */
function itemDeRss(it) {
  const link = texto(it.link) || texto(it.guid);
  const conteudo = texto(it["content:encoded"]) || texto(it.description) || texto(it.summary);
  return {
    titulo: htmlParaTexto(texto(it.title)),
    texto: htmlParaTexto(conteudo),
    html: conteudo,
    url: link,
    publicadoEm: texto(it.pubDate) || texto(it["dc:date"]) || texto(it.published) || null,
    atualizadoEm: texto(it.updated) || null,
    slugs: lista(it.category)
      .map((c) => semAcento(texto(c)).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""))
      .filter(Boolean),
    // Ordem: media:content, media:thumbnail, enclosure e, por fim, a
    // primeira imagem dentro do proprio conteudo do item.
    imagem:
      escolherImagem(
        [
          texto(it["media:content"]?.["@_url"]),
          texto(it["media:thumbnail"]?.["@_url"]),
          texto(it.enclosure?.["@_url"]),
        ],
        link
      ) || primeiraImagemDoHtml(conteudo, link),
  };
}

/** Converte uma <entry> de Atom num item bruto do coletor. */
function itemDeAtom(e) {
  const links = lista(e.link);
  const alternativo =
    links.find((l) => (l?.["@_rel"] || "alternate") === "alternate" && l?.["@_href"]) || links[0];
  const conteudo = texto(e.content) || texto(e.summary);
  return {
    titulo: htmlParaTexto(texto(e.title)),
    texto: htmlParaTexto(conteudo),
    html: conteudo,
    url: texto(alternativo?.["@_href"]) || texto(e.id),
    publicadoEm: texto(e.published) || texto(e.updated) || null,
    atualizadoEm: texto(e.updated) || null,
    slugs: lista(e.category)
      .map((c) => semAcento(texto(c?.["@_term"] ?? c)).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""))
      .filter(Boolean),
    imagem: primeiraImagemDoHtml(conteudo, texto(alternativo?.["@_href"]) || texto(e.id)),
  };
}

const PALAVRAS_ALVO = [...SINAIS_FORTES, ...SINAIS_MEDIOS];

/** Pre-filtro barato: o item fala de peneira? Evita buscar paginas a esmo. */
function pareceRelevante(item) {
  const alvo = semAcento(`${item.titulo} ${item.texto}`);
  return temTermo(alvo, PALAVRAS_ALVO);
}

/**
 * Coleta itens de um ou mais feeds.
 * @param {object} fonte { base, feeds, enriquecer }
 * @param {object} opcoes { maxEnriquecer }
 */
async function coletar(fonte, opcoes = {}) {
  const base = fonte.base.replace(/\/$/, "");
  const caminhos = fonte.feeds && fonte.feeds.length ? fonte.feeds : ["/feed"];
  const itens = [];
  const erros = [];
  const vistos = new Set();

  for (const caminho of caminhos) {
    const url = /^https?:/i.test(caminho) ? caminho : base + caminho;
    const r = await obter(url);
    if (!r.ok || !r.data) {
      erros.push(`${fonte.id}: ${r.erro || `HTTP ${r.status}`} em ${caminho}`);
      continue;
    }

    let doc;
    try {
      doc = parser.parse(r.data);
    } catch (e) {
      erros.push(`${fonte.id}: XML invalido em ${caminho}`);
      continue;
    }

    const canal = doc?.rss?.channel;
    const brutos = canal
      ? lista(canal.item).map(itemDeRss)
      : lista(doc?.feed?.entry).map(itemDeAtom);

    for (const it of brutos) {
      if (!it.url || vistos.has(it.url)) continue;
      vistos.add(it.url);
      itens.push(it);
    }
  }

  // Feeds costumam truncar o texto. Enriquece os que parecem relevantes.
  if (fonte.enriquecer !== false) {
    const limite = opcoes.maxEnriquecer ?? fonte.maxEnriquecer ?? 25;
    const candidatos = itens.filter((it) => pareceRelevante(it) && (it.texto || "").length < 700).slice(0, limite);

    await Promise.all(
      candidatos.map(async (it) => {
        const art = await buscarArtigo(it.url);
        if (!art) return;
        if ((art.texto || "").length > (it.texto || "").length) it.texto = art.texto;
        if (!it.publicadoEm && art.publicadoEm) it.publicadoEm = art.publicadoEm;
        if (!it.imagem && art.imagem) it.imagem = art.imagem;
        if (art.slugs?.length) it.slugs = [...new Set([...it.slugs, ...art.slugs])];
      })
    );
  }

  return { itens, erros };
}

module.exports = { coletar, tipo: "rss", pareceRelevante };
