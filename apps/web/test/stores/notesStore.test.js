import { describe, test, expect, beforeEach } from 'bun:test';
import { useNotesStore } from '../../src/stores/notesStore.js';

beforeEach(() => {
  useNotesStore.setState({ selectedSlug: null });
});

describe('useNotesStore', () => {
  test('initial state has no selection', () => {
    const state = useNotesStore.getState();
    expect(state.selectedSlug).toBeNull();
  });

  test('selectNote() sets selectedSlug', () => {
    useNotesStore.getState().selectNote('my-note');
    expect(useNotesStore.getState().selectedSlug).toBe('my-note');
  });
});
