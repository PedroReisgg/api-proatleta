// src/scheduler.js
// Agenda as coletas automaticas com node-cron.
//
// Observacao sobre o Render: no plano gratuito o servico web hiberna quando
// fica sem trafego, e um processo hibernado nao executa cron. Para garantir a
// atualizacao, use tambem um disparo externo em POST /admin/coleta (ver README).

const cron = require("node-cron");
const config = require("./config");
const { coletar, emAndamento } = require("./collector");
const { limparCache } = require("./routes/peneiras");

const tarefas = [];

async function executar(modo, gatilho) {
  if (emAndamento()) {
    console.log(`[agenda] ${gatilho} ignorado: coleta em andamento`);
    return;
  }
  try {
    await coletar({ modo, gatilho });
    limparCache();
  } catch (e) {
    console.error(`[agenda] ${gatilho} falhou: ${e.message}`);
  }
}

function iniciarAgenda() {
  if (!config.coletaAtivada) {
    console.log("[agenda] desativada (COLETA_ATIVADA=false)");
    return { tarefas: [] };
  }

  const opcoes = { timezone: config.fusoCron };

  for (const [expressao, modo, nome] of [
    [config.coletaCron, "incremental", "coleta incremental"],
    [config.coletaProfundaCron, "profunda", "coleta profunda"],
  ]) {
    if (!expressao) continue;
    if (!cron.validate(expressao)) {
      console.error(`[agenda] expressao cron invalida para ${nome}: "${expressao}"`);
      continue;
    }
    tarefas.push(cron.schedule(expressao, () => executar(modo, `cron:${modo}`), opcoes));
    console.log(`[agenda] ${nome} agendada: "${expressao}" (${config.fusoCron})`);
  }

  if (config.coletarNoBoot) {
    console.log(`[agenda] coleta inicial em ${Math.round(config.atrasoBootMs / 1000)}s`);
    setTimeout(() => executar("incremental", "boot"), config.atrasoBootMs).unref();
  }

  return { tarefas };
}

function pararAgenda() {
  for (const t of tarefas) {
    try {
      t.stop();
    } catch {
      /* ignora */
    }
  }
  tarefas.length = 0;
}

module.exports = { iniciarAgenda, pararAgenda };
