import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import remarkFrontmatter from 'remark-frontmatter';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import YAML from 'yaml';

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
 * Extract all `[[Wikilink]]` titles from Markdown content.
 *
 * Finds every occurrence of `[[...]]` in the provided Markdown and returns
 * a deduplicated array of the inner titles.
 *
 * @param {string} markdown - Markdown content to scan for wikilinks.
 * @returns {string[]} Array of unique wikilink titles found in the content.
 */
export function extractWikilinks(markdown) {
  const regex = /\[\[([^\]]+)\]\]/g;
  const titles = [];
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    const title = match[1].trim();
    if (title && !titles.includes(title)) {
      titles.push(title);
    }
  }
  return titles;
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
    .use(remarkRehype)
    .use(rehypeStringify)
    .processSync(markdown);
  return String(result);
}
