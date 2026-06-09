require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const { getPool } = require("../config/db");
const { processPipeline } = require("./pipeline");

// Replace this with a real uploaded document ID when you want to test the pipeline manually.
const TEST_DOCUMENT_ID = "00000000-0000-0000-0000-000000000000";

const run = async () => {
  const pool = getPool();

  try {
    const result = await processPipeline(TEST_DOCUMENT_ID);
    const chunkResult = await pool.query(
      `
        SELECT content
        FROM document_chunks
        WHERE document_id = $1
        ORDER BY chunk_index ASC
        LIMIT 1
      `,
      [TEST_DOCUMENT_ID]
    );

    console.log(`Chunks created: ${result.chunkCount}`);
    console.log("First chunk content:");
    console.log(chunkResult.rows[0]?.content || "No chunks found");
  } catch (error) {
    console.error("Pipeline test failed:", error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
};

run();
