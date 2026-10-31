// src/routes/admin.js
// Rotas administrativas. Protegidas por ADMIN_TOKEN; sem o token definido,
// todas respondem 503 (ficam desligadas em vez de abertas).

const express = require("express");
const crypto = require("crypto");
const config = require("../config");
const { obterDb } = require("../db");
const { coletar, emAndamento } = require("../collector");
const { limparCache } = require("./peneiras");

const router = express.Router();

/** Comparacao em tempo constante, para nao vazar o token por timing. */
function tokenConfere(recebido) {
  const a = Buffer.from(String(recebido || ""));
  const b = Buffer.from(config.adminToken);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function exigirToken(req, res, next) {
  if (!config.adminToken) {
    return res.status(503).json({
      erro: "rotas administrativas desabilitadas",
      comoHabilitar: "defina a variavel de ambiente ADMIN_TOKEN",
    });
  }
  const cabecalho = req.get("authorization") || "";
  const recebido = cabecalho.replace(/^Bearer\s+/i, "") || req.get("x-admin-token") || req.query.token;
  if (!tokenConfere(recebido)) {
    return res.status(401).json({ erro: "token administrativo invalido" });
  }
  next();
}

router.use(exigirToken);

/**
 * POST /admin/coleta
 * Corpo (ou query) opcional: { modo: "incremental"|"profunda", fontes: [...],
 *                              prioridadeMaxima, janelaDias, aguardar: false }
 * Por padrao responde na hora e segue coletando em background, para nao
 * estourar o timeout de quem chamou (ex: um cron externo).
 */
router.post("/coleta", async (req, res, next) => {
  try {
    const corpo = { ...req.query, ...(req.body || {}) };
    if (emAndamento()) {
      return res.status(409).json({ erro: "ja existe uma coleta em andamento" });
    }

    const opcoes = {
      modo: corpo.modo === "profunda" ? "profunda" : "incremental",
      gatilho: corpo.gatilho || "manual",
      fontes: Array.isArray(corpo.fontes)
        ? corpo.fontes
        : corpo.fontes
          ? String(corpo.fontes).split(",").map((s) => s.trim()).filter(Boolean)
          : null,
      prioridadeMaxima: corpo.prioridadeMaxima ? Number(corpo.prioridadeMaxima) : undefined,
      janelaDias: corpo.janelaDias ? Number(corpo.janelaDias) : undefined,
    };

    const aguardar = /^(1|true|sim)$/i.test(String(corpo.aguardar || ""));
    const execucao = coletar(opcoes).then(
      (r) => {
        limparCache();
        return r;
      },
      (e) => {
        console.error("[coleta] falhou:", e.message);
        throw e;
      }
    );

    if (aguardar) {
      return res.json({ iniciada: true, aguardou: true, resultado: await execucao });
    }

    // Evita derrubar o processo se a coleta em background rejeitar.
    execucao.catch(() => {});
    res.status(202).json({
      iniciada: true,
      aguardou: false,
      modo: opcoes.modo,
      dica: "acompanhe em GET /estatisticas ou GET /admin/coletas",
    });
  } catch (e) {
    next(e);
  }
});

/** GET /admin/coletas - historico das ultimas execucoes. */
router.get("/coletas", async (req, res, next) => {
  try {
    const db = await obterDb();
    const limite = Math.min(Math.max(Number(req.query.limite) || 20, 1), 50);
    res.json({ emAndamento: emAndamento(), coletas: await db.ultimasColetas(limite) });
  } catch (e) {
    next(e);
  }
});

/** POST /admin/manutencao - reavalia status e aplica a retencao. */
router.post("/manutencao", async (req, res, next) => {
  try {
    const db = await obterDb();
    const reavaliadas = await db.reavaliarStatus();
    const dias = req.query.diasRetencao ? Number(req.query.diasRetencao) : config.diasRetencao;
    const removidas = dias > 0 ? await db.limpar(dias) : 0;
    limparCache();
    res.json({ statusReavaliados: reavaliadas, removidas, diasRetencao: dias });
  } catch (e) {
    next(e);
  }
});

/** POST /admin/cache/limpar - descarta o cache de respostas. */
router.post("/cache/limpar", (req, res) => {
  limparCache();
  res.json({ ok: true });
});

module.exports = { router };
