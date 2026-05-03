import { create } from 'zustand';

/**
 * @typedef {object} User
 * @property {string} id
 * @property {string} email
 * @property {string} displayName
 */

/**
 * @typedef {object} AuthState
 * @property {User | null} user
 * @property {boolean} isAuthenticated
 * @property {(user: User) => void} login
 * @property {() => void} logout
 * @property {() => Promise<void>} checkAuth
 */

/** @type {import('zustand').UseBoundStore<import('zustand').StoreApi<AuthState>>} */
export const useAuthStore = create((set) => ({
  user: null,
  isAuthenticated: false,

  /**
   * Set the authenticated user.
   * @param {User} user
   */
  login: (user) => set({ user, isAuthenticated: true }),

  /** Clear the authenticated user. */
  logout: () => set({ user: null, isAuthenticated: false }),

  /**
   * Check current auth status by calling the API.
   * Updates store with the current user or clears it on failure.
   */
  checkAuth: async () => {
    try {
      const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
      if (res.ok) {
        const user = await res.json();
        set({ user, isAuthenticated: true });
      } else {
        set({ user: null, isAuthenticated: false });
      }
    } catch {
      set({ user: null, isAuthenticated: false });
    }
  },
}));
