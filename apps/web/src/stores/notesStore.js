import { create } from 'zustand';

/**
 * @typedef {object} NotesState
 * @property {string | null} selectedSlug - Currently selected note slug
 * @property {(slug: string) => void} selectNote
 */

/** @type {import('zustand').UseBoundStore<import('zustand').StoreApi<NotesState>>} */
export const useNotesStore = create((set) => ({
  selectedSlug: null,

  /**
   * Select a note by slug.
   * @param {string} slug
   */
  selectNote: (slug) => set({ selectedSlug: slug }),
}));
