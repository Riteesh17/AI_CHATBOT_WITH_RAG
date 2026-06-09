import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { createConversation } from "../api/chatApi";
import { getDocuments } from "../api/documentsApi";
import DocumentsList from "../components/DocumentsList";
import FileUploader from "../components/FileUploader";
import UrlIngestion from "../components/UrlIngestion";
import AudioUpload from "../components/AudioUpload";
import WorkspaceNav from "../components/WorkspaceNav";

const DashboardPage = () => {
  const navigate = useNavigate();
  const [documents, setDocuments] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("upload");

  const fetchDocuments = async () => {
    try {
      setError("");
      const { documents: nextDocuments } = await getDocuments();
      setDocuments(nextDocuments);
    } catch (fetchError) {
      setError(
        fetchError.response?.data?.message || "Unable to load your documents"
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, []);

  const handleAskDocument = async (documentId) => {
    if (!documentId) {
      return;
    }

    try {
      const { conversation } = await createConversation([documentId]);
      navigate(`/chat/${conversation.id}`);
    } catch (errorResponse) {
      console.error(
        errorResponse.response?.data?.message || "Unable to start a chat for this document"
      );
    }
  };

  return (
    <div className="dashboard-shell">
      <WorkspaceNav
        title="AI Chatbot"
      />

      <main className="dashboard-layout">
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "8px" }}>
          <div className="workspace-tabs" role="tablist">
            <button
              type="button"
              className={`workspace-tab ${activeTab === "upload" ? "workspace-tab-active" : ""}`}
              onClick={() => setActiveTab("upload")}
              role="tab"
              aria-selected={activeTab === "upload"}
              style={{ background: "none", border: "none", cursor: "pointer" }}
            >
              📁 Upload Files
            </button>
            <button
              type="button"
              className={`workspace-tab ${activeTab === "web" ? "workspace-tab-active" : ""}`}
              onClick={() => setActiveTab("web")}
              role="tab"
              aria-selected={activeTab === "web"}
              style={{ background: "none", border: "none", cursor: "pointer" }}
            >
              🌐 Web URL
            </button>
            <button
              type="button"
              className={`workspace-tab ${activeTab === "audio" ? "workspace-tab-active" : ""}`}
              onClick={() => setActiveTab("audio")}
              role="tab"
              aria-selected={activeTab === "audio"}
              style={{ background: "none", border: "none", cursor: "pointer" }}
            >
              🎙️ Audio
            </button>
          </div>
        </div>

        {activeTab === "upload" ? (
          <FileUploader
            setDocuments={setDocuments}
            setError={setError}
          />
        ) : activeTab === "web" ? (
          <UrlIngestion
            setDocuments={setDocuments}
            setError={setError}
            fetchDocuments={fetchDocuments}
            onAskDocument={handleAskDocument}
          />
        ) : (
          <AudioUpload
            setDocuments={setDocuments}
            setError={setError}
            fetchDocuments={fetchDocuments}
            onAskDocument={handleAskDocument}
          />
        )}
        <DocumentsList
          documents={(() => {
            switch (activeTab) {
              case "web":
                return documents.filter((doc) => doc.file_type?.toLowerCase() === "web");
              case "audio":
                return documents.filter((doc) =>
                  ["mp3", "wav", "m4a"].includes(doc.file_type?.toLowerCase())
                );
              case "upload":
              default:
                return documents.filter(
                  (doc) => !["web", "mp3", "wav", "m4a"].includes(doc.file_type?.toLowerCase())
                );
            }
          })()}
          setDocuments={setDocuments}
          isLoading={isLoading}
          error={error}
          setError={setError}
          fetchDocuments={fetchDocuments}
          onAskDocument={handleAskDocument}
          activeTab={activeTab}
        />
      </main>
    </div>
  );
};

export default DashboardPage;
