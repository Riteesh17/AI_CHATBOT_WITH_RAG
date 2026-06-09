import axios from "axios";

const TOKEN_KEY = "ai-app-auth-token";

const chatApi = axios.create({
  baseURL: "/api",
});

const getAuthToken = () => localStorage.getItem(TOKEN_KEY);

const getAuthHeaders = () => {
  const token = getAuthToken();

  return token
    ? {
        Authorization: `Bearer ${token}`,
      }
    : {};
};

export const createConversation = async (documentIds) => {
  const { data } = await chatApi.post(
    "/conversations",
    { documentIds },
    { headers: getAuthHeaders() }
  );

  return data;
};

export const getConversations = async () => {
  const { data } = await chatApi.get("/conversations", {
    headers: getAuthHeaders(),
  });

  return data;
};

export const getMessages = async (conversationId) => {
  const { data } = await chatApi.get(`/conversations/${conversationId}/messages`, {
    headers: getAuthHeaders(),
  });

  return data;
};

export const deleteConversation = async (id) => {
  await chatApi.delete(`/conversations/${id}`, {
    headers: getAuthHeaders(),
  });
};

export const streamMessage = async (
  conversationId,
  query,
  onChunk,
  onDone,
  onError
) => {
  const response = await fetch(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ query }),
  });

  if (!response.ok || !response.body) {
    const errorText = await response.text();
    throw new Error(errorText || "Unable to stream response");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  const processEventBlock = (block) => {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      if (!line.startsWith("data: ")) {
        continue;
      }

      const payload = JSON.parse(line.slice(6));

      if (payload.type === "chunk") {
        onChunk?.(payload.text || "");
      } else if (payload.type === "done") {
        onDone?.(payload);
      } else if (payload.type === "error") {
        onError?.(payload.message || "Streaming failed");
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() || "";

    for (const block of blocks) {
      processEventBlock(block);
    }
  }

  if (buffer.trim()) {
    processEventBlock(buffer);
  }
};

export default chatApi;
