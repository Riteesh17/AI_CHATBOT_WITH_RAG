const DEFAULT_OPTIONS = {
  targetTokens: 400,
  overlapTokens: 80,
  minChars: 100,
  csvRowGroupSize: 12,
};

const approximateTokenCount = (text) =>
  Math.max(1, Math.ceil((text || "").length / 4));

const splitSentences = (text) =>
  text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

const extractPageNumber = (text) => {
  const match = text.match(/---\s*Page\s+(\d+)\s*---/i);
  return match ? Number(match[1]) : null;
};

const stripPageMarkers = (text) =>
  text
    .replace(/---\s*Page\s+\d+\s*---\n?/gi, "")
    .trim();

const splitParagraphBlock = (block) => {
  const pageNumber = extractPageNumber(block);
  const cleanedBlock = stripPageMarkers(block);

  if (!cleanedBlock) {
    return [];
  }

  return splitSentences(cleanedBlock).length > 1
    ? splitSentences(cleanedBlock).map((content) => ({ content, pageNumber }))
    : [{ content: cleanedBlock, pageNumber }];
};

const splitGenericUnits = (text, targetChars) =>
  text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .flatMap((block) => {
      const cleanedBlock = stripPageMarkers(block);

      if (!cleanedBlock) {
        return [];
      }

      if (cleanedBlock.length <= targetChars) {
        return [
          {
            content: cleanedBlock,
            pageNumber: extractPageNumber(block),
          },
        ];
      }

      return splitParagraphBlock(block);
    });

const splitTabularUnits = (text, groupSize) => {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const units = [];
  let currentSection = null;
  let currentRows = [];

  const flushRows = () => {
    if (currentRows.length === 0) {
      return;
    }

    units.push({
      content: [currentSection, ...currentRows].filter(Boolean).join("\n"),
      pageNumber: null,
    });
    currentRows = [];
  };

  for (const line of lines) {
    if (/^---\s*Sheet:/i.test(line)) {
      flushRows();
      currentSection = line;
      continue;
    }

    currentRows.push(line);

    if (currentRows.length >= groupSize) {
      flushRows();
    }
  }

  flushRows();
  return units;
};

const hardSplitUnit = (unit, maxChars) => {
  const slices = [];
  let remaining = unit.trim();

  while (remaining.length > maxChars) {
    let splitIndex = remaining.lastIndexOf(" ", maxChars);

    if (splitIndex < Math.floor(maxChars * 0.6)) {
      splitIndex = maxChars;
    }

    slices.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }

  if (remaining) {
    slices.push(remaining);
  }

  return slices.filter(Boolean);
};

const splitIntoUnits = (text, options) => {
  const targetChars = options.targetTokens * 4;

  if (options.fileType === "csv" || options.fileType === "xlsx") {
    return splitTabularUnits(text, options.csvRowGroupSize);
  }

  return splitGenericUnits(text, targetChars);
};

const buildOverlapPrefix = (content, overlapChars) => {
  if (!content) {
    return "";
  }

  const overlap = content.slice(-overlapChars).trim();
  const firstSpace = overlap.indexOf(" ");

  if (firstSpace === -1) {
    return overlap;
  }

  return overlap.slice(firstSpace + 1).trim();
};

const pushChunk = (chunks, rawContent, pageNumber, options, textCursor) => {
  const normalized = rawContent.trim();

  if (!normalized || normalized.length < options.minChars) {
    return textCursor;
  }

  const previousChunk = chunks[chunks.length - 1];
  const overlapPrefix = previousChunk
    ? buildOverlapPrefix(previousChunk.content, options.overlapTokens * 4)
    : "";
  const content = overlapPrefix
    ? `${overlapPrefix}\n\n${normalized}`.trim()
    : normalized;
  const startChar = textCursor;
  const endChar = startChar + normalized.length;

  chunks.push({
    content,
    chunkIndex: chunks.length,
    tokenCount: approximateTokenCount(content),
    startChar,
    endChar,
    pageNumber,
  });

  return endChar;
};

const chunkText = (text, options = {}) => {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const targetChars = config.targetTokens * 4;
  const units = splitIntoUnits(text, config).flatMap((unit) =>
    unit.content.length > targetChars
      ? hardSplitUnit(unit.content, targetChars).map((content) => ({
          content,
          pageNumber: unit.pageNumber,
        }))
      : [unit]
  );

  const chunks = [];
  let current = "";
  let currentPageNumber = null;
  let charCursor = 0;

  const flushCurrent = () => {
    charCursor = pushChunk(chunks, current, currentPageNumber, config, charCursor);
    current = "";
  };

  for (const unit of units) {
    const nextPageNumber = unit.pageNumber ?? currentPageNumber;
    const separator = current ? "\n\n" : "";
    const candidate = `${current}${separator}${unit.content}`.trim();

    if (!current) {
      currentPageNumber = nextPageNumber;
    }

    if (candidate.length <= targetChars) {
      current = candidate;
      currentPageNumber = nextPageNumber;
      continue;
    }

    flushCurrent();
    current = unit.content;
    currentPageNumber = nextPageNumber;

    if (current.length > targetChars) {
      const hardPieces = hardSplitUnit(current, targetChars);
      current = "";

      for (let index = 0; index < hardPieces.length; index += 1) {
        if (index === hardPieces.length - 1) {
          current = hardPieces[index];
          currentPageNumber = nextPageNumber;
        } else {
          charCursor = pushChunk(
            chunks,
            hardPieces[index],
            nextPageNumber,
            config,
            charCursor
          );
        }
      }
    }
  }

  flushCurrent();
  return chunks;
};

module.exports = {
  approximateTokenCount,
  chunkText,
};
