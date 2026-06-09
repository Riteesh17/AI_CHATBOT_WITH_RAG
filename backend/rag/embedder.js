const { 
  embedText: localEmbedText, 
  embedBatch: localEmbedBatch, 
  embedQuery: localEmbedQuery, 
  EMBEDDING_DIMENSION 
} = require('./localEmbedder');

const TaskType = {
  RETRIEVAL_DOCUMENT: "RETRIEVAL_DOCUMENT",
  RETRIEVAL_QUERY: "RETRIEVAL_QUERY",
};

async function embedText(text, options = {}) {
  const isQuery = options.taskType === TaskType.RETRIEVAL_QUERY;
  if (isQuery) {
    return localEmbedQuery(text);
  }
  return localEmbedText(text, false);
}

async function embedBatch(texts, options = {}) {
  const isQuery = options.taskType === TaskType.RETRIEVAL_QUERY;
  if (isQuery) {
    return Promise.all(texts.map(t => localEmbedQuery(t)));
  }
  return localEmbedBatch(texts, false);
}

async function embedWithRetry(text, options = {}) {
  return embedText(text, options);
}

module.exports = {
  EMBEDDING_DIMENSION,
  TaskType,
  embedWithRetry,
  embedText,
  embedBatch,
};
