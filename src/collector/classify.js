// src/collector/classify.js
// Decide se um item coletado e realmente um anuncio de peneira/seletiva
// e atribui uma pontuacao de confianca de 0 a 100.

const { semAcento, contarTermos, temTermo } = require("../util/text");
const { hojeISO } = require("../util/dates");
const {
  SINAIS_FORTES,
  SINAIS_MEDIOS,
  SINAIS_INSCRICAO,
  SINAIS_NEGATIVOS,
  SINAIS_RETROSPECTIVO,
  SINAIS_AGREGADO,
} = require("./taxonomy");

/**
 * @param {object} entrada { titulo, texto, extraido }
 * @returns {{ relevante: boolean, pontuacao: number, motivos: string[] }}
 */
function classificar({ titulo, texto, extraido }) {
  const t = semAcento(titulo || "");
  const c = semAcento(texto || "");
  const motivos = [];
  let p = 0;

  const forteTitulo = contarTermos(t, SINAIS_FORTES);
  const forteCorpo = contarTermos(c, SINAIS_FORTES);
  if (forteTitulo) {
    p += 45;
    motivos.push("sinal-forte-titulo");
  }
  if (forteCorpo) {
    p += Math.min(forteCorpo, 4) * 6;
    motivos.push("sinal-forte-corpo");
  }

  const medios = contarTermos(t, SINAIS_MEDIOS) * 4 + Math.min(contarTermos(c, SINAIS_MEDIOS), 5) * 3;
  if (medios) {
    p += Math.min(medios, 20);
    motivos.push("sinal-medio");
  }

  if (contarTermos(c, SINAIS_INSCRICAO) || contarTermos(t, SINAIS_INSCRICAO)) {
    p += 10;
    motivos.push("mencao-inscricao");
  }

  // Campos estruturados encontrados aumentam muito a confianca.
  if (extraido) {
    if (extraido.esporte) {
      p += 8;
      motivos.push("esporte-identificado");
    }
    if (extraido.categorias?.length || extraido.anosNascimento?.length) {
      p += 12;
      motivos.push("categoria-identificada");
    }
    if (extraido.dataEvento || extraido.inscricoesAte) {
      p += 10;
      motivos.push("data-identificada");
    }
    if (extraido.local) {
      p += 5;
      motivos.push("local-identificado");
    }
    if (
      extraido.contato?.linkInscricao ||
      extraido.contato?.whatsapp?.length ||
      extraido.contato?.emails?.length
    ) {
      p += 8;
      motivos.push("contato-identificado");
    }
    if (extraido.taxa !== null && extraido.taxa !== undefined) {
      p += 4;
      motivos.push("taxa-identificada");
    }
  }

  const negativos = contarTermos(t, SINAIS_NEGATIVOS) * 14 + Math.min(contarTermos(c, SINAIS_NEGATIVOS), 4) * 5;
  if (negativos) {
    p -= negativos;
    motivos.push("sinal-negativo");
  }

  // Texto muito curto raramente traz um anuncio util.
  if ((texto || "").length < 160) {
    p -= 12;
    motivos.push("texto-curto");
  }

  const pontuacao = Math.max(0, Math.min(100, Math.round(p)));

  // Artigo-agregado (coluna de notas, resumo do dia): cita peneira de
  // passagem e nunca e um anuncio. Rejeicao direta.
  if (temTermo(t, SINAIS_AGREGADO)) {
    motivos.push("artigo-agregado");
    return { relevante: false, pontuacao, motivos };
  }

  // Cobertura retrospectiva no titulo ("aprovados se apresentam"): so vale
  // se ainda houver data de avaliacao ou prazo de inscricao no futuro.
  if (temTermo(t, SINAIS_RETROSPECTIVO)) {
    const hoje = hojeISO();
    const aindaVale =
      (extraido?.dataEvento && extraido.dataEvento >= hoje) ||
      (extraido?.inscricoesAte && extraido.inscricoesAte >= hoje);
    if (!aindaVale) {
      motivos.push("retrospectivo-sem-data-futura");
      return { relevante: false, pontuacao, motivos };
    }
  }

  // Regra de corte: exige um sinal forte em algum lugar OU sinal medio com
  // dados estruturados suficientes. So pontuacao alta nao basta.
  const temSinalForte = forteTitulo > 0 || forteCorpo > 0;
  const temApoioEstruturado =
    Boolean(extraido?.esporte) &&
    (Boolean(extraido?.categorias?.length) || Boolean(extraido?.anosNascimento?.length)) &&
    Boolean(extraido?.dataEvento || extraido?.inscricoesAte);

  const relevante = pontuacao >= 45 && (temSinalForte || temApoioEstruturado);

  return { relevante, pontuacao, motivos };
}

module.exports = { classificar };
