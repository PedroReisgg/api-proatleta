// src/collector/adapters/html.js
// Adaptador generico para paginas de listagem em HTML, configurado por seletores.
// Usado quando a fonte nao tem REST API, feed nem sitemap util.

const cheerio = require("cheerio");
const { obter } = require("../../util/http");
const { htmlParaTexto } = require("../../util/text");
const { buscarArtigo } = require("./artigo");

/**
 * @param {object} fonte {
 *   base, paginas: string[], seletores: { item, titulo, link, resumo, data },
 *   enriquecer, maxArtigos
 * }
 */
async function coletar(fonte, opcoes = {}) {
  const base = fonte.base.replace(/\/$/, "");
  const paginas = (fonte.paginas && fonte.paginas.length ? fonte.paginas : ["/"]).map((p) =>
    /^https?:/i.test(p) ? p : base + p
  );
  const sel = {
    item: "article, .post, .item, li",
    titulo: "h1, h2, h3, .title, .entry-title",
    link: "a",
    resumo: "p, .excerpt, .resumo",
    data: "time",
    ...(fonte.seletores || {}),
  };

  const itens = [];
  const erros = [];
  const vistos = new Set();

  for (const pagina of paginas) {
    const r = await obter(pagina);
    if (!r.ok || !r.data) {
      erros.push(`${fonte.id}: ${r.erro || `HTTP ${r.status}`} em ${pagina}`);
      continue;
    }

    let $;
    try {
      $ = cheerio.load(r.data);
    } catch {
      erros.push(`${fonte.id}: HTML invalido em ${pagina}`);
      continue;
    }

    $(sel.item).each((_, el) => {
      const no = $(el);
      const titulo = htmlParaTexto(no.find(sel.titulo).first().text() || "");
      let href = no.find(sel.link).first().attr("href") || no.attr("href") || "";
      if (!titulo || !href) return;
      try {
        href = new URL(href, pagina).toString();
      } catch {
        return;
      }
      if (vistos.has(href)) return;
      vistos.add(href);

      itens.push({
        titulo,
        texto: htmlParaTexto(no.find(sel.resumo).first().text() || ""),
        url: href,
        publicadoEm: no.find(sel.data).first().attr("datetime") || null,
        slugs: fonte.slugsPadrao || [],
        imagem: no.find("img").first().attr("src") || null,
      });
    });
  }

  // Listagens dao pouco texto: busca a pagina de cada anuncio.
  if (fonte.enriquecer !== false) {
    const limite = opcoes.maxArtigos || fonte.maxArtigos || 20;
    const alvos = itens.slice(0, limite);
    await Promise.all(
      alvos.map(async (it) => {
        const art = await buscarArtigo(it.url);
        if (!art) return;
        if ((art.texto || "").length > (it.texto || "").length) it.texto = art.texto;
        if (!it.publicadoEm && art.publicadoEm) it.publicadoEm = art.publicadoEm;
        if (!it.imagem && art.imagem) it.imagem = art.imagem;
      })
    );
  }

  return { itens, erros };
}

module.exports = { coletar, tipo: "html" };
