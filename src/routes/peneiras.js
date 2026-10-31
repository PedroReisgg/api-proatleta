// src/routes/peneiras.js
// Rotas de consulta das peneiras.

const express = require("express");
const config = require("../config");
const { obterDb } = require("../db");
const { montarFiltros } = require("./query");
const { formatarPtBr, hojeISO, diffDias } = require("../util/dates");

const router = express.Router();

// Cache em memoria por combinacao de filtros.
const cache = new Map();

function doCache(chave) {
  const e = cache.get(chave);
  if (!e) return null;
  if (Date.now() - e.em > config.cacheTtlSegundos * 1000) {
    cache.delete(chave);
    return null;
  }
  return e.valor;
}

function guardarNoCache(chave, valor) {
  if (cache.size > 300) cache.clear();
  cache.set(chave, { em: Date.now(), valor });
}

function limparCache() {
  cache.clear();
}

/** Campos derivados, calculados na leitura para nao envelhecerem no banco. */
function enriquecer(p) {
  const hoje = hojeISO();
  const diasParaEvento = p.dataEvento ? diffDias(p.dataEvento, hoje) : null;
  const diasParaPrazo = p.inscricoesAte ? diffDias(p.inscricoesAte, hoje) : null;
  return {
    ...p,
    dataEventoTexto: formatarPtBr(p.dataEvento),
    inscricoesAteTexto: formatarPtBr(p.inscricoesAte),
    diasParaEvento,
    diasParaPrazo,
    inscricoesAbertas:
      p.status === "aberta" && (diasParaPrazo === null || diasParaPrazo >= 0),
    // Tem algum caminho concreto para participar? Separa o anuncio de verdade
    // da cobertura jornalistica que so menciona a peneira.
    acionavel: Boolean(
      p.dataEvento ||
        p.inscricoesAte ||
        p.linkInscricao ||
        (p.contatoWhatsapp || []).length ||
        (p.contatoEmails || []).length
    ),
  };
}

/**
 * GET /peneiras
 * Filtros: esporte, uf, cidade, categoria, status, genero, clube, fonte, q,
 *          gratuita, taxaMax, anoNascimento, desde, ate, publicadoDesde,
 *          confiancaMin, ordenar, limite, pagina, offset, incluirTexto
 */
router.get("/peneiras", async (req, res, next) => {
  try {
    const { filtros, paginacao, avisos } = montarFiltros(req.query);
    const chave = JSON.stringify(filtros);

    const emCache = doCache(chave);
    if (emCache) {
      return res.json({ ...emCache, fonte: "cache" });
    }

    const db = await obterDb();
    const { total, itens } = await db.buscar(filtros);

    const corpo = {
      // "fonte", "total" e "peneiras" sao mantidos com os mesmos nomes da
      // versao anterior da API para nao quebrar o app que ja consome.
      fonte: "banco",
      total,
      peneiras: itens.map(enriquecer),
      paginacao: {
        ...paginacao,
        paginas: Math.max(Math.ceil(total / paginacao.limite), 1),
        temProxima: paginacao.offset + itens.length < total,
      },
      filtros,
      avisos: avisos.length ? avisos : undefined,
      geradoEm: new Date().toISOString(),
    };

    guardarNoCache(chave, corpo);
    res.json(corpo);
  } catch (e) {
    next(e);
  }
});

/** GET /peneiras/abertas - atalho para o que ainda da para se inscrever. */
router.get("/peneiras/abertas", async (req, res, next) => {
  try {
    // No Express 5 req.query e um getter que reparseia a query string a cada
    // acesso, entao mutar req.query nao tem efeito: monta-se uma copia.
    const consulta = {
      ordenar: "prazo",
      desde: hojeISO(),
      // Esta rota existe para mostrar o que da para fazer agora, entao por
      // padrao so traz anuncios com data, prazo, formulario ou contato.
      // Passe acionavel=0 para ver tambem os sem caminho de inscricao.
      acionavel: "1",
      ...req.query,
      status: "aberta",
    };
    const { filtros, paginacao } = montarFiltros(consulta);
    const db = await obterDb();
    const { total, itens } = await db.buscar(filtros);
    res.json({
      fonte: "banco",
      total,
      peneiras: itens.map(enriquecer),
      paginacao: { ...paginacao, paginas: Math.max(Math.ceil(total / paginacao.limite), 1) },
      geradoEm: new Date().toISOString(),
    });
  } catch (e) {
    next(e);
  }
});

/** GET /peneiras/:id - uma peneira pelo id ou pelo slug, com texto completo. */
router.get("/peneiras/:id", async (req, res, next) => {
  try {
    const db = await obterDb();
    const p = await db.obterPorId(String(req.params.id));
    if (!p) return res.status(404).json({ erro: "peneira nao encontrada" });
    res.json({ peneira: enriquecer(p) });
  } catch (e) {
    next(e);
  }
});

module.exports = { router, limparCache };
