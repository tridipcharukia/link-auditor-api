const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

function makeAbsolute(url, base) {
  try {
    return new URL(url, base).toString();
  } catch {
    return null;
  }
}

async function checkLink(url) {
  try {

    const response = await axios.head(url, {
      timeout: 10000,
      validateStatus: () => true,
      maxRedirects: 5
    });

    return {
      url,
      status: response.status,
      ok: response.status < 400
    };

  } catch (err) {

    return {
      url,
      status: "ERROR",
      ok: false,
      error: err.message
    };

  }
}

app.post("/audit-links", async (req, res) => {

  const { urls } = req.body;

  if (!urls || !Array.isArray(urls)) {
    return res.status(400).json({
      error: "urls array required"
    });
  }

  const results = [];

  for (const pageUrl of urls) {

    try {

      const page = await axios.get(pageUrl);

      const $ = cheerio.load(page.data);

      const links = [];

      $("a[href]").each((i, el) => {
        links.push({
          type: "anchor",
          url: makeAbsolute($(el).attr("href"), pageUrl)
        });
      });

      $("img[src]").each((i, el) => {
        links.push({
          type: "image",
          url: makeAbsolute($(el).attr("src"), pageUrl)
        });
      });

      const uniqueLinks = [
        ...new Map(
          links.map(item => [item.url, item])
        ).values()
      ];

      const checkedLinks = [];

      for (const link of uniqueLinks) {

        const checked = await checkLink(link.url);

        checkedLinks.push({
          type: link.type,
          ...checked
        });

      }

      results.push({
        page: pageUrl,
        totalLinks: checkedLinks.length,
        brokenLinks: checkedLinks.filter(x => !x.ok),
        allLinks: checkedLinks
      });

    } catch (err) {

      results.push({
        page: pageUrl,
        error: err.message
      });

    }

  }

  res.json({
    success: true,
    results
  });

});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});