const axios = require("axios");
const cheerio = require("cheerio");
const robotsParser = require("robots-parser");
const { NodeHtmlMarkdown } = require("node-html-markdown");

/**
 * Checks if a hostname falls under private IP ranges or localhost.
 * @param {string} hostname
 * @returns {boolean}
 */
const isPrivateHost = (hostname) => {
  const host = hostname.toLowerCase().trim();
  if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") {
    return true;
  }
  // Match 10.x.x.x
  if (/^10\.\d+\.\d+\.\d+$/.test(host)) return true;
  // Match 192.168.x.x
  if (/^192\.168\.\d+\.\d+$/.test(host)) return true;
  // Match 169.254.x.x
  if (/^169\.254\.\d+\.\d+$/.test(host)) return true;
  // Match 172.16.x.x - 172.31.x.x
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host)) return true;

  return false;
};

/**
 * Basic HTML entities decoder.
 * @param {string} str
 * @returns {string}
 */
const decodeHtmlEntities = (str) => {
  if (!str) return "";
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–");
};

/**
 * Scrapes a URL, cleans it, and returns markdown content + metadata.
 * @param {string} url
 * @returns {Promise<{title: string, content: string, metadata: object}>}
 */
const scrapeUrl = async (url) => {
  // A. URL Validation
  if (!url || typeof url !== "string") {
    throw new Error("Invalid URL format");
  }
  if (url.length > 2048) {
    throw new Error("URL exceeds max length of 2048 characters");
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (error) {
    throw new Error("Invalid URL format");
  }

  const protocol = parsedUrl.protocol;
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error("Invalid URL format"); // Only allow http:// and https://
  }

  if (isPrivateHost(parsedUrl.hostname)) {
    throw new Error("Access to private IP ranges or localhost is blocked");
  }

  // B. Robots.txt Check
  let allowedByRobots = true;
  try {
    const robotsTxtUrl = `${parsedUrl.origin}/robots.txt`;
    const robotsResponse = await axios.get(robotsTxtUrl, {
      timeout: 5000,
      headers: {
        "User-Agent": "RAGBot/1.0",
      },
      validateStatus: (status) => status === 200,
    });
    if (typeof robotsResponse.data === "string") {
      const robots = robotsParser(robotsTxtUrl, robotsResponse.data);
      if (!robots.isAllowed(url, "RAGBot")) {
        allowedByRobots = false;
      }
    }
  } catch (robotsError) {
    // If robots.txt check fails/times out/404s, assume allowed and proceed
    console.warn(`[Scraper] robots.txt check failed or skipped: ${robotsError.message}`);
  }

  if (!allowedByRobots) {
    throw new Error("This website does not allow scraping (robots.txt)");
  }

  // C. Fetch the Page
  let response;
  try {
    response = await axios.get(url, {
      timeout: 15000, // 15 seconds
      maxRedirects: 5,
      headers: {
        "User-Agent": "RAGBot/1.0 (document-ingestion; +https://your-app.com)",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      withCredentials: false,
    });
  } catch (error) {
    if (error.code === "ECONNABORTED" || error.message.includes("timeout")) {
      throw new Error("Request timed out after 15 seconds. The website may be slow.");
    }
    if (error.response) {
      const status = error.response.status;
      if (status === 403) {
        throw new Error("Website blocked scraping (403 Forbidden)");
      } else if (status === 404) {
        throw new Error("Page not found (404)");
      } else if (status === 429) {
        throw new Error("Website rate-limited the request. Try again later.");
      } else if (status >= 500) {
        throw new Error("Website server error. Try again later.");
      }
    }
    throw error;
  }

  // Validate Content-Type
  const contentType = (response.headers["content-type"] || "").toLowerCase();
  const cleanContentType = contentType.split(";")[0].trim();
  const allowedContentTypes = ["text/html", "text/plain", "application/xhtml+xml"];

  if (!allowedContentTypes.includes(cleanContentType)) {
    const ext = cleanContentType.split("/")[1] || "binary";
    throw new Error(`URL points to a ${ext.toUpperCase()} file. Download it and upload directly.`);
  }

  // Validate Content-Length
  const contentLength = parseInt(response.headers["content-length"] || "0", 10);
  if (contentLength > 10 * 1024 * 1024) {
    throw new Error("Content size exceeds the 10MB limit.");
  }
  const bodySize = Buffer.byteLength(response.data || "");
  if (bodySize > 10 * 1024 * 1024) {
    throw new Error("Content size exceeds the 10MB limit.");
  }

  let title = "";
  let cleanMarkdown = "";
  let description = null;
  let author = null;
  let publishedDate = null;
  let siteName = null;

  if (cleanContentType === "text/plain") {
    title = parsedUrl.pathname.split("/").pop() || parsedUrl.hostname;
    cleanMarkdown = response.data || "";
    siteName = parsedUrl.hostname;
  } else {
    // D. HTML Parsing with Cheerio
    const $ = cheerio.load(response.data || "");

    // Remove noise elements
    $(
      "script, style, noscript, iframe, nav, footer, header, " +
      ".cookie-banner, .advertisement, .ad, .sidebar, .popup, " +
      '[role="navigation"], [role="banner"], [role="complementary"]'
    ).remove();

    // Extract Title
    title = $('meta[property="og:title"]').attr("content") ||
            $('meta[name="twitter:title"]').attr("content") ||
            $("title").text() ||
            $("h1").first().text() ||
            "";
    title = title.trim();

    // Extract Main Content
    const contentSelectors = [
      "article", "[role='main']", "main", ".content", ".post-content",
      ".article-body", ".entry-content", "#content", "#main", "body"
    ];

    let mainElement = null;
    for (const selector of contentSelectors) {
      const el = $(selector);
      if (el.length > 0 && el.text().trim().length > 0) {
        mainElement = el;
        break;
      }
    }

    const contentHtml = mainElement ? (mainElement.html() || "") : $.html();

    // Extract Metadata
    description = $('meta[property="og:description"]').attr("content") ||
                  $('meta[name="description"]').attr("content") ||
                  null;

    author = $('meta[name="author"]').attr("content") ||
             $(".author").first().text() ||
             $(".byline").first().text() ||
             null;

    publishedDate = $('meta[property="article:published_time"]').attr("content") ||
                    $("time[datetime]").first().attr("datetime") ||
                    $("time").first().attr("datetime") ||
                    null;

    siteName = $('meta[property="og:site_name"]').attr("content") ||
               parsedUrl.hostname ||
               null;

    if (description) description = description.trim();
    if (author) author = author.trim();
    if (publishedDate) publishedDate = publishedDate.trim();
    if (siteName) siteName = siteName.trim();

    // E. Text Cleaning and Markdown conversion
    cleanMarkdown = NodeHtmlMarkdown.translate(contentHtml);
  }

  // Final text cleanup
  cleanMarkdown = decodeHtmlEntities(cleanMarkdown);

  const lines = cleanMarkdown.split(/\r?\n/);
  const cleanedLines = [];

  const navButtonPatterns = [
    /^home$/i, /^about$/i, /^contact$/i, /^menu$/i, /^login$/i, /^sign up$/i, /^signup$/i,
    /^search$/i, /^click here$/i, /^close$/i, /^submit$/i, /^share$/i, /^subscribe$/i,
    /^next$/i, /^previous$/i, /^prev$/i, /^read more$/i, /^comments$/i, /^navigation$/i,
    /^admin$/i, /^cart$/i, /^checkout$/i, /^register$/i, /^cancel$/i, /^learn more$/i,
    /^back to top$/i, /^scroll to top$/i
  ];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") {
      cleanedLines.push("");
      continue;
    }

    if (trimmed.length < 20) {
      const isNavOrButton = navButtonPatterns.some(pattern => pattern.test(trimmed));
      if (isNavOrButton) {
        continue;
      }
    }

    cleanedLines.push(line);
  }

  let finalMarkdown = cleanedLines.join("\n");
  finalMarkdown = finalMarkdown.replace(/^[ \t]+$/gm, ""); // strip whitespace-only lines
  finalMarkdown = finalMarkdown.replace(/\n{3,}/g, "\n\n"); // collapse 3+ newlines into 2

  if (finalMarkdown.length > 500000) {
    finalMarkdown = finalMarkdown.slice(0, 500000) + "\n\n... [Content truncated due to size limit] ...";
  }

  const charCount = finalMarkdown.length;
  const wordCount = finalMarkdown.trim().split(/\s+/).filter(Boolean).length;

  // F. Return Object
  return {
    title: title || parsedUrl.hostname,
    content: finalMarkdown,
    metadata: {
      url,
      domain: parsedUrl.hostname,
      author: author || null,
      publishedDate: publishedDate || null,
      description: description || null,
      siteName: siteName || null,
      scrapedAt: new Date().toISOString(),
      wordCount,
      charCount,
    },
  };
};

module.exports = {
  scrapeUrl,
};
