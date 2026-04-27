import { useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import styled from 'styled-components';
import { renderToHtml } from '@mycelium/shared';
import { useNoteMd } from '../api/hooks.js';
import { useUIStore } from '../stores/uiStore.js';

const Article = styled.article`
  max-width: 720px;
  margin: 0 auto;
  padding: 40px 20px;
  line-height: 1.8;
  font-size: 17px;
  color: var(--color-text);
`;

const LoadingState = styled.div`
  padding: 32px 24px;
  font-size: 14px;
  color: var(--color-text-secondary);
`;

const ErrorState = styled.div`
  padding: 32px 24px;
  color: var(--color-danger);
  font-size: 14px;
`;

/**
 * Distraction-free reading view for a single note.
 *
 * - Hides sidebar and right pane on mount (sets readingMode=true)
 * - Restores previous pane state on unmount (sets readingMode=false)
 * - Fetches note markdown via `useNoteMd` and renders as HTML using
 *   the shared `renderToHtml` pipeline.
 *
 * @returns {React.JSX.Element}
 */
export default function ReadingView() {
  const { slug } = useParams();
  const { data: noteData, isLoading, error } = useNoteMd(slug);

  // Keep a ref to the previous UI state so we can restore on unmount
  const prevState = useRef(/** @type {{ sidebarOpen: boolean, rightPaneOpen: boolean } | null} */ (null));

  useEffect(() => {
    const state = useUIStore.getState();

    // Capture current pane visibility before we hide everything
    prevState.current = {
      sidebarOpen: state.sidebarOpen,
      rightPaneOpen: state.rightPaneOpen,
    };

    // Enter reading mode — hide sidebar and right pane
    useUIStore.setState({
      sidebarOpen: false,
      rightPaneOpen: false,
      readingMode: true,
    });

    return () => {
      // Restore previous state on unmount
      const prev = prevState.current;
      useUIStore.setState({
        readingMode: false,
        ...(prev ? { sidebarOpen: prev.sidebarOpen, rightPaneOpen: prev.rightPaneOpen } : {}),
      });
    };
  }, []);

  if (isLoading) {
    return <LoadingState>Loading note…</LoadingState>;
  }

  if (error) {
    return <ErrorState>Failed to load note: {error.message}</ErrorState>;
  }

  const markdown = noteData?.content ?? '';
  const html = renderToHtml(markdown);

  return (
    <Article>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </Article>
  );
}
