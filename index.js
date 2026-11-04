// index.js
// Ponto de entrada da API ProAtleta.

const config = require("./src/config");
const { criarApp } = require("./src/app");
const { obterDb, fecharDb } = require("./src/db");
const { iniciarAgenda, pararAgenda } = require("./src/scheduler");
const { problemas } = require("./src/collector/sources");

/**
 * Tenta abrir o banco. Se falhar, nao impede a API de subir: agenda novas
 * tentativas com espera crescente (10s, 20s, 40s... ate 5 min) e segue.
 */
async function conectarComInsistencia() {
  let espera = 10000;
  const tentar = async () => {
    try {
      await obterDb();
      console.log("[db] conectado");
      return true;
    } catch (e) {
      console.error(`[db] sem conexao (${e.code || "erro"}): ${e.message}`);
      return false;
    }
  };

  if (await tentar()) return;

  console.error(
    "[db] a API vai subir mesmo assim. Veja GET /saude para o motivo. " +
      "Com DATABASE_URL errada ou senha trocada, corrija a variavel no painel: " +
      "a conexao e refeita sozinha, sem precisar de novo deploy."
  );

  const proxima = () => {
    setTimeout(async () => {
      if (await tentar()) return;
      espera = Math.min(espera * 2, 300000);
      proxima();
    }, espera).unref();
  };
  proxima();
}

async function main() {
  if (problemas.length) {
    console.warn(`[fontes] ${problemas.length} entrada(s) invalida(s) no catalogo:`);
    for (const p of problemas.slice(0, 10)) console.warn(`  - ${p}`);
  }

  // O banco NAO e bloqueante para subir o servidor.
  //
  // Antes a API morria aqui quando o Postgres recusava a conexao. No Render
  // isso vira loop de reinicio: o processo cai, o Render sobe de novo, cai de
  // novo, e nenhuma requisicao chega a ser respondida - nem para dizer o
  // motivo. Quem chama ve a conexao pendurada ate o timeout, sem pista
  // nenhuma do que houve (foi exatamente o que aconteceu com uma senha
  // trocada no DATABASE_URL).
  //
  // Agora o servidor sobe sempre: /saude responde explicando o problema, as
  // rotas que dependem do banco devolvem 503 com o motivo, e a conexao e
  // tentada de novo em segundo plano. Quando o banco volta, a API volta
  // sozinha, sem precisar de deploy.
  await conectarComInsistencia();

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
