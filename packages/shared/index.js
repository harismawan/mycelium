/**
 * Barrel export for @mycelium/shared.
 *
 * Re-exports every public symbol from the markdown pipeline,
 * slug helpers, and shared constants modules.
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
} from './constants.js';
