import { describe, test, expect, beforeEach } from 'bun:test';
import { useEditorStore } from '../../src/stores/editorStore.js';

beforeEach(() => {
  useEditorStore.setState({ isDirty: false, content: '' });
});

describe('useEditorStore', () => {
  test('initial state is clean with empty content', () => {
    const state = useEditorStore.getState();
    expect(state.isDirty).toBe(false);
    expect(state.content).toBe('');
  });

  test('setContent() updates content and marks dirty', () => {
    useEditorStore.getState().setContent('# Hello');

    const state = useEditorStore.getState();
    expect(state.content).toBe('# Hello');
    expect(state.isDirty).toBe(true);
  });

  test('resetDirty() clears the dirty flag', () => {
    useEditorStore.getState().setContent('changed');
    useEditorStore.getState().resetDirty();

    expect(useEditorStore.getState().isDirty).toBe(false);
  });

  test('resetDirty() preserves content', () => {
    useEditorStore.getState().setContent('keep me');
    useEditorStore.getState().resetDirty();

    expect(useEditorStore.getState().content).toBe('keep me');
  });
});
