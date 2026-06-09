const LLM_MODEL = process.env.GEMINI_LLM_MODEL || "gemini-2.5-flash";
const STREAM_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${LLM_MODEL}:streamGenerateContent?alt=sse`;

const normalizeHistory = (conversationHistory) =>
  conversationHistory.slice(-6).map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  }));

const extractTextFromPayload = (payload) => {
  const parts = payload?.candidates?.[0]?.content?.parts || [];

  return parts
    .map((part) => part.text || "")
    .join("")
    .trim();
};

const streamResponse = async (
  systemPrompt,
  context,
  conversationHistory,
  userQuery,
  onChunk,
  abortSignal
) => {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  try {
    const contents = [
      ...normalizeHistory(conversationHistory),
      {
        role: "user",
        parts: [
          {
            text: `${context}\n\nUSER QUESTION:\n${userQuery}`,
          },
        ],
      },
    ];

    const response = await fetch(STREAM_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: systemPrompt }],
        },
        generationConfig: {
          temperature: 0.2,
          topP: 0.85,
          maxOutputTokens: 1024,
        },
        contents,
      }),
      signal: abortSignal,
    });

    if (!response.ok || !response.body) {
      const errorText = await response.text();
      throw new Error(
        `Gemini stream request failed (${response.status} ${response.statusText}): ${errorText}`
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let fullText = "";

    const processSseBlock = (block) => {
      const lines = block
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      for (const line of lines) {
        if (!line.startsWith("data: ")) {
          continue;
        }

        const payload = JSON.parse(line.slice(6));
        const text = extractTextFromPayload(payload);

        if (!text) {
          continue;
        }

        fullText += text;
        onChunk(text);
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
        processSseBlock(block);
      }
    }

    if (buffer.trim()) {
      processSseBlock(buffer);
    }

    const normalized = fullText.trim();

    if (!normalized) {
      throw new Error("Gemini returned an empty response.");
    }

    return normalized;
  } catch (error) {
    console.error("Gemini streaming error:", error);
    throw new Error(`Gemini response failed: ${error.message}`);
  }
};

module.exports = {
  streamResponse,
};
