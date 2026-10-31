# API ProAtleta

API que **coleta sozinha** peneiras, seletivas e avaliações técnicas de clubes
esportivos brasileiros, estrutura os dados, guarda num banco e serve por HTTP
para o site/app do ProAtleta.

Cobre futebol, futsal, basquete, voleibol, vôlei de praia, handebol, tênis,
tênis de mesa, judô, natação, atletismo e outros.

---

## Como funciona

```
  92 fontes            4 adaptadores           extração             banco
┌──────────────┐     ┌───────────────┐     ┌─────────────┐     ┌───────────┐
│ agregadores  │     │ wordpress     │     │ esporte     │     │ Postgres  │
│ clubes       │ ──► │ rss / atom    │ ──► │ UF e cidade │ ──► │   ou      │
│ federações   │     │ sitemap       │     │ sub-N, anos │     │ arquivo   │
│ prefeituras  │     │ html          │     │ datas, taxa │     │  JSON     │
└──────────────┘     └───────────────┘     │ local, zap  │     └─────┬─────┘
                                           │ formulário  │           │
   agenda (node-cron)                      │ status      │           ▼
   incremental a cada 3h  ─────────────►   └─────────────┘      GET /peneiras
   profunda 1x por dia                      dedup + score        (seu site)
```

1. **Coleta.** Cada fonte do catálogo (`src/collector/sources.json`) é lida pelo
   adaptador do seu tipo. Sites WordPress entregam o conteúdo completo pela REST
   API; os demais vêm por RSS, sitemap ou raspagem da listagem.
2. **Extração.** O texto de cada anúncio é convertido em campos: esporte, UF,
   cidade, clube, categorias (`sub-17`), anos de nascimento, gênero, data da
   avaliação, prazo de inscrição, taxa, local, WhatsApp, e-mail e link do
   formulário.
3. **Classificação.** Um score de 0 a 100 separa anúncio de peneira de notícia
   comum. O que não passa do corte é descartado.
4. **Deduplicação.** O mesmo anúncio republicado em várias fontes vira um só
   registro, ficando a versão de maior confiança e mais completa.
5. **Armazenamento.** Upsert pela URL canônica: recoletar corrige os dados em
   vez de duplicar.
6. **Entrega.** `GET /peneiras` com filtros, paginação e cache.

### Por que não usamos o Google Notícias

A planilha de pesquisa inicial trouxe 339 artigos, mas **todos com URL
intermediária do Google Notícias**, que não resolve para o endereço oficial
(o serviço responde 429/503 e exige decodificar um protobuf instável).

Em vez disso, as 167 fontes da planilha foram usadas como **lista-semente**: cada
domínio foi sondado em busca de REST API, RSS ou sitemap próprios. Das 160
distintas, 87 se mostraram legíveis por máquina, e a elas somamos agregadores
dedicados e clubes grandes encontrados em pesquisa adicional. O resultado são
**92 fontes com URL oficial direta**, sem intermediário que possa quebrar.

---

## Rodando local

```bash
npm install
cp .env.example .env
npm run coletar          # primeira coleta (grava em data/peneiras.json)
npm start                # sobe em http://localhost:3000
```

Sem `DATABASE_URL`, os dados vão para `data/peneiras.json`. Serve para
desenvolver, mas **não** para produção no Render, cujo disco é efêmero.

### Testes

```bash
npm run teste            # regressão do motor de extração e do classificador
npm run teste:db         # consistência do schema e montagem das consultas
npm run teste:api        # sobe a API e exercita todas as rotas
npm test                 # os três
```

`npm run teste:db` roda sem banco algum (verifica schema, mapa de colunas e
SQL gerado). Se `DATABASE_URL` estiver definida, ele também faz um teste de
ida e volta real em Postgres — insert, upsert, arrays, datas e filtros. Para
exercitar o caminho de produção localmente:

```bash
docker run -d --name pg-proatleta -e POSTGRES_PASSWORD=teste -e POSTGRES_DB=proatleta -p 55432:5432 postgres:16-alpine
DATABASE_URL="postgresql://postgres:teste@127.0.0.1:55432/proatleta" npm test
```

### Coleta por linha de comando

```bash
npm run coletar                                   # incremental (prioridade 1-2)
npm run coletar:profunda                          # todas as 92 fontes
node scripts/coletar.js --fontes futebolpeneira   # só uma fonte
node scripts/coletar.js --prioridade 2 --janela 60
```

---

## Deploy no Render

### 1. Crie o banco

No painel do Render: **New → PostgreSQL** (plano free serve para começar).
Copie a **Internal Database URL**.

### 2. Configure o serviço web

Em **Environment**, defina:

| Variável | Valor |
| --- | --- |
| `DATABASE_URL` | a Internal Database URL do passo 1 |
| `ADMIN_TOKEN` | um valor longo e aleatório (protege `/admin/*`) |
| `NODE_ENV` | `production` |
| `COLETA_ATIVADA` | `true` |
| `CORS_ORIGENS` | o domínio do seu site, ex. `https://proatleta.com.br` |

Build: `npm ci --omit=dev` · Start: `npm start` · Health check: `/saude`

As tabelas são criadas sozinhas no primeiro boot. Não precisa rodar migração.

### 3. Garanta a atualização automática

O `node-cron` interno já agenda a coleta, **mas no plano gratuito o Render
hiberna o serviço quando não há tráfego, e processo hibernado não executa
cron.** Escolha uma das opções:

- **Plano pago:** nada a fazer, o cron interno basta.
- **Plano gratuito:** aponte um agendador externo gratuito
  ([cron-job.org](https://cron-job.org), GitHub Actions) para a rota de coleta
  de 3 em 3 horas. A chamada acorda o serviço e dispara a coleta:

  ```bash
  curl -X POST "https://SEU-APP.onrender.com/admin/coleta?modo=incremental" \
    -H "Authorization: Bearer SEU_ADMIN_TOKEN"
  ```

  A rota responde `202` na hora e segue coletando em background, então não há
  risco de timeout no agendador.

O arquivo [`render.yaml`](render.yaml) descreve tudo isso como Blueprint, caso
queira recriar a infraestrutura do zero.

---

## Rotas

### `GET /peneiras`

| Filtro | Exemplo | Observação |
| --- | --- | --- |
| `esporte` | `futebol` · `basquete,voleibol` | aceita apelidos (`volei`, `basket`) |
| `uf` / `estado` | `SP` · `SP,RJ` · `São Paulo` | sigla ou nome |
| `cidade` | `Campinas` | busca por texto |
| `categoria` / `sub` | `sub-17` · `17` | |
| `status` | `aberta` · `encerrada` · `indefinida` | |
| `genero` | `feminino` | inclui `misto` e os não informados |
| `clube` | `Palmeiras` | |
| `q` / `busca` | `goleiro` | busca livre, sem acento |
| `gratuita` | `1` · `0` | |
| `acionavel` | `1` · `0` | `1` = só anúncios com data, prazo, formulário ou contato |
| `taxaMax` | `50` | em reais |
| `anoNascimento` | `2010` | |
| `desde` / `ate` | `2026-11-01` · `01/11/2026` | data da avaliação |
| `publicadoDesde` | `2026-10-01` | data de publicação |
| `confiancaMin` | `70` | 0 a 100 |
| `ordenar` | `recentes` (padrão) · `evento` · `prazo` · `confianca` · `antigos` | |
| `limite` / `pagina` | `limite=20&pagina=2` | limite máximo 500 |
| `incluirTexto` | `1` | devolve o texto integral do anúncio |

Resposta (os campos `fonte`, `total` e `peneiras` têm os **mesmos nomes da
versão anterior**, então o app atual continua funcionando):

```json
{
  "fonte": "banco",
  "total": 184,
  "peneiras": [
    {
      "id": "a1b2c3d4e5f60718",
      "titulo": "Ferroviário -CE com novas peneiras!",
      "link": "https://futebolpeneira.com.br/ferroviario-ce-com-novas-peneiras",
      "resumo": "Avaliação Técnica do Sub-17, destinada a atletas nascidos...",
      "dataPublicacao": "2026-09-18T13:32:16.000Z",
      "esporte": "futebol",
      "esporteNome": "Futebol",
      "esportes": ["futebol"],
      "multiesportivo": false,
      "clube": "Ferroviário",
      "uf": "CE",
      "estado": "Ceará",
      "cidade": null,
      "local": "Vila Olímpica Elzir Cabral",
      "categorias": ["sub-17"],
      "anosNascimento": [2010, 2011],
      "genero": null,
      "dataEvento": "2026-11-17",
      "dataEventoTexto": "17 de novembro de 2026",
      "inscricoesAte": null,
      "diasParaEvento": 18,
      "taxa": 50,
      "taxaTexto": "R$ 50,00",
      "gratuita": false,
      "status": "aberta",
      "inscricoesAbertas": true,
      "acionavel": true,
      "contatoWhatsapp": ["85933001422"],
      "linkInscricao": null,
      "fonteNome": "Futebol Peneira",
      "confianca": 100
    }
  ],
  "paginacao": { "limite": 50, "pagina": 1, "offset": 0, "paginas": 4, "temProxima": true },
  "geradoEm": "2026-10-30T22:10:00.000Z"
}
```

### Outras rotas

| Rota | O que faz |
| --- | --- |
| `GET /peneiras/abertas` | só inscrições abertas **e acionáveis**, por prazo (`acionavel=0` inclui as demais) |
| `GET /peneiras/:id` | uma peneira pelo id ou slug, com o texto completo |
| `GET /esportes` | esportes suportados e quantas peneiras há de cada |
| `GET /estados` | idem por UF |
| `GET /categorias` | categorias aceitas no filtro |
| `GET /fontes` | catálogo de fontes e quanto cada uma rendeu |
| `GET /estatisticas` | números gerais e histórico de coletas |
| `GET /saude` | health check (usado pelo Render) |
| `POST /admin/coleta` | dispara coleta · requer `ADMIN_TOKEN` |
| `GET /admin/coletas` | histórico detalhado · requer `ADMIN_TOKEN` |
| `POST /admin/manutencao` | reavalia status e aplica retenção · requer `ADMIN_TOKEN` |

As rotas `/admin/*` aceitam o token em `Authorization: Bearer <token>`, no
cabeçalho `X-Admin-Token` ou em `?token=`. Sem `ADMIN_TOKEN` definido, elas
respondem `503` em vez de ficarem abertas.

---

## Consumindo no site

```js
const base = "https://SEU-APP.onrender.com";

async function carregarPeneiras({ esporte, uf, pagina = 1 } = {}) {
  // acionavel=1 deixa fora matéria jornalística sem caminho de inscrição.
  const params = new URLSearchParams({
    status: "aberta",
    acionavel: "1",
    ordenar: "prazo",
    limite: "24",
    pagina,
  });
  if (esporte) params.set("esporte", esporte);
  if (uf) params.set("uf", uf);

  const r = await fetch(`${base}/peneiras?${params}`);
  if (!r.ok) throw new Error(`API respondeu ${r.status}`);
  const { peneiras, total, paginacao } = await r.json();
  return { peneiras, total, paginacao };
}
```

Cada item traz `link` (o anúncio original) e, quando o anúncio informa,
`linkInscricao` (o formulário). Mande o atleta para o `linkInscricao` se
existir, senão para o `link`.

---

## Acrescentando uma fonte

Edite `src/collector/sources.json` e acrescente um objeto. Mínimo necessário:

```json
{
  "id": "meu-clube",
  "nome": "Meu Clube FC",
  "base": "https://meuclube.com.br",
  "tipo": "wordpress",
  "esportePadrao": "futebol",
  "ufPadrao": "SP",
  "prioridade": 2
}
```

Para descobrir o `tipo` da fonte, teste nesta ordem:

```bash
curl -s "https://SITE/wp-json/wp/v2/posts?search=peneira&per_page=1" | head -c 200   # wordpress
curl -s "https://SITE/feed" | head -c 200                                            # rss
curl -s "https://SITE/sitemap.xml" | head -c 200                                     # sitemap
```

Campos aceitos, por tipo, estão documentados no topo de
[`src/collector/sources.js`](src/collector/sources.js). Depois valide com:

```bash
node scripts/coletar.js --fontes meu-clube
```

`prioridade` 1 e 2 entram na coleta incremental (a cada 3h); 3 e 4 só na
profunda (1x por dia).

---

## Estrutura

```
index.js                      bootstrap: banco, servidor, agenda
src/
  config.js                   configuração via variáveis de ambiente
  app.js                      Express: CORS, rotas, erros
  scheduler.js                node-cron
  collector/
    index.js                  orquestra a coleta, deduplica, grava
    sources.json              catálogo das 92 fontes
    sources.js                carrega e valida o catálogo
    taxonomy.js               esportes, estados, palavras-chave
    extract.js                texto bruto -> campos estruturados
    classify.js               score de relevância
    normalize.js              registro canônico + fingerprint
    adapters/                 wordpress, rss, sitemap, html, artigo
  db/
    index.js                  escolhe o driver
    postgres.js               driver Postgres
    jsonstore.js              driver arquivo JSON
    schema.js                 colunas e DDL
  routes/                     peneiras, meta, admin, query
  util/                       http (retry/limites), text, dates
scripts/
  coletar.js                  coleta por CLI
  teste-extracao.js           regressão da extração
  teste-api.js                teste das rotas
```

---

## Limites conhecidos

- **Fontes mudam de layout.** Os adaptadores por REST API e RSS são estáveis;
  os de sitemap e HTML dependem da estrutura da página. `GET /fontes` mostra
  quanto cada fonte rendeu, e `GET /admin/coletas` registra os erros por
  execução — é por aí que se percebe uma fonte quebrada.
- **A extração é heurística.** `confianca` indica o quanto o registro é
  confiável; use `confiancaMin=70` se preferir precisão a volume. Campos que o
  anúncio não informa vêm `null`, nunca inventados.
- **Parte das fontes cobre peneira como editoria**, publicando também matérias
  de bastidor e de resultado ("os aprovados se apresentaram"). O classificador
  descarta cobertura retrospectiva e colunas de notas, mas matéria de bastidor
  ainda passa. O filtro `acionavel=1` resolve na prática: só entra o que tem
  data, prazo, formulário ou contato. Na última coleta completa, 73% dos
  registros eram acionáveis.
- **73 das 160 fontes da planilha não expõem feed nem API** e ficaram de fora.
  Entrariam só com raspagem de HTML específica, uma a uma.
- **Clubes que publicam peneira só no Instagram** não são cobertos: a API do
  Instagram exige autenticação e proíbe raspagem. Vários anúncios chegam
  indiretamente, porque os agregadores republicam o conteúdo do Instagram.
