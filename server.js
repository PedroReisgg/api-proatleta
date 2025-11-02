const express = require('express');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 3000; // Porta onde a API vai rodar
const SECRET_KEY = 'Pr0Atlet4API'; // Chave secreta para assinar tokens (mude para algo seguro em produção)

// Middleware para parsear JSON
app.use(express.json());

// Rota de login: Gera um token se as credenciais forem válidas
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  
  // Simulação de validação (substitua por lógica real, como banco de dados)
  if (username === 'admin' && password === '123456') {
    const token = jwt.sign({ username }, SECRET_KEY, { expiresIn: '1h' }); // Token válido por 1 hora
    res.json({ token });
  } else {
    res.status(401).json({ error: 'Credenciais inválidas' });
  }
});

// Middleware para verificar token em rotas protegidas
function verifyToken(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1]; // Espera "Bearer <token>"
  
  if (!token) {
    return res.status(403).json({ error: 'Token não fornecido' });
  }
  
  jwt.verify(token, SECRET_KEY, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Token inválido' });
    }
    req.user = decoded; // Salva dados do usuário no request
    next();
  });
}

// Rota protegida: Só acessível com token válido
app.get('/protegida', verifyToken, (req, res) => {
  res.json({ message: 'Acesso autorizado!', user: req.user });
});

// Rota pública de exemplo
app.get('/', (req, res) => {
  res.json({ message: 'API ProAtleta funcionando!' });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`API rodando em http://localhost:${PORT}`);
});