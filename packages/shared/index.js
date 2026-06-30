/**
 * Barrel export for @mycelium/shared.
 *
 * Re-exports every public symbol from the markdown pipeline,
 * slug helpers, and shared constants modules.
 *
 * redis.js is intentionally excluded: it imports `RedisClient` from
 * Bun's built-in runtime and cannot be bundled by Vite for the web app.
 * Import it directly as `@mycelium/shared/redis` in server-only code.
 *
 * @module @mycelium/shared
 */

export {
  parseFrontmatter,
  serializeFrontmatter,
  extractWikilinks,
  generateExcerpt,
  parseMarkdown,
  serializeMarkdown,
  renderToHtml,
} from './markdown.js';

export { slugify, uniqueSlug } from './slug.js';

export {
  NoteStatus,
  DEFAULT_PAGE_LIMIT,
  API_VERSION_PREFIX,
  SCOPES,
  MAX_GRAPH_NODES,
  MAX_GRAPH_DEPTH,
  MAX_LINK_RESULTS,
  GRAPH_DECAY,
  RELATION_VOCAB,
} from './constants.js';

