// src/collector/taxonomy.js
// Vocabularios usados para classificar e enriquecer cada peneira coletada.

/**
 * Esportes suportados. "termos" sao casados sem acento, em minusculas.
 * "peso" ajuda a desempatar quando um texto cita mais de um esporte.
 */
const ESPORTES = [
  {
    id: "futebol",
    nome: "Futebol",
    termos: ["futebol", "futebol de campo", "football", "soccer", "futebol feminino", "society"],
    peso: 1,
  },
  {
    id: "futsal",
    nome: "Futsal",
    termos: ["futsal", "futebol de salao", "futebol salao", "salonismo"],
    peso: 2,
  },
  {
    id: "basquete",
    nome: "Basquete",
    termos: ["basquete", "basquetebol", "basketball", "basquete 3x3", "3x3"],
    peso: 2,
  },
  {
    id: "voleibol",
    nome: "Voleibol",
    termos: ["volei", "voleibol", "volleyball", "volei de quadra"],
    peso: 2,
  },
  {
    id: "volei-de-praia",
    nome: "Vôlei de praia",
    termos: ["volei de praia", "volei praia", "beach volley", "beach tennis volei"],
    peso: 3,
  },
  {
    id: "handebol",
    nome: "Handebol",
    termos: ["handebol", "handball"],
    peso: 2,
  },
  {
    id: "tenis",
    nome: "Tênis",
    termos: ["tenis", "tennis"],
    peso: 1,
  },
  {
    id: "tenis-de-mesa",
    nome: "Tênis de mesa",
    termos: ["tenis de mesa", "tenis mesa", "table tennis", "ping pong", "pingue pongue"],
    peso: 3,
  },
  {
    id: "judo",
    nome: "Judô",
    termos: ["judo", "judoca", "judocas"],
    peso: 2,
  },
  {
    id: "natacao",
    nome: "Natação",
    termos: ["natacao", "nadador", "nadadores", "swimming"],
    peso: 2,
  },
  {
    id: "atletismo",
    nome: "Atletismo",
    termos: ["atletismo", "corrida de velocidade", "arremesso de peso", "salto em distancia"],
    peso: 2,
  },
  {
    id: "rugby",
    nome: "Rugby",
    termos: ["rugby", "rugbi"],
    peso: 2,
  },
  {
    id: "beisebol",
    nome: "Beisebol",
    termos: ["beisebol", "baseball", "softbol", "softball"],
    peso: 2,
  },
  {
    id: "ginastica",
    nome: "Ginástica",
    termos: ["ginastica artistica", "ginastica ritmica", "ginastica de trampolim", "ginastica"],
    peso: 2,
  },
  {
    // "remo" sozinho e ambiguo (Clube do Remo), por isso so a forma composta.
    id: "esportes-aquaticos",
    nome: "Esportes aquáticos",
    termos: ["polo aquatico", "nado artistico", "saltos ornamentais", "canoagem", "remo olimpico", "remo indoor"],
    peso: 2,
  },
  {
    id: "lutas",
    nome: "Lutas",
    termos: ["karate", "taekwondo", "jiu jitsu", "jiu-jitsu", "boxe", "wrestling", "luta olimpica", "muay thai"],
    peso: 2,
  },
  {
    id: "esports",
    nome: "eSports",
    termos: ["esports", "e-sports", "cyber atleta", "free fire", "league of legends"],
    peso: 3,
  },
];

/**
 * Termos que indicam que o texto e um anuncio de peneira/seletiva/avaliacao.
 * Divididos por forca do sinal.
 */
const SINAIS_FORTES = [
  "peneira",
  "peneiras",
  "seletiva",
  "seletivas",
  "avaliacao tecnica",
  "avaliacoes tecnicas",
  "teste seletivo",
  "testes seletivos",
  "captacao de atletas",
  "capitacao de atletas",
  "tryout",
  "try out",
  "open day",
  "recrutamento de atletas",
  "selecao de atletas",
  "avaliacao de atletas",
];

const SINAIS_MEDIOS = [
  "categorias de base",
  "categoria de base",
  "novos talentos",
  "busca de talentos",
  "garimpo de talentos",
  "em busca de atletas",
  "atletas nascidos",
  "nascidos em",
  "nascidos entre",
  "futuros atletas",
  "escolinha",
  "centro de treinamento",
  "divisao de base",
];

const SINAIS_INSCRICAO = [
  "inscricoes abertas",
  "inscricoes",
  "inscricao",
  "abre inscricoes",
  "abriu inscricoes",
  "como participar",
  "vagas",
  "ficha de inscricao",
  "formulario de inscricao",
  "edital",
];

/** Termos que derrubam a relevancia: noticia sobre jogo, resultado, mercado. */
const SINAIS_NEGATIVOS = [
  "resultado do jogo",
  "placar",
  "gol de",
  "campeonato brasileiro serie",
  "libertadores",
  "sul-americana",
  "copa do mundo",
  "transferencia",
  "contratacao de tecnico",
  "demitido",
  "demissao",
  "lesao",
  "artilheiro",
  "tabela de classificacao",
  "escalacao",
  "bilheteria",
  "ingressos a venda",
  "sorteio de ingressos",
  "coletiva de imprensa",
  "morre",
  "falecimento",
  "luto",
  "acidente",
  // Noticia de resultado: cita "seletiva" mas conta o que ja aconteceu.
  "campeao da seletiva",
  "campeoes da seletiva",
  "vencedores da seletiva",
  "medalha de ouro",
  "medalha de prata",
  "medalha de bronze",
  "subiu ao podio",
  "no podio",
  "conquistou o titulo",
  "conquistaram o titulo",
  "sagrou-se campeao",
  "fica com o titulo",
  "garantiu vaga no mundial",
];

/**
 * Cobertura retrospectiva: o texto fala da peneira que JA aconteceu
 * ("aprovados se apresentam", "depois de passarem pela seletiva").
 * No titulo, so sobrevive se houver data futura ou prazo em aberto.
 */
const SINAIS_RETROSPECTIVO = [
  "aprovados",
  "aprovado",
  "aprovadas",
  "aprovada",
  "selecionados",
  "selecionado",
  "se apresentam",
  "se apresentaram",
  "apresentaram",
  "depois de passarem",
  "passaram pela",
  "passou pela",
  "foi realizada",
  "foram realizadas",
  "citam",
  "revelou",
  "contou que",
  "repercussao",
  "recebe reclamacoes",
  "balanco",
];

/**
 * Artigo-agregado (resumo do dia, coluna de notas, retrospectiva). Cita
 * peneira de passagem e nunca e um anuncio: rejeicao direta.
 */
const SINAIS_AGREGADO = [
  "ultimas da",
  "ultimas do",
  "principais noticias",
  "confira aqui as principais",
  "resumo da semana",
  "resumo do dia",
  "giro de noticias",
  "retrospectiva",
  "tudo sobre o dia",
  "o que aconteceu",
  "veja os destaques",
  "entre os destaques",
];

/** Termos que indicam que a peneira ja passou. */
const SINAIS_ENCERRADA = [
  "inscricoes encerradas",
  "inscricoes encerraram",
  "encerrada",
  "encerradas",
  "peneira realizada",
  "foi realizada",
  "aconteceu no ultimo",
  "prazo encerrado",
  "vagas esgotadas",
  "esgotadas",
];

const ESTADOS = [
  { uf: "AC", nome: "Acre", apelidos: ["acre", "rio branco"] },
  { uf: "AL", nome: "Alagoas", apelidos: ["alagoas", "maceio"] },
  { uf: "AP", nome: "Amapá", apelidos: ["amapa", "macapa"] },
  { uf: "AM", nome: "Amazonas", apelidos: ["amazonas", "manaus"] },
  { uf: "BA", nome: "Bahia", apelidos: ["bahia", "baiano", "salvador", "feira de santana"] },
  { uf: "CE", nome: "Ceará", apelidos: ["ceara", "cearense", "fortaleza", "juazeiro do norte"] },
  { uf: "DF", nome: "Distrito Federal", apelidos: ["distrito federal", "brasilia", "taguatinga", "ceilandia"] },
  { uf: "ES", nome: "Espírito Santo", apelidos: ["espirito santo", "vitoria es", "vila velha", "cariacica", "linhares", "serra es"] },
  { uf: "GO", nome: "Goiás", apelidos: ["goias", "goiano", "goiania", "aparecida de goiania", "anapolis"] },
  { uf: "MA", nome: "Maranhão", apelidos: ["maranhao", "sao luis", "imperatriz"] },
  { uf: "MT", nome: "Mato Grosso", apelidos: ["mato grosso", "cuiaba", "varzea grande", "rondonopolis", "sinop"] },
  { uf: "MS", nome: "Mato Grosso do Sul", apelidos: ["mato grosso do sul", "campo grande", "dourados", "tres lagoas"] },
  { uf: "MG", nome: "Minas Gerais", apelidos: ["minas gerais", "mineiro", "belo horizonte", "uberlandia", "contagem", "juiz de fora", "uberaba", "betim", "montes claros", "divinopolis", "pocos de caldas", "caratinga", "varginha", "ipatinga"] },
  {
    // "para" sem acento colide com a preposicao, por isso o nome do estado
    // so e aceito na forma acentuada (comparada contra o texto original).
    uf: "PA",
    nome: "Pará",
    apelidos: ["paraense", "belem", "ananindeua", "santarem", "maraba", "castanhal"],
    apelidosExatos: ["Pará", "PARÁ"],
  },
  { uf: "PB", nome: "Paraíba", apelidos: ["paraiba", "joao pessoa", "campina grande"] },
  { uf: "PR", nome: "Paraná", apelidos: ["parana", "paranaense", "curitiba", "londrina", "maringa", "ponta grossa", "cascavel", "foz do iguacu", "toledo", "sao jose dos pinhais"] },
  { uf: "PE", nome: "Pernambuco", apelidos: ["pernambuco", "pernambucano", "recife", "olinda", "jaboatao", "caruaru", "petrolina"] },
  { uf: "PI", nome: "Piauí", apelidos: ["piaui", "teresina", "parnaiba"] },
  { uf: "RJ", nome: "Rio de Janeiro", apelidos: ["rio de janeiro", "carioca", "fluminense rj", "niteroi", "sao goncalo", "duque de caxias", "nova iguacu", "campos dos goytacazes", "petropolis", "volta redonda", "macae"] },
  { uf: "RN", nome: "Rio Grande do Norte", apelidos: ["rio grande do norte", "potiguar", "natal", "mossoro", "parnamirim"] },
  { uf: "RS", nome: "Rio Grande do Sul", apelidos: ["rio grande do sul", "gaucho", "porto alegre", "caxias do sul", "pelotas", "canoas", "santa maria rs", "novo hamburgo", "gravatai", "alegrete"] },
  { uf: "RO", nome: "Rondônia", apelidos: ["rondonia", "porto velho", "ji-parana", "ji parana"] },
  { uf: "RR", nome: "Roraima", apelidos: ["roraima", "boa vista rr"] },
  { uf: "SC", nome: "Santa Catarina", apelidos: ["santa catarina", "catarinense", "florianopolis", "joinville", "blumenau", "chapeco", "criciuma", "itajai", "lages", "balneario camboriu"] },
  { uf: "SP", nome: "São Paulo", apelidos: ["sao paulo", "paulista", "paulistano", "campinas", "guarulhos", "sao bernardo do campo", "santo andre", "osasco", "sorocaba", "ribeirao preto", "santos", "sao jose dos campos", "maua", "mogi das cruzes", "diadema", "jundiai", "piracicaba", "carapicuiba", "bauru", "itaquaquecetuba", "sao vicente", "franca", "praia grande", "guaruja", "taubate", "limeira", "suzano", "sumare", "barueri", "embu das artes", "sao carlos", "marilia", "indaiatuba", "cotia", "americana", "araraquara", "jacarei", "rio claro", "sao jose do rio preto", "presidente prudente", "braganca paulista", "mirassol", "guaratingueta", "pindamonhangaba"] },
  { uf: "SE", nome: "Sergipe", apelidos: ["sergipe", "aracaju"] },
  { uf: "TO", nome: "Tocantins", apelidos: ["tocantins", "palmas to", "araguaina"] },
];

/** Slugs de categoria de CMS -> UF (usado pelo adaptador WordPress). */
const SLUG_PARA_UF = {
  acre: "AC",
  alagoas: "AL",
  amapa: "AP",
  amazonas: "AM",
  bahia: "BA",
  ceara: "CE",
  "distrito-federal": "DF",
  "espirito-santo": "ES",
  goias: "GO",
  maranhao: "MA",
  "mato-grosso": "MT",
  "mato-grosso-do-sul": "MS",
  "minas-gerais": "MG",
  para: "PA",
  paraiba: "PB",
  parana: "PR",
  pernambuco: "PE",
  piaui: "PI",
  "rio-de-janeiro": "RJ",
  "rio-grande-do-norte": "RN",
  "rio-grande-do-sul": "RS",
  rondonia: "RO",
  roraima: "RR",
  "santa-catarina": "SC",
  "sao-paulo": "SP",
  sergipe: "SE",
  tocantins: "TO",
};

/** Slugs de categoria de CMS -> esporte. */
const SLUG_PARA_ESPORTE = {
  futsal: "futsal",
  "futebol-de-salao": "futsal",
  futebol: "futebol",
  "futebol-feminino": "futebol",
  basquete: "basquete",
  basquetebol: "basquete",
  volei: "voleibol",
  voleibol: "voleibol",
  "volei-de-praia": "volei-de-praia",
  handebol: "handebol",
  tenis: "tenis",
  "tenis-de-mesa": "tenis-de-mesa",
  judo: "judo",
  natacao: "natacao",
  atletismo: "atletismo",
};

const GENEROS = {
  feminino: ["feminino", "feminina", "femininas", "femininos", "meninas", "garotas", "mulheres", "sub-17 feminino"],
  masculino: ["masculino", "masculina", "masculinas", "masculinos", "meninos", "garotos", "homens"],
  misto: ["misto", "mista", "ambos os sexos", "masculino e feminino", "masculino e feminina"],
};

module.exports = {
  ESPORTES,
  SINAIS_FORTES,
  SINAIS_MEDIOS,
  SINAIS_INSCRICAO,
  SINAIS_NEGATIVOS,
  SINAIS_RETROSPECTIVO,
  SINAIS_AGREGADO,
  SINAIS_ENCERRADA,
  ESTADOS,
  SLUG_PARA_UF,
  SLUG_PARA_ESPORTE,
  GENEROS,
};
