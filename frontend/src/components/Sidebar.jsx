import { memo } from "react";

const formatConversationDate = (value) => {
  if (!value) {
    return "";
  }

  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
};

const ConversationItem = memo(({ conversation, isActive, onSelect, onDelete }) => {
  return (
    <article className={`sidebar-item ${isActive ? "sidebar-item-active" : ""}`}>
      <button
        type="button"
        className="sidebar-item-main"
        onClick={() => onSelect(conversation.id)}
      >
        <strong>{conversation.title || "New conversation"}</strong>
        <span>{conversation.last_message_preview || "No messages yet"}</span>
        <small>{formatConversationDate(conversation.updated_at)}</small>
      </button>

      <button
        type="button"
        className="icon-button"
        aria-label="Delete conversation"
        onClick={() => onDelete(conversation)}
      >
        ×
      </button>
    </article>
  );
});

const Sidebar = memo(({
  conversations,
  activeConversationId,
  isOpen,
  isLoading,
  onClose,
  onDelete,
  onNewChat,
  onSelect,
}) => {
  return (
    <>
      {isOpen ? <button type="button" className="sidebar-backdrop" onClick={onClose} /> : null}
      <aside className={`chat-sidebar ${isOpen ? "chat-sidebar-open" : ""}`}>
        <div className="sidebar-top">
          <button type="button" className="primary-button sidebar-new-button" onClick={onNewChat}>
            New Chat
          </button>
        </div>

        <div className="sidebar-list">
          {isLoading ? (
            <div className="sidebar-skeleton-list">
              {Array.from({ length: 5 }).map((_, index) => (
                <div className="sidebar-skeleton" key={index} />
              ))}
            </div>
          ) : conversations.length === 0 ? (
            <div className="empty-state small-empty-state">
              No conversations yet. Start a new chat to query your documents.
            </div>
          ) : (
            conversations.map((conversation) => (
              <ConversationItem
                key={conversation.id}
                conversation={conversation}
                isActive={activeConversationId === conversation.id}
                onSelect={onSelect}
                onDelete={onDelete}
              />
            ))
          )}
        </div>
      </aside>
    </>
  );
});

export default Sidebar;
