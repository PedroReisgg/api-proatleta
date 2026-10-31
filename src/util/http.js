// src/util/http.js
// Cliente HTTP com timeout, retry com backoff, limite de concorrencia
// e limite de requisicoes por host (para nao sobrecarregar as fontes).

const axios = require("axios");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/131.0.0.0 Safari/537.36 ProAtletaBot/1.0 (+https://proatleta.com.br)";

const cliente = axios.create({
  timeout: Number(process.env.HTTP_TIMEOUT_MS || 20000),
  maxRedirects: 5,
  // Nao estourar excecao para 4xx: o chamador decide o que fazer.
  validateStatus: null,
  headers: {
    "User-Agent": UA,
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.6",
    Accept: "application/json, text/html, application/xml, text/xml, */*",
  },
  decompress: true,
  // Alguns portais municipais tem cadeia de certificado incompleta.
  httpsAgent: new (require("https").Agent)({ rejectUnauthorized: false, keepAlive: true }),
});

function esperar(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Semaforo simples para limitar execucoes simultaneas. */
function criarLimitador(max) {
  let ativos = 0;
  const fila = [];
  const liberar = () => {
    ativos--;
    const proximo = fila.shift();
    if (proximo) proximo();
  };
  return function limitar(fn) {
    return new Promise((resolve, reject) => {
      const executar = () => {
        ativos++;
        Promise.resolve()
          .then(fn)
          .then(
            (v) => {
              liberar();
              resolve(v);
            },
            (e) => {
              liberar();
              reject(e);
            }
          );
      };
      if (ativos < max) executar();
      else fila.push(executar);
    });
  };
}

const limiteGlobal = criarLimitador(Number(process.env.HTTP_CONCURRENCY || 8));
const limitesPorHost = new Map();

function limitadorDoHost(url) {
  let host = "desconhecido";
  try {
    host = new URL(url).hostname;
  } catch {
    /* mantem o padrao */
  }
  if (!limitesPorHost.has(host)) {
    limitesPorHost.set(host, criarLimitador(Number(process.env.HTTP_CONCURRENCY_HOST || 2)));
  }
  return limitesPorHost.get(host);
}

const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 522, 524]);

/**
 * GET com retry. Retorna { ok, status, data, headers, url, erro }.
 * Nunca lanca excecao: coleta de muitas fontes nao pode morrer por uma delas.
 */
async function obter(url, opcoes = {}) {
  const tentativas = opcoes.tentativas ?? Number(process.env.HTTP_RETRIES || 3);
  const porHost = limitadorDoHost(url);
  let ultimoErro = null;

  for (let i = 0; i < tentativas; i++) {
    if (i > 0) await esperar(Math.min(800 * 2 ** (i - 1), 6000) + Math.random() * 400);

    const resultado = await limiteGlobal(() =>
      porHost(async () => {
        try {
          const r = await cliente.get(url, {
            responseType: opcoes.responseType || "text",
            timeout: opcoes.timeout,
            headers: opcoes.headers,
            transformResponse: [(d) => d],
          });
          return { status: r.status, data: r.data, headers: r.headers };
        } catch (e) {
          return { erro: e.code || e.message || "erro de rede" };
        }
      })
    );

    if (resultado.erro) {
      ultimoErro = resultado.erro;
      continue;
    }
    if (RETRY_STATUS.has(resultado.status)) {
      ultimoErro = `HTTP ${resultado.status}`;
      continue;
    }
    return {
      ok: resultado.status >= 200 && resultado.status < 300,
      status: resultado.status,
      data: resultado.data,
      headers: resultado.headers,
      url,
    };
  }

  return { ok: false, status: 0, data: null, headers: {}, url, erro: ultimoErro };
}

/** GET que devolve JSON parseado (ou null se nao for JSON valido). */
async function obterJson(url, opcoes = {}) {
  const r = await obter(url, opcoes);
  if (!r.ok || !r.data) return { ...r, json: null };
  try {
    return { ...r, json: JSON.parse(r.data) };
  } catch {
    return { ...r, ok: false, json: null, erro: "resposta nao e JSON" };
  }
}

module.exports = { obter, obterJson, criarLimitador, esperar, UA };
