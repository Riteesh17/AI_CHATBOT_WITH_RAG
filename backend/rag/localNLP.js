let langPipeline = null;

/**
 * Deterministic keyword-based query expansion
 */
async function expandQuery(query) {
  const original = query.trim();
  const variants = [original];

  const stopWords = new Set([
    'what', 'is', 'the', 'a', 'an', 'are', 'was', 'were',
    'how', 'why', 'when', 'where', 'who', 'which', 'do', 'does', 'did', 'can', 'could',
    'should', 'would', 'will', 'have', 'has', 'had', 'be', 'been', 'being', 'to', 'of',
    'and', 'or', 'but', 'in', 'on', 'at', 'for', 'with', 'about', 'by', 'from', 'as'
  ]);

  const keywords = original
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));

  if (keywords.length > 0) {
    variants.push(keywords.join(' '));
  }

  const statement = original
    .replace(/^(what|how|why|when|where|who|which)\s+(is|are|was|were|do|does|did)\s+/i, '')
    .replace(/\?$/, '')
    .trim();

  if (statement !== original && statement.length > 5) {
    variants.push(statement);
  }

  while (variants.length < 3) {
    variants.push(original);
  }

  return variants.slice(0, 3);
}

/**
 * Local language detection using Xenova text classification
 */
async function detectLanguage(text) {
  try {
    if (!langPipeline) {
      const { pipeline } = require('@xenova/transformers');
      langPipeline = await pipeline(
        'text-classification',
        'Xenova/lang-detection-fasttext-legacy',
        { cache_dir: process.env.XENOVA_CACHE_DIR || './models_cache' }
      );
    }

    const sample = text.split(/\s+/).slice(0, 200).join(' ');
    const result = await langPipeline(sample);

    const langCode = result[0]?.label || 'unknown';

    const langNames = {
      en: 'English', fr: 'French', de: 'German', es: 'Spanish',
      it: 'Italian', pt: 'Portuguese', nl: 'Dutch', ru: 'Russian',
      zh: 'Chinese', ja: 'Japanese', ko: 'Korean', ar: 'Arabic',
      hi: 'Hindi', tr: 'Turkish', pl: 'Polish', sv: 'Swedish',
    };

    return langNames[langCode] || langCode.toUpperCase();
  } catch (err) {
    console.warn('[LocalNLP] Language detection failed, defaulting to English:', err.message);
    return 'English';
  }
}

/**
 * Deterministic text-based title generator
 */
function generateTitle(query) {
  let title = query.trim().replace(/\?+$/, '').trim();

  title = title.replace(
    /^(tell me about|what is|what are|how do|how does|explain|describe|summarize|give me|show me|find|list|what's|whats)\s+/i,
    ''
  );

  title = title.charAt(0).toUpperCase() + title.slice(1);

  if (title.length > 50) {
    title = title.substring(0, 50).replace(/\s+\S*$/, '') + '...';
  }

  if (title.length < 4) {
    title = query.slice(0, 50);
  }

  return title;
}

module.exports = {
  expandQuery,
  detectLanguage,
  generateTitle
};
