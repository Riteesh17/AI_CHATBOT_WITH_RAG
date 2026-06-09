import { useEffect, useRef, useState } from "react";

const MAX_VISIBLE_ROWS = 5;

const ChatInput = ({ disabled, onSend, statusLabel }) => {
  const [value, setValue] = useState("");
  const textareaRef = useRef(null);

  useEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, 24 * MAX_VISIBLE_ROWS + 24);
    textarea.style.height = `${nextHeight}px`;
  }, [value]);

  const handleSubmit = () => {
    const trimmed = value.trim();

    if (!trimmed || disabled) {
      return;
    }

    onSend(trimmed);
    setValue("");
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  };

  const showStatus = value.length > 500 || (statusLabel && statusLabel !== "Responses are grounded in your selected ready documents.");

  return (
    <div className="chat-input-shell">
      <div className="chat-input-card">
        <div className="chat-input-row">
          <textarea
            ref={textareaRef}
            className="chat-textarea"
            placeholder="Ask a question about your documents..."
            value={value}
            disabled={disabled}
            rows={1}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={handleKeyDown}
          />

          <button
            type="button"
            className="primary-button send-button"
            disabled={disabled || !value.trim()}
            onClick={handleSubmit}
            aria-label="Send message"
          >
            Send
          </button>
        </div>

        {showStatus && (
          <div className="chat-input-status">
            <span className={`char-count ${value.length > 500 ? "char-count-warning" : ""}`}>
              {value.length > 500 ? `${value.length} characters` : statusLabel}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatInput;
