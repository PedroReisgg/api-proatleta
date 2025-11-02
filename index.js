// index.js
require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { obterPeneiras } = require("./scraper");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "Pr0Atlet4API";
const CACHE_TTL_MINUTES = Number(process.env.CACHE_TTL_MINUTES || 10);

// --- Util: carregar/Salvar usuários simples em arquivo (apenas dev/testes) ---
const USERS_FILE = path.join(__dirname, "users.json");

function lerUsuarios() {
  if (!fs.existsSync(USERS_FILE)) return [];
  const raw = fs.readFileSync(USERS_FILE);
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function salvarUsuarios(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// --- Endpoints de autenticação ---
// POST /register  (opcional — cria usuário)
app.post("/register", (req, res) => {
  const { nome, email, senha } = req.body;
  if (!nome || !email || !senha) return res.status(400).json({ erro: "Campos faltando" });

  const users = lerUsuarios();
  if (users.find(u => u.email === email)) return res.status(400).json({ erro: "Email já cadastrado" });

  const hashed = bcrypt.hashSync(senha, 8);
  const novo = { id: users.length + 1, nome, email, senha: hashed };
  users.push(novo);
  salvarUsuarios(users);
  res.json({ mensagem: "Registrado com sucesso", usuario: { id: novo.id, nome: novo.nome, email: novo.email } });
});

// POST /login
app.post("/login", (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) return res.status(400).json({ erro: "Email e senha são necessários" });

  const users = lerUsuarios();
  const user = users.find(u => u.email === email);
  if (!user) return res.status(400).json({ erro: "Usuário não encontrado" });

  const ok = bcrypt.compareSync(senha, user.senha);
  if (!ok) return res.status(401).json({ erro: "Senha inválida" });

  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "6h" });
  res.json({ mensagem: "Login OK", token });
});

// Middleware para verificar token
function verificarToken(req, res, next) {
  const auth = req.headers["authorization"] || req.headers["Authorization"];
  if (!auth) return res.status(403).json({ erro: "Token não fornecido" });

  // Aceita "Bearer token" ou só o token
  const token = auth.startsWith("Bearer ") ? auth.split(" ")[1] : auth;

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ erro: "Token inválido" });
    req.user = decoded;
    next();
  });
}

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

// GET /peneiras (protegido)
app.get("/peneiras", verificarToken, async (req, res) => {
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
