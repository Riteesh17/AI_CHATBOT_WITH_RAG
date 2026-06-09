const express = require("express");

const { generateTitle } = require("../rag/localNLP");

const authMiddleware = require("../middleware/auth");
const { getPool } = require("../config/db");
const { buildContext, buildSystemPrompt } = require("../rag/contextBuilder");
const { embedText, TaskType } = require("../rag/embedder");
const { streamResponse } = require("../rag/llm");
const {
  dedupeByChunkId,
  expandQuery,
  rerankMergedChunks,
  runFullTextFallback,
  runVectorSearch,
} = require("../rag/retriever");

const router = express.Router();

const MAX_QUERY_LENGTH = 2000;
const MIN_QUERY_LENGTH = 3;
const MAX_CONTEXT_CHARS = 12000;

const createConversationTitleFallback = (query) => {
  const normalized = query.replace(/\s+/g, " ").trim();
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
};

const writeSseEvent = (res, payload) => {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const findConversationForUser = async (conversationId, userId) => {
  const pool = getPool();
  const result = await pool.query(
    `
      SELECT *
      FROM conversations
      WHERE id = $1 AND user_id = $2
    `,
    [conversationId, userId]
  );

  return result.rows[0] || null;
};

const saveAssistantMessage = async (conversationId, content, sourceChunks) => {
  const pool = getPool();
  const persistedSources = sourceChunks.map((chunk) => ({
    id: chunk.id,
    documentId: chunk.documentId,
    chunkIndex: chunk.chunkIndex,
  }));
  const result = await pool.query(
    `
      INSERT INTO messages (conversation_id, role, content, source_chunks)
      VALUES ($1, 'assistant', $2, $3::jsonb)
      RETURNING *
    `,
    [conversationId, content, JSON.stringify(persistedSources)]
  );

  await pool.query(
    `
      UPDATE conversations
      SET updated_at = NOW()
      WHERE id = $1
    `,
    [conversationId]
  );

  return result.rows[0];
};

const trimContext = (context, maxChars = MAX_CONTEXT_CHARS) => {
  if (context.length <= maxChars) {
    return context;
  }

  return `${context.slice(0, maxChars - 3).trim()}...`;
};

const buildNotFoundMessage = (chunks) => {
  const summary = Array.from(
    new Set(chunks.map((chunk) => chunk.documentName).filter(Boolean))
  ).join(", ");

  return `I couldn't find a clear answer in your documents. The documents cover: ${summary || "the retrieved document excerpts"}`;
};

const generateConversationTitle = async (query) => {
  try {
    return generateTitle(query);
  } catch (error) {
    return createConversationTitleFallback(query);
  }
};

router.use(authMiddleware);

router.post("/conversations", async (req, res) => {
  const documentIds = Array.isArray(req.body.documentIds) ? req.body.documentIds : [];

  try {
    const pool = getPool();
    let scopedDocumentIds = [];

    if (documentIds.length > 0) {
      const documentsResult = await pool.query(
        `
          SELECT id
          FROM documents
          WHERE user_id = $1
            AND status = 'ready'
            AND id = ANY($2::uuid[])
        `,
        [req.user.id, documentIds]
      );

      scopedDocumentIds = documentsResult.rows.map((row) => row.id);
    }

    const result = await pool.query(
      `
        INSERT INTO conversations (user_id, document_ids)
        VALUES ($1, $2::uuid[])
        RETURNING *
      `,
      [req.user.id, scopedDocumentIds]
    );

    return res.status(201).json({ conversation: result.rows[0] });
  } catch (error) {
    console.error("Create conversation error:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.get("/conversations", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      `
        SELECT
          c.*,
          COUNT(m.id)::INTEGER AS message_count,
          LEFT(COALESCE(last_message.content, ''), 160) AS last_message_preview
        FROM conversations c
        LEFT JOIN messages m ON m.conversation_id = c.id
        LEFT JOIN LATERAL (
          SELECT content
          FROM messages
          WHERE conversation_id = c.id
          ORDER BY created_at DESC
          LIMIT 1
        ) AS last_message ON TRUE
        WHERE c.user_id = $1
        GROUP BY c.id, last_message.content
        ORDER BY c.updated_at DESC
      `,
      [req.user.id]
    );

    return res.json({ conversations: result.rows });
  } catch (error) {
    console.error("Fetch conversations error:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.get("/conversations/:id/messages", async (req, res) => {
  try {
    const conversation = await findConversationForUser(req.params.id, req.user.id);

    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    const pool = getPool();
    const result = await pool.query(
      `
        SELECT id, conversation_id, role, content, source_chunks, created_at
        FROM messages
        WHERE conversation_id = $1
        ORDER BY created_at ASC
      `,
      [req.params.id]
    );

    return res.json({ messages: result.rows });
  } catch (error) {
    console.error("Fetch conversation messages error:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/conversations/:id/messages", async (req, res) => {
  const query = req.body.query?.trim() || "";

  if (query.length < MIN_QUERY_LENGTH) {
    return res.status(400).json({
      message: `Query must be at least ${MIN_QUERY_LENGTH} characters long.`,
    });
  }

  if (query.length > MAX_QUERY_LENGTH) {
    return res.status(400).json({
      message: `Query is too long. Maximum length is ${MAX_QUERY_LENGTH} characters.`,
    });
  }

  try {
    const pool = getPool();
    const conversation = await findConversationForUser(req.params.id, req.user.id);

    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    const userMessageResult = await pool.query(
      `
        INSERT INTO messages (conversation_id, role, content)
        VALUES ($1, 'user', $2)
        RETURNING id
      `,
      [conversation.id, query]
    );
    const userMessageId = userMessageResult.rows[0].id;

    let conversationTitle = conversation.title;

    if (!conversationTitle) {
      conversationTitle = await generateConversationTitle(query);
      await pool.query(
        `
          UPDATE conversations
          SET title = $2, updated_at = NOW()
          WHERE id = $1
        `,
        [conversation.id, conversationTitle]
      );
    } else {
      await pool.query(
        `
          UPDATE conversations
          SET updated_at = NOW()
          WHERE id = $1
        `,
        [conversation.id]
      );
    }

    const scopedDocumentIds =
      Array.isArray(conversation.document_ids) && conversation.document_ids.length > 0
        ? conversation.document_ids
        : null;

    const [queryVariants, previousMessagesResult] = await Promise.all([
      expandQuery(query),
      pool.query(
        `
          SELECT role, content
          FROM messages
          WHERE conversation_id = $1
            AND id <> $2
            AND role IN ('user', 'assistant')
          ORDER BY created_at DESC
          LIMIT 6
        `,
        [conversation.id, userMessageId]
      ),
    ]);

    const conversationHistory = previousMessagesResult.rows.reverse();
    const allRetrievedChunks = [];

    for (const variant of queryVariants) {
      const embedding = await embedText(variant, {
        taskType: TaskType.RETRIEVAL_QUERY,
        title: "User query",
      });
      const chunks = await runVectorSearch(embedding, {
        userId: req.user.id,
        documentIds: scopedDocumentIds,
        topK: 8,
        similarityThreshold: 0.55,
      });
      allRetrievedChunks.push(...chunks);
    }

    let sourceChunks = rerankMergedChunks(query, dedupeByChunkId(allRetrievedChunks), 5);

    if (sourceChunks.length === 0) {
      sourceChunks = await runFullTextFallback(query, {
        userId: req.user.id,
        documentIds: scopedDocumentIds,
      });
      sourceChunks = rerankMergedChunks(query, sourceChunks, 5);
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    if (sourceChunks.length === 0) {
      const fallbackText =
        "I couldn't find a clear answer in your documents. Try naming a document, section, or key phrase from the material you uploaded.";
      writeSseEvent(res, { type: "chunk", text: fallbackText });

      const assistantMessage = await saveAssistantMessage(conversation.id, fallbackText, []);
      writeSseEvent(res, {
        type: "done",
        sourceChunks: [],
        messageId: assistantMessage.id,
        title: conversationTitle,
      });
      return res.end();
    }

    const systemPrompt = buildSystemPrompt();
    const context = trimContext(buildContext(sourceChunks, query), MAX_CONTEXT_CHARS);
    const abortController = new AbortController();

    req.on("close", () => {
      abortController.abort();
    });

    const fullResponse = await streamResponse(
      systemPrompt,
      context,
      conversationHistory,
      query,
      (text) => {
        writeSseEvent(res, { type: "chunk", text });
      },
      abortController.signal
    );

    const finalResponse =
      fullResponse.trim() || buildNotFoundMessage(sourceChunks);
    const assistantMessage = await saveAssistantMessage(
      conversation.id,
      finalResponse,
      sourceChunks
    );

    writeSseEvent(res, {
      type: "done",
      sourceChunks,
      messageId: assistantMessage.id,
      title: conversationTitle,
    });

    return res.end();
  } catch (error) {
    console.error("Conversation query error:", error);

    if (!res.headersSent) {
      return res.status(500).json({ message: "Server error" });
    }

    writeSseEvent(res, {
      type: "error",
      message: error.message || "Unable to complete the query",
    });
    return res.end();
  }
});

router.delete("/conversations/:id", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      `
        DELETE FROM conversations
        WHERE id = $1 AND user_id = $2
        RETURNING id
      `,
      [req.params.id, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    return res.status(204).send();
  } catch (error) {
    console.error("Delete conversation error:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
