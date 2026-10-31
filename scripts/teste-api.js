// scripts/teste-api.js
// Sobe a API num porta livre, exercita as rotas e confere o formato das
// respostas. Usa o storage configurado (JSON por padrao).
//
//   node scripts/teste-api.js

process.env.COLETA_ATIVADA = "false";
process.env.COLETAR_NO_BOOT = "false";
process.env.CACHE_TTL_SEGUNDOS = process.env.CACHE_TTL_SEGUNDOS || "0";
process.env.ADMIN_TOKEN = process.env.ADMIN_TOKEN || "token-de-teste";

const { criarApp } = require("../src/app");
const { obterDb, fecharDb } = require("../src/db");

let falhas = 0;
let total = 0;

function conferir(nome, condicao, detalhe) {
  total++;
  if (condicao) {
    console.log(`ok      ${nome}`);
  } else {
    falhas++;
    console.log(`FALHOU  ${nome}${detalhe ? ` -- ${detalhe}` : ""}`);
  }
}

async function main() {
  await obterDb();
  const app = criarApp();
  const servidor = app.listen(0);
  await new Promise((r) => servidor.once("listening", r));
  const base = `http://127.0.0.1:${servidor.address().port}`;

  const pegar = async (caminho, opcoes) => {
    const r = await fetch(base + caminho, opcoes);
    let corpo = null;
    try {
      corpo = await r.json();
    } catch {
      /* resposta sem json */
    }
    return { status: r.status, corpo };
  };

  // --- raiz -----------------------------------------------------------------
  const raiz = await pegar("/");
  conferir("GET / responde 200", raiz.status === 200, `status ${raiz.status}`);
  conferir("GET / descreve as rotas", Boolean(raiz.corpo?.rotas?.["GET /peneiras"]));

  // --- peneiras -------------------------------------------------------------
  const lista = await pegar("/peneiras?limite=5");
  conferir("GET /peneiras responde 200", lista.status === 200, `status ${lista.status}`);
  conferir(
    "GET /peneiras mantem o formato antigo (fonte/total/peneiras)",
    lista.corpo && "fonte" in lista.corpo && "total" in lista.corpo && Array.isArray(lista.corpo.peneiras)
  );
  conferir("GET /peneiras respeita o limite", (lista.corpo?.peneiras?.length || 0) <= 5);
  conferir("GET /peneiras traz paginacao", Boolean(lista.corpo?.paginacao?.limite));

  const primeira = lista.corpo?.peneiras?.[0];
  if (primeira) {
    conferir("item tem os campos de compatibilidade", Boolean(primeira.titulo && primeira.link));
    conferir(
      "item tem campos estruturados",
      "esporte" in primeira && "uf" in primeira && "categorias" in primeira && "status" in primeira
    );
    conferir("item tem campos derivados", "inscricoesAbertas" in primeira && "diasParaEvento" in primeira);
    conferir("item nao expoe o texto completo por padrao", !("textoCompleto" in primeira));

    const umItem = await pegar(`/peneiras/${primeira.id}`);
    conferir("GET /peneiras/:id responde 200", umItem.status === 200, `status ${umItem.status}`);
    conferir("GET /peneiras/:id devolve a mesma peneira", umItem.corpo?.peneira?.id === primeira.id);
  } else {
    console.log("aviso   banco vazio: pule `npm run coletar` antes para testar o conteudo");
  }

  const inexistente = await pegar("/peneiras/id-que-nao-existe-123");
  conferir("GET /peneiras/:id inexistente responde 404", inexistente.status === 404);

  // --- filtros --------------------------------------------------------------
  const futebolSp = await pegar("/peneiras?esporte=futebol&uf=SP&limite=10");
  conferir("filtro esporte+uf responde 200", futebolSp.status === 200);
  conferir(
    "filtro esporte+uf nao vaza outros estados",
    (futebolSp.corpo?.peneiras || []).every((p) => p.uf === "SP")
  );
  conferir(
    "filtro esporte+uf nao vaza outros esportes",
    (futebolSp.corpo?.peneiras || []).every(
      (p) => p.esporte === "futebol" || (p.esportes || []).includes("futebol")
    )
  );

  const apelido = await pegar("/peneiras?esporte=volei&limite=3");
  conferir("apelido 'volei' vira voleibol", apelido.corpo?.filtros?.esporte?.[0] === "voleibol");

  const invalido = await pegar("/peneiras?esporte=xadrez-de-marte&limite=3");
  conferir("esporte invalido gera aviso e nao erro", invalido.status === 200 && Boolean(invalido.corpo?.avisos));

  const cat = await pegar("/peneiras?categoria=17&limite=10");
  conferir("categoria aceita numero cru", cat.corpo?.filtros?.categoria?.[0] === "sub-17");
  conferir(
    "filtro de categoria confere",
    (cat.corpo?.peneiras || []).every((p) => (p.categorias || []).includes("sub-17"))
  );

  const abertas = await pegar("/peneiras/abertas?limite=10");
  conferir("GET /peneiras/abertas responde 200", abertas.status === 200);
  conferir(
    "GET /peneiras/abertas devolve apenas abertas",
    (abertas.corpo?.peneiras || []).every((p) => p.status === "aberta")
  );
  conferir(
    "GET /peneiras/abertas devolve apenas acionaveis",
    (abertas.corpo?.peneiras || []).every((p) => p.acionavel === true)
  );

  const acion = await pegar("/peneiras?acionavel=1&limite=20");
  conferir("filtro acionavel=1 responde 200", acion.status === 200);
  conferir(
    "filtro acionavel=1 traz so itens com caminho de inscricao",
    (acion.corpo?.peneiras || []).every(
      (p) =>
        Boolean(p.dataEvento || p.inscricoesAte || p.linkInscricao) ||
        (p.contatoWhatsapp || []).length > 0 ||
        (p.contatoEmails || []).length > 0
    )
  );
  const naoAcion = await pegar("/peneiras?acionavel=0&limite=20");
  conferir(
    "filtro acionavel=0 traz so itens sem caminho de inscricao",
    (naoAcion.corpo?.peneiras || []).every((p) => p.acionavel === false)
  );
  conferir(
    "acionavel=1 e acionavel=0 somam o total sem filtro",
    (acion.corpo?.total || 0) + (naoAcion.corpo?.total || 0) === (lista.corpo?.total || 0),
    `${acion.corpo?.total} + ${naoAcion.corpo?.total} vs ${lista.corpo?.total}`
  );

  const ordenado = await pegar("/peneiras?ordenar=evento&limite=20");
  const datas = (ordenado.corpo?.peneiras || []).map((p) => p.dataEvento).filter(Boolean);
  conferir(
    "ordenar=evento devolve datas crescentes",
    datas.every((d, i) => i === 0 || datas[i - 1] <= d)
  );

  const pagina2 = await pegar("/peneiras?limite=2&pagina=2");
  conferir("paginacao reporta a pagina pedida", pagina2.corpo?.paginacao?.pagina === 2);

  // --- metadados ------------------------------------------------------------
  for (const rota of ["/esportes", "/estados", "/categorias", "/fontes", "/estatisticas"]) {
    const r = await pegar(rota);
    conferir(`GET ${rota} responde 200`, r.status === 200, `status ${r.status}`);
  }
  const fontes = await pegar("/fontes");
  conferir("GET /fontes lista o catalogo", (fontes.corpo?.fontes?.length || 0) > 50);
  conferir("GET /fontes nao tem problemas de validacao", fontes.corpo?.resumo?.problemas?.length === 0);

  const saude = await pegar("/saude");
  conferir("GET /saude responde 200", saude.status === 200, `status ${saude.status}`);
  conferir("GET /saude confirma o banco", saude.corpo?.banco === true);

  // --- admin ----------------------------------------------------------------
  const semToken = await pegar("/admin/coletas");
  conferir("admin sem token responde 401", semToken.status === 401, `status ${semToken.status}`);

  const tokenErrado = await pegar("/admin/coletas", { headers: { Authorization: "Bearer errado" } });
  conferir("admin com token errado responde 401", tokenErrado.status === 401);

  const comToken = await pegar("/admin/coletas", {
    headers: { Authorization: `Bearer ${process.env.ADMIN_TOKEN}` },
  });
  conferir("admin com token responde 200", comToken.status === 200, `status ${comToken.status}`);
  conferir("admin devolve historico", Array.isArray(comToken.corpo?.coletas));

  const manutencao = await pegar("/admin/manutencao", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.ADMIN_TOKEN}` },
  });
  conferir("POST /admin/manutencao responde 200", manutencao.status === 200, `status ${manutencao.status}`);

  // --- 404 e CORS -----------------------------------------------------------
  const naoExiste = await pegar("/rota-que-nao-existe");
  conferir("rota inexistente responde 404", naoExiste.status === 404);

  const preflight = await fetch(`${base}/peneiras`, { method: "OPTIONS" });
  conferir("preflight CORS responde 204", preflight.status === 204, `status ${preflight.status}`);
  conferir(
    "preflight libera a origem",
    preflight.headers.get("access-control-allow-origin") === "*"
  );

  servidor.close();
  await fecharDb();

  console.log(`\n${total - falhas}/${total} verificacoes passaram`);
  process.exit(falhas ? 1 : 0);
}

main().catch(async (e) => {
  console.error("Falha no teste da API:", e);
  await fecharDb().catch(() => {});
  process.exit(1);
});
