import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * @typedef {'light' | 'dark'} Theme
 */

/**
 * @typedef {object} UIState
 * @property {Theme} theme
 * @property {boolean} sidebarOpen
 * @property {boolean} sidebarMinimized
 * @property {boolean} rightPaneOpen
 * @property {boolean} readingMode
 * @property {(theme: Theme) => void} setTheme
 * @property {() => void} toggleSidebar
 * @property {() => void} toggleSidebarMinimized
 * @property {() => void} toggleRightPane
 */

/** @type {import('zustand').UseBoundStore<import('zustand').StoreApi<UIState>>} */
export const useUIStore = create(
  persist(
    (set) => ({
      theme: 'dark',
      /** @type {'blocks' | 'code'} */
      defaultView: 'blocks',
      /** @type {'all' | 'archive' | 'graph' | string} Active sidebar section */
      activeSection: 'all',
      sidebarOpen: true,
      sidebarMinimized: false,
      rightPaneOpen: true,
      readingMode: false,

      /**
       * Set the color theme.
       * @param {Theme} theme
       */
      setTheme: (theme) => set({ theme }),

      /** @param {'blocks' | 'code'} view */
      setDefaultView: (view) => set({ defaultView: view }),

      /** @param {string} section */
      setActiveSection: (section) => set({ activeSection: section }),

      /** Toggle sidebar visibility. */
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

      /** Toggle compact icon-only sidebar mode. */
      toggleSidebarMinimized: () => set((state) => ({ sidebarMinimized: !state.sidebarMinimized })),

      /** Toggle right pane visibility. */
      toggleRightPane: () => set((state) => ({ rightPaneOpen: !state.rightPaneOpen })),
    }),
    {
      name: 'mycelium-ui',
    },
  ),
);
