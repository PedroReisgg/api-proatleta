// index.js
require("dotenv").config();
const express = require("express");
// REMOVIDO: fs e path (não são mais necessários sem o users.json)
// REMOVIDO: jwt e bcryptjs
const { obterPeneiras } = require("./scraper");

const app = express();

// Configuração de CORS para Cordova
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
  
  // Responder preflight requests
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
});

app.use(express.json());

const PORT = process.env.PORT || 3000;
// REMOVIDO: JWT_SECRET

const CACHE_TTL_MINUTES = Number(process.env.CACHE_TTL_MINUTES || 10);

// --- CÓDIGO DE AUTENTICAÇÃO REMOVIDO ---

// --- Cache simples para resultados do scraper ---
let cache = {
  timestamp: 0,
  data: null
};

function cacheValido() {
  const now = Date.now();
  const ttl = CACHE_TTL_MINUTES * 60 * 1000;
  return cache.data && (now - cache.timestamp < ttl);
}

// GET /peneiras (AGORA PÚBLICO)
// Esta rota é a única que seu app precisa chamar para obter os dados.
app.get("/peneiras", async (req, res) => {
  try {
    if (cacheValido()) {
      return res.json({ fonte: "cache", total: cache.data.length, peneiras: cache.data });
    }

    const dados = await obterPeneiras();
    cache = { timestamp: Date.now(), data: dados };
    res.json({ fonte: "scraper", total: dados.length, peneiras: dados });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao obter peneiras" });
  }
});

// Rota teste pública
app.get("/", (req, res) => {
  res.json({ mensagem: "API ProAtleta rodando", versao: "1.0" });
});

app.listen(PORT, () => console.log(`API ProAtleta rodando na porta ${PORT}`));


// REMOVIDA A LÓGICA DE GERENCIAMENTO DE ARQUIVO users.json
