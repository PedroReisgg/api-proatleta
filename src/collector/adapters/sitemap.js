// src/collector/adapters/sitemap.js
// Adaptador para sites sem feed nem REST API: le o sitemap.xml, filtra as URLs
// cujo endereco sugere peneira/seletiva e busca cada pagina.

const { XMLParser } = require("fast-xml-parser");
const { obter } = require("../../util/http");
const { semAcento } = require("../../util/text");
const { buscarArtigo } = require("./artigo");

const parser = new XMLParser({ ignoreAttributes: true, trimValues: true, parseTagValue: false });

// Termos procurados no caminho da URL (slug da noticia).
const TERMOS_URL = [
  "peneira",
  "peneiras",
  "seletiva",
  "seletivas",
  "avaliacao-tecnica",
  "avaliacoes-tecnicas",
  "teste-seletivo",
  "testes-seletivos",
  "captacao",
  "tryout",
  "categorias-de-base",
  "categoria-de-base",
  "novos-talentos",
];

function lista(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Baixa e parseia um sitemap; devolve { urls, sitemaps }. */
async function lerSitemap(url) {
  const r = await obter(url);
  if (!r.ok || !r.data) return { urls: [], sitemaps: [], erro: r.erro || `HTTP ${r.status}` };

  let doc;
  try {
    doc = parser.parse(r.data);
  } catch {
    return { urls: [], sitemaps: [], erro: "XML invalido" };
  }

  if (doc?.sitemapindex) {
    return {
      urls: [],
      sitemaps: lista(doc.sitemapindex.sitemap)
        .map((s) => ({ loc: String(s?.loc || ""), lastmod: s?.lastmod ? String(s.lastmod) : null }))
        .filter((s) => s.loc),
    };
  }

  if (doc?.urlset) {
    return {
      sitemaps: [],
      urls: lista(doc.urlset.url)
        .map((u) => ({ loc: String(u?.loc || ""), lastmod: u?.lastmod ? String(u.lastmod) : null }))
        .filter((u) => u.loc),
    };
  }

  return { urls: [], sitemaps: [] };
}

// Paginas de arquivo/taxonomia casam com os termos mas nao sao anuncios.
const RE_ARQUIVO = /\/(tag|tags|category|categoria|categorias|author|autor|page|pagina|busca|search|feed|amp)\/|\?/i;

function urlInteressa(loc) {
  if (RE_ARQUIVO.test(loc)) return false;
  const alvo = semAcento(loc);
  return TERMOS_URL.some((t) => alvo.includes(t));
}

/**
 * @param {object} fonte { base, sitemaps, maxSubSitemaps, maxArtigos }
 * @param {object} opcoes { desde }
 */
async function coletar(fonte, opcoes = {}) {
  const base = fonte.base.replace(/\/$/, "");
  const raizes = (fonte.sitemaps && fonte.sitemaps.length ? fonte.sitemaps : ["/sitemap.xml"]).map((p) =>
    /^https?:/i.test(p) ? p : base + p
  );

  const erros = [];
  const candidatas = new Map();
  const maxSub = fonte.maxSubSitemaps || 6;
  const maxArtigos = opcoes.maxArtigos || fonte.maxArtigos || 25;
  const corteData = opcoes.desde ? String(opcoes.desde).slice(0, 10) : null;

  for (const raiz of raizes) {
    const nivel1 = await lerSitemap(raiz);
    if (nivel1.erro) {
      erros.push(`${fonte.id}: ${nivel1.erro} em ${raiz}`);
      continue;
    }

    for (const u of nivel1.urls) if (urlInteressa(u.loc)) candidatas.set(u.loc, u.lastmod);

    // Sub-sitemaps: prioriza os mais recentes (noticias costumam vir por ano).
    const subs = nivel1.sitemaps
      .filter((s) => !corteData || !s.lastmod || String(s.lastmod).slice(0, 10) >= corteData)
      .sort((a, b) => String(b.lastmod || "").localeCompare(String(a.lastmod || "")))
      .slice(0, maxSub);

    for (const s of subs) {
      const nivel2 = await lerSitemap(s.loc);
      if (nivel2.erro) continue;
      for (const u of nivel2.urls) if (urlInteressa(u.loc)) candidatas.set(u.loc, u.lastmod);
      // Alguns indices tem tres niveis; nao desce mais para nao explodir.
    }
  }

  const alvos = [...candidatas.entries()]
    .filter(([, lastmod]) => !corteData || !lastmod || String(lastmod).slice(0, 10) >= corteData)
    .sort((a, b) => String(b[1] || "").localeCompare(String(a[1] || "")))
    .slice(0, maxArtigos);

  const itens = [];
  await Promise.all(
    alvos.map(async ([loc, lastmod]) => {
      const art = await buscarArtigo(loc);
      if (!art || !art.titulo) return;
      itens.push({
        titulo: art.titulo,
        texto: art.texto,
        url: loc,
        publicadoEm: art.publicadoEm || lastmod || null,
        atualizadoEm: art.atualizadoEm || lastmod || null,
        slugs: art.slugs || [],
        imagem: art.imagem || null,
      });
    })
  );

  return { itens, erros };
}

module.exports = { coletar, tipo: "sitemap", urlInteressa };
