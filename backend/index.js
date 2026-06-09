require("dotenv").config({
  path: require("path").join(__dirname, ".env"),
});

process.env.XENOVA_CACHE_DIR = './models_cache';
const fs = require('fs');
if (!fs.existsSync('./models_cache')) {
  fs.mkdirSync('./models_cache');
}
console.log('✅ Xenova model cache dir ready: ./models_cache');

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");

const authRoutes = require("./routes/auth");
const queryRoutes = require("./routes/query");
const uploadRoutes = require("./routes/upload");
const scrapeRouter = require("./routes/scrape");
const authMiddleware = require("./middleware/auth");
const { getContainerClient } = require("./config/azureBlob");
const { initDb, getPool } = require("./config/db");
const { ensureUploadsDir } = require("./config/multer");

const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const port = process.env.PORT || 5000;

const messageRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: "Too many requests, slow down." },
});

const uploadRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
});

app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);
app.use(helmet());
app.use(compression());
app.use(express.json());

app.use("/api/conversations/:id/messages", messageRateLimiter);
app.use("/api/upload", uploadRateLimiter);

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRoutes);
app.use("/api", uploadRoutes);
app.use("/api", queryRoutes);
app.use("/api/scrape", authMiddleware, scrapeRouter);

app.use((err, req, res, next) => {
  console.error(
    `[${new Date().toISOString()}] ERROR:`,
    err.message,
    err.stack
  );

  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ error: "File too large. Max 25MB." });
  }

  if (err.name === "JsonWebTokenError") {
    return res.status(401).json({ error: "Invalid token." });
  }

  return res.status(err.status || 500).json({
    error:
      process.env.NODE_ENV === "production"
        ? "Internal server error"
        : err.message,
  });
});

const validateStartupRequirements = async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured.");
  }

  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  if (!process.env.AZURE_STORAGE_CONNECTION_STRING) {
    throw new Error("AZURE_STORAGE_CONNECTION_STRING is not configured.");
  }

  const pool = getPool();
  await pool.query("SELECT 1");

  const vectorExtensionResult = await pool.query(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_extension
      WHERE extname = 'vector'
    ) AS enabled;
  `);

  if (!vectorExtensionResult.rows[0]?.enabled) {
    throw new Error("pgvector extension is not enabled.");
  }

  const hnswIndexResult = await pool.query(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'document_chunks'
        AND indexname = 'document_chunks_embedding_hnsw_idx'
        AND indexdef ILIKE '%USING hnsw%'
    ) AS exists;
  `);

  if (!hnswIndexResult.rows[0]?.exists) {
    throw new Error(
      "HNSW index document_chunks_embedding_hnsw_idx is missing on document_chunks."
    );
  }
};

const startServer = async () => {
  try {
    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET is not configured.");
    }

    if (!process.env.AZURE_STORAGE_CONTAINER) {
      throw new Error("AZURE_STORAGE_CONTAINER is not configured.");
    }

    await initDb();
    await validateStartupRequirements();
    await getContainerClient();
    ensureUploadsDir();

    console.log('[Startup] Loading local embedding model...');
    const { warmupEmbedder } = require('./rag/localEmbedder');
    await warmupEmbedder();
    console.log('[Startup] ✅ Local embedder ready');

    console.log('=== API USAGE SUMMARY ===');
    console.log('🟢 LOCAL (Xenova): Embeddings, Query Expansion, Lang Detection, Titles');
    console.log('🔵 GEMINI API: Stream Generation, Audio Transcription only');
    console.log('========================');

    console.log('✅ Web scraping routes mounted at /api/scrape');
    app.listen(port, () => {
      console.log(`Server listening on http://localhost:${port}`);
    });
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] STARTUP_VALIDATION_ERROR:`,
      error.message
    );
    console.error(error.stack);
    process.exit(1);
  }
};

startServer();
