// src/collector/adapters/artigo.js
// Extrai titulo, corpo, data e imagem de uma pagina HTML de noticia.
// Usado pelos adaptadores que so recebem a URL (RSS, sitemap, HTML).

const cheerio = require("cheerio");
const { obter } = require("../../util/http");
const { htmlParaTexto } = require("../../util/text");

// Seletores tentados em ordem; o primeiro que render texto suficiente ganha.
const SELETORES_CORPO = [
  "article .entry-content",
  "article .post-content",
  ".entry-content",
  ".post-content",
  ".td-post-content",
  ".single-content",
  ".content-noticia",
  ".texto-noticia",
  ".materia-conteudo",
  ".elementor-widget-theme-post-content",
  "[itemprop='articleBody']",
  "article",
  "main",
  "#content",
];

const LIXO = [
  "script",
  "style",
  "noscript",
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "iframe",
  ".related",
  ".relacionadas",
  ".compartilhe",
  ".share",
  ".sharedaddy",
  ".comments",
  "#comments",
  ".comment-respond",
  ".newsletter",
  ".advertisement",
  ".ads",
  ".ad",
  ".banner",
  ".breadcrumb",
  ".tags",
  ".author-box",
  ".wp-block-latest-posts",
  ".menu",
  ".sidebar",
];

/** Extrai os campos de um HTML ja carregado. */
function extrairDoHtml(html, url) {
  const $ = cheerio.load(html);
  $(LIXO.join(",")).remove();

  const titulo =
    limpar($("meta[property='og:title']").attr("content")) ||
    limpar($("h1").first().text()) ||
    limpar($("title").text());

  let melhor = "";
  for (const sel of SELETORES_CORPO) {
    const no = $(sel).first();
    if (!no.length) continue;
    const txt = htmlParaTexto(no.html() || "");
    if (txt.length > melhor.length) melhor = txt;
    if (melhor.length > 900) break;
  }
  if (melhor.length < 200) {
    const alternativo = htmlParaTexto($("body").html() || "");
    if (alternativo.length > melhor.length) melhor = alternativo;
  }

  const publicadoEm =
    $("meta[property='article:published_time']").attr("content") ||
    $("meta[itemprop='datePublished']").attr("content") ||
    $("time[datetime]").first().attr("datetime") ||
    $("meta[name='date']").attr("content") ||
    null;

  const atualizadoEm = $("meta[property='article:modified_time']").attr("content") || null;

  const imagem =
    $("meta[property='og:image']").attr("content") ||
    $("meta[name='twitter:image']").attr("content") ||
    null;

  const slugs = [];
  $("meta[property='article:section'], meta[property='article:tag']").each((_, el) => {
    const v = $(el).attr("content");
    if (v) slugs.push(v.toLowerCase().replace(/\s+/g, "-"));
  });

  return { titulo, texto: melhor, publicadoEm, atualizadoEm, imagem, slugs, url };
}

/** Busca a pagina e extrai os campos. Devolve null se a busca falhar. */
async function buscarArtigo(url) {
  const r = await obter(url);
  if (!r.ok || !r.data || typeof r.data !== "string") return null;
  // Evita gastar CPU com paginas gigantes (geralmente listagens, nao artigos).
  if (r.data.length > 3_000_000) return null;
  try {
    return extrairDoHtml(r.data, r.url || url);
  } catch {
    return null;
  }
}

function limpar(txt) {
  if (!txt) return null;
  const t = String(txt).replace(/\s+/g, " ").trim();
  return t.length ? t : null;
}

module.exports = { buscarArtigo, extrairDoHtml };
