import { describe, test, expect, beforeEach } from 'bun:test';
import { useAuthStore } from '../../src/stores/authStore.js';

beforeEach(() => {
  useAuthStore.setState({ user: null, isAuthenticated: false });
});

describe('useAuthStore', () => {
  test('initial state is unauthenticated', () => {
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });

  test('login() sets user and isAuthenticated', () => {
    const user = { id: '1', email: 'a@b.com', displayName: 'Alice' };
    useAuthStore.getState().login(user);

    const state = useAuthStore.getState();
    expect(state.user).toEqual(user);
    expect(state.isAuthenticated).toBe(true);
  });

  test('logout() clears user and isAuthenticated', () => {
    useAuthStore.getState().login({ id: '1', email: 'a@b.com', displayName: 'Alice' });
    useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });
});
