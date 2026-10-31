// src/db/jsonstore.js
// Driver de arquivo JSON. Usado quando DATABASE_URL nao esta definida, para
// rodar local sem Postgres. Mesma interface e mesma semantica de filtros.
//
// Atencao: no plano gratuito do Render o disco e efemero, ou seja, os dados
// gravados aqui se perdem em cada deploy. Em producao use DATABASE_URL.

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { montarBusca } = require("./schema");
const { semAcento } = require("../util/text");
const { hojeISO } = require("../util/dates");

function criar(arquivo) {
  const dir = path.dirname(arquivo);
  let estado = { peneiras: {}, coletas: [] };
  let gravacaoPendente = null;

  async function init() {
    await fsp.mkdir(dir, { recursive: true });
    if (fs.existsSync(arquivo)) {
      try {
        const bruto = JSON.parse(await fsp.readFile(arquivo, "utf8"));
        estado = {
          peneiras: bruto.peneiras || {},
          coletas: Array.isArray(bruto.coletas) ? bruto.coletas : [],
        };
      } catch (e) {
        console.error(`[db] ${arquivo} ilegivel (${e.message}); comecando vazio`);
      }
    }
  }

  /** Grava no disco de forma atomica, agrupando chamadas proximas. */
  function agendarGravacao() {
    if (gravacaoPendente) return gravacaoPendente;
    gravacaoPendente = new Promise((resolve) => {
      setTimeout(async () => {
        const temporario = `${arquivo}.tmp`;
        try {
          await fsp.mkdir(dir, { recursive: true });
          await fsp.writeFile(temporario, JSON.stringify(estado), "utf8");
          await fsp.rename(temporario, arquivo);
        } catch (e) {
          console.error(`[db] falha ao gravar ${arquivo}: ${e.message}`);
        } finally {
          gravacaoPendente = null;
          resolve();
        }
      }, 50);
    });
    return gravacaoPendente;
  }

  async function salvarLote(registros) {
    let inseridos = 0;
    let atualizados = 0;
    const agora = new Date().toISOString();

    for (const r of registros) {
      const existente = estado.peneiras[r.id];
      if (existente) atualizados++;
      else inseridos++;
      estado.peneiras[r.id] = {
        ...r,
        busca: montarBusca(r),
        coletadoEm: existente?.coletadoEm || r.coletadoEm || agora,
        vistoEm: agora,
      };
    }
    await agendarGravacao();
    return { inseridos, atualizados };
  }

  const ORDENACOES = {
    recentes: (a, b) => cmp(b.dataPublicacao, a.dataPublicacao) || cmp(b.coletadoEm, a.coletadoEm),
    antigos: (a, b) => cmp(a.dataPublicacao, b.dataPublicacao),
    evento: (a, b) => cmpNulosNoFim(a.dataEvento, b.dataEvento) || cmp(b.dataPublicacao, a.dataPublicacao),
    prazo: (a, b) => cmpNulosNoFim(a.inscricoesAte, b.inscricoesAte) || cmpNulosNoFim(a.dataEvento, b.dataEvento),
    confianca: (a, b) => (b.confianca || 0) - (a.confianca || 0) || cmp(b.dataPublicacao, a.dataPublicacao),
  };

  function cmp(a, b) {
    const x = a || "";
    const y = b || "";
    return x < y ? -1 : x > y ? 1 : 0;
  }

  function cmpNulosNoFim(a, b) {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    return cmp(a, b);
  }

  /**
   * "Acionavel": o anuncio da ao atleta algum caminho concreto para participar
   * (data, prazo, formulario ou contato). Mesma regra do driver Postgres.
   */
  function ehAcionavel(r) {
    return Boolean(
      r.dataEvento ||
        r.inscricoesAte ||
        r.linkInscricao ||
        (r.contatoWhatsapp || []).length ||
        (r.contatoEmails || []).length
    );
  }

  function passa(r, f) {
    if (f.esporte?.length) {
      const bate = f.esporte.includes(r.esporte) || (r.esportes || []).some((e) => f.esporte.includes(e));
      if (!bate) return false;
    }
    if (f.uf?.length && !f.uf.includes(r.uf)) return false;
    if (f.cidade && !(r.busca || "").includes(semAcento(f.cidade))) return false;
    if (f.status?.length && !f.status.includes(r.status)) return false;
    if (f.genero?.length && r.genero && r.genero !== "misto" && !f.genero.includes(r.genero)) return false;
    if (f.categoria?.length && !(r.categorias || []).some((c) => f.categoria.includes(c))) return false;
    if (f.clube && !(r.busca || "").includes(semAcento(f.clube))) return false;
    if (f.fonte?.length && !f.fonte.includes(r.fonteId)) return false;
    if (f.q) {
      for (const termo of f.q.split(/\s+/).filter(Boolean).slice(0, 6)) {
        if (!(r.busca || "").includes(semAcento(termo))) return false;
      }
    }
    if (f.gratuita === true && r.gratuita !== true) return false;
    if (f.gratuita === false && r.gratuita !== false) return false;
    if (f.taxaMax != null && r.taxa != null && r.taxa > f.taxaMax) return false;
    if (f.anoNascimento != null && !(r.anosNascimento || []).includes(f.anoNascimento)) return false;
    if (f.desde) {
      const ok = r.dataEvento
        ? r.dataEvento >= f.desde
        : (r.dataPublicacao || "").slice(0, 10) >= f.desde;
      if (!ok) return false;
    }
    if (f.ate && r.dataEvento && r.dataEvento > f.ate) return false;
    if (f.publicadoDesde && (r.dataPublicacao || "") < f.publicadoDesde) return false;
    if (f.confiancaMin != null && (r.confianca || 0) < f.confiancaMin) return false;
    if (f.acionavel != null && ehAcionavel(r) !== f.acionavel) return false;
    return true;
  }

  async function buscar(filtros = {}) {
    const todos = Object.values(estado.peneiras).filter((r) => passa(r, filtros));
    todos.sort(ORDENACOES[filtros.ordenar] || ORDENACOES.recentes);

    const limite = Math.min(Math.max(Number(filtros.limite) || 50, 1), 500);
    const offset = Math.max(Number(filtros.offset) || 0, 0);
    const pagina = todos.slice(offset, offset + limite).map((r) => {
      const { busca, ...resto } = r;
      if (filtros.incluirTexto) return resto;
      const { textoCompleto, ...publico } = resto;
      return publico;
    });

    return { total: todos.length, itens: pagina };
  }

  async function obterPorId(id) {
    const direto = estado.peneiras[id];
    if (direto) {
      const { busca, ...resto } = direto;
      return resto;
    }
    const porSlug = Object.values(estado.peneiras).find((r) => r.slug === id);
    if (!porSlug) return null;
    const { busca, ...resto } = porSlug;
    return resto;
  }

  async function estatisticas() {
    const todos = Object.values(estado.peneiras);
    const hoje = hojeISO();
    const contar = (chave, nomeChave) => {
      const mapa = new Map();
      for (const r of todos) {
        const k = r[chave];
        if (k == null) continue;
        if (!mapa.has(k)) mapa.set(k, { chave: k, nome: nomeChave ? r[nomeChave] : undefined, n: 0 });
        mapa.get(k).n++;
      }
      return [...mapa.values()].sort((a, b) => b.n - a.n);
    };

    return {
      total: todos.length,
      abertas: todos.filter((r) => r.status === "aberta").length,
      futuras: todos.filter((r) => r.dataEvento && r.dataEvento >= hoje).length,
      ultimaColeta: todos.reduce((max, r) => (r.coletadoEm > max ? r.coletadoEm : max), "") || null,
      porEsporte: contar("esporte", "esporteNome"),
      porEstado: contar("uf", "estado"),
      porStatus: contar("status"),
      porFonte: contar("fonteId", "fonteNome").slice(0, 40),
    };
  }

  async function reavaliarStatus() {
    const hoje = hojeISO();
    let n = 0;
    for (const r of Object.values(estado.peneiras)) {
      if (r.status === "encerrada") continue;
      const venceu =
        (r.inscricoesAte && r.inscricoesAte < hoje) || (r.dataEvento && r.dataEvento < hoje);
      if (venceu) {
        r.status = "encerrada";
        n++;
      }
    }
    if (n) await agendarGravacao();
    return n;
  }

  /** Remove registros por id. Devolve quantos foram apagados. */
  async function remover(ids) {
    if (!ids || !ids.length) return 0;
    let n = 0;
    for (const id of ids) {
      if (estado.peneiras[id]) {
        delete estado.peneiras[id];
        n++;
      }
    }
    if (n) await agendarGravacao();
    return n;
  }

  async function limpar(diasRetencao) {
    const corte = new Date(Date.now() - diasRetencao * 86400000).toISOString().slice(0, 10);
    let n = 0;
    for (const [id, r] of Object.entries(estado.peneiras)) {
      if (r.status !== "encerrada") continue;
      const referencia = r.dataEvento || r.inscricoesAte || (r.dataPublicacao || "").slice(0, 10);
      if (referencia && referencia < corte) {
        delete estado.peneiras[id];
        n++;
      }
    }
    if (n) await agendarGravacao();
    return n;
  }

  async function registrarColeta(info) {
    const id = (estado.coletas[0]?.id || 0) + 1;
    estado.coletas.unshift({ id, ...info, detalhes: undefined });
    estado.coletas = estado.coletas.slice(0, 50);
    await agendarGravacao();
    return id;
  }

  async function ultimasColetas(limite = 10) {
    return estado.coletas.slice(0, limite);
  }

  async function saude() {
    return true;
  }

  async function fechar() {
    await agendarGravacao();
  }

  return {
    driver: "jsonstore",
    arquivo,
    init,
    salvarLote,
    buscar,
    obterPorId,
    estatisticas,
    reavaliarStatus,
    remover,
    limpar,
    registrarColeta,
    ultimasColetas,
    saude,
    fechar,
  };
}

module.exports = { criar };
