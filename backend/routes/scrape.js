const fs = require("fs/promises");
const path = require("path");
const express = require("express");
const rateLimit = require("express-rate-limit");
const { v4: uuidv4 } = require("uuid");

const authMiddleware = require("../middleware/auth");
const { getPool } = require("../config/db");
const { addToQueue } = require("../rag/queue");
const { scrapeUrl } = require("../rag/scraper");

const router = express.Router();

// Define rate limiters as requested in security checklist
const previewLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute per IP
  message: { error: "Too many preview requests, slow down." },
});

const ingestLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute per IP
  message: { error: "Too many ingest requests, slow down." },
});

/**
 * Maps scraper error messages to HTTP status codes.
 */
const getStatusCodeForError = (err) => {
  const msg = err.message || "";
  if (
    msg.includes("Invalid URL") ||
    msg.includes("blocked") ||
    msg.includes("exceeds max length") ||
    msg.includes("format")
  ) {
    return 400;
  }
  if (
    msg.includes("robots.txt") ||
    msg.includes("403 Forbidden") ||
    msg.includes("blocked scraping")
  ) {
    return 403;
  }
  if (msg.includes("404") || msg.includes("not found")) {
    return 404;
  }
  if (msg.includes("rate-limited") || msg.includes("429")) {
    return 429;
  }
  return 500;
};

// Protect all routes with authMiddleware
router.use(authMiddleware);

// POST /api/scrape/preview
router.post("/preview", previewLimiter, async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== "string" || url.trim() === "") {
    return res.status(400).json({ error: "URL is required" });
  }

  try {
    const scraped = await scrapeUrl(url.trim());
    const first500 = scraped.content.slice(0, 500);
    const contentPreview = first500 + (scraped.content.length > 500 ? "..." : "");

    return res.json({
      title: scraped.title,
      description: scraped.metadata.description,
      wordCount: scraped.metadata.wordCount,
      charCount: scraped.metadata.charCount,
      domain: scraped.metadata.domain,
      author: scraped.metadata.author,
      publishedDate: scraped.metadata.publishedDate,
      contentPreview,
    });
  } catch (error) {
    console.error(`Scrape preview failed for ${url}:`, error);
    const status = getStatusCodeForError(error);
    return res.status(status).json({ error: error.message || "Failed to preview URL" });
  }
});

// POST /api/scrape/ingest
router.post("/ingest", ingestLimiter, async (req, res) => {
  const { url, title: titleOverride } = req.body;

  if (!url || typeof url !== "string" || url.trim() === "") {
    return res.status(400).json({ error: "URL is required" });
  }

  const trimmedUrl = url.trim();

  try {
    const pool = getPool();

    // Check if this URL already exists for this user
    const existingResult = await pool.query(
      `
        SELECT id FROM documents 
        WHERE user_id = $1 AND source_url = $2
      `,
      [req.user.id, trimmedUrl]
    );

    if (existingResult.rowCount > 0) {
      return res.status(409).json({
        error: "You have already ingested this URL",
        documentId: existingResult.rows[0].id,
      });
    }

    // Call scrapeUrl
    const scraped = await scrapeUrl(trimmedUrl);

    // Generate temp file path
    const uuid = uuidv4();
    const filename = `web_${uuid}.txt`;
    const uploadsDir = path.join(__dirname, "..", "uploads");
    const filePath = path.join(uploadsDir, filename);

    // Save scraped content to temp file
    await fs.writeFile(filePath, scraped.content, "utf-8");

    // Determine final name
    const finalName = titleOverride?.trim() || scraped.title || scraped.metadata.domain;

    // Insert into documents table
    const insertResult = await pool.query(
      `
        INSERT INTO documents (
          user_id,
          original_name,
          stored_name,
          file_path,
          file_type,
          mime_type,
          file_size,
          status,
          source_url,
          scraped_metadata
        )
        VALUES ($1, $2, $3, $4, 'web', 'text/plain', $5, 'uploaded', $6, $7::jsonb)
        RETURNING id, original_name, file_type, status, source_url
      `,
      [
        req.user.id,
        finalName,
        filename,
        path.join("uploads", filename), // Relative path to matches existing uploads
        Buffer.byteLength(scraped.content),
        trimmedUrl,
        JSON.stringify(scraped.metadata),
      ]
    );

    const doc = insertResult.rows[0];

    // Enqueue RAG pipeline
    void addToQueue(doc.id).catch((queueError) => {
      console.error(`Failed to enqueue web document ${doc.id}:`, queueError);
    });

    return res.status(201).json({
      document: doc,
      message: "URL ingestion started. Processing in background.",
    });
  } catch (error) {
    console.error(`Scrape ingestion failed for ${trimmedUrl}:`, error);
    const status = getStatusCodeForError(error);
    return res.status(status).json({ error: error.message || "Failed to ingest URL" });
  }
});

// GET /api/scrape/status/:documentId
router.get("/status/:documentId", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      `
        SELECT
          d.id,
          d.status,
          d.error_message,
          d.source_url,
          COUNT(dc.id)::INTEGER AS chunk_count
        FROM documents d
        LEFT JOIN document_chunks dc ON dc.document_id = d.id
        WHERE d.id = $1 AND d.user_id = $2
        GROUP BY d.id, d.status, d.error_message, d.source_url
      `,
      [req.params.documentId, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Document not found" });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    console.error("Fetch scrape status error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
