// src/collector/normalize.js
// Monta o registro canonico de uma peneira a partir do item bruto do adaptador.

const { htmlParaTexto, resumir, canonizarUrl, hash, slug, semAcento } = require("../util/text");
const { extrair } = require("./extract");
const { classificar } = require("./classify");
const { ESPORTES, ESTADOS } = require("./taxonomy");

const NOME_ESPORTE = new Map(ESPORTES.map((e) => [e.id, e.nome]));
const NOME_ESTADO = new Map(ESTADOS.map((e) => [e.uf, e.nome]));

/**
 * Fingerprint de conteudo para deduplicar o mesmo anuncio republicado
 * em fontes diferentes (titulo normalizado + clube + esporte + data).
 */
function montarFingerprint({ titulo, clube, esporte, dataEvento, uf }) {
  const base = [
    semAcento(titulo).replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).slice(0, 10).join(" "),
    semAcento(clube || ""),
    esporte || "",
    dataEvento || "",
    uf || "",
  ].join("|");
  return hash(base);
}

/**
 * @param {object} bruto item devolvido por um adaptador:
 *   { titulo, html, texto, url, publicadoEm, atualizadoEm, slugs, imagem }
 * @param {object} fonte entrada do catalogo de fontes
 * @returns {object|null} registro canonico, ou null se irrelevante
 */
function normalizar(bruto, fonte) {
  const url = canonizarUrl(bruto.url);
  const titulo = htmlParaTexto(bruto.titulo || "").replace(/\s+/g, " ").trim();
  if (!url || !titulo) return null;

  const texto = bruto.texto || htmlParaTexto(bruto.html || "");
  const publicadoEm = normalizarInstante(bruto.publicadoEm);

  const extraido = extrair({
    titulo,
    texto,
    url,
    publicadoEm,
    slugs: bruto.slugs || [],
    esportePadrao: fonte.esportePadrao,
    fonteNome: fonte.nome,
  });

  // Padroes do catalogo cobrem o que o texto nao disse.
  const uf = extraido.uf || fonte.ufPadrao || null;
  const cidade = extraido.cidade || fonte.cidadePadrao || null;
  const clube = extraido.clube || fonte.nome;

  const { relevante, pontuacao, motivos } = classificar({ titulo, texto, extraido });
  if (!relevante) return null;

  const fingerprint = montarFingerprint({
    titulo,
    clube,
    esporte: extraido.esporte,
    dataEvento: extraido.dataEvento,
    uf,
  });

  return {
    id: hash(url),
    fingerprint,

    // --- campos mantidos por compatibilidade com o app atual ---
    titulo,
    link: url,
    resumo: resumir(texto, 320) || null,
    dataPublicacao: publicadoEm,

    // --- campos estruturados ---
    slug: slug(`${titulo}-${(extraido.dataEvento || "").slice(0, 10)}`),
    esporte: extraido.esporte,
    esporteNome: extraido.esporte ? NOME_ESPORTE.get(extraido.esporte) || extraido.esporte : null,
    esportes: extraido.esportes,
    multiesportivo: Boolean(extraido.multiesportivo),
    clube,
    uf,
    estado: uf ? NOME_ESTADO.get(uf) || null : null,
    cidade,
    local: extraido.local,
    categorias: extraido.categorias,
    anosNascimento: extraido.anosNascimento,
    genero: extraido.genero,
    dataEvento: extraido.dataEvento,
    datasCitadas: extraido.datasCitadas,
    inscricoesAte: extraido.inscricoesAte,
    taxa: extraido.taxa,
    taxaTexto: extraido.taxaTexto,
    gratuita: extraido.gratuita,
    status: extraido.status,

    contatoEmails: extraido.contato.emails,
    contatoTelefones: extraido.contato.telefones,
    contatoWhatsapp: extraido.contato.whatsapp,
    contatoInstagram: extraido.contato.instagram,
    linkInscricao: extraido.contato.linkInscricao,

    imagem: bruto.imagem || null,
    textoCompleto: texto.slice(0, 20000) || null,

    fonteId: fonte.id,
    fonteNome: fonte.nome,
    fonteSite: fonte.base,
    fonteTipo: fonte.tipo,
    confianca: pontuacao,
    motivos,

    coletadoEm: new Date().toISOString(),
    atualizadoEm: normalizarInstante(bruto.atualizadoEm) || publicadoEm,
  };
}

/** Converte varios formatos de data/hora para ISO completo. */
function normalizarInstante(valor) {
  if (!valor) return null;
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor.toISOString();
  const s = String(valor).trim();
  if (!s) return null;
  // WordPress devolve "2026-09-18T10:32:16" sem fuso: assume horario de Brasilia.
  const semFuso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s);
  const d = new Date(semFuso ? `${s}-03:00` : s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

module.exports = { normalizar, montarFingerprint, normalizarInstante };
