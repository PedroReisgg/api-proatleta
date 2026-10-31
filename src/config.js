// src/config.js
// Toda a configuracao vem de variaveis de ambiente, com padroes seguros.

require("dotenv").config();

function num(valor, padrao) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : padrao;
}

function bool(valor, padrao) {
  if (valor === undefined || valor === "") return padrao;
  return /^(1|true|sim|yes|on)$/i.test(String(valor));
}

function lista(valor) {
  if (!valor) return [];
  return String(valor)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const config = {
  porta: num(process.env.PORT, 3000),
  ambiente: process.env.NODE_ENV || "development",

  // Armazenamento
  databaseUrl: process.env.DATABASE_URL || "",
  arquivoDados: process.env.ARQUIVO_DADOS || "data/peneiras.json",

  // Coleta automatica
  coletaAtivada: bool(process.env.COLETA_ATIVADA, true),
  // Padrao: de 3 em 3 horas. Formato cron de 5 campos.
  coletaCron: process.env.COLETA_CRON || "15 */3 * * *",
  // Coleta profunda (todas as fontes) uma vez por dia, de madrugada.
  coletaProfundaCron: process.env.COLETA_PROFUNDA_CRON || "30 5 * * *",
  // Roda uma coleta logo apos subir o servidor.
  coletarNoBoot: bool(process.env.COLETAR_NO_BOOT, true),
  atrasoBootMs: num(process.env.ATRASO_BOOT_MS, 15000),
  fusoCron: process.env.FUSO_CRON || "America/Sao_Paulo",

  // Limites da coleta incremental (prioridade 1 a 2 por padrao)
  prioridadeIncremental: num(process.env.PRIORIDADE_INCREMENTAL, 2),
  prioridadeProfunda: num(process.env.PRIORIDADE_PROFUNDA, 4),
  janelaIncrementalDias: num(process.env.JANELA_INCREMENTAL_DIAS, 21),
  janelaProfundaDias: num(process.env.JANELA_PROFUNDA_DIAS, 120),
  concorrenciaFontes: num(process.env.CONCORRENCIA_FONTES, 4),
  tempoMaxColetaMs: num(process.env.TEMPO_MAX_COLETA_MS, 10 * 60 * 1000),

  // Retencao: apaga peneiras encerradas mais antigas que isso (0 desliga)
  diasRetencao: num(process.env.DIAS_RETENCAO, 365),

  // API
  cacheTtlSegundos: num(process.env.CACHE_TTL_SEGUNDOS, 120),
  limitePadrao: num(process.env.LIMITE_PADRAO, 50),
  corsOrigens: lista(process.env.CORS_ORIGENS), // vazio = libera todas
  // Token para as rotas /admin/*. Sem token, as rotas ficam desabilitadas.
  adminToken: process.env.ADMIN_TOKEN || "",
  confiancaMinima: num(process.env.CONFIANCA_MINIMA, 0),
};

module.exports = config;
