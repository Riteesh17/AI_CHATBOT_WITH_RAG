import { useState, useRef, useEffect } from "react";
import { uploadAudio, getAudioLimits, getDocumentStatus } from "../api/documentsApi";

const formatSize = (bytes) => {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
};

const formatSecondsToDuration = (seconds) => {
  if (!seconds || isNaN(seconds)) return "Unknown";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

const AudioUpload = ({ setDocuments, setError: setGlobalError, fetchDocuments, onAskDocument }) => {
  // Steps: 1 = Selector / Preview, 2 = Ingesting / Polling, 3 = Success
  const [step, setStep] = useState(1);
  const [file, setFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadSpeed, setUploadSpeed] = useState("");
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  
  const [processingStage, setProcessingStage] = useState("uploaded"); // 'uploaded' | 'transcribing' | 'chunking' | 'embedding' | 'storing'
  const [elapsedTime, setElapsedTime] = useState(0);
  const [documentId, setDocumentId] = useState(null);
  const [audioMetadata, setAudioMetadata] = useState(null);
  const [summary, setSummary] = useState("");
  const [showSummary, setShowSummary] = useState(false);
  
  const [error, setError] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const pollTimerRef = useRef(null);
  const elapsedTimerRef = useRef(null);
  const startTimeRef = useRef(null);
  const processStartTimeRef = useRef(null);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    };
  }, []);

  const getEstimatedTimeText = (size) => {
    const mb = size / (1024 * 1024);
    if (mb < 10) return "~1-2 minutes";
    if (mb < 50) return "~3-7 minutes";
    if (mb < 200) return "~7-20 minutes";
    return "~20-45 minutes";
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const validateAndSetFile = (selectedFile) => {
    setError(null);
    if (!selectedFile) return;

    const extension = selectedFile.name.split(".").pop().toLowerCase();
    const supportedExtensions = ["mp3", "wav", "m4a"];
    const supportedMimes = ["audio/mpeg", "audio/wav", "audio/wave", "audio/x-wav", "audio/mp4"];

    if (!supportedExtensions.includes(extension) && !supportedMimes.includes(selectedFile.type)) {
      setError("Only MP3, WAV, and M4A files are supported.");
      return;
    }

    if (selectedFile.size > 500 * 1024 * 1024) {
      setError("File exceeds 500MB limit.");
      return;
    }

    setFile(selectedFile);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInput = (e) => {
    if (e.target.files && e.target.files[0]) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const calculateSpeed = (loaded, startTime) => {
    const elapsed = (Date.now() - startTime) / 1000;
    if (elapsed <= 0) return "0 B/s";
    const speed = loaded / elapsed;
    if (speed < 1024) return `${speed.toFixed(0)} B/s`;
    if (speed < 1024 * 1024) return `${(speed / 1024).toFixed(1)} KB/s`;
    return `${(speed / 1024 / 1024).toFixed(1)} MB/s`;
  };

  const startUpload = async () => {
    if (!file) return;

    setIsLoading(true);
    setError(null);
    setStep(2);
    setUploadProgress(0);
    setUploadedBytes(0);
    setTotalBytes(file.size);
    setProcessingStage("uploaded");
    setElapsedTime(0);

    startTimeRef.current = Date.now();

    try {
      const data = await uploadAudio(file, (percent, loaded, total) => {
        setUploadProgress(percent);
        setUploadedBytes(loaded);
        setTotalBytes(total);
        setUploadSpeed(calculateSpeed(loaded, startTimeRef.current));
      });

      setDocumentId(data.document.id);
      setProcessingStage(data.document.processing_stage || "transcribing");
      
      // Start processing elapsed time timer
      processStartTimeRef.current = Date.now();
      elapsedTimerRef.current = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - processStartTimeRef.current) / 1000));
      }, 1000);

      // Start status polling
      startPolling(data.document.id);
      fetchDocuments?.();
    } catch (err) {
      console.error(err);
      setError(
        err.response?.data?.error || err.response?.data?.message || "Upload failed. Check connection and retry."
      );
      setStep(1);
    } finally {
      setIsLoading(false);
    }
  };

  const startPolling = (docId) => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);

    const poll = async () => {
      try {
        const data = await getDocumentStatus(docId);
        setProcessingStage(data.processing_stage || "transcribing");

        if (data.status === "ready") {
          // Finished! Fetch full document info to display metadata on success screen
          if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
          
          // Trigger parent files list refresh
          fetchDocuments?.();
          
          // Get the summary and metadata from the document table list
          setStep(3);
          const fullDocInfo = data;
          setAudioMetadata(data.audio_metadata || {});
          setSummary(data.audio_summary || "");
        } else if (data.status === "failed") {
          if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
          setError(data.error_message || "Transcription failed.");
          fetchDocuments?.();
        } else {
          // Poll again in 5 seconds
          pollTimerRef.current = setTimeout(poll, 5000);
        }
      } catch (err) {
        console.error("Polling status failed:", err);
        pollTimerRef.current = setTimeout(poll, 5000);
      }
    };

    pollTimerRef.current = setTimeout(poll, 5000);
  };

  const resetState = () => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    setStep(1);
    setFile(null);
    setUploadProgress(0);
    setUploadSpeed("");
    setUploadedBytes(0);
    setTotalBytes(0);
    setProcessingStage("uploaded");
    setElapsedTime(0);
    setDocumentId(null);
    setAudioMetadata(null);
    setSummary("");
    setShowSummary(false);
    setError(null);
    setIsLoading(false);
  };

  const formatElapsed = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}m ${s}s`;
  };

  const estimatedMins = file ? Math.ceil((file.size / (1024 * 1024)) * 0.3) : 5;

  return (
    <section className="panel-section">
      {/* STEP 1: DROPZONE / PREVIEW */}
      {step === 1 && (
        <div className="field">
          <div className="section-heading" style={{ marginBottom: "8px" }}>
            <div>
              <span className="eyebrow">Audio Source</span>
              <h2>Upload Audio Recording</h2>
            </div>
          </div>

          {!file ? (
            <div
              className={`dropzone ${dragActive ? "drag-active" : ""}`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => document.getElementById("audio-file-input").click()}
              style={{
                borderColor: dragActive ? "var(--border-focus)" : "var(--brown-accent)",
                background: dragActive ? "var(--blue-light)" : "var(--brown-light)",
              }}
            >
              <input
                id="audio-file-input"
                type="file"
                accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/wave,audio/x-wav,audio/mp4"
                onChange={handleFileInput}
                style={{ display: "none" }}
              />
              <div className="dropzone-icon">🎙️</div>
              <h3>Drag & drop audio here</h3>
              <p style={{ margin: "4px 0" }}>or click to browse files from your computer</p>
              <small style={{ color: "var(--text-muted)", display: "block", marginTop: "12px" }}>
                Supported: MP3 · WAV · M4A | Max duration: 2 hours | Max size: 500MB
              </small>
            </div>
          ) : (
            <div
              style={{
                padding: "24px",
                border: "1px solid var(--border-color)",
                borderRadius: "20px",
                background: "var(--bg-panel)",
                display: "flex",
                flexDirection: "column",
                gap: "16px",
              }}
            >
              <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
                <div
                  style={{
                    width: "48px",
                    height: "48px",
                    borderRadius: "12px",
                    background: "var(--blue-light)",
                    display: "grid",
                    placeItems: "center",
                    fontSize: "1.4rem",
                    color: "var(--blue-primary)",
                  }}
                >
                  🎙️
                </div>
                <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
                  <strong
                    style={{
                      fontSize: "1.05rem",
                      color: "var(--text-primary)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {file.name}
                  </strong>
                  <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                    {formatSize(file.size)} • {file.name.split(".").pop().toUpperCase()}
                  </span>
                </div>
              </div>

              {/* Large File Warning */}
              {file.size > 100 * 1024 * 1024 && (
                <div
                  style={{
                    background: "#fffbeb",
                    border: "1px solid #fef3c7",
                    color: "#b45309",
                    padding: "12px 16px",
                    borderRadius: "12px",
                    fontSize: "0.9rem",
                    fontWeight: 500,
                  }}
                >
                  ⚠️ Large file detected ({formatSize(file.size)}). Ingestion & transcription may take 10-25 minutes.
                  Please keep this tab open during processing.
                </div>
              )}

              {/* Ingest Details */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "0.95rem" }}>
                <div>
                  <strong>Estimated Processing Time:</strong> {getEstimatedTimeText(file.size)}
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: "12px", marginTop: "8px" }}>
                <button type="button" className="primary-button" onClick={startUpload}>
                  Upload & Transcribe
                </button>
                <button type="button" className="secondary-button" onClick={resetState}>
                  Choose Different File
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="server-error" style={{ marginTop: "16px" }}>
              {error}
            </div>
          )}
        </div>
      )}

      {/* STEP 2: UPLOAD & TRANSCRIPTION PROGRESS */}
      {step === 2 && (
        <div className="field">
          <div className="section-heading" style={{ marginBottom: "16px" }}>
            <div>
              <span className="eyebrow">Ingestion Pipeline</span>
              <h2>Processing Audio File</h2>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "20px", margin: "10px 0" }}>
            {/* Stage 1: Uploading */}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.95rem" }}>
                <strong>
                  Stage 1: Uploading file {uploadProgress === 100 ? "✅" : ""}
                </strong>
                {uploadProgress < 100 && (
                  <span style={{ color: "var(--text-muted)" }}>
                    {uploadProgress}% · {formatSize(uploadedBytes)} of {formatSize(totalBytes)} · {uploadSpeed}
                  </span>
                )}
              </div>
              <div className="progress-track">
                <div
                  className={`progress-fill ${uploadProgress === 100 ? "progress-success" : "progress-uploading"}`}
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>

            {/* Stage 2: Preparing Audio */}
            <div style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "0.95rem" }}>
              {uploadProgress < 100 ? (
                <span style={{ fontSize: "1.2rem", color: "var(--text-muted)" }}>⏳</span>
              ) : processingStage === "uploaded" ? (
                <div className="loader" style={{ width: "16px", height: "16px" }} />
              ) : (
                <span style={{ fontSize: "1.2rem", color: "#10b981" }}>✅</span>
              )}
              <span
                style={{
                  fontWeight: processingStage === "uploaded" && uploadProgress === 100 ? 600 : 500,
                  color: processingStage === "uploaded" && uploadProgress === 100 ? "var(--text-primary)" : "var(--text-muted)",
                }}
              >
                Stage 2: Preparing audio
              </span>
            </div>

            {/* Stage 3: Transcribing with AI */}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "0.95rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                {processingStage === "uploaded" ? (
                  <span style={{ fontSize: "1.2rem", color: "var(--text-muted)" }}>⏳</span>
                ) : processingStage === "transcribing" ? (
                  <div className="loader" style={{ width: "16px", height: "16px" }} />
                ) : ["chunking", "embedding", "storing"].includes(processingStage) ? (
                  <span style={{ fontSize: "1.2rem", color: "#10b981" }}>✅</span>
                ) : (
                  <span style={{ fontSize: "1.2rem", color: "var(--text-muted)" }}>⏳</span>
                )}
                <span
                  style={{
                    fontWeight: processingStage === "transcribing" ? 600 : 500,
                    color: processingStage === "transcribing" ? "var(--text-primary)" : "var(--text-muted)",
                  }}
                >
                  Stage 3: Transcribing with AI
                </span>
              </div>
              {processingStage === "transcribing" && (
                <div style={{ paddingLeft: "28px", color: "var(--text-muted)", fontSize: "0.88rem" }}>
                  Analyzing audio... This may take several minutes for long recordings.
                  <div style={{ marginTop: "4px", color: "var(--brown-accent)" }}>
                    ~{estimatedMins} minutes remaining
                  </div>
                </div>
              )}
            </div>

            {/* Stage 4: Building Knowledge Base */}
            <div style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "0.95rem" }}>
              {["uploaded", "transcribing"].includes(processingStage) ? (
                <span style={{ fontSize: "1.2rem", color: "var(--text-muted)" }}>⏳</span>
              ) : ["chunking", "embedding", "storing"].includes(processingStage) ? (
                <div className="loader" style={{ width: "16px", height: "16px" }} />
              ) : (
                <span style={{ fontSize: "1.2rem", color: "var(--text-muted)" }}>⏳</span>
              )}
              <span
                style={{
                  fontWeight: ["chunking", "embedding", "storing"].includes(processingStage) ? 600 : 500,
                  color: ["chunking", "embedding", "storing"].includes(processingStage) ? "var(--text-primary)" : "var(--text-muted)",
                }}
              >
                Stage 4: Building knowledge base (chunking & embedding)
              </span>
            </div>
          </div>

          {/* Elapsed Time counter */}
          {uploadProgress === 100 && (
            <div style={{ marginTop: "24px", fontSize: "0.9rem", color: "var(--text-muted)" }}>
              Processing for {formatElapsed(elapsedTime)}...
            </div>
          )}

          {error && (
            <div className="server-error" style={{ marginTop: "20px" }}>
              {error}
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

      {/* STEP 3: SUCCESS STATE */}
      {step === 3 && audioMetadata && (
        <div
          className="field"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            padding: "10px 0",
          }}
        >
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

          <h2 style={{ margin: "0 0 8px", fontWeight: 700, color: "var(--text-primary)" }}>
            Audio Transcribed & Indexed!
          </h2>
          <p style={{ margin: "0 0 20px", color: "var(--text-secondary)", maxWidth: "480px" }}>
            <strong>'{file?.name}'</strong> has been fully transcribed, chunked, and embedded into the vector store.
          </p>

          {/* Badges Panel */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center", marginBottom: "20px" }}>
            <span className="type-pill" style={{ textTransform: "none", backgroundColor: "rgba(139, 92, 26, 0.05)", color: "var(--text-secondary)" }}>
              ⏱️ {audioMetadata.durationFormatted || formatSecondsToDuration(audioMetadata.duration)}
            </span>
            <span className="type-pill" style={{ textTransform: "none", backgroundColor: "rgba(37, 99, 235, 0.05)", color: "var(--blue-primary)", borderColor: "rgba(37, 99, 235, 0.1)" }}>
              💬 ~{audioMetadata.wordCount?.toLocaleString() || 0} words
            </span>
            <span className="type-pill" style={{ textTransform: "none", backgroundColor: "rgba(16, 185, 129, 0.05)", color: "#059669", borderColor: "rgba(16, 185, 129, 0.1)" }}>
              👥 ~{audioMetadata.estimatedSpeakers || 1} speakers
            </span>
            <span className="type-pill" style={{ textTransform: "none", backgroundColor: "rgba(168, 85, 247, 0.05)", color: "#9333ea", borderColor: "rgba(168, 85, 247, 0.1)" }}>
              🌐 {audioMetadata.language || "English"}
            </span>
          </div>

          {/* Collapsible Transcript Summary */}
          {summary && (
            <div
              style={{
                width: "100%",
                maxWidth: "600px",
                border: "1px solid var(--border-color)",
                borderRadius: "16px",
                padding: "16px",
                textAlign: "left",
                background: "#fdfdfb",
                marginBottom: "24px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  cursor: "pointer",
                }}
                onClick={() => setShowSummary((current) => !current)}
              >
                <strong style={{ fontSize: "0.95rem", color: "var(--text-primary)" }}>
                  Transcript Summary & Key Points
                </strong>
                <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                  {showSummary ? "Hide" : "Show"}
                </span>
              </div>
              {showSummary && (
                <div
                  style={{
                    marginTop: "12px",
                    fontSize: "0.9rem",
                    color: "var(--text-secondary)",
                    lineHeight: "1.5",
                    borderTop: "1px solid var(--border-color)",
                    paddingTop: "12px",
                    maxHeight: "180px",
                    overflowY: "auto",
                  }}
                >
                  <div style={{ whiteSpace: "pre-wrap" }}>{summary}</div>
                </div>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: "flex", gap: "12px" }}>
            <button type="button" className="primary-button" onClick={() => onAskDocument?.(documentId)}>
              Ask questions about this audio
            </button>
            <button type="button" className="secondary-button" onClick={resetState}>
              Upload Another
            </button>
          </div>
        </div>
      )}
    </section>
  );
};

export default AudioUpload;
