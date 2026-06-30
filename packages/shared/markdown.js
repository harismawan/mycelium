import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import remarkFrontmatter from 'remark-frontmatter';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import YAML from 'yaml';
import { RELATION_VOCAB } from './constants.js';

/**
 * Parse YAML frontmatter from a Markdown string.
 *
 * Extracts the YAML block between `---` delimiters at the start of the
 * document and returns the parsed object alongside the remaining body.
 *
 * @param {string} markdown - Full Markdown string potentially containing YAML frontmatter.
 * @returns {{ frontmatter: Record<string, unknown>, body: string }} Parsed frontmatter object and the Markdown body without the frontmatter block.
 */
export function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: markdown };
  }
  const frontmatter = YAML.parse(match[1]) ?? {};
  const body = match[2];
  return { frontmatter, body };
}

/**
 * Serialize a frontmatter object and body back to a Markdown string with a YAML header.
 *
 * @param {Record<string, unknown>} frontmatter - Metadata object to serialize as YAML.
 * @param {string} body - Markdown body content.
 * @returns {string} Complete Markdown string with `---` delimited YAML frontmatter.
 */
export function serializeFrontmatter(frontmatter, body) {
  const yamlStr = YAML.stringify(frontmatter).trimEnd();
  return `---\n${yamlStr}\n---\n${body}`;
}

/**
 * Extract typed, weighted `[[Wikilink]]` references from Markdown content.
 *
 * For each `[[...]]` occurrence, an optional relation prefix is parsed: the
 * inner text is split on its FIRST colon only when the trimmed, lower-cased
 * prefix matches {@link RELATION_VOCAB}. Otherwise the whole inner text is the
 * title (so `[[Chapter 1: Intro]]` is preserved). Results are deduplicated by
 * `relation::title`; `count` is the number of occurrences of that pair (drives
 * edge weight downstream).
 *
 * @param {string} markdown - Markdown content to scan for wikilinks.
 * @returns {Array<{ title: string, relation: string|null, count: number }>}
 *   Deduplicated typed wikilinks with occurrence counts.
 */
export function extractWikilinks(markdown) {
  const regex = /\[\[([^\]]+)\]\]/g;
  /** @type {Map<string, { title: string, relation: string|null, count: number }>} */
  const byKey = new Map();
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    const inner = match[1].trim();
    if (!inner) continue;

    let relation = null;
    let title = inner;
    const colon = inner.indexOf(':');
    if (colon !== -1) {
      const prefix = inner.slice(0, colon).trim().toLowerCase();
      if (RELATION_VOCAB.includes(prefix)) {
        relation = prefix;
        title = inner.slice(colon + 1).trim();
      }
    }
    if (!title) continue;

    const key = `${relation ?? ''}::${title}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      byKey.set(key, { title, relation, count: 1 });
    }
  }
  return [...byKey.values()];
}

/**
 * Generate a plain-text excerpt from Markdown body content.
 *
 * Strips Markdown syntax (headings, bold, italic, links, images, code,
 * blockquotes, horizontal rules, wikilinks) and returns the first
 * `maxLength` characters of the resulting plain text.
 *
 * @param {string} markdown - Markdown content to excerpt.
 * @param {number} [maxLength=200] - Maximum character length of the excerpt.
 * @returns {string} Plain-text excerpt truncated to `maxLength`.
 */
export function generateExcerpt(markdown, maxLength = 200) {
  // Strip frontmatter first
  const { body } = parseFrontmatter(markdown);

  const plain = body
    // Remove images ![alt](url)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Remove links [text](url)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Remove wikilinks [[title]]
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    // Remove headings markers
    .replace(/^#{1,6}\s+/gm, '')
    // Remove bold/italic markers
    .replace(/(\*{1,3}|_{1,3})(.*?)\1/g, '$2')
    // Remove inline code
    .replace(/`([^`]*)`/g, '$1')
    // Remove code fences
    .replace(/```[\s\S]*?```/g, '')
    // Remove blockquote markers
    .replace(/^>\s?/gm, '')
    // Remove horizontal rules
    .replace(/^[-*_]{3,}\s*$/gm, '')
    // Remove list markers
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    // Collapse whitespace
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (plain.length <= maxLength) {
    return plain;
  }
  return plain.slice(0, maxLength).trimEnd() + '…';
}

/**
 * Parse a Markdown string into an mdast (Markdown Abstract Syntax Tree).
 *
 * Uses unified with remark-parse and remark-frontmatter to produce the AST.
 *
 * @param {string} markdown - Markdown string to parse.
 * @returns {import('mdast').Root} The mdast root node.
 */
export function parseMarkdown(markdown) {
  const processor = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ['yaml']);
  return processor.parse(markdown);
}

/**
 * Serialize an mdast AST back to a Markdown string.
 *
 * Uses unified with remark-stringify and remark-frontmatter to produce
 * the Markdown output.
 *
 * @param {import('mdast').Root} mdastTree - The mdast root node to serialize.
 * @returns {string} Serialized Markdown string.
 */
export function serializeMarkdown(mdastTree) {
  const processor = unified()
    .use(remarkStringify)
    .use(remarkFrontmatter, ['yaml']);
  return processor.stringify(mdastTree);
}

/**
 * Render a Markdown string to HTML.
 *
 * Uses the full remark → rehype → rehype-stringify pipeline with
 * frontmatter support.
 *
 * @param {string} markdown - Markdown string to render.
 * @returns {string} HTML string.
 */
export function renderToHtml(markdown) {
  const result = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ['yaml'])
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize)
    .use(rehypeStringify)
    .processSync(markdown);
  return String(result);
}
