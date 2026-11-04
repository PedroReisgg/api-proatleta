// src/db/index.js
// Escolhe o driver de armazenamento e expoe uma instancia unica.

const path = require("path");
const config = require("../config");

let instancia = null;
// Guarda o motivo da ultima falha de conexao para /saude poder explicar.
let ultimoErro = null;

/** Estado da conexao, sem tentar conectar. Usado pelo health check. */
function estadoDb() {
  return { conectado: Boolean(instancia), ultimoErro };
}

/** Inicializa (uma vez) e devolve o storage. */
async function obterDb() {
  if (instancia) return instancia;
  try {
    return await abrir();
  } catch (e) {
    // Nao guarda instancia quebrada: a proxima chamada tenta de novo.
    ultimoErro = { mensagem: e.message, codigo: e.code || null, em: new Date().toISOString() };
    throw e;
  }
}

async function abrir() {
  if (config.databaseUrl) {
    const pg = require("./postgres");
    const db = pg.criar(config.databaseUrl, config.dbSchema);
    await db.init();
    console.log(`[db] usando PostgreSQL, schema "${db.esquema}"`);
    instancia = db;
    ultimoErro = null;
    return instancia;
  }

  const json = require("./jsonstore");
  const arquivo = path.resolve(config.arquivoDados);
  const db = json.criar(arquivo);
  await db.init();
  console.log(
    `[db] DATABASE_URL ausente: usando arquivo ${arquivo}. ` +
      "Em producao defina DATABASE_URL (o disco do Render e efemero)."
  );
  instancia = db;
  ultimoErro = null;
  return instancia;
}

/** Fecha conexoes (usado no encerramento do processo e nos testes). */
async function fecharDb() {
  if (!instancia) return;
  await instancia.fechar();
  instancia = null;
}

module.exports = { obterDb, fecharDb, estadoDb };
