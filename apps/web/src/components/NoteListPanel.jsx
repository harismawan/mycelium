import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import styled from 'styled-components';
import { Search, Plus, Archive, Trash2, RotateCcw } from 'lucide-react';
import { useNotes, useCreateNote, tagKeys } from '../api/hooks.js';
import { apiDelete, apiPatch } from '../api/client.js';
import { useQueryClient } from '@tanstack/react-query';
import ConfirmDialog from './ConfirmDialog.jsx';
import { useNotesStore } from '../stores/notesStore.js';
import { IconButton, EmptyState } from '../styles/shared.js';

const Panel = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
`;

const HeaderTitle = styled.h2`
  font-size: 14px;
  font-weight: 600;
  margin: 0;
  flex: 1;
  color: var(--color-text);
`;

const SearchRow = styled.div`
  padding: 8px 14px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
`;

const SearchInput = styled.input`
  width: 100%;
  padding: 6px 10px;
  font-size: 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg-surface);
  color: var(--color-text);
  outline: none;
  transition: border-color 0.15s ease;

  &::placeholder {
    color: var(--color-text-muted);
  }

  &:focus {
    border-color: var(--color-primary);
  }
`;

const NoteList = styled.div`
  flex: 1;
  overflow-y: auto;
`;

const NoteCard = styled.div`
  position: relative;
  display: block;
  width: 100%;
  text-align: left;
  padding: 12px 14px;
  border-bottom: 1px solid var(--color-border);
  background: ${(props) =>
    props.$selected
      ? 'color-mix(in srgb, var(--color-primary) 12%, var(--color-bg))'
      : props.$active
        ? 'var(--color-bg-active)'
        : 'transparent'};
  cursor: pointer;
  transition: background-color 0.1s ease;
  user-select: none;

  &:hover {
    background: ${(props) =>
      props.$selected
        ? 'color-mix(in srgb, var(--color-primary) 16%, var(--color-bg))'
        : props.$active
          ? 'var(--color-bg-active)'
          : 'var(--color-bg-hover)'};
  }
`;

const HoverBtn = styled.button`
  position: absolute;
  top: 8px;
  right: ${(p) => p.$right ?? '8px'};
  display: none;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 4px;
  background: var(--color-bg-surface);
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all 0.1s ease;
  box-shadow: 0 1px 3px var(--color-shadow);

  ${NoteCard}:hover & {
    display: flex;
  }

  &:hover {
    background: ${(p) => p.$hoverBg ?? 'color-mix(in srgb, var(--color-danger) 12%, transparent)'};
    color: ${(p) => p.$hoverColor ?? 'var(--color-danger)'};
  }
`;

const NoteTitle = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const NoteTitleInput = styled.input`
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
  background: var(--color-bg-surface);
  border: 1px solid var(--color-primary);
  border-radius: 4px;
  outline: none;
  padding: 2px 6px;
  margin-bottom: 4px;
  width: 100%;
`;

const NoteExcerpt = styled.div`
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-bottom: 6px;
`;

const NoteMeta = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--color-text-muted);
`;

const BulkBar = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--color-border);
  background: color-mix(in srgb, var(--color-primary) 8%, var(--color-bg));
  flex-shrink: 0;
  font-size: 12px;
  color: var(--color-text-secondary);
`;

const BulkBtn = styled.button`
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 500;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  transition: background-color 0.1s ease;
  &:hover {
    background: var(--color-bg-hover);
  }
`;

/**
 * Format a relative time string like "12m ago", "3h ago", "2d ago".
 * @param {string} dateStr
 * @returns {string}
 */
function relativeTime(dateStr) {
  if (!dateStr) return '';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Format a date as "Created Apr 17" style.
 * @param {string} dateStr
 * @returns {string}
 */
function formatCreated(dateStr) {
  if (!dateStr) return '';
  return `Created ${new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

/**
 * Note list panel (Column 2) showing a scrollable list of note cards.
 * Click navigates to note. Cmd/Ctrl+Click toggles selection.
 * Shift+Click selects a range from the last selected item.
 */
export default function NoteListPanel() {
  const navigate = useNavigate();
  const location = useLocation();
  const selectedSlug = useNotesStore((s) => s.selectedSlug);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const createNote = useCreateNote();
  const qc = useQueryClient();
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [editingSlug, setEditingSlug] = useState(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [selectedSlugs, setSelectedSlugs] = useState(new Set());
  const [bulkAction, setBulkAction] = useState(null);
  const lastClickedIndex = useRef(null);

  const handleArchive = async (slug, title) => {
    setArchiveTarget({ slug, title });
  };

  const confirmArchive = async () => {
    if (!archiveTarget) return;
    const { slug } = archiveTarget;
    setArchiveTarget(null);
    try {
      await apiDelete(`/notes/${slug}`);
      qc.invalidateQueries({ queryKey: ['notes'] });
      qc.invalidateQueries({ queryKey: tagKeys.all });
      if (selectedSlug === slug) {
        useNotesStore.getState().selectNote(null);
        if (!statusFilter && !tagFilter) navigate('/');
      }
    } catch { /* ignore */ }
  };

  const handleDelete = (slug, title) => {
    setDeleteTarget({ slug, title });
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const { slug } = deleteTarget;
    setDeleteTarget(null);
    try {
      await apiDelete(`/notes/${slug}/permanent`);
      qc.invalidateQueries({ queryKey: ['notes'] });
      qc.invalidateQueries({ queryKey: tagKeys.all });
      if (selectedSlug === slug) {
        useNotesStore.getState().selectNote(null);
        if (!statusFilter && !tagFilter) navigate('/');
      }
    } catch { /* ignore */ }
  };

  const handleRestore = async (slug) => {
    try {
      await apiPatch(`/notes/${slug}`, { status: 'DRAFT' });
      qc.invalidateQueries({ queryKey: ['notes'] });
      qc.invalidateQueries({ queryKey: tagKeys.all });
    } catch { /* ignore */ }
  };

  const handleTitleDoubleClick = (e, slug, title) => {
    e.stopPropagation();
    setEditingSlug(slug);
    setTitleDraft(title);
  };

  const handleTitleSave = async (slug) => {
    const trimmed = titleDraft.trim();
    setEditingSlug(null);
    if (!trimmed || trimmed === slug) return;
    try {
      await apiPatch(`/notes/${slug}`, { title: trimmed });
      qc.invalidateQueries({ queryKey: ['notes'] });
    } catch { /* ignore */ }
  };

  const handleTitleKeyDown = (e, slug) => {
    if (e.key === 'Enter') handleTitleSave(slug);
    if (e.key === 'Escape') setEditingSlug(null);
  };

  /**
   * Handle card click with multi-select support:
   * - Cmd/Ctrl+Click: toggle individual selection
   * - Shift+Click: select range from last clicked to current
   * - Plain click: navigate to note (clears selection)
   */
  const handleCardClick = (e, note, index) => {
    const isMeta = e.metaKey || e.ctrlKey;
    const isShift = e.shiftKey;

    if (isMeta) {
      // Toggle individual selection
      setSelectedSlugs((prev) => {
        const next = new Set(prev);
        if (next.has(note.slug)) next.delete(note.slug);
        else next.add(note.slug);
        return next;
      });
      lastClickedIndex.current = index;
      return;
    }

    if (isShift) {
      // Range selection — use index 0 as anchor if no prior click
      const anchor = lastClickedIndex.current ?? 0;
      const start = Math.min(anchor, index);
      const end = Math.max(anchor, index);
      setSelectedSlugs((prev) => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) {
          if (notes[i]) next.add(notes[i].slug);
        }
        return next;
      });
      lastClickedIndex.current = index;
      return;
    }

    // Plain click — navigate (clear selection if any)
    if (selectedSlugs.size > 0) {
      setSelectedSlugs(new Set());
    }
    navigate(`/notes/${note.slug}`);
  };

  const confirmBulkAction = async () => {
    if (!bulkAction || selectedSlugs.size === 0) return;
    const slugs = [...selectedSlugs];
    setBulkAction(null);
    try {
      if (bulkAction === 'archive') {
        await Promise.all(slugs.map((s) => apiDelete(`/notes/${s}`)));
      } else if (bulkAction === 'delete') {
        await Promise.all(slugs.map((s) => apiDelete(`/notes/${s}/permanent`)));
      }
      qc.invalidateQueries({ queryKey: ['notes'] });
      qc.invalidateQueries({ queryKey: tagKeys.all });
      setSelectedSlugs(new Set());
    } catch { /* ignore */ }
  };

  // Track filters — sync from URL on navigation, but persist when opening a note
  const params = new URLSearchParams(location.search);
  const urlStatus = params.get('status') ?? undefined;
  const urlTag = params.get('tag') ?? undefined;

  const [statusFilter, setStatusFilter] = useState(urlStatus);
  const [tagFilter, setTagFilter] = useState(urlTag);

  // Update filters when URL changes (sidebar nav clicks)
  useEffect(() => {
    if (location.pathname === '/') {
      setStatusFilter(urlStatus);
      setTagFilter(urlTag);
    }
  }, [location.pathname, urlStatus, urlTag]);

  const { data, isLoading } = useNotes({
    limit: 50,
    status: statusFilter,
    tag: tagFilter,
    q: searchQuery.trim() || undefined,
  });

  const notes = data?.notes ?? [];

  /** Determine the header title based on active filters */
  const headerTitle = useMemo(() => {
    if (tagFilter) return `# ${tagFilter}`;
    if (statusFilter === 'ARCHIVED') return 'Archive';
    return 'All Notes';
  }, [statusFilter, tagFilter]);

  /** Create a new note and navigate to it */
  const handleNewNote = () => {
    createNote.mutate(
      { title: 'Untitled', content: '' },
      {
        onSuccess: (note) => {
          if (note?.slug) navigate(`/notes/${note.slug}`);
        },
      },
    );
  };

  return (
    <Panel>
      <Header>
        <HeaderTitle>{headerTitle}</HeaderTitle>
        <IconButton
          onClick={() => setSearchOpen((v) => !v)}
          aria-label="Toggle search"
          title="Search"
        >
          <Search size={14} />
        </IconButton>
        <IconButton
          onClick={handleNewNote}
          aria-label="New note"
          title="New note"
          disabled={createNote.isPending}
        >
          <Plus size={14} />
        </IconButton>
      </Header>

      {searchOpen && (
        <SearchRow>
          <SearchInput
            type="search"
            placeholder="Filter notes…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
            aria-label="Filter notes"
          />
        </SearchRow>
      )}

      {selectedSlugs.size > 0 && (
        <BulkBar>
          <span>{selectedSlugs.size} selected</span>
          {statusFilter !== 'ARCHIVED' && (
            <BulkBtn onClick={() => setBulkAction('archive')}>Archive</BulkBtn>
          )}
          {statusFilter === 'ARCHIVED' && (
            <BulkBtn onClick={() => setBulkAction('delete')}>Delete</BulkBtn>
          )}
          <BulkBtn onClick={() => setSelectedSlugs(new Set())}>Clear</BulkBtn>
        </BulkBar>
      )}

      <NoteList>
        {isLoading && <EmptyState>Loading…</EmptyState>}

        {!isLoading && notes.length === 0 && (
          <EmptyState>No notes found</EmptyState>
        )}

        {!isLoading &&
          notes.map((note, index) => (
            <NoteCard
              key={note.id ?? note.slug}
              $active={selectedSlug === note.slug}
              $selected={selectedSlugs.has(note.slug)}
              onClick={(e) => handleCardClick(e, note, index)}
            >
              {note.status === 'ARCHIVED' && (
                <HoverBtn
                  $right="36px"
                  $hoverBg="color-mix(in srgb, #22c55e 12%, transparent)"
                  $hoverColor="#22c55e"
                  onClick={(e) => { e.stopPropagation(); handleRestore(note.slug); }}
                  aria-label={`Restore ${note.title}`}
                  title="Restore to drafts"
                >
                  <RotateCcw size={12} />
                </HoverBtn>
              )}
              <HoverBtn
                onClick={(e) => {
                  e.stopPropagation();
                  if (note.status === 'ARCHIVED') {
                    handleDelete(note.slug, note.title);
                  } else {
                    handleArchive(note.slug, note.title);
                  }
                }}
                aria-label={note.status === 'ARCHIVED' ? `Delete ${note.title}` : `Archive ${note.title}`}
                title={note.status === 'ARCHIVED' ? 'Delete permanently' : 'Archive'}
              >
                {note.status === 'ARCHIVED' ? <Trash2 size={12} /> : <Archive size={12} />}
              </HoverBtn>
              {editingSlug === note.slug ? (
                <NoteTitleInput
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={() => handleTitleSave(note.slug)}
                  onKeyDown={(e) => handleTitleKeyDown(e, note.slug)}
                  onClick={(e) => e.stopPropagation()}
                  autoFocus
                />
              ) : (
                <NoteTitle onDoubleClick={(e) => handleTitleDoubleClick(e, note.slug, note.title)}>
                  {note.title}
                </NoteTitle>
              )}
              {note.excerpt && <NoteExcerpt>{note.excerpt}</NoteExcerpt>}
              <NoteMeta>
                <span>{relativeTime(note.updatedAt)}</span>
                <span>{formatCreated(note.createdAt)}</span>
              </NoteMeta>
            </NoteCard>
          ))}
      </NoteList>

      {archiveTarget && (
        <ConfirmDialog
          title="Archive note"
          message={`Are you sure you want to archive "${archiveTarget.title}"? You can find it later in the Archive.`}
          confirmLabel="Archive"
          onConfirm={confirmArchive}
          onCancel={() => setArchiveTarget(null)}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete permanently"
          message={`This will permanently delete "${deleteTarget.title}" and all its revisions. This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {bulkAction && (
        <ConfirmDialog
          title={bulkAction === 'archive' ? 'Archive selected notes' : 'Delete selected notes'}
          message={`This will ${bulkAction === 'archive' ? 'archive' : 'permanently delete'} ${selectedSlugs.size} note${selectedSlugs.size > 1 ? 's' : ''}. ${bulkAction === 'delete' ? 'This cannot be undone.' : ''}`}
          confirmLabel={bulkAction === 'archive' ? 'Archive All' : 'Delete All'}
          onConfirm={confirmBulkAction}
          onCancel={() => setBulkAction(null)}
        />
      )}
    </Panel>
  );
}
