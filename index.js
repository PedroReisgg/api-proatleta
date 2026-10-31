// index.js
// Ponto de entrada da API ProAtleta.

const config = require("./src/config");
const { criarApp } = require("./src/app");
const { obterDb, fecharDb } = require("./src/db");
const { iniciarAgenda, pararAgenda } = require("./src/scheduler");
const { problemas } = require("./src/collector/sources");

async function main() {
  if (problemas.length) {
    console.warn(`[fontes] ${problemas.length} entrada(s) invalida(s) no catalogo:`);
    for (const p of problemas.slice(0, 10)) console.warn(`  - ${p}`);
  }

  // Falhar aqui e melhor que servir 500 em toda requisicao.
  await obterDb();

  const app = criarApp();
  const servidor = app.listen(config.porta, () => {
    console.log(`API ProAtleta ouvindo na porta ${config.porta} (${config.ambiente})`);
  });

  iniciarAgenda();

  const encerrar = async (sinal) => {
    console.log(`\n[${sinal}] encerrando...`);
    pararAgenda();
    servidor.close();
    await fecharDb().catch(() => {});
    process.exit(0);
  };
  process.on("SIGTERM", () => encerrar("SIGTERM"));
  process.on("SIGINT", () => encerrar("SIGINT"));

  process.on("unhandledRejection", (e) => {
    console.error("[unhandledRejection]", e);
  });
}

main().catch((e) => {
  console.error("Falha ao iniciar a API:", e);
  process.exit(1);
});
