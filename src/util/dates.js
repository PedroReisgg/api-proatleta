// src/util/dates.js
// Extracao e normalizacao de datas em texto pt-BR.

const { semAcento } = require("./text");

const MESES = {
  janeiro: 1, jan: 1,
  fevereiro: 2, fev: 2,
  marco: 3, mar: 3,
  abril: 4, abr: 4,
  maio: 5, mai: 5,
  junho: 6, jun: 6,
  julho: 7, jul: 7,
  agosto: 8, ago: 8,
  setembro: 9, set: 9, sete: 9,
  outubro: 10, out: 10,
  novembro: 11, nov: 11,
  dezembro: 12, dez: 12,
};

const NOME_MES = [
  "", "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** Monta uma data ISO (YYYY-MM-DD) validando o dia do mes. */
function montarISO(ano, mes, dia) {
  if (!ano || !mes || !dia) return null;
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return d.toISOString().slice(0, 10);
}

/** Resolve um ano de 2 digitos ou ausente usando a data de referencia. */
function resolverAno(anoBruto, mes, dia, referencia) {
  const ref = referencia ? new Date(referencia) : new Date();
  if (anoBruto == null) {
    // Sem ano no texto: assume o ano da referencia; se a data cair mais de
    // 4 meses no passado, provavelmente se refere ao ano seguinte.
    const anoRef = ref.getUTCFullYear();
    const candidata = montarISO(anoRef, mes, dia);
    if (!candidata) return anoRef;
    const diffDias = (new Date(candidata) - ref) / 86400000;
    if (diffDias < -120) return anoRef + 1;
    return anoRef;
  }
  let a = Number(anoBruto);
  if (a < 100) a += a < 70 ? 2000 : 1900;
  return a;
}

/**
 * Encontra todas as datas citadas num texto.
 * Reconhece: 17/10/2026, 17-10-2026, 17/10, "17 de outubro de 2026",
 * "17 de outubro", "dias 17 e 18 de outubro", "17 a 19 de outubro".
 * @returns {string[]} datas ISO ordenadas e sem repeticao
 */
function extrairDatas(texto, referencia) {
  if (!texto) return [];
  const t = semAcento(texto);
  const achadas = new Set();

  // 17/10/2026 | 17-10-26 | 17.10.2026
  const reNum = /(^|[^\d])([0-3]?\d)[/\-.]([01]?\d)(?:[/\-.](\d{2,4}))?([^\d]|$)/g;
  let m;
  while ((m = reNum.exec(t)) !== null) {
    const dia = Number(m[2]);
    const mes = Number(m[3]);
    const ano = resolverAno(m[4] ?? null, mes, dia, referencia);
    const iso = montarISO(ano, mes, dia);
    if (iso) achadas.add(iso);
  }

  // "dias 17 e 18 de outubro de 2026" | "17 a 19 de outubro" | "17 de outubro"
  const nomesMes = Object.keys(MESES).join("|");
  const reTexto = new RegExp(
    "(?:dias?\\s+)?([0-3]?\\d)(?:\\s*(?:e|a|ate|,|&|/)\\s*([0-3]?\\d))?(?:\\s*(?:e|,)\\s*([0-3]?\\d))?\\s*(?:de\\s+)?(" +
      nomesMes +
      ")\\.?(?:\\s*(?:de\\s+)?(\\d{4}))?",
    "g"
  );
  while ((m = reTexto.exec(t)) !== null) {
    const mes = MESES[m[4]];
    const anoBruto = m[5] ? Number(m[5]) : null;
    for (const diaStr of [m[1], m[2], m[3]]) {
      if (!diaStr) continue;
      const dia = Number(diaStr);
      const ano = resolverAno(anoBruto, mes, dia, referencia);
      const iso = montarISO(ano, mes, dia);
      if (iso) achadas.add(iso);
    }
  }

  return [...achadas].sort();
}

/** Primeira data futura (ou hoje) da lista; se nao houver, a maior passada. */
function escolherDataEvento(datas, referencia) {
  if (!datas || !datas.length) return null;
  const hojeISO = (referencia ? new Date(referencia) : new Date()).toISOString().slice(0, 10);
  const futuras = datas.filter((d) => d >= hojeISO);
  if (futuras.length) return futuras[0];
  return datas[datas.length - 1];
}

/** Data ISO de hoje em UTC. */
function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

/** Diferenca em dias entre duas datas ISO (a - b). */
function diffDias(a, b) {
  if (!a || !b) return null;
  return Math.round((new Date(a + "T00:00:00Z") - new Date(b + "T00:00:00Z")) / 86400000);
}

/** Converte ISO para texto legivel pt-BR (ex: "17 de outubro de 2026"). */
function formatarPtBr(iso) {
  if (!iso) return null;
  const [a, m, d] = iso.split("-").map(Number);
  if (!a || !m || !d) return null;
  return `${d} de ${NOME_MES[m]} de ${a}`;
}

module.exports = { extrairDatas, escolherDataEvento, hojeISO, diffDias, formatarPtBr, montarISO };
