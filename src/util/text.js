// src/util/text.js
// Funcoes de texto compartilhadas pelo coletor e pela API.

/** Remove acentos e normaliza para minusculas. */
function semAcento(txt) {
  if (!txt) return "";
  return String(txt)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Converte HTML em texto plano preservando quebras de linha uteis. */
function htmlParaTexto(html) {
  if (!html) return "";
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#8217;|&#39;|&rsquo;|&apos;/gi, "'")
    .replace(/&#8211;|&ndash;|&#8212;|&mdash;/gi, "-")
    .replace(/&#(\d+);/g, (_, d) => {
      try {
        return String.fromCodePoint(Number(d));
      } catch {
        return " ";
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      try {
        return String.fromCodePoint(parseInt(h, 16));
      } catch {
        return " ";
      }
    })
    .replace(/[ \t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^[ \t]+|[ \t]+$/gm, "")
    .trim();
}

/** Resumo curto a partir de um texto longo. */
function resumir(texto, max = 320) {
  const t = (texto || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const corte = t.slice(0, max);
  const ultimo = corte.lastIndexOf(" ");
  return (ultimo > max * 0.6 ? corte.slice(0, ultimo) : corte).trim() + "...";
}

function slug(txt) {
  return semAcento(txt)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 140);
}

/** Hash estavel (FNV-1a 64 bits em hex) para fingerprint de deduplicacao. */
function hash(txt) {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const s = String(txt);
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * prime) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

const PARAMS_LIXO = /^(utm_[a-z]*|fbclid|gclid|mc_cid|mc_eid|oc|amp|ref|refsrc|igshid)$/i;

/** Normaliza URL para comparacao: remove parametros de rastreio, fragmento e barra final. */
function canonizarUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(String(url).trim());
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) {
      if (PARAMS_LIXO.test(k)) u.searchParams.delete(k);
    }
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    u.protocol = "https:";
    let s = u.toString();
    if (s.endsWith("/") && u.pathname !== "/") s = s.slice(0, -1);
    return s;
  } catch {
    return null;
  }
}

function escaparRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, (m) => "\\" + m);
}

/** Conta ocorrencias de qualquer termo da lista num texto ja normalizado (sem acento). */
function contarTermos(textoSemAcento, termos) {
  let n = 0;
  for (const t of termos) {
    const re = new RegExp("(^|[^a-z0-9])" + escaparRegex(t) + "([^a-z0-9]|$)", "g");
    const m = textoSemAcento.match(re);
    if (m) n += m.length;
  }
  return n;
}

/** True se qualquer termo aparecer no texto normalizado. */
function temTermo(textoSemAcento, termos) {
  for (const t of termos) {
    const re = new RegExp("(^|[^a-z0-9])" + escaparRegex(t) + "([^a-z0-9]|$)");
    if (re.test(textoSemAcento)) return true;
  }
  return false;
}

module.exports = {
  semAcento,
  htmlParaTexto,
  resumir,
  slug,
  hash,
  canonizarUrl,
  escaparRegex,
  contarTermos,
  temTermo,
};
