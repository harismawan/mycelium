import { EMBEDDING_DIMENSIONS } from '@mycelium/shared';

/**
 * Optional embedding provider for semantic search.
 *
 * The entire vector arm is feature-flagged on `EMBEDDING_PROVIDER`. When it is
 * unset, `embedText` returns `null` immediately and every caller falls back to
 * lexical-only behavior that is byte-identical to the pre-pgvector code path.
 *
 * Every failure mode — disabled provider, empty input, non-200 response,
 * malformed body, wrong dimensionality, network error — degrades to `null`
 * rather than throwing, so a flaky or misconfigured provider can never break a
 * note write or a search request.
 *
 * Environment:
 *   EMBEDDING_PROVIDER  feature flag; unset/empty disables the arm.
 *   EMBEDDING_API_URL   OpenAI-compatible /embeddings endpoint (default OpenAI).
 *   EMBEDDING_API_KEY   bearer token sent as `Authorization`.
 *   EMBEDDING_MODEL     model id (default 'text-embedding-3-small').
 *
 * @module services/embedding
 */

/**
 * Embed a single text into a fixed-length vector.
 *
 * @param {string} text - Text to embed (callers pass `${title}\n\n${content}`).
 * @returns {Promise<number[] | null>} The embedding, or `null` when the arm is
 *   disabled or the call fails.
 */
export async function embedText(text) {
  if (!process.env.EMBEDDING_PROVIDER) return null; // arm disabled -> lexical-only
  if (typeof text !== 'string' || text.trim() === '') return null;

  const url = process.env.EMBEDDING_API_URL ?? 'https://api.openai.com/v1/embeddings';
  const model = process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small';
  const apiKey = process.env.EMBEDDING_API_KEY;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        input: text.slice(0, 8000),
        dimensions: EMBEDDING_DIMENSIONS,
      }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    const vector = body?.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS) return null;
    return vector;
  } catch {
    return null; // graceful degradation -> lexical-only
  }
}
