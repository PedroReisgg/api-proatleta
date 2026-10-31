// src/db/where.js
// Monta a clausula WHERE parametrizada das consultas em Postgres.
// Em modulo separado para poder ser testado sem um banco.

const { semAcento } = require("../util/text");

const ORDENACOES = {
  recentes: "data_publicacao DESC NULLS LAST, coletado_em DESC",
  antigos: "data_publicacao ASC NULLS LAST",
  evento: "data_evento ASC NULLS LAST, data_publicacao DESC",
  prazo: "inscricoes_ate ASC NULLS LAST, data_evento ASC NULLS LAST",
  confianca: "confianca DESC, data_publicacao DESC NULLS LAST",
};

/**
 * @param {object} f filtros ja normalizados por routes/query.js
 * @returns {{ sql: string, val: any[] }}
 */
function montarWhere(f = {}) {
  const cond = [];
  const val = [];

  // Cada "?" do fragmento vira o MESMO placeholder, para que uma condicao
  // possa referenciar o valor mais de uma vez.
  const add = (sql, v) => {
    val.push(v);
    cond.push(sql.replace(/\?/g, `$${val.length}`));
  };

  if (f.esporte?.length) add("(esporte = ANY(?::text[]) OR esportes && ?::text[])", f.esporte);
  if (f.uf?.length) add("uf = ANY(?::text[])", f.uf);
  if (f.cidade) add("busca LIKE ?", `%${semAcento(f.cidade)}%`);
  if (f.status?.length) add("status = ANY(?::text[])", f.status);
  if (f.genero?.length) add("(genero = ANY(?::text[]) OR genero = 'misto' OR genero IS NULL)", f.genero);
  if (f.categoria?.length) add("categorias && ?::text[]", f.categoria);
  if (f.clube) add("busca LIKE ?", `%${semAcento(f.clube)}%`);
  if (f.fonte?.length) add("fonte_id = ANY(?::text[])", f.fonte);
  if (f.q) {
    for (const termo of f.q.split(/\s+/).filter(Boolean).slice(0, 6)) {
      add("busca LIKE ?", `%${semAcento(termo)}%`);
    }
  }
  if (f.gratuita === true) cond.push("gratuita IS TRUE");
  if (f.gratuita === false) cond.push("gratuita IS FALSE");
  if (f.taxaMax != null) add("(taxa IS NULL OR taxa <= ?)", f.taxaMax);
  if (f.anoNascimento != null) add("? = ANY(anos_nascimento)", f.anoNascimento);
  if (f.desde) add("(data_evento >= ?::date OR (data_evento IS NULL AND data_publicacao >= ?::date))", f.desde);
  if (f.ate) add("(data_evento <= ?::date OR data_evento IS NULL)", f.ate);
  if (f.publicadoDesde) add("data_publicacao >= ?::timestamptz", f.publicadoDesde);
  if (f.confiancaMin != null) add("confianca >= ?", f.confiancaMin);

  // "Acionavel": o anuncio da ao atleta algum caminho concreto para participar
  // (data, prazo, formulario ou contato). Filtra cobertura jornalistica que
  // menciona a peneira sem dizer como se inscrever.
  if (f.acionavel === true) {
    cond.push(
      "(data_evento IS NOT NULL OR inscricoes_ate IS NOT NULL OR link_inscricao IS NOT NULL" +
        " OR COALESCE(array_length(contato_whatsapp, 1), 0) > 0" +
        " OR COALESCE(array_length(contato_emails, 1), 0) > 0)"
    );
  }
  if (f.acionavel === false) {
    cond.push(
      "(data_evento IS NULL AND inscricoes_ate IS NULL AND link_inscricao IS NULL" +
        " AND COALESCE(array_length(contato_whatsapp, 1), 0) = 0" +
        " AND COALESCE(array_length(contato_emails, 1), 0) = 0)"
    );
  }

  return { sql: cond.length ? "WHERE " + cond.join(" AND ") : "", val };
}

function ordenacao(chave) {
  return ORDENACOES[chave] || ORDENACOES.recentes;
}

module.exports = { montarWhere, ordenacao, ORDENACOES };
