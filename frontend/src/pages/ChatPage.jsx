import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import {
  createConversation,
  deleteConversation,
  getConversations,
  getMessages,
  streamMessage,
} from "../api/chatApi";
import { getDocuments } from "../api/documentsApi";
import ChatInput from "../components/ChatInput";
import DocumentSelector from "../components/DocumentSelector";
import MessageBubble from "../components/MessageBubble";
import Sidebar from "../components/Sidebar";
import WorkspaceNav from "../components/WorkspaceNav";

const createOptimisticTitle = (query) =>
  query.length > 50 ? `${query.slice(0, 47)}...` : query;

const ChatPage = () => {
  const navigate = useNavigate();
  const { conversationId } = useParams();

  const [conversations, setConversations] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [messages, setMessages] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSelectorOpen, setIsSelectorOpen] = useState(false);
  const [isLoadingConversations, setIsLoadingConversations] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(true);
  const [isStreaming, setIsStreaming] = useState(false);
  const [displayText, setDisplayText] = useState("");
  const [streamingPhase, setStreamingPhase] = useState("retrieving");
  const [error, setError] = useState("");

  const messagesContainerRef = useRef(null);
  const bufferRef = useRef("");

  useEffect(() => {
    const interval = setInterval(() => {
      if (bufferRef.current !== displayText) {
        setDisplayText(bufferRef.current);
      }
    }, 50);
    return () => clearInterval(interval);
  }, [displayText]);

  const activeConversation = useMemo(
    () =>
      conversations.find((conversation) => conversation.id === activeConversationId) || null,
    [activeConversationId, conversations]
  );

  const documentMap = useMemo(
    () =>
      documents.reduce((accumulator, document) => {
        accumulator[document.id] = document;
        return accumulator;
      }, {}),
    [documents]
  );

  const activeDocumentScopeLabel = useMemo(() => {
    if (!activeConversation) {
      return "All Documents";
    }

    const scopedIds = activeConversation.document_ids || [];

    if (scopedIds.length === 0) {
      return "All Documents";
    }

    const scopedNames = scopedIds
      .map((id) => documentMap[id]?.original_name)
      .filter(Boolean);

    if (scopedNames.length === 0) {
      return `${scopedIds.length} selected documents`;
    }

    return scopedNames.length > 2
      ? `${scopedNames[0]}, ${scopedNames[1]} +${scopedNames.length - 2} more`
      : scopedNames.join(" | ");
  }, [activeConversation, documentMap]);

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        setError("");
        const [conversationResponse, documentResponse] = await Promise.all([
          getConversations(),
          getDocuments(),
        ]);

        setConversations(conversationResponse.conversations);
        setDocuments(documentResponse.documents);

        if (conversationId && !conversationResponse.conversations.some((item) => item.id === conversationId)) {
          navigate("/chat");
        }
      } catch (loadError) {
        setError(loadError.response?.data?.message || "Unable to load workspace data");
      } finally {
        setIsLoadingConversations(false);
        setIsLoadingDocuments(false);
      }
    };

    loadInitialData();
  }, [conversationId, navigate]);

  useEffect(() => {
    if (conversationId) {
      setActiveConversationId(conversationId);
      return;
    }

    setActiveConversationId(null);
    setMessages([]);
  }, [conversationId]);

  useEffect(() => {
    if (!activeConversationId) {
      return;
    }

    const loadMessages = async () => {
      try {
        setIsLoadingMessages(true);
        setError("");
        const { messages: nextMessages } = await getMessages(activeConversationId);
        setMessages(nextMessages);
      } catch (loadError) {
        setError(loadError.response?.data?.message || "Unable to load messages");
        if (loadError.response?.status === 404) {
          navigate("/chat");
        }
      } finally {
        setIsLoadingMessages(false);
      }
    };

    loadMessages();
  }, [activeConversationId, navigate]);

  const isNearBottom = () => {
    const el = messagesContainerRef.current;
    if (!el) return false;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  useEffect(() => {
    if (isNearBottom()) {
      messagesContainerRef.current?.scrollTo({ top: 999999, behavior: "smooth" });
    }
  }, [messages, displayText]);

  const refreshConversations = async (nextActiveId = activeConversationId) => {
    const { conversations: nextConversations } = await getConversations();
    setConversations(nextConversations);

    if (nextActiveId && !nextConversations.some((item) => item.id === nextActiveId)) {
      navigate("/chat");
    }
  };

  const handleCreateConversation = async (documentIds) => {
    try {
      setError("");
      const { conversation } = await createConversation(documentIds);
      setConversations((currentConversations) => [conversation, ...currentConversations]);
      setMessages([]);
      setIsSelectorOpen(false);
      setActiveConversationId(conversation.id);
      navigate(`/chat/${conversation.id}`);
    } catch (createError) {
      setError(createError.response?.data?.message || "Unable to create conversation");
    }
  };

  const handleSelectConversation = (id) => {
    setActiveConversationId(id);
    setIsSidebarOpen(false);
    navigate(`/chat/${id}`);
  };

  const handleDeleteConversation = async (conversation) => {
    const confirmed = window.confirm(
      `Delete "${conversation.title || "this conversation"}"?`
    );

    if (!confirmed) {
      return;
    }

    try {
      setError("");
      await deleteConversation(conversation.id);
      const nextConversations = conversations.filter((item) => item.id !== conversation.id);
      setConversations(nextConversations);

      if (conversation.id === activeConversationId) {
        setMessages([]);
        setActiveConversationId(null);
        navigate("/chat");
      }
    } catch (deleteError) {
      setError(deleteError.response?.data?.message || "Unable to delete conversation");
    }
  };

  const handleRetry = async () => {
    try {
      setError("");
      setIsLoadingConversations(true);
      setIsLoadingDocuments(true);
      const [conversationResponse, documentResponse] = await Promise.all([
        getConversations(),
        getDocuments(),
      ]);

      setConversations(conversationResponse.conversations);
      setDocuments(documentResponse.documents);
    } catch (retryError) {
      setError(retryError.response?.data?.message || "Unable to reload workspace data");
    } finally {
      setIsLoadingConversations(false);
      setIsLoadingDocuments(false);
    }
  };

  const handleSendMessage = async (query) => {
    if (!activeConversationId || isStreaming) {
      return;
    }

    const tempUserMessage = {
      id: `temp-user-${Date.now()}`,
      role: "user",
      content: query,
    };
    const tempAssistantId = `temp-assistant-${Date.now()}`;
    const tempAssistantMessage = {
      id: tempAssistantId,
      role: "assistant",
      content: "",
      source_chunks: [],
      retrieval_meta: null,
      stream_phase: "retrieving",
      isStreaming: true,
    };

    setError("");
    setIsStreaming(true);
    bufferRef.current = "";
    setDisplayText("");
    setStreamingPhase("retrieving");
    setMessages((currentMessages) => [
      ...currentMessages,
      tempUserMessage,
      tempAssistantMessage,
    ]);

    setConversations((currentConversations) =>
      currentConversations.map((conversation) =>
        conversation.id === activeConversationId
          ? {
              ...conversation,
              title: conversation.title || createOptimisticTitle(query),
              last_message_preview: query,
              updated_at: new Date().toISOString(),
              message_count: (conversation.message_count || 0) + 1,
            }
          : conversation
      )
    );

    try {
      await streamMessage(
        activeConversationId,
        query,
        (text) => {
          bufferRef.current += text;
          setStreamingPhase("answering");
        },
        async ({ messageId, sourceChunks, retrieval }) => {
          const finalContent = bufferRef.current;
          setMessages((currentMessages) =>
            currentMessages.map((message) =>
              message.id === tempAssistantId
                ? {
                    ...message,
                    id: messageId || message.id,
                    content: finalContent,
                    source_chunks: sourceChunks || [],
                    retrieval_meta: retrieval || null,
                    isStreaming: false,
                    stream_phase: "complete",
                  }
                : message
            )
          );
          setIsStreaming(false);
          bufferRef.current = "";
          setDisplayText("");
          setStreamingPhase("retrieving");
          await refreshConversations(activeConversationId);
        },
        (streamError) => {
          throw new Error(streamError);
        }
      );
    } catch (sendError) {
      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.id === tempAssistantId
            ? {
                ...message,
                content: "I ran into an error while generating a response.",
                isStreaming: false,
                stream_phase: "complete",
              }
            : message
        )
      );
      setError(sendError.message || "Unable to send message");
      setIsStreaming(false);
      bufferRef.current = "";
      setDisplayText("");
      setStreamingPhase("retrieving");
    }
  };

  return (
    <div className="chat-shell">
      <WorkspaceNav
        title="AI Chatbot"
        mobileMenuAction={() => setIsSidebarOpen((currentValue) => !currentValue)}
      />

      <div className="chat-layout">
        <Sidebar
          conversations={conversations}
          activeConversationId={activeConversationId}
          isOpen={isSidebarOpen}
          isLoading={isLoadingConversations}
          onClose={() => setIsSidebarOpen(false)}
          onDelete={handleDeleteConversation}
          onNewChat={() => setIsSelectorOpen(true)}
          onSelect={handleSelectConversation}
        />

        <section className="chat-main">
          {error ? (
            <div className="server-error error-banner">
              <span>{error}</span>
              <button type="button" className="secondary-button" onClick={handleRetry}>
                Retry
              </button>
            </div>
          ) : null}

          {!activeConversationId && !isLoadingConversations ? (
            <div className="chat-empty-state">
              <span className="eyebrow">Ready</span>
              <h2>Start a conversation</h2>
              <p>Choose your document scope and ask grounded questions with streaming answers.</p>
              <button type="button" className="primary-button" onClick={() => setIsSelectorOpen(true)}>
                New Chat
              </button>
            </div>
          ) : (
            <>
              <div className="chat-header-card">
                <div>
                  <span className="eyebrow">Conversation</span>
                  <h2>{activeConversation?.title || "New conversation"}</h2>
                  <p>{activeDocumentScopeLabel}</p>
                </div>
              </div>

              <div
                ref={messagesContainerRef}
                className="messages-panel"
              >
                {isLoadingMessages ? (
                  <div className="message-skeleton-list">
                    {Array.from({ length: 4 }).map((_, index) => (
                      <div className="message-skeleton" key={index} />
                    ))}
                  </div>
                ) : messages.length === 0 ? (
                  <div className="chat-empty-inline">
                    Ask anything about your selected documents.
                  </div>
                ) : (
                  messages.map((message) => {
                    const displayMessage =
                      message.isStreaming && message.role === "assistant"
                        ? {
                            ...message,
                            content: displayText,
                            stream_phase: streamingPhase,
                          }
                        : message;
                    return <MessageBubble key={message.id} message={displayMessage} />;
                  })
                )}
              </div>

              <ChatInput
                disabled={isStreaming || !activeConversationId}
                onSend={handleSendMessage}
                statusLabel={
                  isStreaming
                    ? streamingPhase === "answering"
                      ? "Generating grounded answer"
                      : "Retrieving relevant evidence"
                    : activeConversationId
                      ? "Responses are grounded in your selected ready documents."
                      : "Create a chat to start asking questions."
                }
              />
            </>
          )}
        </section>
      </div>

      <DocumentSelector
        isOpen={isSelectorOpen}
        onClose={() => setIsSelectorOpen(false)}
        onConfirm={handleCreateConversation}
      />

      {isLoadingDocuments ? <div className="sr-only">Documents loading</div> : null}
    </div>
  );
};

export default ChatPage;
