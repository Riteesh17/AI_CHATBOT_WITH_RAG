const fs = require("fs");
const path = require("path");
const mm = require("music-metadata");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { detectLanguage } = require("./localNLP");

ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * Format duration helper
 * @param {number} seconds
 * @returns {string}
 */
const formatDuration = (seconds) => {
  if (!seconds || isNaN(seconds)) return "0s";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

/**
 * Helper to split audio into N-second chunks using ffmpeg
 */
const splitAudio = async (filePath, duration, chunkDurationSecs = 600) => {
  const chunks = [];
  const numChunks = Math.ceil(duration / chunkDurationSecs);

  for (let i = 0; i < numChunks; i++) {
    const start = i * chunkDurationSecs;
    const chunkPath = filePath.replace(/\.[^.]+$/, `_chunk${i}.wav`);

    await new Promise((resolve, reject) => {
      ffmpeg(filePath)
        .setStartTime(start)
        .setDuration(Math.min(chunkDurationSecs, duration - start))
        .output(chunkPath)
        .audioCodec("pcm_s16le") // WAV format codec
        .on("end", resolve)
        .on("error", (err) => reject(new Error("Audio processing failed: " + err.message)))
        .run();
    });

    chunks.push({ path: chunkPath, startTime: start, index: i });
  }
  return chunks;
};

/**
 * Transcribes a single audio file (direct base64 upload to Gemini)
 */
const transcribeInline = async (filePath, mimeType, extraContext = "") => {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const audioData = fs.readFileSync(filePath).toString("base64");
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: process.env.GEMINI_LLM_MODEL || "gemini-2.5-flash" });

  const prompt = `You are a professional transcription assistant.
         
Transcribe this audio recording completely and accurately.
${extraContext}

Rules:
1. Output the full verbatim transcript — every word spoken
2. Format with speaker labels if multiple speakers detected:
   [Speaker 1]: text here
   [Speaker 2]: text here
3. Add timestamps every 2-3 minutes in format [00:00] [02:30] [05:00]
4. Note non-speech audio in brackets: [music] [applause] [laughter] [silence]
5. Mark unclear words as [inaudible]
6. Preserve filler words (um, uh, like) for accuracy
7. Use proper punctuation and paragraphs
8. At the end, add a brief summary section:
   === SUMMARY ===
   Topic: [main topic]
   Key Points: [bullet list of 3-5 main points]
   Speakers: [estimated number of speakers]
   Duration Note: [any observations about the recording]`;

  try {
    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: mimeType,
          data: audioData,
        },
      },
      {
        text: prompt,
      },
    ]);

    return result.response.text();
  } catch (error) {
    throw new Error("Transcription failed: " + error.message);
  }
};

/**
 * Wrapper for transcribeInline with 429 exponential backoff retries
 */
const transcribeInlineWithRetry = async (filePath, mimeType, extraContext = "") => {
  let attempts = 3;
  let delay = 2000;
  while (attempts > 0) {
    try {
      return await transcribeInline(filePath, mimeType, extraContext);
    } catch (error) {
      const isRateLimit =
        error.status === 429 ||
        error.message?.includes("429") ||
        error.message?.toLowerCase().includes("rate limit") ||
        error.message?.toLowerCase().includes("quota");

      if (isRateLimit && attempts > 1) {
        console.warn(`[AudioTranscriber] Gemini API rate limited. Retrying in ${delay}ms... (Attempts left: ${attempts - 1})`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        attempts--;
        delay *= 2;
      } else {
        throw error;
      }
    }
  }
};

/**
 * Main transcription function
 */
const transcribeAudio = async (filePath, mimeType) => {
  // F. Validation checks
  if (!fs.existsSync(filePath)) {
    throw new Error("Audio file not found at path");
  }

  const stats = fs.statSync(filePath);
  if (stats.size > 500 * 1024 * 1024) {
    throw new Error("Audio file too large. Maximum size is 500MB.");
  }

  let audioMeta;
  try {
    audioMeta = await mm.parseFile(filePath);
  } catch (err) {
    throw new Error("Could not read audio file. It may be corrupted.");
  }

  const duration = audioMeta.format.duration;
  if (!duration || isNaN(duration)) {
    throw new Error("Could not read audio file. It may be corrupted.");
  }

  if (duration > 7200) {
    throw new Error("Audio too long. Maximum is 2 hours.");
  }

  const codec = (audioMeta.format.codec || "").toLowerCase();
  const supportedCodecs = ["mp3", "wav", "aac", "ogg", "mpeg", "pcm", "m4a", "mp4"];
  if (codec && !supportedCodecs.some((c) => codec.includes(c))) {
    console.warn(`[AudioTranscriber] Warning: Unsupported codec: ${codec}`);
  }

  // B. Chunking strategy
  const fileSizeMB = stats.size / (1024 * 1024);
  let rawTranscript = "";
  let chunkCount = 1;

  if (fileSizeMB <= 18) {
    console.log(`[AudioTranscriber] Processing directly (size: ${fileSizeMB.toFixed(2)}MB)`);
    rawTranscript = await transcribeInlineWithRetry(filePath, mimeType);
  } else {
    // Large file: chunk split
    console.log(`[AudioTranscriber] Splitting file into chunks (size: ${fileSizeMB.toFixed(2)}MB)`);
    const chunks = await splitAudio(filePath, duration);
    chunkCount = chunks.length;

    const transcripts = [];
    try {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const startFormatted = formatDuration(chunk.startTime);
        const extraContext = `This is segment ${i + 1} of ${chunks.length}, starting at ${startFormatted}.`;

        console.log(`[AudioTranscriber] Transcribing chunk ${i + 1}/${chunks.length} starting at ${startFormatted}...`);
        const chunkTranscript = await transcribeInlineWithRetry(chunk.path, "audio/wav", extraContext);
        transcripts.push(`\n\n[Segment ${i + 1} - ${startFormatted}]\n${chunkTranscript}`);

        // 500ms delay to avoid rate limits
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      rawTranscript = transcripts.join("");
    } finally {
      // Clean up chunk files immediately
      for (const chunk of chunks) {
        try {
          if (fs.existsSync(chunk.path)) {
            fs.unlinkSync(chunk.path);
          }
        } catch (unlinkErr) {
          console.warn(`[AudioTranscriber] Failed to clean up chunk ${chunk.path}: ${unlinkErr.message}`);
        }
      }
    }
  }

  // E. Post-Transcription Processing
  // 1. Extract Summary Section
  let transcriptText = rawTranscript;
  let summaryText = null;

  const summarySplit = rawTranscript.split("=== SUMMARY ===");
  if (summarySplit.length > 1) {
    transcriptText = summarySplit[0].trim();
    summaryText = "=== SUMMARY ===\n" + summarySplit.slice(1).join("=== SUMMARY ===").trim();
  }

  // 2. Clean the transcript
  transcriptText = transcriptText.replace(/\n{3,}/g, "\n\n"); // collapse empty lines
  transcriptText = transcriptText.replace(/\[Speaker (\d+)\]:?/g, "Speaker $1:"); // normalize labels

  // 3. Word Count
  const wordCount = transcriptText.trim().split(/\s+/).filter(Boolean).length;

  // 4. Estimate Speaker Count
  const speakerMatches = transcriptText.match(/Speaker \d+:/g) || [];
  const uniqueSpeakers = new Set(speakerMatches.map((s) => s.replace(":", "").trim()));
  const estimatedSpeakers = uniqueSpeakers.size || 1;

  // 5. Detect Language
  let detectedLanguage = "English";
  if (wordCount > 100) {
    try {
      detectedLanguage = await detectLanguage(transcriptText);
    } catch (langErr) {
      console.warn("[AudioTranscriber] Language detection failed:", langErr.message);
    }
  }

  return {
    transcript: transcriptText,
    summary: summaryText,
    metadata: {
      duration,
      durationFormatted: formatDuration(duration),
      wordCount,
      estimatedSpeakers,
      language: detectedLanguage,
      codec: audioMeta.format.codec || "unknown",
      bitrate: audioMeta.format.bitrate || 0,
      title: audioMeta.common.title || null,
      artist: audioMeta.common.artist || null,
      transcribedAt: new Date().toISOString(),
      chunkCount,
    },
  };
};

module.exports = {
  transcribeAudio,
};
