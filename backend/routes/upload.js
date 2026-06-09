const fs = require("fs/promises");
const mime = require("mime-types");
const express = require("express");
const multer = require("multer");
const rateLimit = require("express-rate-limit");

const { deleteBlob } = require("../config/azureBlob");
const authMiddleware = require("../middleware/auth");
const { getPool } = require("../config/db");
const { addToQueue } = require("../rag/queue");
const {
  upload,
  allowedMimeTypes,
  allowedTypesMessage,
  getFileType,
} = require("../config/multer");

const audioUploadRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 requests per hour per user
  keyGenerator: (req) => req.user.id,
  message: { error: "Too many audio uploads. Limit is 3 per hour." },
  validate: false,
});

const router = express.Router();

const formatDocument = (row) => ({
  id: row.id,
  user_id: row.user_id,
  original_name: row.original_name,
  stored_name: row.stored_name,
  file_path: row.file_path,
  file_type: row.file_type,
  mime_type: row.mime_type,
  file_size: row.file_size,
  status: row.status,
  error_message: row.error_message,
  storage_provider: row.storage_provider,
  blob_name: row.blob_name,
  blob_url: row.blob_url,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const uploadSingleFile = (req, res, next) => {
  upload.single("file")(req, res, (error) => {
    if (!error) {
      return next();
    }

    if (error.code === "LIMIT_FILE_SIZE") {
      return next(error);
    }

    if (error instanceof multer.MulterError) {
      if (error.message === allowedTypesMessage) {
        return res.status(400).json({ message: allowedTypesMessage });
      }
    }

    return res.status(400).json({
      message: error.message || "Unable to upload file",
    });
  });
};

const uploadAudioFile = (req, res, next) => {
  upload.single("audio")(req, res, (error) => {
    if (!error) {
      return next();
    }

    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "File exceeds 500MB limit." });
    }

    return res.status(400).json({
      error: error.message || "Unable to upload audio file",
    });
  });
};

router.use(authMiddleware);

router.post("/upload", uploadSingleFile, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "Please upload a file" });
  }

  const audioMimeTypes = ["audio/mpeg", "audio/wav", "audio/wave", "audio/x-wav", "audio/mp4"];
  if (audioMimeTypes.includes(req.file.mimetype)) {
    try {
      await fs.unlink(req.file.path);
    } catch (e) {}
    return res.status(400).json({ message: "Please use the audio upload endpoint for .mp3 and .wav files." });
  }

  if (req.file.size > 25 * 1024 * 1024) {
    try {
      await fs.unlink(req.file.path);
    } catch (e) {}
    return res.status(400).json({ error: "File too large. Max 25MB." });
  }

  const fileType = allowedMimeTypes[req.file.mimetype] || mime.extension(req.file.mimetype);

  try {
    const pool = getPool();
    const result = await pool.query(
      `
        INSERT INTO documents (
          user_id,
          original_name,
          stored_name,
          file_path,
          file_type,
          mime_type,
          file_size,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'uploaded')
        RETURNING *
      `,
      [
        req.user.id,
        req.file.originalname,
        req.file.filename,
        req.file.path,
        fileType,
        req.file.mimetype,
        req.file.size,
      ]
    );

    const document = formatDocument(result.rows[0]);

    // Queue ingestion in the background so uploads return immediately while RAG work continues.
    void addToQueue(document.id).catch((queueError) => {
      console.error(`Failed to enqueue document ${document.id}:`, queueError);
    });

    return res.status(201).json({ document });
  } catch (error) {
    console.error("Document upload error:", error);

    try {
      await fs.unlink(req.file.path);
    } catch (unlinkError) {
      console.error("Failed to cleanup uploaded file:", unlinkError);
    }

    return res.status(500).json({ message: "Server error" });
  }
});

router.get("/documents", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      `
        SELECT
          d.id,
          d.original_name,
          d.file_type,
          d.file_size,
          d.status,
          d.error_message,
          d.created_at,
          d.source_url,
          d.scraped_metadata,
          d.audio_metadata,
          d.processing_stage,
          d.audio_duration_seconds,
          COUNT(dc.id)::INTEGER AS chunk_count
        FROM documents d
        LEFT JOIN document_chunks dc ON dc.document_id = d.id
        WHERE d.user_id = $1
        GROUP BY d.id
        ORDER BY d.created_at DESC
      `,
      [req.user.id]
    );

    return res.json({ documents: result.rows });
  } catch (error) {
    console.error("Fetch documents error:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.delete("/documents/:id", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      `
        SELECT id, file_path, blob_name, storage_provider
        FROM documents
        WHERE id = $1 AND user_id = $2
      `,
      [req.params.id, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Document not found" });
    }

    try {
      await fs.unlink(result.rows[0].file_path);
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.error("File deletion error:", error);
        return res.status(500).json({ message: "Server error" });
      }
    }

    if (result.rows[0].storage_provider === "azure_blob") {
      try {
        await deleteBlob(result.rows[0].blob_name);
      } catch (error) {
        console.error("Azure blob deletion error:", error);
        return res.status(500).json({ message: "Server error" });
      }
    }

    await pool.query("DELETE FROM documents WHERE id = $1 AND user_id = $2", [
      req.params.id,
      req.user.id,
    ]);

    return res.status(204).send();
  } catch (error) {
    console.error("Delete document error:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.get("/documents/:id/status", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      `
        SELECT
          d.id,
          d.status,
          d.error_message,
          d.processing_stage,
          d.audio_metadata,
          d.audio_summary,
          d.audio_duration_seconds,
          COUNT(dc.id)::INTEGER AS chunk_count
        FROM documents d
        LEFT JOIN document_chunks dc ON dc.document_id = d.id
        WHERE d.id = $1 AND d.user_id = $2
        GROUP BY d.id, d.status, d.error_message, d.processing_stage, d.audio_metadata, d.audio_summary, d.audio_duration_seconds
      `,
      [req.params.id, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Document not found" });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    console.error("Fetch document status error:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

// GET /api/upload/audio/limits
router.get("/upload/audio/limits", (req, res) => {
  return res.json({
    maxSizeMB: 500,
    supportedFormats: ["mp3", "wav", "m4a"],
    maxDurationMinutes: 120,
    note: "Large files may take 5-15 minutes to transcribe",
  });
});

// POST /api/upload/audio
router.post("/upload/audio", audioUploadRateLimiter, uploadAudioFile, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Please upload an audio file" });
  }

  const audioMimeTypes = ["audio/mpeg", "audio/wav", "audio/wave", "audio/x-wav", "audio/mp4"];
  if (!audioMimeTypes.includes(req.file.mimetype)) {
    try {
      await fs.unlink(req.file.path);
    } catch (e) {}
    return res.status(400).json({ error: "Only MP3, WAV, and M4A files are supported." });
  }

  if (req.file.size > 500 * 1024 * 1024) {
    try {
      await fs.unlink(req.file.path);
    } catch (e) {}
    return res.status(400).json({ error: "File exceeds 500MB limit." });
  }

  const fileType = getFileType(req.file.mimetype);

  try {
    const pool = getPool();
    const result = await pool.query(
      `
        INSERT INTO documents (
          user_id,
          original_name,
          stored_name,
          file_path,
          file_type,
          mime_type,
          file_size,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'uploaded')
        RETURNING *
      `,
      [
        req.user.id,
        req.file.originalname,
        req.file.filename,
        req.file.path,
        fileType,
        req.file.mimetype,
        req.file.size,
      ]
    );

    const document = formatDocument(result.rows[0]);

    // Enqueue queue pipeline in background
    void addToQueue(document.id).catch((queueError) => {
      console.error(`Failed to enqueue audio document ${document.id}:`, queueError);
    });

    return res.status(201).json({
      document,
      estimatedProcessingTime: "2-10 minutes",
    });
  } catch (error) {
    console.error("Audio upload error:", error);
    try {
      await fs.unlink(req.file.path);
    } catch (unlinkError) {}
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
