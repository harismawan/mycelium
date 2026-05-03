import { describe, test, expect } from 'bun:test';
import {
  noteKeys,
  tagKeys,
  graphKeys,
  revKeys,
  searchKeys,
} from '../../src/api/hooks.js';

describe('query key factories', () => {
  test('noteKeys.all is a stable array', () => {
    expect(noteKeys.all).toEqual(['notes']);
  });

  test('noteKeys.lists produces key with filters', () => {
    const filters = { status: 'DRAFT', tag: 'js' };
    expect(noteKeys.lists(filters)).toEqual(['notes', 'list', filters]);
  });

  test('noteKeys.detail produces key with slug', () => {
    expect(noteKeys.detail('my-note')).toEqual(['notes', 'detail', 'my-note']);
  });

  test('noteKeys.md produces key with slug', () => {
    expect(noteKeys.md('my-note')).toEqual(['notes', 'md', 'my-note']);
  });

  test('tagKeys.all is a stable array', () => {
    expect(tagKeys.all).toEqual(['tags']);
  });

  test('graphKeys.all is a stable array', () => {
    expect(graphKeys.all).toEqual(['graph']);
  });

  test('graphKeys.ego produces key with slug and depth', () => {
    expect(graphKeys.ego('my-note', 2)).toEqual(['graph', 'my-note', 2]);
  });

  test('revKeys.list produces key with noteId', () => {
    expect(revKeys.list('note-123')).toEqual(['revisions', 'note-123']);
  });

  test('searchKeys.query produces key with query string', () => {
    expect(searchKeys.query('hello world')).toEqual(['search', 'hello world']);
  });
});
