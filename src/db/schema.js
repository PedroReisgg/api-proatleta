// src/db/schema.js
// Definicao compartilhada das colunas, usada pelos dois drivers de storage.

const { semAcento } = require("../util/text");

/**
 * Mapa campo do registro -> coluna do banco.
 * A ordem define a ordem dos parametros no INSERT.
 */
const COLUNAS = [
  ["id", "id"],
  ["fingerprint", "fingerprint"],
  ["titulo", "titulo"],
  ["link", "link"],
  ["resumo", "resumo"],
  ["dataPublicacao", "data_publicacao"],
  ["slug", "slug"],
  ["esporte", "esporte"],
  ["esporteNome", "esporte_nome"],
  ["esportes", "esportes"],
  ["multiesportivo", "multiesportivo"],
  ["clube", "clube"],
  ["uf", "uf"],
  ["estado", "estado"],
  ["cidade", "cidade"],
  ["local", "local_evento"],
  ["categorias", "categorias"],
  ["anosNascimento", "anos_nascimento"],
  ["genero", "genero"],
  ["dataEvento", "data_evento"],
  ["datasCitadas", "datas_citadas"],
  ["inscricoesAte", "inscricoes_ate"],
  ["taxa", "taxa"],
  ["taxaTexto", "taxa_texto"],
  ["gratuita", "gratuita"],
  ["status", "status"],
  ["contatoEmails", "contato_emails"],
  ["contatoTelefones", "contato_telefones"],
  ["contatoWhatsapp", "contato_whatsapp"],
  ["contatoInstagram", "contato_instagram"],
  ["linkInscricao", "link_inscricao"],
  ["imagem", "imagem"],
  ["textoCompleto", "texto_completo"],
  ["fonteId", "fonte_id"],
  ["fonteNome", "fonte_nome"],
  ["fonteSite", "fonte_site"],
  ["fonteTipo", "fonte_tipo"],
  ["confianca", "confianca"],
  ["motivos", "motivos"],
  ["busca", "busca"],
  ["coletadoEm", "coletado_em"],
  ["atualizadoEm", "atualizado_em"],
  ["vistoEm", "visto_em"],
];

// Identificador de schema valido: letra ou "_" seguido de letras, digitos ou
// "_". Validado porque o nome vem de variavel de ambiente e e interpolado no
// SQL (nao da para passar identificador como parametro).
const RE_ESQUEMA = /^[a-z_][a-z0-9_]{0,62}$/;

/** Valida o nome do schema e devolve-o, ou lanca. */
function validarEsquema(nome) {
  const limpo = String(nome || "").trim().toLowerCase();
  if (!RE_ESQUEMA.test(limpo)) {
    throw new Error(
      `DB_SCHEMA invalido: ${JSON.stringify(nome)}. Use apenas letras minusculas, digitos e "_".`
    );
  }
  return limpo;
}

/**
 * DDL do coletor, dentro do schema informado.
 *
 * O coletor mora num schema separado de proposito: o banco do ProAtleta tem a
 * propria tabela "peneiras" (as publicadas pelas instituicoes), com colunas
 * completamente diferentes das daqui. Se as duas dividissem o "public", o
 * "CREATE TABLE IF NOT EXISTS" de uma encontraria a outra ja criada, nao faria
 * nada e o erro so apareceria em tempo de execucao, como coluna inexistente.
 */
function criarTabelas(esquema) {
  const e = validarEsquema(esquema);
  return `
CREATE SCHEMA IF NOT EXISTS ${e};

CREATE TABLE IF NOT EXISTS ${e}.peneiras (
  id                 TEXT PRIMARY KEY,
  fingerprint        TEXT NOT NULL,
  titulo             TEXT NOT NULL,
  link               TEXT NOT NULL,
  resumo             TEXT,
  data_publicacao    TIMESTAMPTZ,
  slug               TEXT,
  esporte            TEXT,
  esporte_nome       TEXT,
  esportes           TEXT[],
  multiesportivo     BOOLEAN DEFAULT FALSE,
  clube              TEXT,
  uf                 TEXT,
  estado             TEXT,
  cidade             TEXT,
  local_evento       TEXT,
  categorias         TEXT[],
  anos_nascimento    INTEGER[],
  genero             TEXT,
  data_evento        DATE,
  datas_citadas      DATE[],
  inscricoes_ate     DATE,
  taxa               NUMERIC(10,2),
  taxa_texto         TEXT,
  gratuita           BOOLEAN,
  status             TEXT,
  contato_emails     TEXT[],
  contato_telefones  TEXT[],
  contato_whatsapp   TEXT[],
  contato_instagram  TEXT[],
  link_inscricao     TEXT,
  imagem             TEXT,
  texto_completo     TEXT,
  fonte_id           TEXT,
  fonte_nome         TEXT,
  fonte_site         TEXT,
  fonte_tipo         TEXT,
  confianca          INTEGER DEFAULT 0,
  motivos            TEXT[],
  busca              TEXT,
  coletado_em        TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em      TIMESTAMPTZ,
  visto_em           TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS peneiras_link_idx        ON ${e}.peneiras (link);
CREATE INDEX IF NOT EXISTS peneiras_fingerprint_idx        ON ${e}.peneiras (fingerprint);
CREATE INDEX IF NOT EXISTS peneiras_esporte_idx            ON ${e}.peneiras (esporte);
CREATE INDEX IF NOT EXISTS peneiras_uf_idx                 ON ${e}.peneiras (uf);
CREATE INDEX IF NOT EXISTS peneiras_status_idx             ON ${e}.peneiras (status);
CREATE INDEX IF NOT EXISTS peneiras_data_evento_idx        ON ${e}.peneiras (data_evento);
CREATE INDEX IF NOT EXISTS peneiras_data_publicacao_idx    ON ${e}.peneiras (data_publicacao DESC);
CREATE INDEX IF NOT EXISTS peneiras_fonte_idx              ON ${e}.peneiras (fonte_id);
CREATE INDEX IF NOT EXISTS peneiras_categorias_idx         ON ${e}.peneiras USING GIN (categorias);
CREATE INDEX IF NOT EXISTS peneiras_esportes_idx           ON ${e}.peneiras USING GIN (esportes);

CREATE TABLE IF NOT EXISTS ${e}.coletas (
  id            SERIAL PRIMARY KEY,
  iniciada_em   TIMESTAMPTZ NOT NULL,
  concluida_em  TIMESTAMPTZ,
  duracao_ms    INTEGER,
  gatilho       TEXT,
  fontes_total  INTEGER DEFAULT 0,
  fontes_ok     INTEGER DEFAULT 0,
  itens_brutos  INTEGER DEFAULT 0,
  relevantes    INTEGER DEFAULT 0,
  inseridos     INTEGER DEFAULT 0,
  atualizados   INTEGER DEFAULT 0,
  erros         TEXT[],
  detalhes      JSONB
);

CREATE INDEX IF NOT EXISTS coletas_iniciada_idx ON ${e}.coletas (iniciada_em DESC);
`;
}

/** Texto plano usado para a busca livre (?q=). */
function montarBusca(r) {
  return semAcento(
    [r.titulo, r.clube, r.cidade, r.estado, r.local, r.esporteNome, r.fonteNome, r.resumo]
      .filter(Boolean)
      .join(" ")
  ).slice(0, 4000);
}

/** Campos expostos por padrao na API (sem o texto completo, que e grande). */
const CAMPOS_PUBLICOS = [
  "id",
  "titulo",
  "link",
  "resumo",
  "dataPublicacao",
  "slug",
  "esporte",
  "esporteNome",
  "esportes",
  "multiesportivo",
  "clube",
  "uf",
  "estado",
  "cidade",
  "local",
  "categorias",
  "anosNascimento",
  "genero",
  "dataEvento",
  "inscricoesAte",
  "taxa",
  "taxaTexto",
  "gratuita",
  "status",
  "contatoEmails",
  "contatoTelefones",
  "contatoWhatsapp",
  "contatoInstagram",
  "linkInscricao",
  "imagem",
  "fonteId",
  "fonteNome",
  "fonteSite",
  "confianca",
  "coletadoEm",
  "atualizadoEm",
];

module.exports = { COLUNAS, criarTabelas, validarEsquema, montarBusca, CAMPOS_PUBLICOS };
