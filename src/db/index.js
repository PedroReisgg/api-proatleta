// src/db/index.js
// Escolhe o driver de armazenamento e expoe uma instancia unica.

const path = require("path");
const config = require("../config");

let instancia = null;

/** Inicializa (uma vez) e devolve o storage. */
async function obterDb() {
  if (instancia) return instancia;

  if (config.databaseUrl) {
    const pg = require("./postgres");
    const db = pg.criar(config.databaseUrl);
    await db.init();
    console.log("[db] usando PostgreSQL");
    instancia = db;
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
  return instancia;
}

/** Fecha conexoes (usado no encerramento do processo e nos testes). */
async function fecharDb() {
  if (!instancia) return;
  await instancia.fechar();
  instancia = null;
}

module.exports = { obterDb, fecharDb };
