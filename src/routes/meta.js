// src/routes/meta.js
// Rotas de apoio: taxonomias, fontes, estatisticas e saude.

const express = require("express");
const config = require("../config");
const { obterDb } = require("../db");
const { ESPORTES, ESTADOS } = require("../collector/taxonomy");
const { listarFontes, resumoCatalogo } = require("../collector/sources");
const { emAndamento } = require("../collector");

const router = express.Router();

/** GET /esportes - esportes suportados, com a contagem atual no banco. */
router.get("/esportes", async (req, res, next) => {
  try {
    const db = await obterDb();
    const stats = await db.estatisticas();
    const contagem = new Map(stats.porEsporte.map((e) => [e.chave, e.n]));
    res.json({
      total: ESPORTES.length,
      esportes: ESPORTES.map((e) => ({
        id: e.id,
        nome: e.nome,
        peneiras: contagem.get(e.id) || 0,
      })).sort((a, b) => b.peneiras - a.peneiras || a.nome.localeCompare(b.nome)),
    });
  } catch (e) {
    next(e);
  }
});

/** GET /estados - UFs, com a contagem atual no banco. */
router.get("/estados", async (req, res, next) => {
  try {
    const db = await obterDb();
    const stats = await db.estatisticas();
    const contagem = new Map(stats.porEstado.map((e) => [e.chave, e.n]));
    res.json({
      total: ESTADOS.length,
      estados: ESTADOS.map((e) => ({
        uf: e.uf,
        nome: e.nome,
        peneiras: contagem.get(e.uf) || 0,
      })).sort((a, b) => b.peneiras - a.peneiras || a.nome.localeCompare(b.nome)),
    });
  } catch (e) {
    next(e);
  }
});

/** GET /categorias - categorias de base aceitas no filtro. */
router.get("/categorias", (req, res) => {
  const categorias = [];
  for (let n = 7; n <= 23; n++) categorias.push({ id: `sub-${n}`, nome: `Sub-${n}` });
  res.json({ total: categorias.length, categorias });
});

/** GET /fontes - catalogo de fontes monitoradas. */
router.get("/fontes", async (req, res, next) => {
  try {
    const db = await obterDb();
    const stats = await db.estatisticas();
    const contagem = new Map(stats.porFonte.map((f) => [f.chave, f.n]));
    res.json({
      resumo: resumoCatalogo(),
      fontes: listarFontes({ apenasAtivas: false }).map((f) => ({
        id: f.id,
        nome: f.nome,
        site: f.base,
        tipo: f.tipo,
        prioridade: f.prioridade,
        ativo: f.ativo !== false,
        esportePadrao: f.esportePadrao || null,
        ufPadrao: f.ufPadrao || null,
        notas: f.notas || null,
        peneiras: contagem.get(f.id) || 0,
      })),
    });
  } catch (e) {
    next(e);
  }
});

/** GET /estatisticas - visao geral do acervo. */
router.get("/estatisticas", async (req, res, next) => {
  try {
    const db = await obterDb();
    const [stats, coletas] = await Promise.all([db.estatisticas(), db.ultimasColetas(5)]);
    res.json({
      ...stats,
      coletaEmAndamento: emAndamento(),
      ultimasColetas: coletas,
      catalogo: resumoCatalogo(),
    });
  } catch (e) {
    next(e);
  }
});

/** GET /saude - usado por monitores e pelo health check do Render. */
router.get("/saude", async (req, res) => {
  const inicio = Date.now();
  let banco = false;
  let erro = null;
  try {
    const db = await obterDb();
    banco = await db.saude();
  } catch (e) {
    erro = e.message;
  }
  // Erros de conexao mais comuns ganham uma explicacao em vez de so o texto
  // cru do driver, que nao diz onde mexer.
  const DICAS = [
    [/password authentication failed|28P01/i, "a senha do DATABASE_URL nao confere com a do banco. Se voce trocou a senha no painel do banco, atualize o DATABASE_URL no Render."],
    [/Tenant or user not found/i, "o usuario do DATABASE_URL esta errado. No Supabase use o Session pooler: postgres.SEU_PROJECT_REF."],
    [/ENOTFOUND|EAI_AGAIN|could not translate host/i, "o host do DATABASE_URL nao resolve. Confira o endereco."],
    [/ETIMEDOUT|ECONNREFUSED|timeout/i, "o banco nao respondeu. No Supabase use o Session pooler (porta 5432): a conexao direta e so IPv6."],
    [/does not exist|3D000/i, "o banco informado no DATABASE_URL nao existe."],
  ];
  const dica = erro ? (DICAS.find(([re]) => re.test(erro)) || [])[1] || null : null;

  const corpo = {
    ok: banco,
    banco,
    erro,
    comoResolver: dica,
    driver: config.databaseUrl ? "postgres" : "jsonstore",
    coletaAtivada: config.coletaAtivada,
    coletaEmAndamento: emAndamento(),
    ambiente: config.ambiente,
    tempoDeVidaSegundos: Math.round(process.uptime()),
    latenciaMs: Date.now() - inicio,
  };
  res.status(banco ? 200 : 503).json(corpo);
});

module.exports = { router };
