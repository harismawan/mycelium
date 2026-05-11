import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

const sidebarSource = readFileSync(new URL('../../src/components/sidebar/Sidebar.jsx', import.meta.url), 'utf8');
const noteListSource = readFileSync(new URL('../../src/components/NoteListPanel.jsx', import.meta.url), 'utf8');
const rightPaneSource = readFileSync(new URL('../../src/components/rightpane/RightPane.jsx', import.meta.url), 'utf8');
const appLayoutSource = readFileSync(new URL('../../src/components/AppLayout.jsx', import.meta.url), 'utf8');
const confirmDialogSource = readFileSync(new URL('../../src/components/ConfirmDialog.jsx', import.meta.url), 'utf8');

describe('directory UI wiring', () => {
  test('Sidebar renders directories instead of tags', () => {
    expect(sidebarSource).toContain('useDirectories');
    expect(sidebarSource).toContain('Directories');
    expect(sidebarSource).toContain('Unfiled');
    expect(sidebarSource).not.toContain('useTags');
    expect(sidebarSource).not.toContain('Tags</span>');
  });

  test('Sidebar normalizes root directory creates to null parentId', () => {
    expect(sidebarSource).toContain("newParentId === 'root' ? null : newParentId");
    expect(sidebarSource).toContain('{ name, parentId }');
    expect(sidebarSource).not.toContain('{ name, parentId: newParentId }');
  });

  test('Sidebar renders Unfiled after directory entries', () => {
    expect(sidebarSource.indexOf('{directories.map((directory) => renderDirectory(directory))}'))
      .toBeLessThan(sidebarSource.indexOf('<NavLabel>Unfiled</NavLabel>'));
  });

  test('Sidebar renders pinned notes below the directory list', () => {
    expect(sidebarSource.indexOf('<NavLabel>Unfiled</NavLabel>'))
      .toBeLessThan(sidebarSource.indexOf('<span>Pinned</span>'));
    expect(sidebarSource.indexOf('<span>Pinned</span>'))
      .toBeLessThan(sidebarSource.indexOf('<BottomSection>'));
  });

  test('Sidebar directory tree follows right pane nested styling', () => {
    expect(sidebarSource).toContain("props.$minimized ? '6px 8px' : `6px 8px 6px ${12 + props.$depth * 18}px`");
    expect(sidebarSource).toContain("left: ${(props) => `${22 + (props.$depth - 1) * 18}px`}");
    expect(sidebarSource).toContain('border-left: 1px solid var(--color-border)');
    expect(sidebarSource).toContain('border-top: 1px solid var(--color-border)');
    expect(sidebarSource).toContain('$depth={depth}');
    expect(sidebarSource).toContain('$depth={0}');
  });

  test('Sidebar directories collapse from the list item click', () => {
    expect(sidebarSource).toContain('collapsedDirectoryIds');
    expect(sidebarSource).toContain('toggleDirectoryCollapse');
    expect(sidebarSource).toContain('const selectDirectory = () =>');
    expect(sidebarSource).toContain('onClick={selectDirectory}');
    expect(sidebarSource).toContain('aria-expanded={hasChildren ? !isCollapsed : undefined}');
    expect(sidebarSource).toContain('{!isMinimizedView && !isCollapsed && children.map((child) => renderDirectory(child, depth + 1))}');
    expect(sidebarSource).not.toContain('DirectoryToggle');
    expect(sidebarSource).not.toContain('ChevronRight');
    expect(sidebarSource).not.toContain('ChevronDown');
  });

  test('Sidebar directory rename uses title double click instead of a pencil action', () => {
    expect(sidebarSource).toContain('const startRenameDirectory = (event) =>');
    expect(sidebarSource).toContain('<NavLabel onDoubleClick={startRenameDirectory}>{directory.name}</NavLabel>');
    expect(sidebarSource).not.toContain('Pencil');
    expect(sidebarSource).not.toContain('aria-label={`Rename ${directory.name}`}');
  });

  test('Sidebar directory delete uses a confirmation dialog', () => {
    expect(sidebarSource).toContain("import ConfirmDialog from '../ConfirmDialog.jsx'");
    expect(sidebarSource).toContain('const [deleteTarget, setDeleteTarget] = useState(null)');
    expect(sidebarSource).toContain('const confirmDeleteDirectory = () =>');
    expect(sidebarSource).toContain('const hasNotes = (directory.noteCount ?? 0) > 0');
    expect(sidebarSource).toContain('const canDeleteDirectory = !hasChildren && !hasNotes');
    expect(sidebarSource).toContain('if (!deleteTarget.canDelete) {');
    expect(sidebarSource).toContain("title={canDeleteDirectory ? 'Delete empty directory' : 'Directory must be empty before deletion'}");
    expect(sidebarSource).toContain('setDeleteTarget({ id: directory.id, name: directory.name, canDelete: canDeleteDirectory })');
    expect(sidebarSource).toContain('<ConfirmDialog');
    expect(sidebarSource).toContain('title="Delete directory"');
    expect(sidebarSource).toContain('confirmLabel="Delete"');
    expect(sidebarSource).toContain('hideConfirm={!deleteTarget.canDelete}');
    expect(sidebarSource).toContain('Move or remove its notes and subdirectories before deleting it.');
    expect(sidebarSource).toContain('onConfirm={confirmDeleteDirectory}');
    expect(confirmDialogSource).toContain('hideConfirm = false');
    expect(confirmDialogSource).toContain('{!hideConfirm && <ConfirmBtn onClick={onConfirm}>{confirmLabel}</ConfirmBtn>}');
    expect(sidebarSource).not.toContain('deleteDirectory.mutate(directory.id)');
  });

  test('Sidebar pinned note rows match the main list item rhythm', () => {
    expect(sidebarSource).toContain('const PinnedItem = styled.button`');
    expect(sidebarSource).toContain('padding: 6px 8px;');
    expect(sidebarSource).toContain('font-size: 13px;');
    expect(sidebarSource).toContain('<NavIcon><Pin size={14} /></NavIcon>');
    expect(sidebarSource).toContain('<PinnedTitle>{note.title}</PinnedTitle>');
  });

  test('Sidebar can minimize to an icon-only rail', () => {
    expect(appLayoutSource).toContain('const sidebarMinimized = useUIStore((s) => s.sidebarMinimized)');
    expect(appLayoutSource).toContain("<NavColumn $minimized={sidebarMinimized}");
    expect(appLayoutSource).toContain("props.$minimized ? '52px' : 'var(--sidebar-width)'");
    expect(appLayoutSource).not.toContain('&:hover,');
    expect(appLayoutSource).not.toContain('&:focus-within');
    expect(sidebarSource).toContain('const sidebarMinimized = useUIStore((s) => s.sidebarMinimized)');
    expect(sidebarSource).toContain('const toggleSidebarMinimized = useUIStore((s) => s.toggleSidebarMinimized)');
    expect(sidebarSource).toContain('const isMinimizedView = sidebarMinimized');
    expect(sidebarSource).toContain("aria-label={sidebarMinimized ? 'Expand sidebar' : 'Minimize sidebar'}");
    expect(sidebarSource).toContain('{sidebarMinimized ? <ChevronsRight size={13} /> : <ChevronsLeft size={13} />}');
    expect(sidebarSource).toContain('{!isMinimizedView && <NavLabel>All Notes</NavLabel>}');
  });

  test('Sidebar minimized hover uses a text toast instead of expanding the sidebar', () => {
    expect(sidebarSource).toContain('const SidebarToast = styled.div`');
    expect(sidebarSource).toContain('const [sidebarToast, setSidebarToast] = useState(null)');
    expect(sidebarSource).toContain('const showSidebarToast = (label, event) =>');
    expect(sidebarSource).toContain('const handleSidebarMinimizeToggle = () =>');
    expect(sidebarSource).toContain('setSidebarToast(null)');
    expect(sidebarSource).toContain('if (!sidebarMinimized) {');
    expect(sidebarSource).toContain('const toastProps = (label) => (');
    expect(sidebarSource).toContain("{sidebarToast && <SidebarToast $top={sidebarToast.top}>{sidebarToast.label}</SidebarToast>}");
    expect(sidebarSource).toContain("{...toastProps('All Notes')}");
    expect(sidebarSource).not.toContain('setSidebarPreviewOpen');
  });

  test('Sidebar hides pinned notes while persistently minimized', () => {
    expect(sidebarSource).toContain('{!sidebarMinimized && pinnedNotes.length > 0 && (');
  });

  test('NoteListPanel supports directory and unfiled URL filters', () => {
    expect(noteListSource).toContain("params.get('directoryId')");
    expect(noteListSource).toContain("params.get('unfiled')");
    expect(noteListSource).toContain('directoryId: directoryFilter');
    expect(noteListSource).toContain('unfiled: unfiledFilter');
  });

  test('notes can be dragged onto sidebar directories', () => {
    expect(noteListSource).toContain("const NOTE_DRAG_MIME = 'application/x-mycelium-note-slug'");
    expect(noteListSource).toContain('const handleNoteDragStart = (event, note) =>');
    expect(noteListSource).toContain('event.dataTransfer.setData(NOTE_DRAG_MIME, note.slug)');
    expect(noteListSource).toContain('draggable={editingSlug !== note.slug}');
    expect(sidebarSource).toContain("const NOTE_DRAG_MIME = 'application/x-mycelium-note-slug'");
    expect(sidebarSource).toContain('const handleDirectoryDrop = async (event, directoryId) =>');
    expect(sidebarSource).toContain("await apiPatch(`/notes/${slug}`, { directoryId })");
    expect(sidebarSource).toContain('queryClient.invalidateQueries({ queryKey: noteKeys.all })');
    expect(sidebarSource).toContain('queryClient.invalidateQueries({ queryKey: directoryKeys.all })');
  });

  test('RightPane includes a directory selector that updates directoryId', () => {
    expect(rightPaneSource).toContain('DirectorySelector');
    expect(rightPaneSource).toContain('useDirectories');
    expect(rightPaneSource).toContain('updateNote.mutate({ directoryId');
  });

  test('RightPane directory selector uses styled nested tree controls', () => {
    expect(rightPaneSource).toContain('DirectoryTrigger');
    expect(rightPaneSource).toContain('DirectoryMenu');
    expect(rightPaneSource).toContain('DirectoryOption');
    expect(rightPaneSource).toContain('$depth={directory.depth}');
    expect(rightPaneSource).toContain('border-left: 1px solid var(--color-border)');
  });
});
