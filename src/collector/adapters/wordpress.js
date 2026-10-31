// src/collector/adapters/wordpress.js
// Adaptador para sites WordPress com a REST API publica (/wp-json/wp/v2).
// E a melhor fonte: devolve conteudo completo, datas e taxonomia em JSON.

const { obterJson } = require("../../util/http");
const { htmlParaTexto } = require("../../util/text");
const { primeiraImagemDoHtml, normalizarImagem } = require("../imagem");

const CAMPOS = [
  "id",
  "link",
  "date",
  "date_gmt",
  "modified_gmt",
  "title",
  "excerpt",
  "content",
  "categories",
  "tags",
  "featured_media",
].join(",");

// Cache de taxonomia por host: evita rebuscar categorias a cada coleta.
const cacheTaxonomia = new Map();

/**
 * Resolve ids de midia destacada em URLs de imagem.
 *
 * A REST API do WordPress so devolve o ID em "featured_media". O caminho
 * natural seria "_embed=wp:featuredmedia", mas "_embed" e "_fields" sao
 * incompativeis: pedindo os dois, o WordPress descarta o "_embedded". Como
 * abrir mao de "_fields" encheria a resposta de campos inuteis, resolve-se a
 * midia em lote num unico pedido a /wp/v2/media.
 *
 * @param {string} base
 * @param {number[]} ids
 * @returns {Promise<Map<number,string>>} id -> source_url
 */
async function resolverMidias(base, ids) {
  const mapa = new Map();
  const unicos = [...new Set(ids.filter((i) => Number.isInteger(i) && i > 0))];
  if (!unicos.length) return mapa;

  // 100 e o teto de per_page da REST API.
  for (let i = 0; i < unicos.length; i += 100) {
    const lote = unicos.slice(i, i + 100);
    const url =
      `${base}/wp-json/wp/v2/media?include=${lote.join(",")}` +
      `&per_page=${lote.length}&_fields=id,source_url`;
    const r = await obterJson(url);
    if (!r.ok || !Array.isArray(r.json)) continue;
    for (const m of r.json) {
      const limpa = normalizarImagem(m?.source_url, base);
      if (m?.id && limpa) mapa.set(m.id, limpa);
    }
  }
  return mapa;
}

async function carregarTaxonomia(base) {
  if (cacheTaxonomia.has(base)) return cacheTaxonomia.get(base);
  const mapa = new Map();
  for (const tipo of ["categories", "tags"]) {
    const r = await obterJson(`${base}/wp-json/wp/v2/${tipo}?per_page=100&_fields=id,slug`);
    if (r.ok && Array.isArray(r.json)) {
      for (const t of r.json) if (t && t.id && t.slug) mapa.set(`${tipo}:${t.id}`, t.slug);
    }
  }
  cacheTaxonomia.set(base, mapa);
  return mapa;
}

/**
 * Coleta posts de um site WordPress.
 * @param {object} fonte { base, termos, maxPaginas, porPagina }
 * @param {object} opcoes { desde: ISO string, limitePaginas }
 * @returns {Promise<{itens: object[], erros: string[]}>}
 */
async function coletar(fonte, opcoes = {}) {
  const base = fonte.base.replace(/\/$/, "");
  const termos = fonte.termos && fonte.termos.length ? fonte.termos : ["peneira"];
  const porPagina = Math.min(fonte.porPagina || 100, 100);
  const maxPaginas = opcoes.limitePaginas || fonte.maxPaginas || 2;

  const taxonomia = await carregarTaxonomia(base);
  const itens = [];
  const erros = [];
  const vistos = new Set();

  for (const termo of termos) {
    for (let pagina = 1; pagina <= maxPaginas; pagina++) {
      const params = new URLSearchParams({
        search: termo,
        per_page: String(porPagina),
        page: String(pagina),
        orderby: "date",
        order: "desc",
        _fields: CAMPOS,
      });
      if (opcoes.desde) params.set("after", opcoes.desde);

      const url = `${base}/wp-json/wp/v2/posts?${params}`;
      const r = await obterJson(url);

      if (!r.ok || !Array.isArray(r.json)) {
        // page fora do alcance devolve 400: fim normal da paginacao.
        if (r.status !== 400) erros.push(`${fonte.id}: ${r.erro || `HTTP ${r.status}`} em "${termo}" p${pagina}`);
        break;
      }
      if (!r.json.length) break;

      const daPagina = [];
      for (const post of r.json) {
        if (!post || !post.link || vistos.has(post.link)) continue;
        vistos.add(post.link);

        const slugs = [];
        for (const id of post.categories || []) {
          const s = taxonomia.get(`categories:${id}`);
          if (s) slugs.push(s);
        }
        for (const id of post.tags || []) {
          const s = taxonomia.get(`tags:${id}`);
          if (s) slugs.push(s);
        }

        const corpoHtml = post.content?.rendered || post.excerpt?.rendered || "";
        daPagina.push({
          titulo: htmlParaTexto(post.title?.rendered || ""),
          texto: htmlParaTexto(corpoHtml),
          html: corpoHtml,
          url: post.link,
          publicadoEm: post.date_gmt ? `${post.date_gmt}Z` : post.date,
          atualizadoEm: post.modified_gmt ? `${post.modified_gmt}Z` : null,
          slugs,
          // Capa: a imagem destacada do post; se nao houver, a primeira do corpo.
          imagem: primeiraImagemDoHtml(corpoHtml, post.link),
          _midiaId: post.featured_media,
        });
      }

      // Um pedido por pagina resolve a midia destacada de todos os posts dela.
      const midias = await resolverMidias(
        base,
        daPagina.map((i) => i._midiaId)
      );
      for (const item of daPagina) {
        const destacada = midias.get(item._midiaId);
        if (destacada) item.imagem = destacada;
        delete item._midiaId;
      }
      itens.push(...daPagina);

      if (r.json.length < porPagina) break;
    }
  }

  return { itens, erros };
}

module.exports = { coletar, tipo: "wordpress" };
