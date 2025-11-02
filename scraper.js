// scraper.js
const axios = require("axios");
const cheerio = require("cheerio");

const URL = "https://futebolpeneira.com.br/category/sao-paulo/";

async function fetchHTML(url) {
  const { data } = await axios.get(url, { timeout: 15000 });
  return data;
}

async function obterPeneiras() {
  try {
    const html = await fetchHTML(URL);
    const $ = cheerio.load(html);
    const peneiras = [];

    // Selecione os elementos corretos conforme o HTML do site.
    // Observe: seletores podem mudar com o tempo — adapte se necessário.
    $(".td_module_10, .td_module_9, .td_module_1").each((i, el) => {
      const titulo = $(el).find(".entry-title a").text().trim();
      const link = $(el).find(".entry-title a").attr("href");
      const resumo = $(el).find(".td-excerpt").text().trim() || null;
      const dataPublicacao = $(el).find("time").attr("datetime") || null;

      if (titulo && link) {
        peneiras.push({
          titulo,
          link,
          resumo,
          dataPublicacao,
        });
      }
    });

    return peneiras;
  } catch (err) {
    console.error("Erro no scraper:", err.message);
    throw err;
  }
}

module.exports = { obterPeneiras };
