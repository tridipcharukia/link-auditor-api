const axios = require("axios");
const cheerio = require("cheerio");

function makeAbsolute(url, base) {
  try {
    return new URL(url, base).toString();
  } catch {
    return null;
  }
}

function getStatusGroup(status) {
  if (status === 404) return "404 Not Found";
  if (status === 403) return "403 Forbidden";
  if (status >= 500) return "500 Server Error";
  if (status >= 300 && status < 400) return "Redirect";
  if (status >= 200 && status < 300) return "Working";
  return "Other Error";
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  return `"${String(value).replace(/"/g, '""')}"`;
}

function buildCsv(rows) {

  const header = [
    "Source Page",
    "Link URL",
    "Link Type",
    "HTTP Status",
    "Status Group",
    "Error"
  ];

  const lines = [header.join(",")];

  for (const row of rows) {

    lines.push([
      csvEscape(row.sourcePage),
      csvEscape(row.url),
      csvEscape(row.type),
      csvEscape(row.status),
      csvEscape(row.statusGroup),
      csvEscape(row.error || "")
    ].join(","));

  }

  return lines.join("\n");
}

async function checkLink(url) {

  try {

    const response = await axios.head(url, {
      timeout: 10000,
      validateStatus: () => true,
      maxRedirects: 5
    });

    return {
      status: response.status,
      ok: response.status < 400
    };

  } catch (err) {

    return {
      status: "ERROR",
      ok: false,
      error: err.message
    };

  }

}

module.exports = async (req, res) => {

  if (req.method !== "POST") {

    return res.status(405).json({
      error: "POST only"
    });

  }

  const { urls } = req.body;

  if (!urls || !Array.isArray(urls)) {

    return res.status(400).json({
      error: "urls array required"
    });

  }

  const allRows = [];

  for (const pageUrl of urls) {

    try {

      const page = await axios.get(pageUrl, {
        timeout: 15000,
        validateStatus: () => true
      });

      const $ = cheerio.load(page.data);

      const selectors = [
        { selector: "a[href]", attr: "href", type: "anchor" },
        { selector: "img[src]", attr: "src", type: "image" },
        { selector: "script[src]", attr: "src", type: "js" },
        { selector: "link[href]", attr: "href", type: "css" },
        { selector: "iframe[src]", attr: "src", type: "iframe" },
        { selector: "audio[src]", attr: "src", type: "audio" },
        { selector: "video[src]", attr: "src", type: "video" }
      ];

      const links = [];

      for (const item of selectors) {

        $(item.selector).each((i, el) => {

          const absoluteUrl = makeAbsolute(
            $(el).attr(item.attr),
            pageUrl
          );

          if (absoluteUrl) {

            links.push({
              sourcePage: pageUrl,
              type: item.type,
              url: absoluteUrl
            });

          }

        });

      }

      const uniqueLinks = [
        ...new Map(
          links.map(x => [`${x.type}-${x.url}`, x])
        ).values()
      ];

      for (const link of uniqueLinks) {

        const checked = await checkLink(link.url);

        allRows.push({
          sourcePage: link.sourcePage,
          url: link.url,
          type: link.type,
          status: checked.status,
          statusGroup: getStatusGroup(checked.status),
          ok: checked.ok,
          error: checked.error || ""
        });

      }

    } catch (err) {

      allRows.push({
        sourcePage: pageUrl,
        url: pageUrl,
        type: "page",
        status: "ERROR",
        statusGroup: "Other Error",
        ok: false,
        error: err.message
      });

    }

  }

  const grouped = {};

  for (const row of allRows) {

    if (!grouped[row.statusGroup]) {
      grouped[row.statusGroup] = [];
    }

    grouped[row.statusGroup].push(row);

  }

  return res.status(200).json({
    grouped,
    csv: buildCsv(allRows)
  });

};
