import { create } from 'zustand';

/**
 * @typedef {object} NotesState
 * @property {string | null} selectedSlug - Currently selected note slug
 * @property {string[]} pinnedSlugs - List of pinned note slugs
 * @property {(slug: string) => void} selectNote
 * @property {(slug: string) => void} togglePin
 */

/** @type {import('zustand').UseBoundStore<import('zustand').StoreApi<NotesState>>} */
export const useNotesStore = create((set) => ({
  selectedSlug: null,
  pinnedSlugs: [],

  /**
   * Select a note by slug.
   * @param {string} slug
   */
  selectNote: (slug) => set({ selectedSlug: slug }),

  /**
   * Toggle a note's pinned status.
   * Adds the slug if not pinned, removes it if already pinned.
   * @param {string} slug
   */
  togglePin: (slug) =>
    set((state) => ({
      pinnedSlugs: state.pinnedSlugs.includes(slug)
        ? state.pinnedSlugs.filter((s) => s !== slug)
        : [...state.pinnedSlugs, slug],
    })),
}));
