// src/collector/extract.js
// Converte o texto bruto de um anuncio em campos estruturados.

const { semAcento, contarTermos, temTermo, htmlParaTexto } = require("../util/text");
const { extrairDatas, escolherDataEvento, hojeISO, diffDias } = require("../util/dates");
const {
  ESPORTES,
  ESTADOS,
  GENEROS,
  SLUG_PARA_UF,
  SLUG_PARA_ESPORTE,
  SINAIS_ENCERRADA,
} = require("./taxonomy");

const ANO_MIN_NASCIMENTO = 1995;
// Um ano de nascimento plausivel para categoria de base nunca e o ano corrente:
// o teto evita confundir "avaliacoes de 2026" / "temporada 2027" com nascimento.
const ANO_MAX_NASCIMENTO = new Date().getUTCFullYear() - 4;

// Degraus oficiais mais usados nas categorias de base no Brasil.
const DEGRAUS_SUB = [9, 11, 13, 15, 17, 20, 23];

/* ------------------------------------------------------------------ esporte */

/**
 * Detecta o(s) esporte(s) citados. Titulo pesa mais que o corpo.
 * @returns {{ esporte: string|null, esportes: string[] }}
 */
function detectarEsportes(titulo, corpo, dicas = {}) {
  const t = semAcento(titulo);
  const c = semAcento(corpo);
  const pontos = new Map();

  for (const esp of ESPORTES) {
    const noTitulo = contarTermos(t, esp.termos);
    const noCorpo = contarTermos(c, esp.termos);
    if (!noTitulo && !noCorpo) continue;
    pontos.set(esp.id, noTitulo * 5 * esp.peso + Math.min(noCorpo, 6) * esp.peso);
  }

  // Dicas de taxonomia do CMS (categorias/tags) valem muito.
  for (const slug of dicas.slugs || []) {
    const id = SLUG_PARA_ESPORTE[slug];
    if (id) pontos.set(id, (pontos.get(id) || 0) + 12);
  }
  // Esporte declarado no catalogo da fonte (ex: site so de basquete).
  if (dicas.esportePadrao) {
    const id = dicas.esportePadrao;
    pontos.set(id, (pontos.get(id) || 0) + 6);
  }

  // "futebol" aparece em quase todo texto de futsal; se futsal pontuou
  // claramente, nao deixa futebol roubar a classificacao principal.
  if (pontos.has("futsal") && pontos.has("futebol") && pontos.get("futsal") >= 10) {
    pontos.set("futebol", Math.min(pontos.get("futebol"), pontos.get("futsal") - 1));
  }
  // Mesmo caso entre tenis e tenis de mesa.
  if (pontos.has("tenis-de-mesa") && pontos.has("tenis")) {
    pontos.set("tenis", Math.min(pontos.get("tenis"), pontos.get("tenis-de-mesa") - 1));
  }
  // E entre volei de quadra e de praia.
  if (pontos.has("volei-de-praia") && pontos.has("voleibol") && pontos.get("volei-de-praia") >= 10) {
    pontos.set("voleibol", Math.min(pontos.get("voleibol"), pontos.get("volei-de-praia") - 1));
  }

  const ordenado = [...pontos.entries()].sort((a, b) => b[1] - a[1]);
  const principal = ordenado.length ? ordenado[0][0] : dicas.esportePadrao || null;

  // Corte relativo ao topo: um anuncio multiesportivo cita cada esporte uma
  // vez so, e um corte fixo descartaria todos menos um.
  const topo = ordenado.length ? ordenado[0][1] : 0;
  const corte = Math.max(2, topo * 0.5);
  const relevantes = ordenado.filter(([, p]) => p >= corte).map(([id]) => id);
  const lista = relevantes.length ? relevantes : principal ? [principal] : [];

  return { esporte: principal, esportes: lista, multiesportivo: lista.length >= 3 };
}

/* --------------------------------------------------------- estado e cidade */

/** Detecta UF e cidade a partir do texto e das dicas de taxonomia. */
function detectarLocalidade(titulo, corpo, dicas = {}) {
  const alvo = semAcento(`${titulo} ${corpo}`);
  let uf = null;
  let cidade = null;

  // 1. Taxonomia do CMS (ex: futebolpeneira categoriza por estado).
  for (const slug of dicas.slugs || []) {
    if (SLUG_PARA_UF[slug]) {
      uf = SLUG_PARA_UF[slug];
      break;
    }
  }

  // 2. Sigla isolada em maiusculas no titulo original (ex: "Ferroviario -CE").
  if (!uf) {
    const m = String(titulo || "").match(/(?:^|[\s\-/(,])([A-Z]{2})(?=$|[\s\-/),.])/g);
    if (m) {
      for (const bruto of m) {
        const sigla = bruto.replace(/[^A-Z]/g, "");
        if (ESTADOS.some((e) => e.uf === sigla)) {
          uf = sigla;
          break;
        }
      }
    }
  }

  // 3. Nome do estado ou de uma cidade conhecida no texto. Apelidos mais
  // longos ganham, para que "mato grosso do sul" vença "mato grosso".
  const original = `${titulo} ${corpo}`;
  let melhor = null;
  const considerar = (uf, apelido, posicao) => {
    const score = apelido.length * 10 - Math.min(posicao, 200);
    if (!melhor || score > melhor.score) melhor = { uf, apelido, score };
  };
  for (const est of ESTADOS) {
    for (const ap of est.apelidos) {
      if (temTermo(alvo, [ap])) considerar(est.uf, ap, alvo.indexOf(ap));
    }
    for (const ap of est.apelidosExatos || []) {
      const pos = original.indexOf(ap);
      if (pos !== -1) considerar(est.uf, semAcento(ap), pos);
    }
  }
  if (melhor) {
    if (!uf) uf = melhor.uf;
    // Apelido com espaco e quase sempre nome de cidade, nao do estado.
    const nomeEstado = semAcento(ESTADOS.find((e) => e.uf === melhor.uf).nome);
    if (melhor.apelido !== nomeEstado) cidade = melhor.apelido;
  }

  // 4. Cidade declarada apos marcadores comuns.
  const mCidade = `${titulo} ${corpo}`.match(
    /(?:em|na cidade de|cidade de|munic[ií]pio de)\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ÿ]+(?:\s+(?:de|da|do|dos|das)\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ]?[\wÀ-ÿ]+|\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ÿ]+){0,3})/
  );
  if (!cidade && mCidade) {
    const bruto = mCidade[1].trim();
    if (bruto.length >= 3 && bruto.length <= 40) cidade = semAcento(bruto);
  }

  return { uf, cidade: cidade ? titulizar(cidade) : null };
}

function titulizar(txt) {
  const minusculas = new Set(["de", "da", "do", "dos", "das", "e"]);
  return String(txt)
    .split(/\s+/)
    .map((p, i) => (i > 0 && minusculas.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(" ");
}

/* ----------------------------------------------------------- categorias */

/**
 * Extrai categorias (sub-N) e anos de nascimento.
 * Converte anos de nascimento em sub-N aproximado usando a temporada seguinte.
 */
function detectarCategorias(titulo, corpo) {
  const alvo = semAcento(`${titulo} ${corpo}`);
  const subs = new Set();
  const anos = new Set();

  // sub-17, sub 17, su-17, u17, sub17
  const reSub = /\b(?:sub|u)\s*[-–]?\s*(\d{1,2})\b/g;
  let m;
  while ((m = reSub.exec(alvo)) !== null) {
    const n = Number(m[1]);
    if (n >= 5 && n <= 23) subs.add(`sub-${n}`);
  }

  // anos de nascimento: "nascidos em 2010 e 2011", "entre 2007 e 2011", "2012/2013"
  const reAno = /\b(19[89]\d|20[0-2]\d)\b/g;
  const brutos = [];
  while ((m = reAno.exec(alvo)) !== null) {
    const a = Number(m[1]);
    if (a >= ANO_MIN_NASCIMENTO && a <= ANO_MAX_NASCIMENTO) brutos.push({ ano: a, pos: m.index });
  }
  // Mantem apenas anos proximos de uma expressao de nascimento, para nao
  // confundir com "temporada 2026" ou "Copa 2014".
  const reNasc = /nascid[oa]s?|natalidade|idade|ano de nascimento|categoria|aniversari/g;
  const marcadores = [];
  while ((m = reNasc.exec(alvo)) !== null) marcadores.push(m.index);
  for (const b of brutos) {
    const perto = marcadores.some((pos) => Math.abs(pos - b.pos) <= 120);
    if (perto) anos.add(b.ano);
  }

  // "entre 2007 e 2011" -> expande o intervalo
  const reIntervalo = /nascid[oa]s?\s+(?:entre|de)\s+(19[89]\d|20[0-2]\d)\s*(?:e|a|ate|–|-)\s*(19[89]\d|20[0-2]\d)/g;
  while ((m = reIntervalo.exec(alvo)) !== null) {
    const ini = Number(m[1]);
    const fim = Number(m[2]);
    if (fim > ini && fim - ini <= 14) {
      for (let a = ini; a <= fim; a++) anos.add(a);
    }
  }

  // Deriva sub-N dos anos de nascimento apenas quando o texto nao declarou
  // nenhuma categoria: um sub-N explicito e sempre mais confiavel.
  if (!subs.size && anos.size) {
    const temporada = new Date().getUTCFullYear();
    for (const a of anos) {
      const idade = temporada - a;
      const degrau = DEGRAUS_SUB.find((d) => d >= idade);
      if (degrau) subs.add(`sub-${degrau}`);
    }
  }

  return {
    categorias: [...subs].sort((a, b) => Number(a.slice(4)) - Number(b.slice(4))),
    anosNascimento: [...anos].sort(),
  };
}

/* ------------------------------------------------------------- genero */

function detectarGenero(titulo, corpo) {
  const t = semAcento(titulo);
  const c = semAcento(corpo);
  const pontuar = (termos) => contarTermos(t, termos) * 4 + Math.min(contarTermos(c, termos), 4);
  const f = pontuar(GENEROS.feminino);
  const mas = pontuar(GENEROS.masculino);
  const mi = pontuar(GENEROS.misto);
  if (mi > 0 && mi >= f && mi >= mas) return "misto";
  if (f > 0 && mas > 0) return "misto";
  if (f > mas) return "feminino";
  if (mas > f) return "masculino";
  return null;
}

/* --------------------------------------------------- taxa, local, contato */

/** Taxa de inscricao em reais; 0 quando o anuncio diz que e gratuito. */
function detectarTaxa(texto) {
  const alvo = semAcento(texto);
  if (
    temTermo(alvo, ["gratuito", "gratuita", "gratis", "sem custo", "isento", "sem taxa", "inscricao gratuita"])
  ) {
    return { taxa: 0, taxaTexto: "Gratuito" };
  }
  const m = texto.match(/R\$\s*([\d.]{1,9}(?:,\d{2})?)/);
  if (m) {
    const num = Number(m[1].replace(/\./g, "").replace(",", "."));
    if (Number.isFinite(num) && num >= 0 && num <= 100000) {
      return { taxa: num, taxaTexto: `R$ ${m[1]}` };
    }
  }
  return { taxa: null, taxaTexto: null };
}

// Apenas termos especificos: "campo", "quadra" e "clube" sozinhos apareciam em
// titulos e frases corridas e produziam locais falsos.
const MARCADORES_LOCAL = [
  "local",
  "locais",
  "endereco",
  "onde",
  "ginasio",
  "estadio",
  "centro de treinamento",
  "arena",
  "complexo esportivo",
  "vila olimpica",
  "centro olimpico",
];

/** Tenta isolar a linha que descreve o local do evento. */
function detectarLocal(texto) {
  const linhas = String(texto || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length >= 6 && l.length <= 180);

  // 1. Linha iniciada pelo emoji de localizacao.
  for (const l of linhas) {
    if (/^(?:\u{1F4CD}|\u{1F3DF}|\u{1F3DF}\u{FE0F})/u.test(l)) {
      return limparRotulo(l);
    }
  }
  // 2. Linha com rotulo explicito "Local:".
  for (const l of linhas) {
    const m = l.match(/^(?:local|locais|endere[cç]o|onde)\s*[:\-–]\s*(.+)$/i);
    if (m) return m[1].trim();
  }
  // 3. Nome proprio da instalacao dentro de um paragrafo corrido. Vem antes da
  // busca por linha solta porque e muito mais preciso.
  const instalacao = acharInstalacao(texto);
  if (instalacao) return instalacao;

  // 4. Linha curta, sem pontuacao de frase, que cite um tipo de instalacao.
  for (const l of linhas) {
    if (l.length > 80 || /https?:/i.test(l)) continue;
    if (/[.!?]\s+\p{Lu}/u.test(l)) continue; // mais de uma frase: nao e rotulo
    if (l.split(/\s+/).length > 14) continue;
    if (temTermo(semAcento(l), MARCADORES_LOCAL)) return limparRotulo(l);
  }
  return null;
}

// Tipo de instalacao seguido de nome proprio. Termos genericos como "Campo"
// entram aqui (e nao na busca por linha) porque aqui exigem o nome proprio.
const RE_INSTALACAO =
  /\b(Gin[áa]sio|Est[áa]dio|Arena|Complexo Esportivo|Vila Ol[íi]mpica|Centro Ol[íi]mpico|Centro de Treinamento|Centro Esportivo|Pra[çc]a de Esportes|Campo|Quadra|Parque|CT)\s+(d[oae]s?\s+)?([A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ÿ'".]*(?:\s+(?:d[oae]s?|e)\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ]?[\wÀ-ÿ'".]*|\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ÿ'".]*){0,4})/g;

function acharInstalacao(texto) {
  const alvo = String(texto || "");
  RE_INSTALACAO.lastIndex = 0;
  let melhor = null;
  let m;
  while ((m = RE_INSTALACAO.exec(alvo)) !== null) {
    const nome = `${m[1]} ${m[2] || ""}${m[3]}`.replace(/\s{2,}/g, " ").trim();
    if (nome.length < 8 || nome.length > 100) continue;
    // Prefere a instalacao precedida por "em/no/na", que indica o local do evento.
    const antes = alvo.slice(Math.max(0, m.index - 12), m.index);
    const prioridade = /\b(em|no|na)\s+$/i.test(antes) ? 2 : 1;
    if (!melhor || prioridade > melhor.prioridade) melhor = { nome, prioridade };
    if (prioridade === 2) break;
  }
  return melhor ? melhor.nome : null;
}

function limparRotulo(linha) {
  return linha
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/^(?:local|locais|endere[cç]o|onde)\s*[:\-–]\s*/i, "")
    .trim();
}

const RE_EMAIL = /[\w.+-]+@[\w-]+\.[\w.]{2,}/g;
const RE_TEL = /(?:\(?\d{2}\)?\s?)?(?:9\s?)?\d{4}[-\s.]?\d{4}/g;
const RE_INSTA = /(?:instagram\.com\/|@)([A-Za-z0-9_.]{3,30})/g;
const RE_URL = /https?:\/\/[^\s<>"')\]]+/g;

/** Extrai canais de contato e links de inscricao. */
function detectarContato(texto, urlOrigem) {
  const emails = [...new Set((texto.match(RE_EMAIL) || []).map((e) => e.toLowerCase()))].slice(0, 3);

  const telefones = [];
  for (const bruto of texto.match(RE_TEL) || []) {
    const digitos = bruto.replace(/\D/g, "");
    if (digitos.length >= 10 && digitos.length <= 11 && !/^(\d)\1+$/.test(digitos)) {
      telefones.push(digitos);
    }
  }

  const whatsapp = [];
  // Numero citado perto da palavra whatsapp/zap/wpp. Junta os digitos separados
  // por espacos, parenteses, pontos e hifens para que a busca encontre o numero.
  const alvo = semAcento(texto).replace(/(\d)[\s().\-]+(?=\d)/g, "$1");
  for (const d of new Set(telefones)) {
    const pos = alvo.indexOf(d.slice(-8));
    if (pos === -1) continue;
    const janela = alvo.slice(Math.max(0, pos - 90), pos + 40);
    if (/whats|wpp|zap|wha/.test(janela)) whatsapp.push(d);
  }

  const instagram = [];
  let m;
  RE_INSTA.lastIndex = 0;
  while ((m = RE_INSTA.exec(texto)) !== null) {
    const h = m[1].toLowerCase().replace(/\.$/, "");
    if (!/^(gmail|hotmail|outlook|yahoo|icloud|com|br)/.test(h)) instagram.push(h);
  }

  const links = [...new Set(texto.match(RE_URL) || [])]
    .map((u) => u.replace(/[.,;)]+$/, ""))
    .filter((u) => !/^https?:\/\/(www\.)?(facebook|twitter|x)\.com\/(sharer|intent)/i.test(u));

  const inscricao =
    links.find((u) => /docs\.google\.com\/forms|forms\.gle|forms\.office|typeform|jotform|sympla|inscri/i.test(u)) ||
    null;

  return {
    emails,
    telefones: [...new Set(telefones)].slice(0, 4),
    whatsapp: [...new Set(whatsapp)].slice(0, 3),
    instagram: [...new Set(instagram)].slice(0, 3),
    linkInscricao: inscricao,
    links: links.filter((u) => u !== urlOrigem).slice(0, 8),
  };
}

/* ------------------------------------------------------------ prazos */

/** Data limite de inscricao, quando o texto declara um prazo. */
function detectarPrazoInscricao(texto, publicadoEm) {
  const linhas = String(texto || "").split(/[\n.;!]/);
  for (const l of linhas) {
    const alvo = semAcento(l);
    if (!/(inscri|prazo|vagas|participa)/.test(alvo)) continue;
    if (!/(ate|limite|prazo|encerram|termina|fecham)/.test(alvo)) continue;
    const datas = extrairDatas(l, publicadoEm);
    if (datas.length) return datas[datas.length - 1];
  }
  return null;
}

/**
 * Situacao da peneira: "aberta", "encerrada" ou "indefinida".
 * Usa prazo, data do evento, sinais no texto e idade da publicacao.
 */
function detectarStatus({ texto, dataEvento, inscricoesAte, publicadoEm }) {
  const hoje = hojeISO();
  const alvo = semAcento(texto);

  if (inscricoesAte && inscricoesAte < hoje) return "encerrada";
  if (dataEvento && dataEvento < hoje) return "encerrada";
  if (temTermo(alvo, SINAIS_ENCERRADA)) return "encerrada";
  if (inscricoesAte && inscricoesAte >= hoje) return "aberta";
  if (dataEvento && dataEvento >= hoje) return "aberta";

  // Sem datas: publicacao recente ainda conta como potencialmente aberta.
  if (publicadoEm) {
    const dias = diffDias(hoje, String(publicadoEm).slice(0, 10));
    if (dias != null && dias <= 45) return "aberta";
    if (dias != null && dias > 180) return "encerrada";
  }
  return "indefinida";
}

/* ------------------------------------------------------------- clube */

// Marcadores que, no titulo, separam o nome do organizador do resto da frase.
// A ordem nao importa: vale sempre a ocorrencia mais a esquerda.
const CORTES_CLUBE = [
  "abre",
  "abrira",
  "abriu",
  "divulga",
  "divulgou",
  "anuncia",
  "anunciou",
  "realiza",
  "realizara",
  "promove",
  "convoca",
  "confirma",
  "define",
  "inicia",
  "recebe",
  "faz",
  "fara",
  "tera",
  "com",
  "para",
  "peneira",
  "peneiras",
  "seletiva",
  "seletivas",
  "avaliacao",
  "avaliacoes",
  "testes",
  "teste",
  "inscricoes",
  "inscricao",
  "captacao",
  "tryout",
  "confira",
  "veja",
  "saiba",
  "atencao",
];

// Quando o titulo COMECA por uma destas palavras, o trecho inicial nao e o
// nome do organizador (ex: "Aprovados em peneira do Toguro se apresentam").
const INICIO_NAO_E_CLUBE = new Set([
  "aprovados", "aprovado", "aprovadas", "aprovada",
  "selecionados", "selecionado", "classificados",
  "atleta", "atletas", "jogador", "jogadores", "jovem", "jovens",
  "garoto", "garotos", "menina", "meninas", "menino", "meninos",
  "filho", "filha", "craque", "promessa", "promessas",
  "veja", "confira", "saiba", "conheca", "entenda", "assista", "leia",
  "como", "quem", "onde", "quando", "quanto", "porque", "por",
  "apos", "depois", "antes", "durante", "ultimas", "ultimo", "ultima",
  "mais", "nova", "novo", "novas", "novos", "tudo", "isso", "este", "esta",
  "inscricoes", "inscricao", "vagas", "oportunidade", "oportunidades",
  "atencao", "urgente", "exclusivo", "video", "fotos", "galeria",
]);

/** Nome provavel do clube/organizador, derivado do titulo do anuncio. */
function detectarClube(titulo, fonteNome) {
  // Fica com o trecho antes do primeiro separador forte.
  let base = String(titulo || "").split(/[–—|:]/)[0];
  const alvo = semAcento(base);

  const primeira = alvo.trim().split(/[^a-z0-9]+/)[0];
  if (INICIO_NAO_E_CLUBE.has(primeira)) return fonteNome || null;

  // Corta na primeira palavra-marcador encontrada.
  let corte = base.length;
  for (const marcador of CORTES_CLUBE) {
    const re = new RegExp("(^|[^a-z0-9])" + marcador + "([^a-z0-9]|$)");
    const m = re.exec(alvo);
    if (m) {
      const pos = m.index + m[1].length;
      if (pos > 0 && pos < corte) corte = pos;
    }
  }
  base = base.slice(0, corte);

  base = base
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\(([^)]*)\)/g, " ")
    .replace(/\b20\d\d\b/g, " ")
    .replace(/[\s\-–]+[A-Z]{2}\s*$/, "") // sufixo de UF: "Ferroviario -CE"
    .replace(/\s{2,}/g, " ")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N})]+$/gu, "")
    .trim();

  if (base.length >= 3 && base.length <= 60) return base;
  return fonteNome || null;
}

/* ------------------------------------------------------------ fachada */

/**
 * Executa toda a extracao sobre um item bruto.
 * @param {object} bruto { titulo, html, texto, url, publicadoEm, slugs, fonte }
 */
function extrair(bruto) {
  const corpo = bruto.texto || htmlParaTexto(bruto.html || "");
  const titulo = String(bruto.titulo || "").trim();
  const completo = `${titulo}\n${corpo}`;

  const { esporte, esportes, multiesportivo } = detectarEsportes(titulo, corpo, {
    slugs: bruto.slugs || [],
    esportePadrao: bruto.esportePadrao,
  });
  const { uf, cidade } = detectarLocalidade(titulo, corpo, { slugs: bruto.slugs || [] });
  const { categorias, anosNascimento } = detectarCategorias(titulo, corpo);
  const datas = extrairDatas(completo, bruto.publicadoEm);
  const inscricoesAte = detectarPrazoInscricao(completo, bruto.publicadoEm);
  // Nao reaproveita o prazo de inscricao como data do evento: se a unica data
  // do texto e o prazo, a data da avaliacao simplesmente nao foi informada.
  const dataEvento = escolherDataEvento(
    datas.filter((d) => d !== inscricoesAte),
    bruto.publicadoEm
  );
  const { taxa, taxaTexto } = detectarTaxa(completo);
  const contato = detectarContato(completo, bruto.url);

  return {
    esporte,
    esportes,
    multiesportivo,
    uf,
    cidade,
    categorias,
    anosNascimento,
    genero: detectarGenero(titulo, corpo),
    datasCitadas: datas,
    dataEvento,
    inscricoesAte,
    taxa,
    taxaTexto,
    gratuita: taxa === 0 ? true : taxa > 0 ? false : null,
    local: detectarLocal(corpo),
    clube: detectarClube(titulo, bruto.fonteNome),
    contato,
    status: detectarStatus({ texto: completo, dataEvento, inscricoesAte, publicadoEm: bruto.publicadoEm }),
  };
}

module.exports = {
  extrair,
  detectarEsportes,
  detectarLocalidade,
  detectarCategorias,
  detectarGenero,
  detectarTaxa,
  detectarLocal,
  detectarContato,
  detectarPrazoInscricao,
  detectarStatus,
  detectarClube,
};
