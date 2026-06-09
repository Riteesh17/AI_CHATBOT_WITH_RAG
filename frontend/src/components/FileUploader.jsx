import { useCallback, useMemo, useState } from "react";
import { useDropzone } from "react-dropzone";

import { uploadFile } from "../api/documentsApi";

const acceptedMimeTypes = {
  "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    ".docx",
  ],
  "text/plain": [".txt"],
  "text/csv": [".csv"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
};

const typeLabels = ["PDF", "DOCX", "TXT", "CSV", "XLSX"];
const allowedTypesError =
  "File type not supported. Allowed: PDF, DOCX, TXT, CSV, XLSX";
const fileTooLargeError = "File too large. Maximum size is 25MB";

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

const getFileIcon = (name) => {
  const extension = name.split(".").pop()?.toLowerCase();

  switch (extension) {
    case "pdf":
      return "PDF";
    case "docx":
      return "DOCX";
    case "txt":
      return "TXT";
    case "csv":
      return "CSV";
    case "xlsx":
      return "XLSX";
    default:
      return "FILE";
  }
};

const createQueueItem = (file) => ({
  id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
  file,
  progress: 0,
  status: "queued",
  error: "",
  document: null,
});

const getRejectedFileMessage = (errors) => {
  if (errors.some((error) => error.code === "file-too-large")) {
    return fileTooLargeError;
  }

  if (
    errors.some(
      (error) => error.code === "file-invalid-type" || error.code === "too-many-files"
    )
  ) {
    return allowedTypesError;
  }

  return errors[0]?.message || "Unable to upload file";
};


const FileUploader = ({ setDocuments, setError }) => {
  const [queue, setQueue] = useState([]);
  const [isUploading, setIsUploading] = useState(false);

  const processQueue = useCallback(
    async (files) => {
      if (!files.length) {
        return;
      }

      setIsUploading(true);

      for (const item of files) {
        setQueue((currentQueue) =>
          currentQueue.map((entry) =>
            entry.id === item.id
              ? { ...entry, status: "uploading", progress: 0, error: "" }
              : entry
          )
        );

        try {
          const response = await uploadFile(item.file, (progress) => {
            setQueue((currentQueue) =>
              currentQueue.map((entry) =>
                entry.id === item.id ? { ...entry, progress } : entry
              )
            );
          });

          setQueue((currentQueue) =>
            currentQueue.map((entry) =>
              entry.id === item.id
                ? {
                    ...entry,
                    status: "success",
                    progress: 100,
                    document: response.document,
                  }
                : entry
            )
          );

          // Replace placeholder in lifted documents state with the actual document response
          setDocuments((currentDocs) =>
            currentDocs.map((doc) =>
              doc.id === item.id ? response.document : doc
            )
          );
        } catch (uploadError) {
          const errorMessage =
            uploadError.response?.data?.message || "Unable to upload file";

          setQueue((currentQueue) =>
            currentQueue.map((entry) =>
              entry.id === item.id
                ? {
                    ...entry,
                    status: "error",
                    error: errorMessage,
                  }
                : entry
            )
          );

          // Remove the placeholder from the documents list and show error
          setDocuments((currentDocs) =>
            currentDocs.filter((doc) => doc.id !== item.id)
          );
          setError(errorMessage);
        }
      }

      setIsUploading(false);
    },
    [setDocuments, setError]
  );

  const onDrop = useCallback(
    (acceptedFiles, rejectedFiles) => {
      const acceptedItems = acceptedFiles.map(createQueueItem);
      const rejectedItems = rejectedFiles.map(({ file, errors }) => ({
        ...createQueueItem(file),
        status: "error",
        error: getRejectedFileMessage(errors),
      }));

      const incomingQueue = [...acceptedItems, ...rejectedItems];

      setQueue((currentQueue) => [...incomingQueue, ...currentQueue]);

      if (acceptedItems.length > 0) {
        // Optimistically add placeholders to the documents list
        const placeholders = acceptedItems.map((item) => ({
          id: item.id,
          original_name: item.file.name,
          file_type: item.file.name.split(".").pop()?.toLowerCase() || "file",
          file_size: item.file.size,
          status: "uploading",
          created_at: new Date().toISOString(),
        }));

        setDocuments((currentDocs) => [...placeholders, ...currentDocs]);
        processQueue(acceptedItems);
      }
    },
    [processQueue, setDocuments]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: acceptedMimeTypes,
    maxSize: 25 * 1024 * 1024,
    multiple: true,
    onDrop,
  });

  const acceptedTypesText = useMemo(() => typeLabels.join(", "), []);

  return (
    <section className="panel-section">
      <div className="section-heading">
        <h2>Upload</h2>
      </div>

      <div
        {...getRootProps()}
        className={`dropzone ${isDragActive ? "dropzone-active" : ""}`}
      >
        <input {...getInputProps()} />
        <div className="dropzone-icon" aria-hidden="true">
          +
        </div>
        <h3>Drag &amp; drop here</h3>
        <p>Accepted file types: {acceptedTypesText}</p>
        <small>Maximum file size: 25MB</small>
      </div>

      <div className="upload-queue">
        {queue.length === 0 ? (
          <div className="empty-state">No uploads yet. Add files to start your document queue.</div>
        ) : (
          queue.map((item) => (
            <article className="queue-item" key={item.id}>
              <div className="file-badge">{getFileIcon(item.file.name)}</div>
              <div className="queue-details">
                <div className="queue-header">
                  <strong>{item.file.name}</strong>
                  <span>{formatBytes(item.file.size)}</span>
                </div>
                <div className="progress-track">
                  <div
                    className={`progress-fill progress-${item.status}`}
                    style={{ width: `${item.progress}%` }}
                  />
                </div>
                <div className="queue-status">
                  {item.status === "uploading" && <span>Uploading...</span>}
                  {item.status === "success" && (
                    <span className="success-text">Uploaded. Background indexing started.</span>
                  )}
                  {item.status === "queued" && <span>Queued</span>}
                  {item.status === "error" && (
                    <span className="error-text">{item.error}</span>
                  )}
                </div>
              </div>
            </article>
          ))
        )}
      </div>

      {isUploading ? (
        <div className="helper-text">
          Uploads run one by one; parsing and embedding continue in the background after upload finishes.
        </div>
      ) : null}
    </section>
  );
};

export default FileUploader;
