// src/db/postgres.js
// Driver PostgreSQL. Usado quando DATABASE_URL esta definida (producao/Render).

const { Pool } = require("pg");
const { COLUNAS, CRIAR_TABELAS, montarBusca } = require("./schema");
const { montarWhere, ordenacao } = require("./where");

const COLUNA_PARA_CAMPO = new Map(COLUNAS.map(([campo, coluna]) => [coluna, campo]));
const NOMES_COLUNAS = COLUNAS.map(([, c]) => c);

function criar(urlConexao) {
  const pool = new Pool({
    connectionString: urlConexao,
    max: Number(process.env.PG_POOL_MAX || 5),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
    // Render exige TLS mas usa certificado proprio na rede interna.
    ssl: /localhost|127\.0\.0\.1/.test(urlConexao) ? false : { rejectUnauthorized: false },
  });

  pool.on("error", (e) => console.error("[db] erro no pool:", e.message));

  async function init() {
    await pool.query(CRIAR_TABELAS);
  }

  /** Converte um registro canonico na lista de valores das colunas. */
  function paraValores(r) {
    const completo = { ...r, busca: montarBusca(r), vistoEm: new Date().toISOString() };
    return COLUNAS.map(([campo]) => {
      const v = completo[campo];
      if (v === undefined) return null;
      return v;
    });
  }

  function paraRegistro(linha) {
    if (!linha) return null;
    const out = {};
    for (const [coluna, valor] of Object.entries(linha)) {
      const campo = COLUNA_PARA_CAMPO.get(coluna) || coluna;
      out[campo] = valor instanceof Date ? valor.toISOString() : valor;
    }
    // DATE volta como Date em UTC; a API expoe sempre YYYY-MM-DD.
    for (const campo of ["dataEvento", "inscricoesAte"]) {
      if (out[campo]) out[campo] = String(out[campo]).slice(0, 10);
    }
    if (Array.isArray(out.datasCitadas)) {
      out.datasCitadas = out.datasCitadas.map((d) =>
        d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)
      );
    }
    if (out.taxa != null) out.taxa = Number(out.taxa);
    return out;
  }

  /**
   * Grava um lote. O mesmo link sempre atualiza a linha existente, para que
   * recoletas corrijam dados sem duplicar.
   */
  async function salvarLote(registros) {
    if (!registros.length) return { inseridos: 0, atualizados: 0 };

    const atualizaveis = NOMES_COLUNAS.filter((c) => c !== "id" && c !== "coletado_em");
    const sql = `
      INSERT INTO peneiras (${NOMES_COLUNAS.join(", ")})
      VALUES (${NOMES_COLUNAS.map((_, i) => `$${i + 1}`).join(", ")})
      ON CONFLICT (id) DO UPDATE SET
        ${atualizaveis.map((c) => `${c} = EXCLUDED.${c}`).join(",\n        ")}
      RETURNING (xmax = 0) AS inserido
    `;

    let inseridos = 0;
    let atualizados = 0;
    const cliente = await pool.connect();
    try {
      await cliente.query("BEGIN");
      for (const r of registros) {
        try {
          const res = await cliente.query(sql, paraValores(r));
          if (res.rows[0]?.inserido) inseridos++;
          else atualizados++;
        } catch (e) {
          // Um registro problematico nao deve abortar o lote inteiro.
          console.error(`[db] falha ao gravar ${r.link}: ${e.message}`);
        }
      }
      await cliente.query("COMMIT");
    } catch (e) {
      await cliente.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      cliente.release();
    }
    return { inseridos, atualizados };
  }

  async function buscar(filtros = {}) {
    const { sql: where, val } = montarWhere(filtros);
    const ordem = ordenacao(filtros.ordenar);
    const limite = Math.min(Math.max(Number(filtros.limite) || 50, 1), 500);
    const offset = Math.max(Number(filtros.offset) || 0, 0);

    const colunas = filtros.incluirTexto ? "*" : NOMES_COLUNAS.filter((c) => c !== "texto_completo" && c !== "busca").join(", ");

    const [itens, total] = await Promise.all([
      pool.query(
        `SELECT ${colunas} FROM peneiras ${where} ORDER BY ${ordem} LIMIT $${val.length + 1} OFFSET $${val.length + 2}`,
        [...val, limite, offset]
      ),
      pool.query(`SELECT COUNT(*)::int AS n FROM peneiras ${where}`, val),
    ]);

    return { total: total.rows[0].n, itens: itens.rows.map(paraRegistro) };
  }

  async function obterPorId(id) {
    const r = await pool.query("SELECT * FROM peneiras WHERE id = $1 OR slug = $1 LIMIT 1", [id]);
    return paraRegistro(r.rows[0]);
  }

  async function estatisticas() {
    const [geral, esporte, uf, status, fonte] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'aberta')::int AS abertas,
                COUNT(*) FILTER (WHERE data_evento >= CURRENT_DATE)::int AS futuras,
                MAX(coletado_em) AS ultima_coleta
         FROM peneiras`
      ),
      pool.query(
        `SELECT esporte AS chave, esporte_nome AS nome, COUNT(*)::int AS n FROM peneiras
         WHERE esporte IS NOT NULL GROUP BY 1,2 ORDER BY n DESC`
      ),
      pool.query(
        `SELECT uf AS chave, estado AS nome, COUNT(*)::int AS n FROM peneiras
         WHERE uf IS NOT NULL GROUP BY 1,2 ORDER BY n DESC`
      ),
      pool.query(`SELECT status AS chave, COUNT(*)::int AS n FROM peneiras GROUP BY 1 ORDER BY n DESC`),
      pool.query(
        `SELECT fonte_id AS chave, fonte_nome AS nome, COUNT(*)::int AS n FROM peneiras
         GROUP BY 1,2 ORDER BY n DESC LIMIT 40`
      ),
    ]);

    return {
      ...geral.rows[0],
      ultimaColeta: geral.rows[0].ultima_coleta ? geral.rows[0].ultima_coleta.toISOString() : null,
      porEsporte: esporte.rows,
      porEstado: uf.rows,
      porStatus: status.rows,
      porFonte: fonte.rows,
    };
  }

  /** Recalcula o status das peneiras cujo prazo venceu. */
  async function reavaliarStatus() {
    const r = await pool.query(
      `UPDATE peneiras SET status = 'encerrada'
       WHERE status <> 'encerrada'
         AND (
           (inscricoes_ate IS NOT NULL AND inscricoes_ate < CURRENT_DATE)
           OR (data_evento IS NOT NULL AND data_evento < CURRENT_DATE)
         )`
    );
    return r.rowCount;
  }

  /** Remove registros por id. Devolve quantos foram apagados. */
  async function remover(ids) {
    if (!ids || !ids.length) return 0;
    const r = await pool.query("DELETE FROM peneiras WHERE id = ANY($1::text[])", [ids]);
    return r.rowCount;
  }

  /** Remove registros antigos e ja encerrados. */
  async function limpar(diasRetencao) {
    const r = await pool.query(
      `DELETE FROM peneiras
       WHERE status = 'encerrada'
         AND COALESCE(data_evento, inscricoes_ate, data_publicacao::date) < CURRENT_DATE - $1::int`,
      [diasRetencao]
    );
    return r.rowCount;
  }

  async function registrarColeta(info) {
    const r = await pool.query(
      `INSERT INTO coletas
         (iniciada_em, concluida_em, duracao_ms, gatilho, fontes_total, fontes_ok,
          itens_brutos, relevantes, inseridos, atualizados, erros, detalhes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id`,
      [
        info.iniciadaEm,
        info.concluidaEm,
        info.duracaoMs,
        info.gatilho,
        info.fontesTotal,
        info.fontesOk,
        info.itensBrutos,
        info.relevantes,
        info.inseridos,
        info.atualizados,
        (info.erros || []).slice(0, 200),
        JSON.stringify(info.detalhes || {}),
      ]
    );
    return r.rows[0].id;
  }

  async function ultimasColetas(limite = 10) {
    const r = await pool.query(
      `SELECT id, iniciada_em, concluida_em, duracao_ms, gatilho, fontes_total, fontes_ok,
              itens_brutos, relevantes, inseridos, atualizados, erros
       FROM coletas ORDER BY iniciada_em DESC LIMIT $1`,
      [limite]
    );
    return r.rows.map((l) => ({
      id: l.id,
      iniciadaEm: l.iniciada_em?.toISOString() || null,
      concluidaEm: l.concluida_em?.toISOString() || null,
      duracaoMs: l.duracao_ms,
      gatilho: l.gatilho,
      fontesTotal: l.fontes_total,
      fontesOk: l.fontes_ok,
      itensBrutos: l.itens_brutos,
      relevantes: l.relevantes,
      inseridos: l.inseridos,
      atualizados: l.atualizados,
      erros: l.erros || [],
    }));
  }

  async function saude() {
    const r = await pool.query("SELECT 1 AS ok");
    return r.rows[0].ok === 1;
  }

  async function fechar() {
    await pool.end();
  }

  return {
    driver: "postgres",
    init,
    salvarLote,
    buscar,
    obterPorId,
    estatisticas,
    reavaliarStatus,
    remover,
    limpar,
    registrarColeta,
    ultimasColetas,
    saude,
    fechar,
  };
}

module.exports = { criar };
