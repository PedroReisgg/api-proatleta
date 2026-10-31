// scripts/teste-extracao.js
// Casos de regressao do motor de extracao. Rode com: npm run teste
const { extrair } = require("../src/collector/extract");
const { classificar } = require("../src/collector/classify");
const { normalizarImagem, primeiraImagemDoHtml } = require("../src/collector/imagem");
const { htmlParaTexto } = require("../src/util/text");

const CASOS = [
  {
    nome: "futebol CE com taxa e whatsapp",
    titulo: "Ferroviário -CE com novas peneiras!",
    html:
      "<p>Ferroviário-CE divulgou as avaliações de 2026!</p><p>Avaliação Técnica do Sub-17, para atletas nascidos em 2010 e 2011.</p>" +
      "<p>&#x1f4cd; Vila Olímpica Elzir Cabral<br>&#x1f4c5; 17 de novembro<br>Taxa de inscrição: R$ 50,00</p><p>Inscrições pelo WhatsApp: (85) 93300-1422</p>",
    slugs: ["ceara"],
    esportePadrao: "futebol",
    publicadoEm: "2026-10-18",
    espera: {
      esporte: "futebol",
      uf: "CE",
      clube: "Ferroviário",
      categorias: ["sub-17"],
      dataEvento: "2026-11-17",
      taxa: 50,
      local: "Vila Olímpica Elzir Cabral",
      status: "aberta",
    },
  },
  {
    nome: "basquete com intervalo de nascimento e formulario",
    titulo: "EC PINHEIROS DIVULGA PENEIRA DE BASQUETE PARA NASCIDOS ENTRE 2012 E 2015 [2026]",
    html:
      "O basquete do Pinheiros está em busca de novos talentos para a temporada de 2027! Se você nasceu entre 2012 e 2015, essa é sua chance. " +
      "Inscrições abertas até 27/11/2026! Formulário: https://docs.google.com/forms/d/e/abc/viewform",
    esportePadrao: "basquete",
    publicadoEm: "2026-10-20",
    espera: {
      esporte: "basquete",
      clube: "EC PINHEIROS",
      inscricoesAte: "2026-11-27",
      dataEvento: null,
      linkInscricao: "https://docs.google.com/forms/d/e/abc/viewform",
      status: "aberta",
    },
  },
  {
    nome: "futsal nao deve virar futebol nem esporte aquatico",
    titulo: "Remo abre inscrições para peneira do futsal de base",
    html:
      "O Clube do Remo abre inscrições para a peneira do futsal de base. As avaliações acontecem nos dias 17 e 18 de novembro " +
      "no Ginásio Serra Freire, em Belém, para atletas nascidos entre 2011 e 2014. Inscrição gratuita. Masculino.",
    slugs: ["futsal"],
    publicadoEm: "2026-10-13",
    espera: {
      esporte: "futsal",
      uf: "PA",
      cidade: "Belem",
      genero: "masculino",
      taxa: 0,
      local: "Ginásio Serra Freire",
      dataEvento: "2026-11-17",
    },
  },
  {
    nome: "volei com prazo, email e duas categorias",
    titulo: "Vôlei Renata abre peneira para categoria de base masculina",
    html:
      "As avaliações serão no Ginásio do Taquaral, em Campinas, dia 20 de novembro, para atletas sub-17 e sub-19. " +
      "Inscrições até 16/11/2026 pelo e-mail base@voleirenata.com.br",
    publicadoEm: "2026-10-10",
    espera: {
      esporte: "voleibol",
      uf: "SP",
      cidade: "Campinas",
      categorias: ["sub-17", "sub-19"],
      dataEvento: "2026-11-20",
      inscricoesAte: "2026-11-16",
      clube: "Vôlei Renata",
    },
  },
  {
    nome: "evento multiesportivo lista todos os esportes",
    titulo: "Centro Olímpico abre a 2ª Super Peneira do ano com mais de 400 vagas",
    html:
      "A Secretaria Municipal de Esportes de São Paulo abre a Super Peneira com vagas em futebol, futsal, basquete, " +
      "vôlei, handebol, judô, natação e atletismo. Inscrições até 10/12/2026.",
    publicadoEm: "2026-10-28",
    espera: { uf: "SP", multiesportivo: true, inscricoesAte: "2026-12-10", minEsportes: 6 },
  },
  {
    nome: "peneira passada deve ficar encerrada",
    titulo: "Avaliação técnica do Sub-15 foi realizada no último sábado",
    html: "A avaliação técnica aconteceu no dia 10 de março de 2026. Inscrições encerradas.",
    esportePadrao: "futebol",
    publicadoEm: "2026-03-11",
    espera: { status: "encerrada" },
  },
  {
    nome: "cobertura retrospectiva nao e anuncio",
    titulo: "Aprovados em peneira do Toguro se apresentam na Portuguesa",
    html:
      "Quatro jovens aprovados na etapa final da peneira Em Busca do Jogador Inexplicavel se apresentaram " +
      "no CT da Portuguesa. O projeto reuniu o clube e o influenciador Toguro, e os selecionados agora " +
      "passam por uma nova fase de avaliacao junto ao elenco sub-20.",
    esportePadrao: "futebol",
    publicadoEm: "2026-10-20",
    espera: { descartado: true },
  },
  {
    nome: "coluna de notas nao e anuncio",
    titulo: "Ultimas da Portuguesa: novo estatuto aprovado, peneira do Toguro recebe reclamacoes e mais",
    html:
      "Confira aqui as principais noticias da Portuguesa publicadas em 14/09/2026. Entre os destaques: " +
      "novo estatuto aprovado, peneira do Toguro, nota oficial e muito mais. Avaliacao tecnica sub-20 " +
      "para nascidos em 2007 acontece em 20 de dezembro de 2026.",
    esportePadrao: "futebol",
    publicadoEm: "2026-09-14",
    espera: { descartado: true },
  },
  {
    nome: "retrospectivo COM prazo futuro continua valendo",
    titulo: "Veja os aprovados e as novas vagas: peneira do sub-15 segue com inscricoes",
    html:
      "O clube divulgou os aprovados da primeira etapa e abriu novas vagas para o Sub-15, " +
      "para atletas nascidos em 2011. A avaliacao acontece no Ginasio Central dia 18 de dezembro de 2026. " +
      "Inscricoes abertas ate 15/12/2026.",
    esportePadrao: "futebol",
    publicadoEm: "2026-11-20",
    espera: { categorias: ["sub-15"], inscricoesAte: "2026-12-15", status: "aberta" },
  },
  {
    nome: "clube nao e o inicio do titulo quando o titulo comeca por participio",
    titulo: "Aprovados em peneira citam apoio da familia e sonho de chegar ao sub-20",
    html:
      "Depois de passarem pelas etapas da peneira, os quatro jogadores aprovados falaram sobre o caminho " +
      "percorrido ate chegar a avaliacao com o elenco sub-20 em 2026.",
    esportePadrao: "futebol",
    publicadoEm: "2026-10-21",
    espera: { descartado: true },
  },
];

let falhas = 0;
for (const caso of CASOS) {
  const r = extrair({
    titulo: caso.titulo,
    texto: htmlParaTexto(caso.html),
    url: "https://exemplo.com/post",
    publicadoEm: caso.publicadoEm,
    slugs: caso.slugs || [],
    esportePadrao: caso.esportePadrao,
    fonteNome: "Fonte de teste",
  });

  const obtido = {
    esporte: r.esporte,
    uf: r.uf,
    cidade: r.cidade,
    clube: r.clube,
    categorias: r.categorias,
    dataEvento: r.dataEvento,
    inscricoesAte: r.inscricoesAte,
    taxa: r.taxa,
    local: r.local,
    genero: r.genero,
    status: r.status,
    multiesportivo: r.multiesportivo,
    linkInscricao: r.contato.linkInscricao,
    minEsportes: r.esportes.length,
  };

  // Casos marcados com descartado: true devem ser rejeitados pelo classificador.
  if (caso.espera.descartado) {
    const { relevante, motivos } = classificar({
      titulo: caso.titulo,
      texto: htmlParaTexto(caso.html),
      extraido: r,
    });
    if (relevante) {
      falhas++;
      console.log(`FALHOU  ${caso.nome}`);
      console.log(`        esperado descarte, mas foi aceito (motivos: ${motivos.join(",")})`);
    } else {
      console.log(`ok      ${caso.nome}`);
    }
    continue;
  }

  const erros = [];
  for (const [chave, esperado] of Object.entries(caso.espera)) {
    const real = obtido[chave];
    const ok =
      chave === "minEsportes"
        ? real >= esperado
        : Array.isArray(esperado)
          ? JSON.stringify(real) === JSON.stringify(esperado)
          : real === esperado;
    if (!ok) erros.push(`${chave}: esperado ${JSON.stringify(esperado)}, obtido ${JSON.stringify(real)}`);
  }

  if (erros.length) {
    falhas++;
    console.log(`FALHOU  ${caso.nome}`);
    for (const e of erros) console.log(`        ${e}`);
  } else {
    console.log(`ok      ${caso.nome}`);
  }
}

// ------------------------------------------------------------- imagens
// A capa e o que faz a peneira aparecer com foto no site. Estes casos travam
// as regras de aceitacao e de descarte da URL da imagem.
const BASE = "https://exemplo.com.br/post/peneira";

const CASOS_IMAGEM = [
  ["absoluta e aceita", "https://exemplo.com.br/uploads/flyer.png", "https://exemplo.com.br/uploads/flyer.png"],
  ["relativa vira absoluta", "/uploads/a.jpg", "https://exemplo.com.br/uploads/a.jpg"],
  ["http vira https", "http://exemplo.com.br/a.jpg", "https://exemplo.com.br/a.jpg"],
  ["data: e descartada", "data:image/png;base64,AAA", null],
  ["gravatar e descartado", "https://secure.gravatar.com/avatar/abc", null],
  ["miniatura e descartada", "https://exemplo.com.br/foto-150x150.jpg", null],
  ["tamanho util e aceito", "https://exemplo.com.br/foto-800x600.jpg", "https://exemplo.com.br/foto-800x600.jpg"],
  ["gif de espacamento e descartado", "https://exemplo.com.br/spacer.gif", null],
  ["asset do core do WP e descartado", "https://exemplo.com.br/wp-includes/images/x.png", null],
  [
    "srcset com virgula pega a primeira",
    "https://exemplo.com.br/a.jpg 300w, https://exemplo.com.br/b.jpg 800w",
    "https://exemplo.com.br/a.jpg",
  ],
  ["srcset de uma entrada perde o descritor", "https://exemplo.com.br/p.webp 800w", "https://exemplo.com.br/p.webp"],
  ["vazio devolve null", "", null],
];

for (const [nome, entrada, esperado] of CASOS_IMAGEM) {
  const obtido = normalizarImagem(entrada, BASE);
  if (obtido === esperado) {
    console.log(`ok      imagem: ${nome}`);
  } else {
    falhas++;
    console.log(`FALHOU  imagem: ${nome}`);
    console.log(`        esperado ${JSON.stringify(esperado)}, obtido ${JSON.stringify(obtido)}`);
  }
}

const CASOS_HTML = [
  [
    "pula emoji e pega a foto",
    '<img class="emoji" src="https://s.w.org/images/core/emoji/x.png"><img src="/uploads/flyer.jpg">',
    "https://exemplo.com.br/uploads/flyer.jpg",
  ],
  [
    "prefere data-lazy-src ao placeholder",
    '<img data-lazy-src="https://exemplo.com.br/real.jpg" src="https://exemplo.com.br/placeholder.png">',
    "https://exemplo.com.br/real.jpg",
  ],
  [
    "le source srcset de picture",
    '<picture><source srcset="https://exemplo.com.br/p.webp 800w"></picture>',
    "https://exemplo.com.br/p.webp",
  ],
  ["html sem imagem devolve null", "<p>so texto</p>", null],
];

for (const [nome, html, esperado] of CASOS_HTML) {
  const obtido = primeiraImagemDoHtml(html, BASE);
  if (obtido === esperado) {
    console.log(`ok      imagem: ${nome}`);
  } else {
    falhas++;
    console.log(`FALHOU  imagem: ${nome}`);
    console.log(`        esperado ${JSON.stringify(esperado)}, obtido ${JSON.stringify(obtido)}`);
  }
}

const totalCasos = CASOS.length + CASOS_IMAGEM.length + CASOS_HTML.length;
console.log(`\n${totalCasos - falhas}/${totalCasos} casos passaram`);
process.exit(falhas ? 1 : 0);
