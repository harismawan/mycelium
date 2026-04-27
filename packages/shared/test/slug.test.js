import { describe, test, expect } from 'bun:test';
import { slugify, uniqueSlug } from '../slug.js';

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------
describe('slugify', () => {
  test('converts a basic title to a slug', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  test('removes special characters', () => {
    expect(slugify('Hello! @World# $2024')).toBe('hello-world-2024');
  });

  test('strips unicode characters', () => {
    expect(slugify('Café résumé naïve')).toBe('caf-rsum-nave');
  });

  test('collapses multiple spaces into a single hyphen', () => {
    expect(slugify('too   many    spaces')).toBe('too-many-spaces');
  });

  test('trims leading and trailing hyphens', () => {
    expect(slugify('--leading and trailing--')).toBe('leading-and-trailing');
  });

  test('returns empty string for empty input', () => {
    expect(slugify('')).toBe('');
  });

  test('converts underscores to hyphens', () => {
    expect(slugify('snake_case_title')).toBe('snake-case-title');
  });

  test('handles mixed case', () => {
    expect(slugify('My UPPER and lower Title')).toBe('my-upper-and-lower-title');
  });

  test('handles string of only special characters', () => {
    expect(slugify('!@#$%^&*()')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// uniqueSlug
// ---------------------------------------------------------------------------
describe('uniqueSlug', () => {
  test('returns base slug when it is unique', () => {
    expect(uniqueSlug('New Note', [])).toBe('new-note');
  });

  test('appends -1 when base slug is taken', () => {
    expect(uniqueSlug('My Note', ['my-note'])).toBe('my-note-1');
  });

  test('appends -2 when base and -1 are both taken', () => {
    expect(uniqueSlug('My Note', ['my-note', 'my-note-1'])).toBe('my-note-2');
  });

  test('works with a Set of existing slugs', () => {
    const existing = new Set(['hello-world', 'hello-world-1']);
    expect(uniqueSlug('Hello World', existing)).toBe('hello-world-2');
  });

  test('works with an Array of existing slugs', () => {
    const existing = ['test-slug', 'test-slug-1', 'test-slug-2'];
    expect(uniqueSlug('Test Slug', existing)).toBe('test-slug-3');
  });

  test('returns base slug with empty existing set', () => {
    expect(uniqueSlug('Fresh Title', new Set())).toBe('fresh-title');
  });
});
