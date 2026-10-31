// src/app.js
// Monta o aplicativo Express: CORS, rotas e tratamento de erro.

const express = require("express");
const config = require("./config");
const { resumoCatalogo } = require("./collector/sources");

function criarApp() {
  const app = express();
  app.disable("x-powered-by");
  // "trust proxy" nao e habilitado de proposito: nada aqui usa o IP do cliente
  // (sem rate limit por IP, sem log de IP), e confiar em X-Forwarded-For sem
  // necessidade so aumenta a superficie de ataque.

  // --- CORS -----------------------------------------------------------------
  // Sem CORS_ORIGENS, libera qualquer origem (a API e publica e somente leitura).
  app.use((req, res, next) => {
    const origem = req.get("origin");
    if (!config.corsOrigens.length) {
      res.setHeader("Access-Control-Allow-Origin", "*");
    } else if (origem && config.corsOrigens.includes(origem)) {
      res.setHeader("Access-Control-Allow-Origin", origem);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Token");
    res.setHeader("Access-Control-Max-Age", "86400");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.use(express.json({ limit: "256kb" }));

  // --- log de acesso enxuto -------------------------------------------------
  app.use((req, res, next) => {
    const inicio = Date.now();
    res.on("finish", () => {
      if (req.path === "/saude" && res.statusCode === 200) return; // nao poluir
      console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - inicio}ms)`);
    });
    next();
  });

  // --- raiz: documentacao curta --------------------------------------------
  app.get("/", (req, res) => {
    res.json({
      mensagem: "API ProAtleta - peneiras e seletivas esportivas",
      versao: "2.0.0",
      catalogoDeFontes: resumoCatalogo().ativas,
      rotas: {
        "GET /peneiras":
          "lista com filtros: esporte, uf, cidade, categoria, status, genero, clube, fonte, q, " +
          "gratuita, taxaMax, anoNascimento, desde, ate, publicadoDesde, confiancaMin, " +
          "ordenar(recentes|antigos|evento|prazo|confianca), limite, pagina",
        "GET /peneiras/abertas": "somente inscricoes abertas, ordenadas por prazo",
        "GET /peneiras/:id": "uma peneira pelo id ou slug, com o texto completo",
        "GET /esportes": "esportes suportados e quantas peneiras ha de cada",
        "GET /estados": "estados e quantas peneiras ha de cada",
        "GET /categorias": "categorias de base aceitas no filtro",
        "GET /fontes": "fontes monitoradas",
        "GET /estatisticas": "numeros gerais e historico de coletas",
        "GET /saude": "health check",
        "POST /admin/coleta": "dispara coleta (requer ADMIN_TOKEN)",
        "GET /admin/coletas": "historico detalhado (requer ADMIN_TOKEN)",
        "POST /admin/manutencao": "reavalia status e aplica retencao (requer ADMIN_TOKEN)",
      },
      exemplos: [
        "/peneiras?esporte=futebol&uf=SP&status=aberta",
        "/peneiras?esporte=basquete,voleibol&categoria=sub-17&ordenar=prazo",
        "/peneiras?q=goleiro&gratuita=1&limite=20&pagina=2",
        "/peneiras/abertas?uf=RJ",
      ],
    });
  });

  // --- rotas ----------------------------------------------------------------
  app.use(require("./routes/peneiras").router);
  app.use(require("./routes/meta").router);
  // Montado num prefixo para que o guarda de token valha apenas aqui: sem o
  // prefixo, o middleware do roteador responderia 401 a qualquer rota errada.
  app.use("/admin", require("./routes/admin").router);

  // --- 404 ------------------------------------------------------------------
  app.use((req, res) => {
    res.status(404).json({ erro: "rota nao encontrada", caminho: req.originalUrl, veja: "/" });
  });

  // --- erros ----------------------------------------------------------------
  app.use((err, req, res, next) => {
    console.error(`[erro] ${req.method} ${req.originalUrl}:`, err.stack || err.message);
    res.status(err.status || 500).json({
      erro: "erro interno",
      detalhe: config.ambiente === "production" ? undefined : err.message,
    });
  });

  return app;
}

module.exports = { criarApp };
