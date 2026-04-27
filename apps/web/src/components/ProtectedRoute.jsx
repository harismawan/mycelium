import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore.js';

/**
 * Route wrapper that redirects to /login when the user is not authenticated.
 * Calls checkAuth() on mount to verify the session via the API and waits
 * for the result before deciding whether to redirect.
 *
 * @param {{ children: import('react').ReactNode }} props
 */
export default function ProtectedRoute({ children }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const checkAuth = useAuthStore((s) => s.checkAuth);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    checkAuth().finally(() => setChecking(false));
  }, [checkAuth]);

  // Still verifying the session — don't redirect yet
  if (checking) {
    return null;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
}
