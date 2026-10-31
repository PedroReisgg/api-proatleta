// scripts/teste-db.js
// Verifica o driver de Postgres sem precisar de um banco: consistencia entre
// o registro canonico, o mapa de colunas e o DDL, e a montagem do WHERE
// (onde um placeholder repetido ja causou bug).
//
// Se DATABASE_URL estiver definida, roda tambem um teste de ida e volta real.

const { COLUNAS, CRIAR_TABELAS, montarBusca, CAMPOS_PUBLICOS } = require("../src/db/schema");
const { montarWhere, ordenacao, ORDENACOES } = require("../src/db/where");
const { normalizar } = require("../src/collector/normalize");
const { htmlParaTexto } = require("../src/util/text");

let falhas = 0;
let total = 0;

function conferir(nome, condicao, detalhe) {
  total++;
  if (condicao) console.log(`ok      ${nome}`);
  else {
    falhas++;
    console.log(`FALHOU  ${nome}${detalhe ? ` -- ${detalhe}` : ""}`);
  }
}

// ----------------------------------------------------- registro de referencia
const FONTE = {
  id: "fonte-teste",
  nome: "Fonte de teste",
  base: "https://exemplo.com.br",
  tipo: "wordpress",
  esportePadrao: "futebol",
};

const registro = normalizar(
  {
    titulo: "Clube Teste abre peneira do sub-17",
    texto: htmlParaTexto(
      "<p>O Clube Teste realiza avaliacao tecnica do Sub-17 para atletas nascidos em 2010 e 2011, " +
        "no Ginasio Municipal Central, em Campinas, dia 20 de dezembro de 2026. " +
        "Taxa de inscricao: R$ 40,00. Inscricoes abertas ate 15/12/2026 pelo WhatsApp (19) 99999-1234 " +
        "ou pelo formulario https://docs.google.com/forms/d/e/abc/viewform</p>"
    ),
    // URL unica por execucao: garante que a primeira gravacao seja um INSERT
    // de verdade, e o registro e apagado no fim do teste.
    url: `https://exemplo.com.br/peneira-sub-17-teste-${Date.now()}`,
    publicadoEm: "2026-11-01T10:00:00",
    slugs: ["sao-paulo"],
  },
  FONTE
);

conferir("o registro de referencia e considerado relevante", Boolean(registro));
if (!registro) {
  console.log("\nsem registro para conferir; abortando");
  process.exit(1);
}

// -------------------------------------------- COLUNAS x registro x DDL x API
const camposDoMapa = new Set(COLUNAS.map(([campo]) => campo));
const colunasDoMapa = COLUNAS.map(([, coluna]) => coluna);

const camposDoRegistro = Object.keys({ ...registro, busca: "", vistoEm: "" });
const semColuna = camposDoRegistro.filter((c) => !camposDoMapa.has(c));
conferir(
  "todo campo do registro tem coluna no banco",
  semColuna.length === 0,
  `sem coluna: ${semColuna.join(", ")}`
);

const semCampo = COLUNAS.map(([campo]) => campo).filter(
  (campo) => !camposDoRegistro.includes(campo)
);
conferir(
  "toda coluna mapeada corresponde a um campo do registro",
  semCampo.length === 0,
  `sem campo: ${semCampo.join(", ")}`
);

const colunasDoDdl = new Set();
for (const linha of CRIAR_TABELAS.split("\n")) {
  const m = linha.match(/^\s{2}([a-z_]+)\s{2,}[A-Z]/);
  if (m) colunasDoDdl.add(m[1]);
}
const foraDoDdl = colunasDoMapa.filter((c) => !colunasDoDdl.has(c));
conferir(
  "toda coluna mapeada existe no CREATE TABLE",
  foraDoDdl.length === 0,
  `ausentes no DDL: ${foraDoDdl.join(", ")}`
);

conferir("nao ha coluna duplicada no mapa", new Set(colunasDoMapa).size === colunasDoMapa.length);

const publicosSemCampo = CAMPOS_PUBLICOS.filter((c) => !camposDoRegistro.includes(c));
conferir(
  "CAMPOS_PUBLICOS referencia apenas campos existentes",
  publicosSemCampo.length === 0,
  `inexistentes: ${publicosSemCampo.join(", ")}`
);

conferir("montarBusca produz texto sem acento e em minusculas", /^[^A-ZÀ-ÿ]*$/.test(montarBusca(registro)));
conferir("montarBusca inclui o clube", montarBusca(registro).includes("clube teste"));

// ----------------------------------------------- INSERT: colunas x parametros
const nomes = colunasDoMapa;
const sqlInsert = `INSERT INTO peneiras (${nomes.join(", ")}) VALUES (${nomes
  .map((_, i) => `$${i + 1}`)
  .join(", ")})`;
const qtdColunas = sqlInsert.match(/\(([^)]*)\) VALUES/)[1].split(",").length;
const qtdParams = new Set(sqlInsert.match(/\$\d+/g)).size;
conferir("o INSERT tem um parametro por coluna", qtdColunas === qtdParams, `${qtdColunas} vs ${qtdParams}`);

// ----------------------------------------------------------------- montarWhere
function conferirWhere(nome, filtros, verificacoes) {
  const { sql, val } = montarWhere(filtros);
  const usados = [...new Set((sql.match(/\$(\d+)/g) || []).map((p) => Number(p.slice(1))))];
  const maiorPlaceholder = usados.length ? Math.max(...usados) : 0;

  const problemas = [];
  if (maiorPlaceholder > val.length) {
    problemas.push(`placeholder $${maiorPlaceholder} sem valor (${val.length} valores)`);
  }
  for (let i = 1; i <= val.length; i++) {
    if (!usados.includes(i)) problemas.push(`valor $${i} nunca usado`);
  }
  if (sql.includes("?")) problemas.push("sobrou '?' sem substituir");
  for (const [descricao, ok] of Object.entries(verificacoes || {})) {
    if (!ok(sql, val)) problemas.push(descricao);
  }
  conferir(`WHERE: ${nome}`, problemas.length === 0, problemas.join("; "));
}

conferirWhere("sem filtros devolve vazio", {}, {
  "deveria ser string vazia": (sql) => sql === "",
});
conferirWhere("esporte usa o mesmo parametro duas vezes", { esporte: ["futebol"] }, {
  "esperado $1 em duas posicoes": (sql) => (sql.match(/\$1/g) || []).length === 2,
});
conferirWhere("desde usa o mesmo parametro duas vezes", { desde: "2026-11-01" }, {
  "esperado $1 em duas posicoes": (sql) => (sql.match(/\$1/g) || []).length === 2,
});
conferirWhere("busca livre gera um parametro por termo", { q: "goleiro sub 17" }, {
  "esperado 3 valores": (sql, val) => val.length === 3,
  "termos devem vir sem acento e em minuscula": (sql, val) => val.every((v) => v === v.toLowerCase()),
});
conferirWhere("gratuita nao consome parametro", { gratuita: true }, {
  "esperado 0 valores": (sql, val) => val.length === 0,
  "esperado IS TRUE": (sql) => sql.includes("gratuita IS TRUE"),
});
conferirWhere(
  "combinacao larga de filtros",
  {
    esporte: ["futebol", "futsal"],
    uf: ["SP", "RJ"],
    cidade: "Campinas",
    status: ["aberta"],
    genero: ["feminino"],
    categoria: ["sub-17"],
    clube: "Palmeiras",
    fonte: ["futebolpeneira"],
    q: "goleiro",
    gratuita: false,
    taxaMax: 50,
    anoNascimento: 2010,
    desde: "2026-11-01",
    ate: "2026-12-31",
    publicadoDesde: "2026-10-01T00:00:00Z",
    confiancaMin: 70,
  },
  {
    // 16 filtros, mas "gratuita" nao consome parametro.
    "esperado 15 valores": (sql, val) => val.length === 15,
    // Contar " AND " nao serve: a condicao de "desde" tem um AND interno.
    // Confere-se que cada filtro virou condicao, pela coluna que ele usa.
    "todos os filtros viraram condicao": (sql) =>
      [
        "esporte = ANY",
        "uf = ANY",
        "status = ANY",
        "genero = ANY",
        "categorias &&",
        "fonte_id = ANY",
        "busca LIKE",
        "gratuita IS FALSE",
        "taxa IS NULL OR taxa <=",
        "ANY(anos_nascimento)",
        "data_evento >=",
        "data_evento <=",
        "data_publicacao >=",
        "confianca >=",
      ].every((trecho) => sql.includes(trecho)),
  }
);

conferir("ordenacao conhecida e respeitada", ordenacao("evento") === ORDENACOES.evento);
conferir("ordenacao desconhecida cai no padrao", ordenacao("inventada") === ORDENACOES.recentes);

// ------------------------------------------------- teste real, se houver banco
async function testeReal() {
  if (!process.env.DATABASE_URL) {
    console.log("\naviso   DATABASE_URL ausente: o teste de ida e volta em Postgres foi pulado");
    return;
  }
  const { criar } = require("../src/db/postgres");
  const db = criar(process.env.DATABASE_URL);
  await db.init();
  conferir("Postgres: init cria as tabelas", true);

  const r1 = await db.salvarLote([registro]);
  conferir("Postgres: primeira gravacao insere", r1.inseridos === 1, JSON.stringify(r1));

  const r2 = await db.salvarLote([registro]);
  conferir("Postgres: segunda gravacao atualiza (upsert)", r2.atualizados === 1, JSON.stringify(r2));

  const achado = await db.obterPorId(registro.id);
  conferir("Postgres: le o registro de volta", achado?.id === registro.id);
  conferir("Postgres: preserva dataEvento como YYYY-MM-DD", achado?.dataEvento === registro.dataEvento,
    `${achado?.dataEvento} vs ${registro.dataEvento}`);
  conferir("Postgres: preserva arrays", JSON.stringify(achado?.categorias) === JSON.stringify(registro.categorias));
  conferir("Postgres: preserva taxa como numero", achado?.taxa === registro.taxa);

  const busca = await db.buscar({ esporte: ["futebol"], uf: ["SP"], limite: 10 });
  conferir("Postgres: busca com filtros encontra o registro", busca.itens.some((p) => p.id === registro.id));

  const stats = await db.estatisticas();
  conferir("Postgres: estatisticas responde", typeof stats.total === "number");

  await db.registrarColeta({
    iniciadaEm: new Date().toISOString(),
    concluidaEm: new Date().toISOString(),
    duracaoMs: 1,
    gatilho: "teste",
    fontesTotal: 1,
    fontesOk: 1,
    itensBrutos: 1,
    relevantes: 1,
    inseridos: 1,
    atualizados: 0,
    erros: [],
    detalhes: {},
  });
  const coletas = await db.ultimasColetas(1);
  conferir("Postgres: historico de coletas grava e le", coletas.length >= 1);

  const apagados = await db.remover([registro.id]);
  conferir("Postgres: remover apaga o registro de teste", apagados === 1, `apagados: ${apagados}`);
  conferir("Postgres: registro apagado nao e mais encontrado", (await db.obterPorId(registro.id)) === null);

  await db.fechar();
}

testeReal()
  .catch((e) => {
    falhas++;
    console.log(`FALHOU  teste real em Postgres -- ${e.message}`);
  })
  .finally(() => {
    console.log(`\n${total - falhas}/${total} verificacoes passaram`);
    process.exit(falhas ? 1 : 0);
  });
