const fs = require("fs");
const fsPromises = require("fs/promises");
const csv = require("csv-parser");
const mammoth = require("mammoth");
const XLSX = require("xlsx");
const { PDFParse } = require("pdf-parse");

const normalizeWhitespace = (text) =>
  text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

const parsePdf = async (filePath) => {
  // pdf-parse v2 exposes a parser instance so we can keep page boundaries intact.
  const parser = new PDFParse({ data: await fsPromises.readFile(filePath) });

  try {
    const result = await parser.getText();
    const pages = result.pages
      .map((page, index) => {
        const pageNumber = page.pageNumber || index + 1;
        const pageText = normalizeWhitespace(page.text || "");
        return pageText ? `--- Page ${pageNumber} ---\n${pageText}` : "";
      })
      .filter(Boolean);

    return pages.join("\n\n").trim();
  } finally {
    await parser.destroy();
  }
};

const parseDocx = async (filePath) => {
  const result = await mammoth.extractRawText({ path: filePath });
  return normalizeWhitespace(result.value || "");
};

const parseTxt = async (filePath) => {
  const text = await fsPromises.readFile(filePath, "utf-8");
  return normalizeWhitespace(text);
};

const parseCsv = async (filePath) =>
  new Promise((resolve, reject) => {
    const rows = [];

    fs.createReadStream(filePath)
      .pipe(csv())
      .on("data", (row) => {
        const line = Object.entries(row)
          .map(([key, value]) => `${key}: ${value}`)
          .join(", ");

        if (line.trim()) {
          rows.push(line.trim());
        }
      })
      .on("end", () => resolve(rows.join("\n")))
      .on("error", reject);
  });

const parseXlsx = async (filePath) => {
  const workbook = XLSX.readFile(filePath);
  const sections = workbook.SheetNames.map((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const sheetCsv = XLSX.utils.sheet_to_csv(worksheet, { blankrows: false });
    const normalizedSheet = normalizeWhitespace(sheetCsv.replace(/,/g, ", "));

    return `--- Sheet: ${sheetName} ---\n${normalizedSheet}`;
  });

  return sections.filter(Boolean).join("\n\n").trim();
};

const parseFile = async (filePath, fileType) => {
  switch (fileType) {
    case "pdf":
      return parsePdf(filePath);
    case "docx":
      return parseDocx(filePath);
    case "txt":
      return parseTxt(filePath);
    case "web":
      return fsPromises.readFile(filePath, "utf-8");
    case "csv":
      return parseCsv(filePath);
    case "xlsx":
      return parseXlsx(filePath);
    case "mp3":
    case "wav":
    case "m4a":
      return fsPromises.readFile(filePath, "utf-8");
    default:
      throw new Error(`Unsupported file type for parsing: ${fileType}`);
  }
};

module.exports = {
  parseFile,
};
