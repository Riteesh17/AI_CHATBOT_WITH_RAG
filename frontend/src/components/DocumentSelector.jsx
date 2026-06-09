import { useEffect, useMemo, useState } from "react";

import { getDocuments } from "../api/documentsApi";

const DocumentSelector = ({ isOpen, onClose, onConfirm }) => {
  const [documents, setDocuments] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectAll, setSelectAll] = useState(true);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const loadDocuments = async () => {
      try {
        setIsLoading(true);
        setError("");
        const { documents: allDocuments } = await getDocuments();
        const readyDocuments = allDocuments.filter(
          (document) => document.status === "ready"
        );

        setDocuments(readyDocuments);
        setSelectedIds(readyDocuments.map((document) => document.id));
        setSelectAll(true);
      } catch (loadError) {
        setError(
          loadError.response?.data?.message || "Unable to load ready documents"
        );
      } finally {
        setIsLoading(false);
      }
    };

    loadDocuments();
  }, [isOpen]);

  const allSelected = useMemo(
    () => documents.length > 0 && selectedIds.length === documents.length,
    [documents, selectedIds]
  );

  const handleToggleAll = () => {
    if (allSelected || selectAll) {
      setSelectedIds([]);
      setSelectAll(false);
      return;
    }

    setSelectedIds(documents.map((document) => document.id));
    setSelectAll(true);
  };

  const handleToggleDocument = (documentId) => {
    setSelectAll(false);
    setSelectedIds((currentIds) =>
      currentIds.includes(documentId)
        ? currentIds.filter((id) => id !== documentId)
        : [...currentIds, documentId]
    );
  };

  const handleConfirm = () => {
    const payload = allSelected || selectAll ? [] : selectedIds;
    onConfirm(payload);
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-card">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Scope</span>
            <h2>Select documents for this chat</h2>
          </div>
          <button
            type="button"
            className="icon-button modal-close-visible"
            onClick={onClose}
            aria-label="Close"
          >
            x
          </button>
        </div>

        {error ? <div className="server-error">{error}</div> : null}

        {isLoading ? (
          <div className="selector-skeleton-list">
            {Array.from({ length: 4 }).map((_, index) => (
              <div className="selector-skeleton" key={index} />
            ))}
          </div>
        ) : documents.length === 0 ? (
          <div className="empty-state">
            No documents ready yet. Upload files first.
          </div>
        ) : (
          <>
            <label className="selector-row selector-row-featured">
              <input type="checkbox" checked={allSelected || selectAll} onChange={handleToggleAll} />
              <div>
                <strong>All Documents</strong>
                <span>Search across your full ready document library</span>
              </div>
            </label>

            <div className="selector-list">
              {documents.map((document) => (
                <label className="selector-row" key={document.id}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(document.id)}
                    onChange={() => handleToggleDocument(document.id)}
                    disabled={allSelected || selectAll}
                  />
                  <div>
                    <strong>{document.original_name}</strong>
                    <span>
                      <span className="type-pill">{document.file_type.toUpperCase()}</span>
                    </span>
                  </div>
                </label>
              ))}
            </div>
          </>
        )}

        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={handleConfirm}
            disabled={!isLoading && documents.length === 0}
          >
            Create Chat
          </button>
        </div>
      </div>
    </div>
  );
};

export default DocumentSelector;
