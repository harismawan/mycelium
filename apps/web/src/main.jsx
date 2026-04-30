import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, createGlobalStyle } from 'styled-components';
import './theme.css';

// Core shell — loaded eagerly (small)
import ProtectedRoute from './components/ProtectedRoute.jsx';
import AppLayout from './components/AppLayout.jsx';

// Route pages — lazy loaded (heavy deps: BlockNote, ForceGraph, etc.)
const LoginPage = lazy(() => import('./pages/LoginPage.jsx'));
const RegisterPage = lazy(() => import('./pages/RegisterPage.jsx'));
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'));
const EditorView = lazy(() => import('./pages/EditorView.jsx'));
const GraphPage = lazy(() => import('./pages/GraphPage.jsx'));
const ActivityFeedPage = lazy(() => import('./pages/ActivityFeedPage.jsx'));
const ReadingView = lazy(() => import('./pages/ReadingView.jsx'));
const SettingsPage = lazy(() => import('./pages/SettingsPage.jsx'));

const GlobalStyle = createGlobalStyle`
  *, *::before, *::after {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    background-color: var(--color-bg);
    color: var(--color-text);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
      'Helvetica Neue', Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    line-height: 1.5;
    transition: background-color 0.2s ease, color 0.2s ease;
  }

  a {
    color: var(--color-primary);
    text-decoration: none;
    transition: color 0.15s ease;
    &:hover { color: var(--color-primary-hover); }
  }

  button { font-family: inherit; }
  input, select, textarea { font-family: inherit; }

  ::selection {
    background: var(--color-primary);
    color: #fff;
  }

  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--color-border); border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--color-text-secondary); }
`;

function PageLoader() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      minHeight: 200,
      color: 'var(--color-text-secondary)',
      fontSize: 14,
    }}>
      Loading…
    </div>
  );
}

function SearchResults() {
  return <div style={{ padding: 24 }}>Search results placeholder</div>;
}

const queryClient = new QueryClient();
const theme = {};

const router = createBrowserRouter([
  {
    path: '/login',
    element: <Suspense fallback={<PageLoader />}><LoginPage /></Suspense>,
  },
  {
    path: '/register',
    element: <Suspense fallback={<PageLoader />}><RegisterPage /></Suspense>,
  },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <Suspense fallback={<PageLoader />}><DashboardPage /></Suspense> },
      { path: 'notes/:slug', element: <Suspense fallback={<PageLoader />}><EditorView /></Suspense> },
      { path: 'notes/:slug/read', element: <Suspense fallback={<PageLoader />}><ReadingView /></Suspense> },
      { path: 'graph', element: <Suspense fallback={<PageLoader />}><GraphPage /></Suspense> },
      { path: 'activity', element: <Suspense fallback={<PageLoader />}><ActivityFeedPage /></Suspense> },
      { path: 'search', element: <SearchResults /> },
      { path: 'settings', element: <Suspense fallback={<PageLoader />}><SettingsPage /></Suspense> },
    ],
  },
]);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <GlobalStyle />
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
