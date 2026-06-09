const { expandQuery: localExpandQuery } = require("./localNLP");

const { getPool } = require("../config/db");
const { embedText, TaskType } = require("./embedder");

const QUERY_EXPANSION_MODEL = process.env.GEMINI_QUERY_EXPANSION_MODEL || "gemini-2.5-flash";
const QUERY_EXPANSION_LIMIT = 3;

const vectorLiteral = (values) => `[${values.join(",")}]`;

const normalizeKeywords = (query) =>
  Array.from(
    new Set(
      (query.toLowerCase().match(/\b[a-z0-9]{2,}\b/g) || []).filter(
        (word) => !["the", "and", "for", "with", "from", "into", "that", "this"].includes(word)
      )
    )
  );

const computeKeywordScore = (query, content) => {
  const queryWords = normalizeKeywords(query);

  if (queryWords.length === 0) {
    return 0;
  }

  const lowerContent = content.toLowerCase();
  const matchedWords = queryWords.filter((word) => lowerContent.includes(word)).length;
  return (matchedWords / queryWords.length) * 0.3;
};

const dedupeByChunkId = (rows) => {
  const merged = new Map();

  for (const row of rows) {
    const existing = merged.get(row.id);
    const similarity = Number(row.similarity) || 0;

    if (!existing || similarity > existing.similarity) {
      merged.set(row.id, {
        ...row,
        similarity,
      });
    }
  }

  return Array.from(merged.values());
};

const expandQuery = async (query) => {
  return localExpandQuery(query);
};

const runVectorSearch = async (queryEmbedding, options) => {
  const { userId, documentIds, topK, similarityThreshold } = options;
  const scopedDocumentIds =
    Array.isArray(documentIds) && documentIds.length > 0 ? documentIds : null;
  const pool = getPool();
  const result = await pool.query(
    `
      SELECT
        dc.id,
        dc.content,
        dc.chunk_index,
        dc.document_id,
        d.original_name,
        dc.metadata,
        1 - (dc.embedding <=> $1::vector) AS similarity
      FROM document_chunks dc
      JOIN documents d ON dc.document_id = d.id
      WHERE dc.user_id = $2
        AND d.status = 'ready'
        AND ($3::uuid[] IS NULL OR dc.document_id = ANY($3::uuid[]))
        AND 1 - (dc.embedding <=> $1::vector) >= $4
      ORDER BY dc.embedding <=> $1::vector
      LIMIT $5
    `,
    [vectorLiteral(queryEmbedding), userId, scopedDocumentIds, similarityThreshold, topK]
  );

  return result.rows.map((row) => ({
    id: row.id,
    content: row.content,
    chunkIndex: row.chunk_index,
    documentId: row.document_id,
    documentName: row.original_name,
    similarity: Number(row.similarity) || 0,
    startChar: row.metadata?.startChar ?? null,
    endChar: row.metadata?.endChar ?? null,
    pageNumber: row.metadata?.pageNumber ?? null,
    metadata: row.metadata || {},
  }));
};

const runFullTextFallback = async (query, options) => {
  const { userId, documentIds } = options;
  const scopedDocumentIds =
    Array.isArray(documentIds) && documentIds.length > 0 ? documentIds : null;
  const pool = getPool();
  const result = await pool.query(
    `
      SELECT
        dc.id,
        dc.content,
        dc.chunk_index,
        dc.document_id,
        d.original_name,
        dc.metadata
      FROM document_chunks dc
      JOIN documents d ON dc.document_id = d.id
      WHERE dc.user_id = $1
        AND d.status = 'ready'
        AND ($2::uuid[] IS NULL OR dc.document_id = ANY($2::uuid[]))
        AND to_tsvector('english', dc.content) @@ plainto_tsquery('english', $3)
      LIMIT 5
    `,
    [userId, scopedDocumentIds, query]
  );

  return result.rows.map((row) => ({
    id: row.id,
    content: row.content,
    chunkIndex: row.chunk_index,
    documentId: row.document_id,
    documentName: row.original_name,
    similarity: 0.55,
    startChar: row.metadata?.startChar ?? null,
    endChar: row.metadata?.endChar ?? null,
    pageNumber: row.metadata?.pageNumber ?? null,
    metadata: row.metadata || {},
  }));
};

const rerankMergedChunks = (query, chunks, limit = 5) =>
  chunks
    .map((chunk) => {
      const keywordScore = computeKeywordScore(query, chunk.content);
      const finalScore = chunk.similarity * 0.7 + keywordScore * 0.3;

      return {
        ...chunk,
        keywordScore,
        finalScore,
      };
    })
    .sort((left, right) => right.finalScore - left.finalScore)
    .slice(0, limit);

const retrieveRelevantChunks = async (query, options) => {
  const {
    userId,
    documentIds = null,
    topK = 8,
    similarityThreshold = 0.55,
  } = options;

  const expandedQueries = await expandQuery(query);
  const allResults = [];

  for (const variant of expandedQueries) {
    const queryEmbedding = await embedText(variant, {
      taskType: TaskType.RETRIEVAL_QUERY,
      title: "User query",
    });
    const variantResults = await runVectorSearch(queryEmbedding, {
      userId,
      documentIds,
      topK,
      similarityThreshold,
    });
    allResults.push(...variantResults);
  }

  let mergedResults = dedupeByChunkId(allResults);

  if (mergedResults.length === 0) {
    mergedResults = await runFullTextFallback(query, { userId, documentIds });
  }

  return rerankMergedChunks(query, mergedResults, 5);
};

module.exports = {
  expandQuery,
  dedupeByChunkId,
  rerankMergedChunks,
  runFullTextFallback,
  runVectorSearch,
  retrieveRelevantChunks,
};
