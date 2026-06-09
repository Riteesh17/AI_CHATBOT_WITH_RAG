import { useState, useRef, useEffect } from "react";
import { previewUrl, ingestUrl, getIngestStatus } from "../api/documentsApi";

const UrlIngestion = ({ setDocuments, setError: setGlobalError, fetchDocuments, onAskDocument }) => {
  // Steps: 1 = Input, 2 = Preview, 3 = Ingesting, 4 = Success
  const [step, setStep] = useState(1);
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState(null);
  const [customTitle, setCustomTitle] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [documentId, setDocumentId] = useState(null);
  const [processingStatus, setProcessingStatus] = useState("uploaded");

  const pollTimerRef = useRef(null);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
      }
    };
  }, []);

  const resetState = () => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
    }
    setStep(1);
    setUrl("");
    setPreview(null);
    setCustomTitle("");
    setIsLoading(false);
    setError(null);
    setDocumentId(null);
    setProcessingStatus("uploaded");
  };

  const mapError = (err) => {
    const errMsg = err.response?.data?.error || err.response?.data?.message || err.message || "";
    const status = err.response?.status;

    if (status === 409) {
      return {
        message: "Already ingested. View it in your documents.",
        documentId: err.response?.data?.documentId,
      };
    }

    if (errMsg.includes("Invalid URL") || errMsg.includes("format") || errMsg.includes("scheme")) {
      return { message: "Please enter a valid URL starting with http:// or https://" };
    }
    if (errMsg.includes("robots.txt") || (status === 403 && errMsg.toLowerCase().includes("robots"))) {
      return { message: "This website doesn't allow scraping." };
    }
    if (status === 403) {
      return { message: "This website blocked access. Try a different URL." };
    }
    if (status === 404 || errMsg.includes("404") || errMsg.toLowerCase().includes("not found")) {
      return { message: "Page not found. Check the URL and try again." };
    }
    if (
      errMsg.includes("points to a") ||
      errMsg.toLowerCase().includes("pdf") ||
      errMsg.toLowerCase().includes("file") ||
      errMsg.includes("binary")
    ) {
      return { message: "This URL points to a file. Download it and upload directly." };
    }
    if (err.code === "ECONNABORTED" || errMsg.includes("timeout") || errMsg.includes("timed out")) {
      return { message: "The website took too long to respond." };
    }
    if (err.message === "Network Error") {
      return { message: "Could not reach the website. Check your connection." };
    }
    return { message: errMsg || "An unexpected error occurred." };
  };

  const handlePreview = async (e) => {
    e.preventDefault();
    if (!url || url.trim() === "") {
      setError({ message: "Please enter a valid URL starting with http:// or https://" });
      return;
    }

    // Client-side quick protocol validation
    const trimmedUrl = url.trim();
    if (!trimmedUrl.startsWith("http://") && !trimmedUrl.startsWith("https://")) {
      setError({ message: "Please enter a valid URL starting with http:// or https://" });
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const data = await previewUrl(trimmedUrl);
      setPreview(data);
      setCustomTitle(data.title);
      setStep(2);
    } catch (err) {
      setError(mapError(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleIngest = async () => {
    setIsLoading(true);
    setError(null);
    setStep(3);

    try {
      const data = await ingestUrl(url.trim(), customTitle);
      setDocumentId(data.document.id);
      setProcessingStatus(data.document.status || "uploaded");
      startPolling(data.document.id);
      // Trigger a list refresh immediately to show the "uploaded" state document
      fetchDocuments?.();
    } catch (err) {
      setError(mapError(err));
      // Revert step back to preview if ingest start fails
      setStep(2);
    } finally {
      setIsLoading(false);
    }
  };

  const startPolling = (docId) => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
    }

    let delay = 3000;
    const MAX_DELAY = 15000;

    const poll = async () => {
      try {
        const data = await getIngestStatus(docId);
        setProcessingStatus(data.status);

        if (data.status === "ready") {
          setStep(4);
          fetchDocuments?.(); // Refresh list
        } else if (data.status === "failed") {
          setError({ message: data.error_message || "Ingestion failed during AI processing." });
          fetchDocuments?.(); // Refresh list to show failure status
        } else {
          // Continue polling
          delay = Math.min(delay * 1.5, MAX_DELAY);
          pollTimerRef.current = setTimeout(poll, delay);
        }
      } catch (err) {
        console.error("Polling error:", err);
        // Continue polling anyway in case of transient network issues
        pollTimerRef.current = setTimeout(poll, delay);
      }
    };

    pollTimerRef.current = setTimeout(poll, delay);
  };

  return (
    <section className="panel-section">
      {/* STEP 1: URL INPUT */}
      {step === 1 && (
        <form onSubmit={handlePreview} className="field">
          <div className="section-heading" style={{ marginBottom: "8px" }}>
            <div>
              <span className="eyebrow">Web Source</span>
              <h2>Ingest from Web URL</h2>
            </div>
          </div>

          <div style={{ display: "flex", gap: "12px", width: "100%" }}>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/article"
              disabled={isLoading}
              style={{ flex: 1 }}
              aria-label="URL to scrape"
            />
            <button
              type="submit"
              className="primary-button"
              disabled={isLoading || !url.trim()}
              style={{ minWidth: "120px" }}
            >
              {isLoading ? "Fetching..." : "Preview"}
            </button>
          </div>
          <small style={{ color: "var(--text-muted)", marginTop: "4px" }}>
            Supported: articles, blogs, documentation, Wikipedia pages
          </small>

          {isLoading && (
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "16px" }}>
              <div className="loader" style={{ width: "24px", height: "24px" }} />
              <span style={{ fontSize: "0.95rem", color: "var(--text-secondary)" }}>Fetching page...</span>
            </div>
          )}

          {error && (
            <div className="server-error" style={{ marginTop: "16px" }}>
              {error.message}
              {error.documentId && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => onAskDocument?.(error.documentId)}
                  style={{ marginLeft: "12px", padding: "4px 8px", borderRadius: "8px", fontSize: "0.85rem" }}
                >
                  Ask Question
                </button>
              )}
            </div>
          )}
        </form>
      )}

      {/* STEP 2: PREVIEW CARD */}
      {step === 2 && preview && (
        <div className="field">
          <div className="section-heading" style={{ marginBottom: "16px" }}>
            <div>
              <span className="eyebrow">Scrape Preview</span>
              <h2>Confirm Document Content</h2>
            </div>
          </div>

          {/* Glassmorphic Preview Card */}
          <div
            style={{
              padding: "24px",
              border: "1px solid var(--border-color)",
              borderRadius: "20px",
              background: "var(--bg-panel)",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
              boxShadow: "0 4px 20px rgba(0,0,0,0.02)",
            }}
          >
            <div style={{ display: "flex", gap: "14px", alignItems: "center" }}>
              <img
                src={`https://www.google.com/s2/favicons?domain=${preview.domain}&sz=64`}
                alt="Website Favicon"
                onError={(e) => {
                  e.target.style.display = "none";
                }}
                style={{ width: "24px", height: "24px", borderRadius: "4px" }}
              />
              <div style={{ display: "flex", flexDirection: "column" }}>
                <strong style={{ fontSize: "1.1rem", color: "var(--text-primary)" }}>{preview.title}</strong>
                <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                  {preview.domain}
                  {preview.publishedDate ? ` • Published: ${new Date(preview.publishedDate).toLocaleDateString()}` : ""}
                </span>
              </div>
            </div>

            {preview.author && (
              <div style={{ fontSize: "0.9rem", color: "var(--text-secondary)" }}>
                <strong>Author:</strong> {preview.author}
              </div>
            )}

            {preview.description && (
              <div style={{ fontSize: "0.95rem", color: "var(--text-secondary)", fontStyle: "italic" }}>
                "{preview.description}"
              </div>
            )}

            {/* Word Count and Read Time */}
            <div style={{ display: "flex", gap: "8px" }}>
              <span className="type-pill" style={{ textTransform: "none" }}>
                {preview.wordCount.toLocaleString()} words
              </span>
              <span className="type-pill" style={{ textTransform: "none", background: "rgba(16, 185, 129, 0.08)", color: "#059669", borderColor: "rgba(16, 185, 129, 0.15)" }}>
                ~{Math.max(1, Math.round(preview.wordCount / 200))} min read
              </span>
            </div>

            {/* Content Preview Box */}
            <div
              style={{
                position: "relative",
                background: "#f9f9fb",
                border: "1px solid var(--border-color)",
                borderRadius: "12px",
                padding: "16px",
                maxHeight: "120px",
                overflow: "hidden",
                fontSize: "0.9rem",
                color: "var(--text-secondary)",
                lineHeight: "1.5",
              }}
            >
              <div>{preview.contentPreview}</div>
              <div
                style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: "40px",
                  background: "linear-gradient(to top, #f9f9fb, rgba(249, 249, 251, 0))",
                  pointerEvents: "none",
                }}
              />
            </div>
          </div>

          {/* Title Override Input */}
          <div className="field" style={{ marginTop: "12px" }}>
            <span>Custom title (optional)</span>
            <input
              type="text"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              placeholder="Give this document a friendly name"
              disabled={isLoading}
            />
          </div>

          {/* Buttons */}
          <div style={{ display: "flex", gap: "12px", marginTop: "16px" }}>
            <button
              type="button"
              className="primary-button"
              onClick={handleIngest}
              disabled={isLoading}
              style={{ background: "linear-gradient(135deg, #10b981, #059669)", boxShadow: "0 4px 14px rgba(16, 185, 129, 0.2)" }}
            >
              Ingest This Page
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={resetState}
              disabled={isLoading}
            >
              Try Different URL
            </button>
          </div>

          {error && (
            <div className="server-error" style={{ marginTop: "16px" }}>
              {error.message}
            </div>
          )}
        </div>
      )}

      {/* STEP 3: INGESTING / PROCESSING */}
      {step === 3 && (
        <div className="field" style={{ textAlign: "left" }}>
          <div className="section-heading" style={{ marginBottom: "16px" }}>
            <div>
              <span className="eyebrow">Ingestion Pipeline</span>
              <h2>Processing Web Document</h2>
            </div>
          </div>

          {/* Progress Steps Checklist */}
          <div style={{ display: "flex", flexDirection: "column", gap: "16px", margin: "16px 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <span style={{ fontSize: "1.2rem", color: "#10b981" }}>✅</span>
              <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>Page scraped</span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              {processingStatus === "uploaded" ? (
                <div className="loader" style={{ width: "18px", height: "18px" }} />
              ) : (
                <span style={{ fontSize: "1.2rem", color: "#10b981" }}>✅</span>
              )}
              <span
                style={{
                  fontWeight: processingStatus === "uploaded" ? 600 : 500,
                  color: processingStatus === "uploaded" ? "var(--text-primary)" : "var(--text-muted)",
                }}
              >
                {processingStatus === "uploaded" ? "Saving document..." : "Document saved"}
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              {processingStatus === "uploaded" ? (
                <span style={{ fontSize: "1.2rem", color: "var(--text-muted)" }}>⏳</span>
              ) : processingStatus === "processing" ? (
                <div className="loader" style={{ width: "18px", height: "18px" }} />
              ) : processingStatus === "ready" ? (
                <span style={{ fontSize: "1.2rem", color: "#10b981" }}>✅</span>
              ) : (
                <span style={{ fontSize: "1.2rem", color: "#ef4444" }}>❌</span>
              )}
              <span
                style={{
                  fontWeight: processingStatus === "processing" ? 600 : 500,
                  color: processingStatus === "processing" ? "var(--text-primary)" : "var(--text-muted)",
                }}
              >
                {processingStatus === "ready"
                  ? "Processing with AI completed"
                  : processingStatus === "failed"
                    ? "AI Processing failed"
                    : "Processing with AI..."}
              </span>
            </div>
          </div>

          {processingStatus === "failed" && error && (
            <div className="server-error" style={{ marginTop: "16px" }}>
              {error.message}
              <button
                type="button"
                className="secondary-button"
                onClick={resetState}
                style={{ marginLeft: "12px", padding: "4px 8px", borderRadius: "8px", fontSize: "0.85rem" }}
              >
                Retry
              </button>
            </div>
          )}
        </div>
      )}

      {/* STEP 4: SUCCESS STATE */}
      {step === 4 && (
        <div className="field" style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "20px 0" }}>
          <div
            style={{
              width: "64px",
              height: "64px",
              borderRadius: "50%",
              background: "rgba(16, 185, 129, 0.1)",
              display: "grid",
              placeItems: "center",
              fontSize: "2rem",
              color: "#10b981",
              marginBottom: "16px",
            }}
          >
            ✓
          </div>

          <h2 style={{ margin: "0 0 8px", fontWeight: 700, color: "var(--text-primary)" }}>Ready to Chat!</h2>
          <p style={{ margin: "0 0 24px", color: "var(--text-secondary)", maxWidth: "440px" }}>
            <strong>'{customTitle || preview?.title}'</strong> has been successfully scraped, chunked, and embedded.
          </p>

          <div style={{ display: "flex", gap: "12px" }}>
            <button
              type="button"
              className="primary-button"
              onClick={() => onAskDocument?.(documentId)}
            >
              Ask a question
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={resetState}
            >
              Ingest Another URL
            </button>
          </div>
        </div>
      )}
    </section>
  );
};

export default UrlIngestion;
