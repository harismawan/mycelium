import { describe, test, expect, beforeEach } from 'bun:test';
import { useUIStore } from '../../src/stores/uiStore.js';

beforeEach(() => {
  useUIStore.setState({
    theme: 'light',
    sidebarOpen: true,
    sidebarMinimized: false,
    rightPaneOpen: true,
    readingMode: false,
  });
});

describe('useUIStore', () => {
  test('initial state defaults', () => {
    const state = useUIStore.getState();
    expect(state.theme).toBe('light');
    expect(state.sidebarOpen).toBe(true);
    expect(state.sidebarMinimized).toBe(false);
    expect(state.rightPaneOpen).toBe(true);
    expect(state.readingMode).toBe(false);
  });

  test('setTheme() changes the theme', () => {
    useUIStore.getState().setTheme('dark');
    expect(useUIStore.getState().theme).toBe('dark');
  });

  test('toggleSidebar() flips sidebarOpen', () => {
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarOpen).toBe(false);

    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarOpen).toBe(true);
  });

  test('toggleSidebarMinimized() flips sidebarMinimized', () => {
    useUIStore.getState().toggleSidebarMinimized();
    expect(useUIStore.getState().sidebarMinimized).toBe(true);

    useUIStore.getState().toggleSidebarMinimized();
    expect(useUIStore.getState().sidebarMinimized).toBe(false);
  });
});
