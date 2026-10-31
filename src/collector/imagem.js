// src/collector/imagem.js
// Escolhe a imagem de capa de um anuncio e descarta o que nao serve como capa
// (pixel de rastreio, avatar, icone de interface, emoji).

// Trechos de URL que nunca sao uma boa capa.
const DESCARTAR = new RegExp(
  [
    "gravatar",
    "/avatar",
    "avatar\\.",
    "spacer",
    "pixel\\.",
    "1x1",
    "blank\\.",
    "loading\\.",
    "placeholder",
    "/emoji/",
    "twemoji",
    "feed-icon",
    "wp-includes/images",
    "wp-content/plugins",
    "/smilies/",
    "share-icon",
    "icon-",
    "-icon\\.",
    "/badges?/",
    "doubleclick",
    "googlesyndication",
    "facebook\\.com/tr",
    "google-analytics",
  ].join("|"),
  "i"
);

// Extensoes aceitas. Sem extensao tambem passa: muitos CDNs servem por id.
const EXTENSAO_RUIM = /\.(svg|gif|ico|bmp|tiff?)(\?|#|$)/i;

/**
 * Valida e normaliza uma URL de imagem.
 * @param {string} url
 * @param {string} base URL da pagina, para resolver caminhos relativos
 * @returns {string|null}
 */
function normalizarImagem(url, base) {
  if (!url) return null;
  let bruto = String(url).trim();
  if (!bruto || bruto.startsWith("data:")) return null;

  // srcset: fica com a primeira entrada e descarta o descritor de tamanho.
  // Vale tambem para srcset de uma entrada so ("p.webp 800w"), que nao tem
  // virgula mas ainda assim traz o descritor grudado na URL.
  if (/\s\d+(\.\d+)?[wx]\s*(,|$)/.test(bruto)) {
    bruto = bruto.split(",")[0].trim().split(/\s+/)[0];
  }

  let u;
  try {
    u = new URL(bruto, base || undefined);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  if (DESCARTAR.test(u.href)) return null;
  if (EXTENSAO_RUIM.test(u.pathname)) return null;

  // Miniatura minuscula do WordPress (ex: foto-150x150.jpg): nao serve de capa.
  const m = u.pathname.match(/-(\d{2,4})x(\d{2,4})\.(jpe?g|png|webp|avif)$/i);
  if (m && (Number(m[1]) < 300 || Number(m[2]) < 200)) return null;

  u.protocol = "https:";
  return u.href;
}

// Atributos onde os temas escondem a imagem real quando usam lazy-load.
const ATRIBUTOS = ["src", "data-src", "data-lazy-src", "data-original", "data-srcset", "srcset"];

/**
 * Primeira imagem utilizavel dentro de um HTML.
 * @param {string} html
 * @param {string} base URL da pagina
 * @returns {string|null}
 */
function primeiraImagemDoHtml(html, base) {
  if (!html) return null;
  const texto = String(html);

  // 1. <figure>/<img> do corpo do post.
  const reImg = /<img\b[^>]*>/gi;
  let tag;
  while ((tag = reImg.exec(texto)) !== null) {
    for (const attr of ATRIBUTOS) {
      const m = tag[0].match(new RegExp(attr + '\\s*=\\s*["\']([^"\']+)["\']', "i"));
      if (!m) continue;
      const url = normalizarImagem(m[1], base);
      if (url) return url;
    }
  }

  // 2. <source srcset> de <picture>.
  const reSource = /<source\b[^>]*srcset\s*=\s*["']([^"']+)["']/gi;
  let s;
  while ((s = reSource.exec(texto)) !== null) {
    const url = normalizarImagem(s[1], base);
    if (url) return url;
  }

  return null;
}

/**
 * Escolhe a melhor capa entre varios candidatos, na ordem de preferencia dada.
 * @param {Array<string|null|undefined>} candidatos
 * @param {string} base
 * @returns {string|null}
 */
function escolherImagem(candidatos, base) {
  for (const c of candidatos || []) {
    const url = normalizarImagem(c, base);
    if (url) return url;
  }
  return null;
}

module.exports = { normalizarImagem, primeiraImagemDoHtml, escolherImagem };
