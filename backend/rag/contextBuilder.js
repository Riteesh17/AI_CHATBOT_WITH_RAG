const SYSTEM_PROMPT = `You are a precise document assistant. Your ONLY job is to answer questions
using the context chunks provided below. Follow these rules strictly:

1. ONLY use information from the provided context. Never use outside knowledge.
2. If the context contains the answer, give a complete, accurate response.
3. If the context does NOT contain enough information, say exactly:
   "I couldn't find a clear answer in your documents. The documents cover: [brief summary of what IS in the context]"
4. Always cite your source: end every answer with "Source: [document name], Chunk [N]"
5. For numerical data, quotes, or specific facts - copy them exactly from context.
6. Never guess, hallucinate, or combine context with general knowledge.
7. Some context chunks may come from audio transcriptions. These may contain speaker labels like 'Speaker 1:' and timestamps like [00:00]. Treat them as accurate text and reference the audio document by name in citations.`;

const formatDuration = (seconds) => {
  if (!seconds || isNaN(seconds)) return "Unknown";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

const buildContext = (chunks, query) => {
  const body = chunks
    .map((chunk, index) => {
      const relevance = Math.round(chunk.similarity * 100);
      const sourceUrl = chunk.metadata?.sourceUrl;
      const audioDocument = chunk.metadata?.audioDocument;

      let header;
      if (audioDocument) {
        const durationFormatted = chunk.metadata?.duration ? formatDuration(chunk.metadata.duration) : "Unknown";
        header = `[Source: ${chunk.documentName} | 🎙️ Audio Transcript | Duration: ${durationFormatted} | Chunk ${index + 1} | Relevance: ${relevance}%]`;
      } else if (sourceUrl) {
        header = `[Source: ${chunk.documentName} | ${sourceUrl} | Chunk ${index + 1} | Relevance: ${relevance}%]`;
      } else {
        header = `[Source: ${chunk.documentName} | Chunk ${index + 1} | Relevance: ${relevance}%]`;
      }
      return `${header}\n${chunk.content}`;
    })
    .join("\n\n");

  return `=== DOCUMENT CONTEXT ===\n\n${body}\n\n=== END CONTEXT ===\n\nUser Question: ${query}`;
};

const buildSystemPrompt = () => SYSTEM_PROMPT;

module.exports = {
  buildContext,
  buildSystemPrompt,
};
