import { useEffect } from 'react';
import { useUIStore } from '../stores/uiStore.js';

/**
 * Custom hook that manages theme detection and application.
 *
 * - Reads the current theme from `useUIStore`
 * - On mount, detects OS preferred color scheme if no persisted preference exists
 * - Applies `data-theme` attribute to `document.documentElement`
 *
 * @returns {{ theme: import('../stores/uiStore.js').Theme, setTheme: (t: import('../stores/uiStore.js').Theme) => void }}
 */
export function useTheme() {
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);

  // On mount, detect OS preference if the store has never been explicitly set
  useEffect(() => {
    const persisted = localStorage.getItem('mycelium-ui');
    if (persisted) {
      try {
        const parsed = JSON.parse(persisted);
        // If the store already has a persisted theme, respect it
        if (parsed?.state?.theme) return;
      } catch {
        // ignore parse errors
      }
    }

    // No persisted preference — detect OS color scheme
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    setTheme(prefersDark ? 'dark' : 'light');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply data-theme attribute whenever theme changes
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return { theme, setTheme };
}
