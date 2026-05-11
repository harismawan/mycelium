import { FileText, Archive, GitBranch, Activity, Pin, Sun, Moon, LogOut, User, Settings, Folder, FolderPlus, Trash2, Check, X, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { useQueryClient } from '@tanstack/react-query';
import {
  directoryKeys,
  noteKeys,
  useNoteCounts,
  useNotes,
  useDirectories,
  useCreateDirectory,
  useUpdateDirectory,
  useDeleteDirectory,
} from '../../api/hooks.js';
import { useUIStore } from '../../stores/uiStore.js';
import { useAuthStore } from '../../stores/authStore.js';
import { apiPatch, apiPost } from '../../api/client.js';
import ConfirmDialog from '../ConfirmDialog.jsx';
import MyceliumLogo from '../MyceliumLogo.jsx';
import SettingsDialog from '../SettingsDialog.jsx';
import { useTheme } from '../../hooks/useTheme.js';

const Nav = styled.nav`
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 12px ${(props) => (props.$minimized ? '6px' : '8px')};
  gap: 2px;
  overflow-y: auto;
`;

const BrandRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: ${(props) => (props.$minimized ? 'center' : 'space-between')};
  gap: 8px;
  padding: 4px 4px 12px;
  font-weight: 700;
  font-size: 14px;
  color: var(--color-text);
  letter-spacing: -0.3px;
`;

const BrandIdentity = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  overflow: hidden;
`;

const BrandText = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const NavItem = styled.button`
  display: flex;
  align-items: center;
  justify-content: ${(props) => (props.$minimized ? 'center' : 'flex-start')};
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: 6px;
  background: ${(props) => (props.$active ? 'var(--color-bg-active)' : 'transparent')};
  color: ${(props) => (props.$active ? 'var(--color-text)' : 'var(--color-text-secondary)')};
  font-size: 13px;
  font-weight: ${(props) => (props.$active ? '600' : '400')};
  cursor: pointer;
  text-align: left;
  transition: background-color 0.1s ease;

  &:hover {
    background: var(--color-bg-hover);
    color: var(--color-text);
  }
`;

const DirectoryRow = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  justify-content: ${(props) => (props.$minimized ? 'center' : 'flex-start')};
  padding: ${(props) => (props.$minimized ? '6px 8px' : `6px 8px 6px ${12 + props.$depth * 18}px`)};
  border-radius: 6px;
  background: ${(props) => (props.$active ? 'var(--color-bg-active)' : 'transparent')};
  outline: ${(props) => (props.$dropActive ? '1px solid var(--color-primary)' : 'none')};
  outline-offset: ${(props) => (props.$dropActive ? '-1px' : '0')};
  color: ${(props) => (props.$active ? 'var(--color-text)' : 'var(--color-text-secondary)')};
  font-size: 13px;
  font-weight: ${(props) => (props.$active ? '600' : '400')};
  cursor: pointer;
  text-align: left;
  transition: background-color 0.1s ease, color 0.1s ease;

  &::before {
    content: ${(props) => (props.$depth > 0 && !props.$minimized ? "''" : 'none')};
    position: absolute;
    left: ${(props) => `${22 + (props.$depth - 1) * 18}px`};
    top: 0;
    bottom: 50%;
    border-left: 1px solid var(--color-border);
  }

  &::after {
    content: ${(props) => (props.$depth > 0 && !props.$minimized ? "''" : 'none')};
    position: absolute;
    left: ${(props) => `${22 + (props.$depth - 1) * 18}px`};
    top: 50%;
    width: 10px;
    border-top: 1px solid var(--color-border);
  }

  &:hover {
    background: var(--color-bg-hover);
    color: var(--color-text);
  }
`;

const NOTE_DRAG_MIME = 'application/x-mycelium-note-slug';

const NavIcon = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 16px;
  flex-shrink: 0;
`;

const NavLabel = styled.span`
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const CountBadge = styled.span`
  font-size: 11px;
  color: var(--color-text-muted);
  background: var(--color-bg-hover);
  padding: 1px 6px;
  border-radius: 8px;
  flex-shrink: 0;
`;

const SectionHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: ${(props) => (props.$minimized ? 'center' : 'space-between')};
  padding: 12px 8px 4px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-muted);
`;

const SectionAction = styled.div`
  display: flex;
  align-items: center;
  justify-content: ${(props) => (props.$minimized ? 'center' : 'flex-end')};
  width: ${(props) => (props.$minimized ? '100%' : 'auto')};
`;

const Spacer = styled.div`
  flex: 1;
`;

const BottomSection = styled.div`
  padding: 8px 0 4px;
  border-top: 1px solid var(--color-border);
`;

const ProfileRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: ${(props) => (props.$minimized ? 'center' : 'flex-start')};
  gap: 8px;
  padding: 6px ${(props) => (props.$minimized ? '0' : '8px')} 8px;
`;

const Avatar = styled.div`
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--color-bg-hover);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
  flex-shrink: 0;
`;

const ProfileName = styled.span`
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ViewAllButton = styled.button`
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 4px 8px;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 11px;
  cursor: pointer;
  text-align: left;
  transition: color 0.1s ease;

  &:hover {
    color: var(--color-text-secondary);
  }
`;

const DirectoryActions = styled.span`
  display: none;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;

  ${DirectoryRow}:hover &,
  ${DirectoryRow}:focus-within & {
    display: inline-flex;
  }
`;

const SmallIconButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;

  &:hover {
    background: var(--color-bg-hover);
    color: var(--color-text);
  }
`;

const DirectoryInputRow = styled.form`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px 4px ${(props) => `${8 + (props.$depth ?? 0) * 18}px`};
`;

const DirectoryInput = styled.input`
  min-width: 0;
  flex: 1;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg-surface);
  color: var(--color-text);
  font-size: 12px;
  padding: 4px 6px;
  outline: none;
`;

const PinnedItem = styled.button`
  display: flex;
  align-items: center;
  justify-content: ${(props) => (props.$minimized ? 'center' : 'flex-start')};
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
  transition: background-color 0.1s ease;
  overflow: hidden;

  &:hover {
    background: var(--color-bg-hover);
    color: var(--color-text);
  }
`;

const PinnedTitle = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const SidebarToast = styled.div`
  position: fixed;
  left: 58px;
  top: ${(props) => `${props.$top}px`};
  transform: translateY(-50%);
  z-index: 50;
  max-width: 180px;
  padding: 5px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg-surface);
  color: var(--color-text);
  box-shadow: 0 4px 12px var(--color-shadow);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
`;

/**
 * Narrow navigation sidebar matching Tolaria's layout.
 * Shows nav items with icons/counts, tags section, pinned notes, and theme toggle.
 */
export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { theme, setTheme } = useTheme();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const sidebarMinimized = useUIStore((s) => s.sidebarMinimized);
  const toggleSidebarMinimized = useUIStore((s) => s.toggleSidebarMinimized);

  const handleLogout = async () => {
    try { await apiPost('/auth/logout', {}); } catch { /* ignore */ }
    logout();
    navigate('/login');
  };

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newParentId, setNewParentId] = useState(null);
  const [newName, setNewName] = useState('');
  const [editingDirectoryId, setEditingDirectoryId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [collapsedDirectoryIds, setCollapsedDirectoryIds] = useState(() => new Set());
  const [dropTargetId, setDropTargetId] = useState(null);
  const [sidebarToast, setSidebarToast] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const activeSection = useUIStore((s) => s.activeSection);
  const setActiveSection = useUIStore((s) => s.setActiveSection);

  const { data: counts } = useNoteCounts();
  const { data: directoriesData } = useDirectories();
  const { data: pinnedData } = useNotes({ pinned: true });
  const createDirectory = useCreateDirectory();
  const updateDirectory = useUpdateDirectory();
  const deleteDirectory = useDeleteDirectory();

  const totalNotes = counts?.total ?? 0;
  const archivedCount = counts?.archived ?? 0;
  const directories = directoriesData?.directories ?? [];
  const pinnedNotes = pinnedData?.notes ?? [];
  const isMinimizedView = sidebarMinimized;

  // Sync activeSection when navigating to graph
  const isGraph = location.pathname === '/graph';
  const params = new URLSearchParams(location.search);
  const activeDirectoryId = params.get('directoryId');
  const isUnfiled = params.get('unfiled') === 'true';

  const submitNewDirectory = (event) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const parentId = newParentId === 'root' ? null : newParentId;
    createDirectory.mutate(
      { name, parentId },
      {
        onSuccess: () => {
          setNewName('');
          setNewParentId(null);
        },
      },
    );
  };

  const submitRenameDirectory = (event, id) => {
    event.preventDefault();
    const name = editingName.trim();
    if (!name) return;
    updateDirectory.mutate(
      { id, name },
      {
        onSuccess: () => {
          setEditingDirectoryId(null);
          setEditingName('');
        },
      },
    );
  };

  const confirmDeleteDirectory = () => {
    if (!deleteTarget) return;
    if (!deleteTarget.canDelete) {
      setDeleteTarget(null);
      return;
    }
    deleteDirectory.mutate(deleteTarget.id, {
      onSuccess: () => setDeleteTarget(null),
    });
  };

  const toggleDirectoryCollapse = (id) => {
    setCollapsedDirectoryIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const expandDirectory = (id) => {
    setCollapsedDirectoryIds((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  };

  const handleDirectoryDragOver = (event, targetId) => {
    if (!event.dataTransfer.types.includes(NOTE_DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTargetId(targetId);
  };

  const handleDirectoryDragLeave = (event, targetId) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setDropTargetId((current) => (current === targetId ? null : current));
  };

  const handleDirectoryDrop = async (event, directoryId) => {
    event.preventDefault();
    event.stopPropagation();
    const slug = event.dataTransfer.getData(NOTE_DRAG_MIME) || event.dataTransfer.getData('text/plain');
    setDropTargetId(null);
    if (!slug) return;

    try {
      await apiPatch(`/notes/${slug}`, { directoryId });
      queryClient.invalidateQueries({ queryKey: noteKeys.all });
      queryClient.invalidateQueries({ queryKey: directoryKeys.all });
    } catch { /* ignore */ }
  };

  const showSidebarToast = (label, event) => {
    if (!sidebarMinimized) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setSidebarToast({ label, top: rect.top + rect.height / 2 });
  };

  const hideSidebarToast = () => {
    setSidebarToast(null);
  };

  useEffect(() => {
    if (!sidebarMinimized) {
      setSidebarToast(null);
    }
  }, [sidebarMinimized]);

  const handleSidebarMinimizeToggle = () => {
    setSidebarToast(null);
    toggleSidebarMinimized();
  };

  const toastProps = (label) => (
    sidebarMinimized
      ? {
          onMouseEnter: (event) => showSidebarToast(label, event),
          onMouseLeave: hideSidebarToast,
          onFocus: (event) => showSidebarToast(label, event),
          onBlur: hideSidebarToast,
        }
      : {}
  );

  const renderDirectory = (directory, depth = 0) => {
    const isEditing = editingDirectoryId === directory.id;
    const children = directory.children ?? [];
    const hasChildren = children.length > 0;
    const hasNotes = (directory.noteCount ?? 0) > 0;
    const canDeleteDirectory = !hasChildren && !hasNotes;
    const isCollapsed = collapsedDirectoryIds.has(directory.id);
    const selectDirectory = () => {
      setActiveSection(`directory:${directory.id}`);
      navigate(`/?directoryId=${encodeURIComponent(directory.id)}`);
      if (hasChildren) {
        if (!isCollapsed) {
          setNewParentId((current) => (current === directory.id ? null : current));
        }
        toggleDirectoryCollapse(directory.id);
      }
    };
    const startRenameDirectory = (event) => {
      event.stopPropagation();
      setEditingDirectoryId(directory.id);
      setEditingName(directory.name);
    };
    return (
      <div key={directory.id}>
        {isEditing ? (
          <DirectoryInputRow $depth={depth} onSubmit={(event) => submitRenameDirectory(event, directory.id)}>
            <DirectoryInput
              value={editingName}
              onChange={(event) => setEditingName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setEditingDirectoryId(null);
              }}
              autoFocus
              aria-label="Directory name"
            />
            <SmallIconButton type="submit" aria-label="Save directory name"><Check size={12} /></SmallIconButton>
            <SmallIconButton type="button" onClick={() => setEditingDirectoryId(null)} aria-label="Cancel rename"><X size={12} /></SmallIconButton>
          </DirectoryInputRow>
        ) : (
          <DirectoryRow
            role="button"
            tabIndex={0}
            $depth={depth}
            $minimized={isMinimizedView}
            $active={activeSection === `directory:${directory.id}` || activeDirectoryId === directory.id}
            $dropActive={dropTargetId === directory.id}
            onClick={selectDirectory}
            onDragOver={(event) => handleDirectoryDragOver(event, directory.id)}
            onDragLeave={(event) => handleDirectoryDragLeave(event, directory.id)}
            onDrop={(event) => handleDirectoryDrop(event, directory.id)}
            {...toastProps(directory.name)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                selectDirectory();
              }
            }}
            aria-expanded={hasChildren ? !isCollapsed : undefined}
          >
            <NavIcon><Folder size={14} /></NavIcon>
            {!isMinimizedView && (
              <>
                <NavLabel onDoubleClick={startRenameDirectory}>{directory.name}</NavLabel>
                {directory.noteCount > 0 && <CountBadge>{directory.noteCount}</CountBadge>}
                <DirectoryActions>
                  <SmallIconButton
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      expandDirectory(directory.id);
                      setNewParentId(directory.id);
                      setNewName('');
                    }}
                    aria-label={`Create directory inside ${directory.name}`}
                    title="New subdirectory"
                  >
                    <FolderPlus size={12} />
                  </SmallIconButton>
                  <SmallIconButton
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setDeleteTarget({ id: directory.id, name: directory.name, canDelete: canDeleteDirectory });
                    }}
                    aria-label={`Delete ${directory.name}`}
                    title={canDeleteDirectory ? 'Delete empty directory' : 'Directory must be empty before deletion'}
                  >
                    <Trash2 size={12} />
                  </SmallIconButton>
                </DirectoryActions>
              </>
            )}
          </DirectoryRow>
        )}
        {!isMinimizedView && !isCollapsed && newParentId === directory.id && (
          <DirectoryInputRow $depth={depth + 1} onSubmit={submitNewDirectory}>
            <DirectoryInput
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setNewParentId(null);
              }}
              placeholder="Directory name"
              autoFocus
              aria-label="New directory name"
            />
            <SmallIconButton type="submit" aria-label="Create directory"><Check size={12} /></SmallIconButton>
            <SmallIconButton type="button" onClick={() => setNewParentId(null)} aria-label="Cancel new directory"><X size={12} /></SmallIconButton>
          </DirectoryInputRow>
        )}
        {!isMinimizedView && !isCollapsed && children.map((child) => renderDirectory(child, depth + 1))}
      </div>
    );
  };

  return (
    <Nav $minimized={isMinimizedView}>
      <BrandRow $minimized={isMinimizedView}>
        {!isMinimizedView && (
          <BrandIdentity>
            <MyceliumLogo size={20} />
            <BrandText>Mycelium</BrandText>
          </BrandIdentity>
        )}
        <SmallIconButton
          type="button"
          onClick={handleSidebarMinimizeToggle}
          aria-label={sidebarMinimized ? 'Expand sidebar' : 'Minimize sidebar'}
          title={sidebarMinimized ? 'Expand sidebar' : 'Minimize sidebar'}
          {...toastProps(sidebarMinimized ? 'Expand sidebar' : 'Minimize sidebar')}
        >
          {sidebarMinimized ? <ChevronsRight size={13} /> : <ChevronsLeft size={13} />}
        </SmallIconButton>
      </BrandRow>

      <NavItem $minimized={isMinimizedView} $active={activeSection === 'all'} onClick={() => { setActiveSection('all'); navigate('/'); }} title="All Notes" {...toastProps('All Notes')}>
        <NavIcon><FileText size={15} /></NavIcon>
        {!isMinimizedView && <NavLabel>All Notes</NavLabel>}
        {!isMinimizedView && totalNotes > 0 && <CountBadge>{totalNotes}</CountBadge>}
      </NavItem>

      <NavItem $minimized={isMinimizedView} $active={activeSection === 'archive'} onClick={() => { setActiveSection('archive'); navigate('/?status=ARCHIVED'); }} title="Archive" {...toastProps('Archive')}>
        <NavIcon><Archive size={15} /></NavIcon>
        {!isMinimizedView && <NavLabel>Archive</NavLabel>}
        {!isMinimizedView && archivedCount > 0 && <CountBadge>{archivedCount}</CountBadge>}
      </NavItem>

      <NavItem $minimized={isMinimizedView} $active={activeSection === 'graph' || isGraph} onClick={() => { setActiveSection('graph'); navigate('/graph'); }} title="Graph" {...toastProps('Graph')}>
        <NavIcon><GitBranch size={15} /></NavIcon>
        {!isMinimizedView && <NavLabel>Graph</NavLabel>}
      </NavItem>

      <NavItem $minimized={isMinimizedView} $active={activeSection === 'activity' || location.pathname === '/activity'} onClick={() => { setActiveSection('activity'); navigate('/activity'); }} title="Agent Activity" {...toastProps('Agent Activity')}>
        <NavIcon><Activity size={15} /></NavIcon>
        {!isMinimizedView && <NavLabel>Agent Activity</NavLabel>}
      </NavItem>

      <SectionHeader $minimized={isMinimizedView}>
        {!isMinimizedView && <span>Directories</span>}
        <SectionAction $minimized={isMinimizedView}>
          <SmallIconButton
            type="button"
            onClick={() => {
              if (sidebarMinimized) {
                handleSidebarMinimizeToggle();
              }
              setNewParentId('root');
              setNewName('');
            }}
            aria-label="Create root directory"
            title="New directory"
            {...toastProps('New directory')}
          >
            <FolderPlus size={12} />
          </SmallIconButton>
        </SectionAction>
      </SectionHeader>
      {!isMinimizedView && newParentId === 'root' && (
        <DirectoryInputRow $depth={0} onSubmit={submitNewDirectory}>
          <DirectoryInput
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setNewParentId(null);
            }}
            placeholder="Directory name"
            autoFocus
            aria-label="New directory name"
          />
          <SmallIconButton type="submit" aria-label="Create directory"><Check size={12} /></SmallIconButton>
          <SmallIconButton type="button" onClick={() => setNewParentId(null)} aria-label="Cancel new directory"><X size={12} /></SmallIconButton>
        </DirectoryInputRow>
      )}
      {directories.map((directory) => renderDirectory(directory))}
      <DirectoryRow
        role="button"
        tabIndex={0}
        $depth={0}
        $minimized={isMinimizedView}
        $active={activeSection === 'unfiled' || isUnfiled}
        $dropActive={dropTargetId === 'unfiled'}
        onClick={() => {
          setActiveSection('unfiled');
          navigate('/?unfiled=true');
        }}
        onDragOver={(event) => handleDirectoryDragOver(event, 'unfiled')}
        onDragLeave={(event) => handleDirectoryDragLeave(event, 'unfiled')}
        onDrop={(event) => handleDirectoryDrop(event, null)}
        {...toastProps('Unfiled')}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            setActiveSection('unfiled');
            navigate('/?unfiled=true');
          }
        }}
      >
        <NavIcon><Folder size={14} /></NavIcon>
        {!isMinimizedView && <NavLabel>Unfiled</NavLabel>}
      </DirectoryRow>

      {!sidebarMinimized && pinnedNotes.length > 0 && (
        <>
          {!isMinimizedView && (
            <SectionHeader>
              <span>Pinned</span>
            </SectionHeader>
          )}
          {pinnedNotes.map((note) => (
            <PinnedItem $minimized={isMinimizedView} key={note.slug} onClick={() => navigate(`/notes/${note.slug}`)} title={note.title}>
              <NavIcon><Pin size={14} /></NavIcon>
              {!isMinimizedView && <PinnedTitle>{note.title}</PinnedTitle>}
            </PinnedItem>
          ))}
        </>
      )}

      <Spacer />

      <BottomSection>
        <ProfileRow $minimized={isMinimizedView} {...toastProps(user?.displayName ?? user?.email ?? 'User')}>
          <Avatar>
            <User size={14} />
          </Avatar>
          {!isMinimizedView && <ProfileName>{user?.displayName ?? user?.email ?? 'User'}</ProfileName>}
        </ProfileRow>
        <NavItem $minimized={isMinimizedView} $active={false} onClick={() => setSettingsOpen(true)} title="Settings" {...toastProps('Settings')}>
          <NavIcon><Settings size={15} /></NavIcon>
          {!isMinimizedView && <NavLabel>Settings</NavLabel>}
        </NavItem>
        <NavItem
          $minimized={isMinimizedView}
          $active={false}
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          {...toastProps(theme === 'dark' ? 'Light mode' : 'Dark mode')}
        >
          <NavIcon>{theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}</NavIcon>
          {!isMinimizedView && <NavLabel>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</NavLabel>}
        </NavItem>
        <NavItem $minimized={isMinimizedView} $active={false} onClick={handleLogout} title="Log out" {...toastProps('Log out')}>
          <NavIcon><LogOut size={15} /></NavIcon>
          {!isMinimizedView && <NavLabel>Log out</NavLabel>}
        </NavItem>
      </BottomSection>

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {sidebarToast && <SidebarToast $top={sidebarToast.top}>{sidebarToast.label}</SidebarToast>}
      {deleteTarget && (
        <ConfirmDialog
          title="Delete directory"
          message={
            deleteTarget.canDelete
              ? `Delete "${deleteTarget.name}"?`
              : `"${deleteTarget.name}" is not empty. Move or remove its notes and subdirectories before deleting it.`
          }
          confirmLabel="Delete"
          hideConfirm={!deleteTarget.canDelete}
          onConfirm={confirmDeleteDirectory}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </Nav>
  );
}
