import { describe, test, expect, beforeEach } from 'bun:test';
import { useNotesStore } from '../../src/stores/notesStore.js';

beforeEach(() => {
  useNotesStore.setState({ selectedSlug: null, pinnedSlugs: [] });
});

describe('useNotesStore', () => {
  test('initial state has no selection and no pins', () => {
    const state = useNotesStore.getState();
    expect(state.selectedSlug).toBeNull();
    expect(state.pinnedSlugs).toEqual([]);
  });

  test('selectNote() sets selectedSlug', () => {
    useNotesStore.getState().selectNote('my-note');
    expect(useNotesStore.getState().selectedSlug).toBe('my-note');
  });

  test('togglePin() adds a slug when not pinned', () => {
    useNotesStore.getState().togglePin('note-a');
    expect(useNotesStore.getState().pinnedSlugs).toEqual(['note-a']);
  });

  test('togglePin() removes a slug when already pinned', () => {
    useNotesStore.getState().togglePin('note-a');
    useNotesStore.getState().togglePin('note-a');
    expect(useNotesStore.getState().pinnedSlugs).toEqual([]);
  });

  test('togglePin() handles multiple pins', () => {
    useNotesStore.getState().togglePin('a');
    useNotesStore.getState().togglePin('b');
    useNotesStore.getState().togglePin('c');
    expect(useNotesStore.getState().pinnedSlugs).toEqual(['a', 'b', 'c']);

    useNotesStore.getState().togglePin('b');
    expect(useNotesStore.getState().pinnedSlugs).toEqual(['a', 'c']);
  });
});
