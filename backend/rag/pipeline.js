const { getPool } = require("../config/db");
const { uploadFileToBlob } = require("../config/azureBlob");
const { v4: uuidv4 } = require("uuid");
const { chunkText } = require("./chunker");
const { embedBatch } = require("./embedder");
const { parseFile } = require("./parsers");

const vectorLiteral = (values) => `[${values.join(",")}]`;

const buildAudioDocument = (audioResult, document) => {
  const meta = audioResult.metadata;
  return `=== AUDIO DOCUMENT: ${document.original_name} ===
Duration: ${meta.durationFormatted || "Unknown"}
Speakers: ~${meta.estimatedSpeakers || "Unknown"}
Language: ${meta.language || "Unknown"}
Word Count: ${meta.wordCount || 0}
Transcribed: ${meta.transcribedAt}

=== SUMMARY ===
${audioResult.summary || "No summary available"}

=== FULL TRANSCRIPT ===
${audioResult.transcript}`;
};
const MAX_CHUNKS_PER_DOCUMENT = Number(
  process.env.GEMINI_MAX_CHUNKS_PER_DOCUMENT || 80
);
const EMBEDDING_BATCH_SIZE = Number(process.env.GEMINI_EMBED_BATCH_SIZE || 24);

const updateDocumentStatus = async (documentId, status, errorMessage = null) => {
  const pool = getPool();
  await pool.query(
    `
      UPDATE documents
      SET status = $2, error_message = $3, updated_at = NOW()
      WHERE id = $1
    `,
    [documentId, status, errorMessage]
  );
};

const applyChunkLimit = (chunks, documentId) => {
  if (!Number.isFinite(MAX_CHUNKS_PER_DOCUMENT) || MAX_CHUNKS_PER_DOCUMENT <= 0) {
    return {
      chunks,
      originalChunkCount: chunks.length,
      wasTruncated: false,
    };
  }

  if (chunks.length <= MAX_CHUNKS_PER_DOCUMENT) {
    return {
      chunks,
      originalChunkCount: chunks.length,
      wasTruncated: false,
    };
  }

  console.warn(
    `Processing doc ${documentId}: chunk count ${chunks.length} exceeds cap ${MAX_CHUNKS_PER_DOCUMENT}. Sampling chunks across the full document to protect embedding quota.`
  );

  const selectedIndexes = new Set();

  for (let index = 0; index < MAX_CHUNKS_PER_DOCUMENT; index += 1) {
    const scaledIndex = Math.round(
      (index * (chunks.length - 1)) / Math.max(1, MAX_CHUNKS_PER_DOCUMENT - 1)
    );
    selectedIndexes.add(scaledIndex);
  }

  return {
    chunks: chunks.filter((_, index) => selectedIndexes.has(index)),
    originalChunkCount: chunks.length,
    wasTruncated: true,
  };
};

const chunkArray = (items, size) => {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
};

const bulkInsertChunks = async (pool, document, chunks, embeddings, metadataRows) => {
  const chunkIds = chunks.map(() => uuidv4());
  const documentIds = chunks.map(() => document.id);
  const userIds = chunks.map(() => document.user_id);
  const chunkIndexes = chunks.map((chunk) => chunk.chunkIndex);
  const contents = chunks.map((chunk) => chunk.content);
  const tokenCounts = chunks.map((chunk) => chunk.tokenCount);
  const embeddingVectors = embeddings.map((embedding) => vectorLiteral(embedding));

  await pool.query(
    `
      INSERT INTO document_chunks
        (id, document_id, user_id, chunk_index, content, token_count, embedding, metadata)
      SELECT *
      FROM unnest(
        $1::uuid[],
        $2::uuid[],
        $3::uuid[],
        $4::int[],
        $5::text[],
        $6::int[],
        $7::vector[],
        $8::jsonb[]
      )
    `,
    [
      chunkIds,
      documentIds,
      userIds,
      chunkIndexes,
      contents,
      tokenCounts,
      embeddingVectors,
      metadataRows,
    ]
  );
};

const processPipeline = async (documentId) => {
  let activeStep = "initializing";

  try {
    const pool = getPool();
    console.log(`Processing doc ${documentId}: step 1/7 fetch document`);
    const documentResult = await pool.query(
      `
        SELECT
          id,
          file_path,
          file_type,
          user_id,
          original_name,
          stored_name,
          mime_type,
          source_url,
          scraped_metadata,
          audio_metadata
        FROM documents
        WHERE id = $1
      `,
      [documentId]
    );

    if (documentResult.rowCount === 0) {
      throw new Error(`Document ${documentId} not found`);
    }

    const document = documentResult.rows[0];

    activeStep = "status-processing";
    console.log(`Processing doc ${documentId}: step 2/7 mark processing`);
    await updateDocumentStatus(documentId, "processing");

    activeStep = "cleanup-old-chunks";
    // Re-processing should replace old embeddings instead of duplicating them.
    await pool.query("DELETE FROM document_chunks WHERE document_id = $1", [documentId]);

    activeStep = "parse";
    console.log(`Processing doc ${documentId}: step 3/7 parse file`);
    let rawText;
    if (document.file_type === "web") {
      const fsPromises = require("fs/promises");
      rawText = await fsPromises.readFile(document.file_path, "utf-8");
    } else if (["mp3", "wav", "m4a"].includes(document.file_type)) {
      console.log(`[Pipeline] Transcribing audio: ${document.original_name}`);
      await pool.query(
        "UPDATE documents SET status = 'processing', processing_stage = 'transcribing', updated_at = NOW() WHERE id = $1",
        [document.id]
      );
      const { transcribeAudio } = require("./audioTranscriber");
      const mimeTypeMap = { mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4" };
      const audioResult = await transcribeAudio(
        document.file_path,
        mimeTypeMap[document.file_type] || "audio/mpeg"
      );

      document.audio_metadata = audioResult.metadata;
      rawText = buildAudioDocument(audioResult, document);

      await pool.query(
        `UPDATE documents SET
           audio_metadata = $1,
           audio_summary = $2,
           audio_duration_seconds = $3,
           updated_at = NOW()
         WHERE id = $4`,
        [
          JSON.stringify(audioResult.metadata),
          audioResult.summary,
          Math.round(audioResult.metadata.duration || 0),
          document.id,
        ]
      );
    } else {
      rawText = await parseFile(document.file_path, document.file_type);
    }

    if (!rawText.trim()) {
      throw new Error("Parsed file did not produce any text content");
    }

    activeStep = "chunk";
    console.log(`Processing doc ${documentId}: step 4/7 chunk text`);
    if (["mp3", "wav", "m4a"].includes(document.file_type)) {
      await pool.query(
        "UPDATE documents SET processing_stage = 'chunking', updated_at = NOW() WHERE id = $1",
        [documentId]
      );
    }
    const rawChunks = chunkText(rawText, {
      fileType: document.file_type,
    });
    const {
      chunks,
      originalChunkCount,
      wasTruncated,
    } = applyChunkLimit(rawChunks, documentId);

    if (chunks.length === 0) {
      throw new Error("No valid chunks were generated from the parsed document");
    }

    activeStep = "embed-and-insert";
    console.log(
      `Processing doc ${documentId}: step 5/7 embed and store ${chunks.length}${wasTruncated ? ` of ${originalChunkCount}` : ""} chunks`
    );
    if (["mp3", "wav", "m4a"].includes(document.file_type)) {
      await pool.query(
        "UPDATE documents SET processing_stage = 'embedding', updated_at = NOW() WHERE id = $1",
        [documentId]
      );
    }
    for (const embeddingBatch of chunkArray(chunks, EMBEDDING_BATCH_SIZE)) {
      const embeddings = await embedBatch(
        embeddingBatch.map((chunk) => chunk.content),
        {
          taskType: "RETRIEVAL_DOCUMENT",
          title: document.original_name,
        }
      );
      const metadataRows = embeddingBatch.map((chunk) => {
        const chunkMetadata = {
          chunkIndex: chunk.chunkIndex,
          documentId: document.id,
          originalName: document.original_name,
          startChar: chunk.startChar,
          endChar: chunk.endChar,
          pageNumber: chunk.pageNumber,
          wasTruncated,
          originalChunkCount,
          storedChunkCount: chunks.length,
        };

        if (document.file_type === "web") {
          chunkMetadata.sourceUrl = document.source_url;
          chunkMetadata.domain = document.scraped_metadata?.domain;
          chunkMetadata.scrapedAt = document.scraped_metadata?.scrapedAt;
        }

        if (["mp3", "wav", "m4a"].includes(document.file_type)) {
          chunkMetadata.audioDocument = true;
          chunkMetadata.duration = document.audio_metadata?.duration;
          chunkMetadata.speakers = document.audio_metadata?.estimatedSpeakers;
          chunkMetadata.language = document.audio_metadata?.language;
        }

        return JSON.stringify(chunkMetadata);
      });

      await bulkInsertChunks(pool, document, embeddingBatch, embeddings, metadataRows);
    }

    activeStep = "azure-upload";
    console.log(`Processing doc ${documentId}: step 6/7 upload original file to Azure Blob Storage`);
    if (["mp3", "wav", "m4a"].includes(document.file_type)) {
      await pool.query(
        "UPDATE documents SET processing_stage = 'storing', updated_at = NOW() WHERE id = $1",
        [documentId]
      );
    }
    const blobName = `${document.user_id}/${document.id}/${document.stored_name}`;
    const { blobUrl } = await uploadFileToBlob(
      document.file_path,
      blobName,
      document.mime_type
    );

    await pool.query(
      `
        UPDATE documents
        SET
          storage_provider = 'azure_blob',
          blob_name = $2,
          blob_url = $3,
          updated_at = NOW()
        WHERE id = $1
      `,
      [document.id, blobName, blobUrl]
    );

    activeStep = "ready";
    console.log(`Processing doc ${documentId}: step 7/7 mark ready`);
    await updateDocumentStatus(documentId, "ready");
    if (["mp3", "wav", "m4a"].includes(document.file_type)) {
      await pool.query(
        "UPDATE documents SET processing_stage = NULL, updated_at = NOW() WHERE id = $1",
        [documentId]
      );
    }

    return {
      documentId,
      chunkCount: chunks.length,
      originalChunkCount,
      wasTruncated,
      firstChunk: chunks[0]?.content || "",
    };
  } catch (error) {
    console.error(`Processing doc ${documentId} failed during ${activeStep}:`, error);

    try {
      await updateDocumentStatus(documentId, "failed", error.message);
    } catch (statusError) {
      console.error("Failed to update document failure status:", statusError);
    }

    throw error;
  }
};

module.exports = {
  processPipeline,
};
