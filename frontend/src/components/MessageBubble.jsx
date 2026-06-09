import { useState, useMemo, memo } from "react";
import ReactMarkdown from "react-markdown";

const formatSimilarity = (value) => `${Math.round((value || 0) * 100)}%`;

const MessageBubble = memo(({ message }) => {
  const [showSources, setShowSources] = useState(false);
  const sources = Array.isArray(message.source_chunks) ? message.source_chunks : [];
  const retrievalMeta = message.retrieval_meta || null;

  const groupedSources = useMemo(() => {
    const groups = {};
    sources.forEach((source) => {
      const docName = source.documentName || "Unknown Document";
      if (!groups[docName]) {
        groups[docName] = [];
      }
      groups[docName].push(source);
    });
    return groups;
  }, [sources]);

  if (message.role === "user") {
    return (
      <div className="message-row message-row-user">
        <article className="message-bubble message-bubble-user">
          <p>{message.content}</p>
        </article>
      </div>
    );
  }

  return (
    <div className="message-row">
      <article className="message-bubble message-bubble-assistant">
        {message.isStreaming && !message.content ? (
          <div className="searching-state">
            {message.stream_phase === "answering"
              ? "Generating answer from retrieved evidence..."
              : "Searching documents..."}
          </div>
        ) : null}

        <div className="markdown-body">
          <ReactMarkdown>{message.content || ""}</ReactMarkdown>
          {message.isStreaming ? <span className="streaming-cursor" /> : null}
        </div>
      </article>

      {!message.isStreaming && sources.length > 0 ? (
        <div className="sources-panel">
          {retrievalMeta ? (
            <div className="retrieval-summary">
              <strong>{retrievalMeta.sourceCount} evidence chunks used</strong>
              <span>{(retrievalMeta.documents || []).join(", ")}</span>
            </div>
          ) : null}

          <button
            type="button"
            className="sources-toggle"
            onClick={() => setShowSources((currentValue) => !currentValue)}
          >
            {showSources ? "Hide sources" : `View sources (${sources.length})`}
          </button>

          {showSources ? (
            <div className="sources-list">
              {Object.entries(groupedSources).map(([docName, docSources]) => (
                <div key={docName} className="source-group">
                  <h4 className="source-group-title">{docName}</h4>
                  {docSources.map((source) => {
                    const preview = source.contextText || source.content || "";

                    return (
                      <article className="source-card" key={source.id}>
                        <span>
                          Relevance: {formatSimilarity(source.hybridScore || source.similarity)}
                          {source.sectionLabel ? ` | ${source.sectionLabel}` : ""}
                        </span>
                        <p>{`${preview.slice(0, 180)}${preview.length > 180 ? "..." : ""}`}</p>
                      </article>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

export default MessageBubble;
