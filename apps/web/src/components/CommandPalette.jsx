import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { FileText, Zap } from 'lucide-react';
import { useSearch } from '../api/hooks.js';
import { Overlay as SharedOverlay } from '../styles/shared.js';

/**
 * @typedef {{ type: 'note', slug: string, title: string } | { type: 'action', label: string, route: string }} PaletteItem
 */

/** Static actions always shown at the bottom of results */
const STATIC_ACTIONS = [
  { type: /** @type {const} */ ('action'), label: 'Go to Graph', route: '/graph' },
  { type: /** @type {const} */ ('action'), label: 'Go to Settings', route: '/settings' },
  { type: /** @type {const} */ ('action'), label: 'Go to Search', route: '/search' },
];

const Overlay = styled(SharedOverlay)`
  align-items: flex-start;
  padding-top: 120px;
  background: rgba(0, 0, 0, 0.45);
`;

const Dialog = styled.div`
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  width: 520px;
  max-width: 90vw;
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 16px 48px var(--color-shadow), 0 0 0 1px var(--color-border);
  overflow: hidden;
`;

const SearchInput = styled.input`
  width: 100%;
  padding: 14px 18px;
  font-size: 15px;
  border: none;
  border-bottom: 1px solid var(--color-border);
  outline: none;
  background: transparent;
  color: var(--color-text);

  &::placeholder {
    color: var(--color-text-secondary);
  }
`;

const ResultList = styled.ul`
  overflow-y: auto;
  margin: 0;
  padding: 6px 0;
  list-style: none;
`;

const GroupLabel = styled.li`
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--color-text-secondary);
  padding: 10px 18px 4px;
  letter-spacing: 0.05em;
`;

const ResultItem = styled.li`
  padding: 8px 18px;
  cursor: pointer;
  font-size: 14px;
  color: var(--color-text);
  transition: background-color 0.1s ease;
  background: ${(props) => (props.$active ? 'var(--color-bg-hover)' : 'transparent')};

  &:hover {
    background: var(--color-bg-hover);
  }
`;

const EmptyMessage = styled.li`
  padding: 10px 18px;
  font-size: 13px;
  color: var(--color-text-secondary);
`;

/**
 * Custom hook for debounced value.
 * @param {string} value
 * @param {number} delay
 * @returns {string}
 */
function useDebouncedValue(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

/**
 * Command palette overlay activated by Cmd/Ctrl-K.
 * Searches notes via API and shows static actions.
 * Supports keyboard navigation (arrows, Enter, Escape).
 *
 * @returns {JSX.Element | null}
 */
export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const navigate = useNavigate();

  const debouncedQuery = useDebouncedValue(query.trim(), 200);
  const { data, isLoading } = useSearch(debouncedQuery, { enabled: debouncedQuery.length >= 2 });

  /** @type {Array<{ slug: string, title: string }>} */
  const noteResults = data?.notes ?? data ?? [];

  // Filter static actions by query
  const filteredActions = query.trim()
    ? STATIC_ACTIONS.filter((a) => a.label.toLowerCase().includes(query.trim().toLowerCase()))
    : STATIC_ACTIONS;

  /** @type {PaletteItem[]} */
  const items = [
    ...noteResults.map((n) => /** @type {PaletteItem} */ ({ type: 'note', slug: n.slug, title: n.title })),
    ...filteredActions,
  ];

  // Reset active index when items change
  useEffect(() => {
    setActiveIndex(0);
  }, [debouncedQuery, filteredActions.length]);

  // Global keyboard shortcut: Cmd/Ctrl-K
  useEffect(() => {
    /** @param {KeyboardEvent} e */
    function handleKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => {
          if (!prev) {
            setQuery('');
            setActiveIndex(0);
          }
          return !prev;
        });
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setActiveIndex(0);
  }, []);

  /** @param {PaletteItem} item */
  const selectItem = useCallback(
    (item) => {
      close();
      if (item.type === 'note') {
        navigate(`/notes/${item.slug}`);
      } else {
        navigate(item.route);
      }
    },
    [close, navigate],
  );

  /** @param {import('react').KeyboardEvent} e */
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % (items.length || 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + (items.length || 1)) % (items.length || 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items[activeIndex]) {
        selectItem(items[activeIndex]);
      }
    }
  };

  if (!open) return null;

  const hasNotes = noteResults.length > 0;
  const hasActions = filteredActions.length > 0;
  let flatIndex = 0;

  return (
    <Overlay onClick={close} role="dialog" aria-label="Command palette">
      <Dialog onClick={(e) => e.stopPropagation()}>
        <SearchInput
          ref={inputRef}
          type="text"
          placeholder="Search notes, actions…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Command palette search"
        />
        <ResultList role="listbox">
          {isLoading && debouncedQuery.length >= 2 && (
            <EmptyMessage>Searching…</EmptyMessage>
          )}

          {hasNotes && <GroupLabel>Notes</GroupLabel>}
          {noteResults.map((note) => {
            const idx = flatIndex++;
            return (
              <ResultItem
                key={`note-${note.slug}`}
                role="option"
                aria-selected={activeIndex === idx}
                $active={activeIndex === idx}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => selectItem({ type: 'note', slug: note.slug, title: note.title })}
              >
                <FileText size={14} style={{ flexShrink: 0 }} /> {note.title}
              </ResultItem>
            );
          })}

          {hasActions && <GroupLabel>Actions</GroupLabel>}
          {filteredActions.map((action) => {
            const idx = flatIndex++;
            return (
              <ResultItem
                key={`action-${action.route}`}
                role="option"
                aria-selected={activeIndex === idx}
                $active={activeIndex === idx}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => selectItem(action)}
              >
                <Zap size={14} style={{ flexShrink: 0 }} /> {action.label}
              </ResultItem>
            );
          })}

          {!isLoading && items.length === 0 && debouncedQuery.length >= 2 && (
            <EmptyMessage>No results found</EmptyMessage>
          )}
        </ResultList>
      </Dialog>
    </Overlay>
  );
}
