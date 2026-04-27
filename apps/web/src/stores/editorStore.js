import { create } from 'zustand';

/**
 * @typedef {object} EditorState
 * @property {boolean} isDirty - Whether the editor has unsaved changes
 * @property {string} content - Current editor content
 * @property {(content: string) => void} setContent
 * @property {() => void} resetDirty
 */

/** @type {import('zustand').UseBoundStore<import('zustand').StoreApi<EditorState>>} */
export const useEditorStore = create((set) => ({
  isDirty: false,
  content: '',
  /** @type {string | null} ID of revision being diffed, null = normal editor */
  diffRevisionId: null,
  /** @type {string} Content of the revision being diffed */
  diffContent: '',

  /** @param {string} content */
  setContent: (content) => set({ content, isDirty: true }),

  /** @param {string} content */
  setContentClean: (content) => set({ content, isDirty: false }),

  resetDirty: () => set({ isDirty: false }),

  /**
   * Show diff view for a revision.
   * @param {string} revisionId
   * @param {string} revisionContent
   */
  showDiff: (revisionId, revisionContent) =>
    set({ diffRevisionId: revisionId, diffContent: revisionContent }),

  /** Close diff view and return to editor. */
  closeDiff: () => set({ diffRevisionId: null, diffContent: '' }),
}));
