import { Outlet, useLocation } from 'react-router-dom';
import styled from 'styled-components';
import { useUIStore } from '../stores/uiStore.js';
import { useTheme } from '../hooks/useTheme.js';
import RightPane from './rightpane/RightPane.jsx';
import Sidebar from './sidebar/Sidebar.jsx';
import NoteListPanel from './NoteListPanel.jsx';
import CommandPalette from './CommandPalette.jsx';

const Shell = styled.div`
  display: flex;
  height: 100vh;
  overflow: hidden;
  background-color: var(--color-bg);
  color: var(--color-text);
`;

const NavColumn = styled.aside`
  width: var(--sidebar-width);
  min-width: var(--sidebar-width);
  background-color: var(--color-bg-surface);
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const NoteListColumn = styled.aside`
  width: var(--notelist-width);
  min-width: var(--notelist-width);
  background-color: var(--color-bg);
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const CenterColumn = styled.main`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background-color: var(--color-bg);
`;

const RightColumn = styled.aside`
  width: var(--rightpane-width);
  min-width: var(--rightpane-width);
  background-color: var(--color-bg-surface);
  border-left: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

/**
 * Four-column Tolaria-style application layout.
 * - Column 1: NavSidebar (narrow navigation)
 * - Column 2: NoteListPanel (note list)
 * - Column 3: Center editor (Outlet)
 * - Column 4: Properties panel (RightPane)
 */
export default function AppLayout() {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const rightPaneOpen = useUIStore((s) => s.rightPaneOpen);
  const location = useLocation();
  const isGraphPage = location.pathname === '/graph';
  const isActivityPage = location.pathname === '/activity';
  const hideNoteList = isGraphPage || isActivityPage;
  // Initialize theme hook so data-theme attribute is set
  useTheme();

  return (
    <Shell>
      <CommandPalette />

      {sidebarOpen && (
        <NavColumn aria-label="Navigation sidebar">
          <Sidebar />
        </NavColumn>
      )}

      {!hideNoteList && (
        <NoteListColumn aria-label="Note list">
          <NoteListPanel />
        </NoteListColumn>
      )}

      <CenterColumn>
        <Outlet />
      </CenterColumn>

      {rightPaneOpen && !hideNoteList && (
        <RightColumn aria-label="Properties panel">
          <RightPane />
        </RightColumn>
      )}
    </Shell>
  );
}
