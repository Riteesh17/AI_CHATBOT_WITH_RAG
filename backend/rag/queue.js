const { processPipeline } = require("./pipeline");
const { getPool } = require("../config/db");

let queuePromise;

const getQueue = async () => {
  if (!queuePromise) {
    queuePromise = import("p-queue").then(({ default: PQueue }) => {
      const concurrency = Number(process.env.RAG_QUEUE_CONCURRENCY || 1);
      const queue = new PQueue({ concurrency });

      queue.on("active", () => {
        console.log(
          `RAG queue active. Concurrency: ${concurrency}, Running: ${queue.pending}, Waiting: ${queue.size}`
        );
      });

      return queue;
    });
  }

  return queuePromise;
};

const addToQueue = async (documentId) => {
  const queue = await getQueue();

  return queue.add(async () => {
    const pool = getPool();
    let fileType = "unknown";
    let originalName = "unknown";
    let fileSize = 0;

    try {
      const docRes = await pool.query(
        "SELECT file_type, original_name, file_size FROM documents WHERE id = $1",
        [documentId]
      );
      if (docRes.rowCount > 0) {
        fileType = docRes.rows[0].file_type;
        originalName = docRes.rows[0].original_name;
        fileSize = docRes.rows[0].file_size;
      }
    } catch (dbErr) {
      console.error("[Queue] Failed to fetch document details for log:", dbErr);
    }

    console.log(`[Queue] Starting ${fileType} job for: ${originalName}`);

    if (["mp3", "wav", "m4a"].includes(fileType)) {
      const mins = Math.ceil((fileSize / (1024 * 1024)) * 0.3);
      console.log(`[Queue] Audio job estimated time: ~${mins} minutes`);
    }

    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Job timed out (exceeded 30 minutes limit)")), 1800000)
      );

      const result = await Promise.race([
        processPipeline(documentId),
        timeoutPromise,
      ]);

      console.log(`RAG job completed for document ${documentId}`);
      return result;
    } catch (error) {
      console.error(`RAG job failed for document ${documentId}:`, error);

      try {
        await pool.query(
          "UPDATE documents SET status = 'failed', error_message = $1, updated_at = NOW() WHERE id = $2",
          [error.message, documentId]
        );
      } catch (dbErr) {
        console.error("Failed to update status in queue:", dbErr);
      }

      throw error;
    }
  });
};

module.exports = {
  addToQueue,
};
