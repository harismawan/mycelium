import { describe, test, expect } from 'bun:test';
import {
  parseFrontmatter,
  serializeFrontmatter,
  extractWikilinks,
  generateExcerpt,
  renderToHtml,
} from '../markdown.js';

// ---------------------------------------------------------------------------
// parseFrontmatter
// ---------------------------------------------------------------------------
describe('parseFrontmatter', () => {
  test('extracts YAML frontmatter correctly', () => {
    const md = `---\ntitle: Hello\nstatus: DRAFT\n---\nBody text here`;
    const { frontmatter, body } = parseFrontmatter(md);
    expect(frontmatter).toEqual({ title: 'Hello', status: 'DRAFT' });
    expect(body).toBe('Body text here');
  });

  test('returns empty frontmatter when none present', () => {
    const md = 'Just a plain paragraph.';
    const { frontmatter, body } = parseFrontmatter(md);
    expect(frontmatter).toEqual({});
    expect(body).toBe(md);
  });

  test('handles empty frontmatter block', () => {
    const md = `---\n\n---\nSome body`;
    const { frontmatter, body } = parseFrontmatter(md);
    expect(frontmatter).toEqual({});
    expect(body).toBe('Some body');
  });

  test('handles frontmatter with arrays and nested values', () => {
    const md = `---\ntitle: Test\ntags:\n  - alpha\n  - beta\nmeta:\n  key: value\n---\nContent`;
    const { frontmatter, body } = parseFrontmatter(md);
    expect(frontmatter.title).toBe('Test');
    expect(frontmatter.tags).toEqual(['alpha', 'beta']);
    expect(frontmatter.meta).toEqual({ key: 'value' });
    expect(body).toBe('Content');
  });
});


// ---------------------------------------------------------------------------
// serializeFrontmatter
// ---------------------------------------------------------------------------
describe('serializeFrontmatter', () => {
  test('produces valid Markdown with YAML header', () => {
    const result = serializeFrontmatter({ title: 'My Note' }, 'Hello world');
    expect(result).toContain('---');
    expect(result).toContain('title: My Note');
    expect(result).toContain('Hello world');
  });

  test('serializes complex frontmatter', () => {
    const fm = { title: 'Complex', tags: ['a', 'b'], status: 'PUBLISHED' };
    const result = serializeFrontmatter(fm, 'Body');
    const parsed = parseFrontmatter(result);
    expect(parsed.frontmatter.title).toBe('Complex');
    expect(parsed.frontmatter.tags).toEqual(['a', 'b']);
    expect(parsed.body).toBe('Body');
  });
});

// ---------------------------------------------------------------------------
// Round-trip: parseFrontmatter ↔ serializeFrontmatter
// Validates: Requirements 1.8, 20.2
// ---------------------------------------------------------------------------
describe('parseFrontmatter / serializeFrontmatter round-trip', () => {
  test('round-trip produces equivalent result', () => {
    const originalFm = { title: 'Round Trip', status: 'DRAFT', tags: ['x', 'y'] };
    const originalBody = '# Heading\n\nSome content with [[Link]].';

    const serialized = serializeFrontmatter(originalFm, originalBody);
    const { frontmatter, body } = parseFrontmatter(serialized);

    expect(frontmatter).toEqual(originalFm);
    expect(body).toBe(originalBody);
  });

  test('round-trip with empty frontmatter', () => {
    const serialized = serializeFrontmatter({}, 'Just body');
    const { frontmatter, body } = parseFrontmatter(serialized);
    expect(frontmatter).toEqual({});
    expect(body).toBe('Just body');
  });
});

// ---------------------------------------------------------------------------
// extractWikilinks
// ---------------------------------------------------------------------------
describe('extractWikilinks', () => {
  test('finds single [[Link]]', () => {
    expect(extractWikilinks('See [[My Note]] for details.')).toEqual(['My Note']);
  });

  test('finds [[Multiple Words]] links', () => {
    const md = 'Check [[First Note]] and [[Second Note]] out.';
    expect(extractWikilinks(md)).toEqual(['First Note', 'Second Note']);
  });

  test('deduplicates repeated links', () => {
    const md = '[[Dup]] is mentioned twice: [[Dup]].';
    expect(extractWikilinks(md)).toEqual(['Dup']);
  });

  test('returns empty array for content without wikilinks', () => {
    expect(extractWikilinks('No links here.')).toEqual([]);
  });

  test('handles empty content', () => {
    expect(extractWikilinks('')).toEqual([]);
  });

  test('handles nested/adjacent brackets gracefully', () => {
    // The regex [^\]]+ won't match inner ]], so nested brackets won't form a valid wikilink
    const md = 'Some [regular link](url) and [[Valid Link]] text.';
    const links = extractWikilinks(md);
    expect(links).toContain('Valid Link');
    expect(links).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// generateExcerpt
// ---------------------------------------------------------------------------
describe('generateExcerpt', () => {
  test('truncates long content with ellipsis', () => {
    const longText = 'A'.repeat(300);
    const excerpt = generateExcerpt(longText, 200);
    expect(excerpt.length).toBeLessThanOrEqual(201); // 200 chars + ellipsis character
    expect(excerpt).toEndWith('…');
  });

  test('returns full text when shorter than maxLength', () => {
    const short = 'Short note.';
    expect(generateExcerpt(short)).toBe('Short note.');
  });

  test('strips Markdown heading syntax', () => {
    const md = '# Heading\n\nParagraph text.';
    const excerpt = generateExcerpt(md);
    expect(excerpt).not.toContain('#');
    expect(excerpt).toContain('Heading');
    expect(excerpt).toContain('Paragraph text.');
  });

  test('strips bold and italic markers', () => {
    const md = 'This is **bold** and *italic* text.';
    const excerpt = generateExcerpt(md);
    expect(excerpt).not.toContain('**');
    expect(excerpt).not.toContain('*');
    expect(excerpt).toContain('bold');
    expect(excerpt).toContain('italic');
  });

  test('strips wikilinks but keeps title text', () => {
    const md = 'See [[My Note]] for info.';
    const excerpt = generateExcerpt(md);
    expect(excerpt).not.toContain('[[');
    expect(excerpt).toContain('My Note');
  });

  test('strips frontmatter before generating excerpt', () => {
    const md = `---\ntitle: Test\n---\nActual content here.`;
    const excerpt = generateExcerpt(md);
    expect(excerpt).not.toContain('title: Test');
    expect(excerpt).toContain('Actual content here.');
  });

  test('respects custom maxLength', () => {
    const md = 'Word '.repeat(100);
    const excerpt = generateExcerpt(md, 50);
    expect(excerpt.length).toBeLessThanOrEqual(51); // 50 + ellipsis
  });
});

// ---------------------------------------------------------------------------
// renderToHtml
// ---------------------------------------------------------------------------
describe('renderToHtml', () => {
  test('converts paragraph to HTML', () => {
    const html = renderToHtml('Hello world');
    expect(html).toContain('<p>Hello world</p>');
  });

  test('converts heading to HTML', () => {
    const html = renderToHtml('# Title');
    expect(html).toContain('<h1>Title</h1>');
  });

  test('converts bold and italic', () => {
    const html = renderToHtml('**bold** and *italic*');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
  });

  test('converts links to anchor tags', () => {
    const html = renderToHtml('[click](https://example.com)');
    expect(html).toContain('<a href="https://example.com">click</a>');
  });

  test('does not include frontmatter in HTML output', () => {
    const md = `---\ntitle: Hidden\n---\nVisible content`;
    const html = renderToHtml(md);
    expect(html).not.toContain('title: Hidden');
    expect(html).toContain('Visible content');
  });

  test('converts code blocks', () => {
    const md = '```\nconst x = 1;\n```';
    const html = renderToHtml(md);
    expect(html).toContain('<code>');
  });
});

// ---------------------------------------------------------------------------
// parseMarkdown (mdast)
// ---------------------------------------------------------------------------
import { parseMarkdown, serializeMarkdown } from '../markdown.js';

describe('parseMarkdown', () => {
  test('parses a simple paragraph into an mdast tree', () => {
    const tree = parseMarkdown('Hello world');
    expect(tree.type).toBe('root');
    expect(tree.children.length).toBeGreaterThan(0);
    expect(tree.children[0].type).toBe('paragraph');
  });

  test('parses headings correctly', () => {
    const tree = parseMarkdown('# Title\n\n## Subtitle');
    const headings = tree.children.filter((n) => n.type === 'heading');
    expect(headings).toHaveLength(2);
    expect(headings[0].depth).toBe(1);
    expect(headings[1].depth).toBe(2);
  });

  test('parses frontmatter as a yaml node', () => {
    const tree = parseMarkdown('---\ntitle: Test\n---\nBody');
    const yamlNode = tree.children.find((n) => n.type === 'yaml');
    expect(yamlNode).toBeDefined();
    expect(yamlNode.value).toContain('title: Test');
  });

  test('parses code blocks', () => {
    const tree = parseMarkdown('```js\nconst x = 1;\n```');
    const code = tree.children.find((n) => n.type === 'code');
    expect(code).toBeDefined();
    expect(code.lang).toBe('js');
    expect(code.value).toBe('const x = 1;');
  });

  test('parses lists', () => {
    const tree = parseMarkdown('- item 1\n- item 2\n- item 3');
    const list = tree.children.find((n) => n.type === 'list');
    expect(list).toBeDefined();
    expect(list.children).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// serializeMarkdown (mdast → string)
// ---------------------------------------------------------------------------
describe('serializeMarkdown', () => {
  test('serializes a parsed tree back to markdown', () => {
    const original = '# Hello\n\nWorld\n';
    const tree = parseMarkdown(original);
    const result = serializeMarkdown(tree);
    expect(result).toContain('# Hello');
    expect(result).toContain('World');
  });

  test('round-trip preserves structure', () => {
    const original = '## Heading\n\nParagraph with **bold** text.\n\n- item 1\n- item 2\n';
    const tree = parseMarkdown(original);
    const result = serializeMarkdown(tree);
    expect(result).toContain('## Heading');
    expect(result).toContain('**bold**');
    // remark-stringify may use * instead of - for list markers
    expect(result).toMatch(/[*-] item 1/);
    expect(result).toMatch(/[*-] item 2/);
  });

  test('preserves frontmatter in round-trip', () => {
    const original = '---\ntitle: Test\n---\n\nBody content\n';
    const tree = parseMarkdown(original);
    const result = serializeMarkdown(tree);
    expect(result).toContain('---');
    expect(result).toContain('title: Test');
    expect(result).toContain('Body content');
  });
});
