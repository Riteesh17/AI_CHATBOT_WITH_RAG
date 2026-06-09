import { useEffect, useMemo, useState, memo } from "react";

import { deleteDocument, getDocumentStatus } from "../api/documentsApi";

const formatBytes = (bytes) => {
  if (!bytes) {
    return "0 B";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = units[0];

  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
};

const formatSecondsToDuration = (seconds) => {
  if (!seconds || isNaN(seconds)) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

const getStatusClassName = (status) => {
  switch (status) {
    case "processing":
      return "badge-processing";
    case "ready":
      return "badge-ready";
    case "failed":
      return "badge-failed";
    case "uploading":
      return "badge-processing";
    default:
      return "badge-uploaded";
  }
};

const getStatusLabel = (document) => {
  const { status, file_type, processing_stage } = document;
  const isAudio = ["mp3", "wav", "m4a"].includes(file_type);

  if (status === "processing" && isAudio) {
    if (processing_stage === "transcribing") return "Transcribing...";
    if (["chunking", "embedding", "storing"].includes(processing_stage)) return "Building index...";
    return "Processing...";
  }

  switch (status) {
    case "processing":
      return "Processing";
    case "ready":
      return "Ready";
    case "failed":
      return "Failed";
    case "uploading":
      return "Uploading...";
    default:
      return "Uploaded";
  }
};

const DocumentsList = memo(({
  documents,
  setDocuments,
  isLoading,
  error,
  setError,
  fetchDocuments,
  onAskDocument,
  activeTab = "upload",
}) => {
  const [deletingId, setDeletingId] = useState("");

  const processingDocumentIds = useMemo(
    () =>
      documents
        .filter((document) => document.status === "processing")
        .map((document) => document.id),
    [documents]
  );

  const filteredAndSortedDocuments = useMemo(() => {
    return [...documents].sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );
  }, [documents]);

  useEffect(() => {
    if (processingDocumentIds.length === 0) {
      return undefined;
    }

    let active = true;

    const pollWithBackoff = async (docId, onUpdate) => {
      let delay = 2000;
      const MAX_DELAY = 20000;
      while (active) {
        try {
          const data = await getDocumentStatus(docId);
          if (!active) break;
          onUpdate(data);
          if (data.status === "ready" || data.status === "failed") {
            break;
          }
        } catch (pollError) {
          console.error("Document polling error:", pollError);
        }
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 1.5, MAX_DELAY);
      }
    };

    processingDocumentIds.forEach((id) => {
      pollWithBackoff(id, (match) => {
        setDocuments((currentDocuments) =>
          currentDocuments.map((doc) =>
            doc.id === match.id
              ? {
                  ...doc,
                  status: match.status,
                  error_message: match.error_message,
                  chunk_count: match.chunk_count,
                  processing_stage: match.processing_stage,
                  audio_metadata: match.audio_metadata,
                  audio_duration_seconds: match.audio_duration_seconds,
                }
              : doc
          )
        );
      });
    });

    return () => {
      active = false;
    };
  }, [processingDocumentIds, setDocuments]);

  const handleDelete = async (document) => {
    const confirmed = window.confirm(
      `Delete "${document.original_name}"? This cannot be undone.`
    );

    if (!confirmed) {
      return;
    }

    try {
      setDeletingId(document.id);
      await deleteDocument(document.id);
      await fetchDocuments();
    } catch (deleteError) {
      setError(
        deleteError.response?.data?.message || "Unable to delete the document"
      );
    } finally {
      setDeletingId("");
    }
  };

  return (
    <section className="panel-section">
      <div className="section-heading">
        <h2>Your uploaded files</h2>
        <button type="button" className="secondary-button" onClick={fetchDocuments}>
          Refresh
        </button>
      </div>

      {error && <div className="server-error">{error}</div>}

      {isLoading ? (
        <div className="loader-wrap">
          <div className="loader" aria-label="Loading documents" />
        </div>
      ) : filteredAndSortedDocuments.length === 0 ? (
        <div className="empty-state">
          {activeTab === "web"
            ? "No Web URLs ingested yet. Ingest your first URL above."
            : activeTab === "audio"
            ? "No audio recordings uploaded yet. Upload your first audio file above."
            : "No documents uploaded yet. Upload your first file above."}
        </div>
      ) : (
        <div className="documents-table-wrap">
          <table className="documents-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Size</th>
                <th>Status</th>
                <th>Uploaded</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredAndSortedDocuments.map((document) => (
                <tr key={document.id}>
                  <td className="document-name">
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      {["mp3", "wav", "m4a"].includes(document.file_type) && <span style={{ fontSize: "1.1rem" }}>🎙️</span>}
                      <span>{document.original_name}</span>
                    </div>
                    {["mp3", "wav", "m4a"].includes(document.file_type) && document.audio_duration_seconds && (
                      <div className="document-meta-note" style={{ marginTop: "4px" }}>
                        Duration: {formatSecondsToDuration(document.audio_duration_seconds)}
                      </div>
                    )}
                    {document.file_type === "web" && document.source_url && (
                      <div className="document-meta-note" style={{ marginTop: "4px", fontSize: "0.85rem" }}>
                        <a href={document.source_url} target="_blank" rel="noopener noreferrer">
                          {(() => {
                            if (document.scraped_metadata?.domain) {
                              return document.scraped_metadata.domain;
                            }
                            try {
                              return new URL(document.source_url).hostname;
                            } catch (e) {
                              return document.source_url;
                            }
                          })()}
                        </a>
                      </div>
                    )}
                  </td>
                  <td>
                    {["mp3", "wav", "m4a"].includes(document.file_type) ? (
                      <span className="type-pill" style={{ display: "inline-flex", alignItems: "center", gap: "4px", backgroundColor: "rgba(168, 85, 247, 0.05)", color: "#9333ea", borderColor: "rgba(168, 85, 247, 0.1)" }}>
                        🎙️ {document.file_type.toUpperCase()}
                      </span>
                    ) : document.file_type === "web" ? (
                      <span className="type-pill" style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                        🌐 WEB
                      </span>
                    ) : (
                      <span className="type-pill">{document.file_type.toUpperCase()}</span>
                    )}
                  </td>
                  <td>{formatBytes(document.file_size)}</td>
                  <td>
                    <span className={`status-pill ${getStatusClassName(document.status)}`}>
                      {(document.status === "processing" || document.status === "uploading") && (
                        <span className="status-dot spinner-dot" aria-hidden="true" />
                      )}
                      {getStatusLabel(document)}
                    </span>
                    {document.chunk_count ? (
                      <div className="document-meta-note">{document.chunk_count} chunks indexed</div>
                    ) : null}
                    {document.error_message ? (
                      <div className="document-meta-error">{document.error_message}</div>
                    ) : null}
                  </td>
                  <td>{new Date(document.created_at).toLocaleString()}</td>
                  <td>
                    <div className="table-action-group">
                      <button
                        type="button"
                        className="secondary-button table-action-button"
                        onClick={() => onAskDocument?.(document.id)}
                        disabled={document.status !== "ready"}
                      >
                        Ask
                      </button>
                      <button
                        type="button"
                        className="danger-button table-action-button"
                        onClick={() => handleDelete(document)}
                        disabled={deletingId === document.id || document.status === "uploading"}
                      >
                        {deletingId === document.id ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
});

export default DocumentsList;
