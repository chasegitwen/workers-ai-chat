export const DEFAULT_CHUNK_SIZE = 1500;
export const DEFAULT_CHUNK_OVERLAP = 200;

export function splitTextIntoChunks(
  text,
  chunkSize = DEFAULT_CHUNK_SIZE,
  overlap = DEFAULT_CHUNK_OVERLAP
) {
  const chunks = [];
  const cleanText = String(text || "").replace(/\s+/g, " ").trim();

  if (!cleanText) {
    return chunks;
  }

  let start = 0;
  const step = Math.max(1, chunkSize - overlap);

  while (start < cleanText.length) {
    const end = Math.min(start + chunkSize, cleanText.length);
    const chunk = cleanText.slice(start, end).trim();

    if (chunk) {
      chunks.push(chunk);
    }

    start += step;
  }

  return chunks;
}

export function getQueryTerms(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[\s,.;:!?，。；：！？、()（）\[\]{}'"“”‘’<>《》\-_/\\|]+/)
    .map(term => term.trim())
    .filter(term => term.length >= 2)
    .slice(0, 40);
}

export function scoreChunk(content, terms) {
  const lower = String(content || "").toLowerCase();
  let score = 0;

  for (const term of terms) {
    if (lower.includes(term)) {
      score += term.length >= 4 ? 2 : 1;
    }
  }

  return score;
}
