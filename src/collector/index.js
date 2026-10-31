// src/collector/index.js
// Orquestra a coleta: escolhe as fontes, roda o adaptador de cada uma,
// normaliza, deduplica e grava no banco.

const config = require("../config");
const { obterDb } = require("../db");
const { listarFontes } = require("./sources");
const { normalizar } = require("./normalize");
const { criarLimitador } = require("../util/http");

const ADAPTADORES = {
  wordpress: require("./adapters/wordpress"),
  rss: require("./adapters/rss"),
  sitemap: require("./adapters/sitemap"),
  html: require("./adapters/html"),
};

// Garante que duas coletas nao rodem ao mesmo tempo.
let execucaoAtual = null;

function emAndamento() {
  return Boolean(execucaoAtual);
}

/** Coleta de uma fonte unica. Nunca lanca: devolve o relatorio dela. */
async function coletarFonte(fonte, opcoes) {
  const inicio = Date.now();
  const adaptador = ADAPTADORES[fonte.tipo];
  if (!adaptador) {
    return { fonteId: fonte.id, ok: false, erros: [`${fonte.id}: tipo sem adaptador (${fonte.tipo})`] };
  }

  let itens = [];
  let erros = [];
  try {
    const r = await adaptador.coletar(fonte, opcoes);
    itens = r.itens || [];
    erros = r.erros || [];
  } catch (e) {
    return {
      fonteId: fonte.id,
      ok: false,
      brutos: 0,
      relevantes: 0,
      duracaoMs: Date.now() - inicio,
      erros: [`${fonte.id}: ${e.message}`],
    };
  }

  const registros = [];
  for (const bruto of itens) {
    try {
      const r = normalizar(bruto, fonte);
      if (r && r.confianca >= config.confiancaMinima) registros.push(r);
    } catch (e) {
      erros.push(`${fonte.id}: falha ao normalizar ${bruto.url}: ${e.message}`);
    }
  }

  return {
    fonteId: fonte.id,
    fonteNome: fonte.nome,
    ok: true,
    brutos: itens.length,
    relevantes: registros.length,
    duracaoMs: Date.now() - inicio,
    registros,
    erros,
  };
}

/**
 * Remove duplicatas entre fontes. Mesmo fingerprint = mesmo anuncio
 * republicado; fica o de maior confianca (e, no empate, o mais completo).
 */
function deduplicar(registros) {
  const porLink = new Map();
  for (const r of registros) {
    const existente = porLink.get(r.id);
    if (!existente || melhor(r, existente)) porLink.set(r.id, r);
  }

  const porFingerprint = new Map();
  for (const r of porLink.values()) {
    const existente = porFingerprint.get(r.fingerprint);
    if (!existente || melhor(r, existente)) porFingerprint.set(r.fingerprint, r);
  }
  return [...porFingerprint.values()];
}

function completude(r) {
  let n = 0;
  for (const campo of ["esporte", "uf", "cidade", "local", "dataEvento", "inscricoesAte", "taxaTexto", "genero"]) {
    if (r[campo]) n++;
  }
  n += Math.min((r.categorias || []).length, 3);
  if (r.linkInscricao) n += 2;
  if ((r.contatoWhatsapp || []).length) n += 1;
  return n;
}

function melhor(a, b) {
  if (a.confianca !== b.confianca) return a.confianca > b.confianca;
  const ca = completude(a);
  const cb = completude(b);
  if (ca !== cb) return ca > cb;
  return (a.dataPublicacao || "") > (b.dataPublicacao || "");
}

/**
 * Executa uma coleta completa.
 * @param {object} opcoes
 *   modo: "incremental" | "profunda"
 *   gatilho: texto livre que vai para o historico ("cron", "boot", "manual")
 *   fontes: lista de ids para coletar apenas essas
 *   prioridadeMaxima, janelaDias: sobrescrevem os padroes do modo
 */
async function coletar(opcoes = {}) {
  if (execucaoAtual) {
    return { jaRodando: true, ...(await execucaoAtual.resumoParcial()) };
  }

  const modo = opcoes.modo === "profunda" ? "profunda" : "incremental";
  const gatilho = opcoes.gatilho || "manual";
  const prioridadeMaxima =
    opcoes.prioridadeMaxima ??
    (modo === "profunda" ? config.prioridadeProfunda : config.prioridadeIncremental);
  const janelaDias =
    opcoes.janelaDias ?? (modo === "profunda" ? config.janelaProfundaDias : config.janelaIncrementalDias);

  const fontes = listarFontes({
    prioridadeMaxima,
    ids: opcoes.fontes && opcoes.fontes.length ? opcoes.fontes : null,
  });

  const iniciadaEm = new Date();
  const desde = new Date(Date.now() - janelaDias * 86400000).toISOString();
  const estado = { feitas: 0, total: fontes.length };

  console.log(
    `[coleta] inicio modo=${modo} gatilho=${gatilho} fontes=${fontes.length} ` +
      `prioridade<=${prioridadeMaxima} janela=${janelaDias}d`
  );

  const executar = async () => {
    const limitar = criarLimitador(config.concorrenciaFontes);
    const prazo = Date.now() + config.tempoMaxColetaMs;

    const relatorios = await Promise.all(
      fontes.map((fonte) =>
        limitar(async () => {
          if (Date.now() > prazo) {
            return { fonteId: fonte.id, ok: false, erros: [`${fonte.id}: tempo maximo da coleta excedido`] };
          }
          const r = await coletarFonte(fonte, {
            desde,
            limitePaginas: modo === "profunda" ? undefined : Math.min(fonte.maxPaginas || 2, 2),
            maxArtigos: modo === "profunda" ? undefined : Math.min(fonte.maxArtigos || 25, 15),
            maxEnriquecer: modo === "profunda" ? undefined : Math.min(fonte.maxEnriquecer || 25, 12),
          });
          estado.feitas++;
          if (r.relevantes) {
            console.log(`[coleta] ${r.fonteId}: ${r.relevantes}/${r.brutos} relevantes em ${r.duracaoMs}ms`);
          }
          return r;
        })
      )
    );

    const todos = [];
    const erros = [];
    const detalhes = {};
    let brutos = 0;
    let fontesOk = 0;

    for (const r of relatorios) {
      if (r.ok) fontesOk++;
      brutos += r.brutos || 0;
      if (r.registros) todos.push(...r.registros);
      if (r.erros?.length) erros.push(...r.erros);
      detalhes[r.fonteId] = {
        ok: r.ok,
        brutos: r.brutos || 0,
        relevantes: r.relevantes || 0,
        duracaoMs: r.duracaoMs || 0,
        erros: (r.erros || []).length,
      };
    }

    const unicos = deduplicar(todos);
    const db = await obterDb();
    const { inseridos, atualizados } = await db.salvarLote(unicos);

    const reavaliadas = await db.reavaliarStatus();
    const removidas = config.diasRetencao > 0 ? await db.limpar(config.diasRetencao) : 0;

    const concluidaEm = new Date();
    const resumo = {
      modo,
      gatilho,
      iniciadaEm: iniciadaEm.toISOString(),
      concluidaEm: concluidaEm.toISOString(),
      duracaoMs: concluidaEm - iniciadaEm,
      fontesTotal: fontes.length,
      fontesOk,
      itensBrutos: brutos,
      relevantes: unicos.length,
      duplicadasDescartadas: todos.length - unicos.length,
      inseridos,
      atualizados,
      statusReavaliados: reavaliadas,
      removidasPorRetencao: removidas,
      erros: erros.slice(0, 100),
      totalErros: erros.length,
    };

    try {
      await db.registrarColeta({ ...resumo, detalhes });
    } catch (e) {
      console.error(`[coleta] nao foi possivel gravar o historico: ${e.message}`);
    }

    console.log(
      `[coleta] fim ${resumo.duracaoMs}ms fontes_ok=${fontesOk}/${fontes.length} ` +
        `brutos=${brutos} relevantes=${unicos.length} novos=${inseridos} ` +
        `atualizados=${atualizados} erros=${erros.length}`
    );
    return resumo;
  };

  const promessa = executar();
  execucaoAtual = {
    promessa,
    resumoParcial: async () => ({
      modo,
      gatilho,
      iniciadaEm: iniciadaEm.toISOString(),
      progresso: `${estado.feitas}/${estado.total} fontes`,
    }),
  };

  try {
    return await promessa;
  } finally {
    execucaoAtual = null;
  }
}

module.exports = { coletar, coletarFonte, deduplicar, emAndamento };
