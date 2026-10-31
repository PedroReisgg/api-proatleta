// scripts/coletar.js
// Coleta por linha de comando, sem subir o servidor.
//
//   node scripts/coletar.js                       -> coleta incremental
//   node scripts/coletar.js --modo profunda       -> todas as fontes
//   node scripts/coletar.js --fontes futebolpeneira,webvolei
//   node scripts/coletar.js --prioridade 2 --janela 60

const { coletar } = require("../src/collector");
const { fecharDb } = require("../src/db");

function argumento(nome, padrao) {
  const i = process.argv.indexOf(`--${nome}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

async function main() {
  const resumo = await coletar({
    modo: argumento("modo", "incremental"),
    gatilho: "cli",
    fontes: argumento("fontes") ? argumento("fontes").split(",").map((s) => s.trim()) : null,
    prioridadeMaxima: argumento("prioridade") ? Number(argumento("prioridade")) : undefined,
    janelaDias: argumento("janela") ? Number(argumento("janela")) : undefined,
  });

  console.log("\n=== resumo ===");
  for (const [k, v] of Object.entries(resumo)) {
    if (k === "erros") continue;
    console.log(`${k}: ${JSON.stringify(v)}`);
  }
  if (resumo.erros?.length) {
    console.log(`\n=== primeiros erros (${resumo.totalErros} no total) ===`);
    for (const e of resumo.erros.slice(0, 25)) console.log(`  - ${e}`);
  }

  await fecharDb();
}

main().catch(async (e) => {
  console.error("Falha na coleta:", e);
  await fecharDb().catch(() => {});
  process.exit(1);
});
