/**
 * ActivityFeedPage — Chronological list of agent activity log entries.
 *
 * Displays API key name, action type, target resource slug, timestamp,
 * and details summary for each entry. Supports filtering by action type
 * and API key name, cursor-based pagination via "Load more", and an
 * empty state when no entries exist.
 */

import { useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { useActivityLog } from '../api/hooks.js';

// ---------------------------------------------------------------------------
// Action type options for the filter dropdown
// ---------------------------------------------------------------------------

const ACTION_OPTIONS = [
  { value: '', label: 'All actions' },
  { value: 'note:create', label: 'note:create' },
  { value: 'note:update', label: 'note:update' },
  { value: 'note:archive', label: 'note:archive' },
  { value: 'note:delete', label: 'note:delete' },
  { value: 'note:search', label: 'note:search' },
  { value: 'note:revert', label: 'note:revert' },
  { value: 'bundle:read', label: 'bundle:read' },
];

const PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 24px;
  overflow-y: auto;
`;

const Header = styled.h1`
  font-size: 20px;
  font-weight: 700;
  margin: 0 0 16px;
  color: var(--color-text);
`;

const Filters = styled.div`
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
  flex-wrap: wrap;
`;

const FilterSelect = styled.select`
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
  background: var(--color-bg);
  color: var(--color-text);
  outline: none;
  transition: border-color 0.15s ease;
  &:focus {
    border-color: var(--color-primary);
  }
`;

const FilterInput = styled.input`
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 13px;
  background: var(--color-bg);
  color: var(--color-text);
  outline: none;
  width: 200px;
  transition: border-color 0.15s ease;
  &::placeholder {
    color: var(--color-text-muted);
  }
  &:focus {
    border-color: var(--color-primary);
  }
`;

const EntryList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const EntryCard = styled.li`
  padding: 12px 16px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg-surface);
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const EntryTopRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

const ActionBadge = styled.span`
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 4px;
  background: color-mix(in srgb, var(--color-primary) 15%, transparent);
  color: var(--color-primary);
  font-family: monospace;
`;

const StatusBadge = styled.span`
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 999px;
  text-transform: lowercase;
  font-family: monospace;
  background: ${({ $status }) => ($status === 'success'
    ? 'color-mix(in srgb, var(--color-success) 18%, transparent)'
    : 'color-mix(in srgb, var(--color-danger) 18%, transparent)')};
  color: ${({ $status }) => ($status === 'success' ? 'var(--color-success)' : 'var(--color-danger)')};
`;

const KeyName = styled.span`
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-secondary);
`;

const Timestamp = styled.time`
  font-size: 11px;
  color: var(--color-text-muted);
  margin-left: auto;
  flex-shrink: 0;
`;

const ResourceLink = styled(Link)`
  font-size: 13px;
  color: var(--color-primary);
  text-decoration: none;
  &:hover {
    color: var(--color-primary-hover);
    text-decoration: underline;
  }
`;

const ResourceSlug = styled.span`
  font-size: 13px;
  color: var(--color-text-secondary);
`;

const DetailsSummary = styled.p`
  font-size: 12px;
  color: var(--color-text-secondary);
  margin: 0;
  line-height: 1.4;
`;

const MetaRow = styled.div`
  display: flex;
  gap: 8px;
  align-items: baseline;
  flex-wrap: wrap;
`;

const MetaLabel = styled.span`
  font-size: 11px;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

const MetaValue = styled.span`
  font-size: 12px;
  color: var(--color-text-secondary);
  font-family: monospace;
`;

const DetailsPre = styled.pre`
  margin: 0;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-text-secondary);
  font-size: 11px;
  line-height: 1.45;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
`;

const DetailsToggleButton = styled.button`
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  width: fit-content;

  &:hover {
    background: var(--color-bg-hover);
    color: var(--color-text);
  }
`;

const EmptyState = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  font-size: 14px;
  color: var(--color-text-secondary);
  padding: 48px 24px;
  text-align: center;
`;

const LoadMoreButton = styled.button`
  padding: 8px 20px;
  font-size: 13px;
  font-weight: 500;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  align-self: center;
  margin-top: 16px;
  transition: background-color 0.15s ease;
  &:hover:not(:disabled) {
    background: var(--color-bg-hover);
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const LoadingState = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  font-size: 14px;
  color: var(--color-text-secondary);
  padding: 48px 24px;
`;

const ErrorState = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  font-size: 14px;
  color: var(--color-danger);
  padding: 48px 24px;
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a date string into a human-readable timestamp. */
function formatTimestamp(dateStr) {
  try {
    const date = new Date(dateStr);
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

/** Summarize the details JSON object into a short string. */
function summarizeDetails(details) {
  if (!details || typeof details !== 'object') return null;
  const parts = [];
  if (details.title) parts.push(`"${details.title}"`);
  if (details.message) parts.push(details.message);
  if (details.error) parts.push(`Error: ${details.error}`);
  if (details.query) parts.push(`Query: "${details.query}"`);
  if (details.revisionId) parts.push(`Revision: ${details.revisionId}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** Render details object as pretty JSON for audit visibility. */
function formatDetailsJson(details) {
  if (!details || typeof details !== 'object') return null;
  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return String(details);
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ActivityFeedPage() {
  const [actionFilter, setActionFilter] = useState('');
  const [apiKeyNameFilter, setApiKeyNameFilter] = useState('');
  const [allEntries, setAllEntries] = useState([]);
  const [currentCursor, setCurrentCursor] = useState(undefined);
  const [hasLoadedMore, setHasLoadedMore] = useState(false);
  const [detailsVisibleById, setDetailsVisibleById] = useState({});

  // Build filters for the hook
  const filters = useMemo(() => {
    const f = { limit: PAGE_SIZE };
    if (actionFilter) f.action = actionFilter;
    if (apiKeyNameFilter.trim()) f.apiKeyName = apiKeyNameFilter.trim();
    if (currentCursor) f.cursor = currentCursor;
    return f;
  }, [actionFilter, apiKeyNameFilter, currentCursor]);

  const { data, isLoading, error } = useActivityLog(filters);

  // Merge entries: first page replaces, subsequent pages append
  const entries = useMemo(() => {
    if (!data?.entries) return allEntries;
    if (hasLoadedMore) {
      // Deduplicate by id when appending
      const existingIds = new Set(allEntries.map((e) => e.id));
      const newEntries = data.entries.filter((e) => !existingIds.has(e.id));
      return [...allEntries, ...newEntries];
    }
    return data.entries;
  }, [data, allEntries, hasLoadedMore]);

  const nextCursor = data?.nextCursor ?? null;

  // Reset pagination when filters change
  const handleActionChange = useCallback((e) => {
    setActionFilter(e.target.value);
    setCurrentCursor(undefined);
    setAllEntries([]);
    setHasLoadedMore(false);
    setDetailsVisibleById({});
  }, []);

  const handleApiKeyNameChange = useCallback((e) => {
    setApiKeyNameFilter(e.target.value);
    setCurrentCursor(undefined);
    setAllEntries([]);
    setHasLoadedMore(false);
    setDetailsVisibleById({});
  }, []);

  const handleLoadMore = useCallback(() => {
    if (!nextCursor) return;
    setAllEntries(entries);
    setCurrentCursor(nextCursor);
    setHasLoadedMore(true);
  }, [nextCursor, entries]);

  const toggleDetailsVisibility = useCallback((entryId) => {
    setDetailsVisibleById((prev) => ({
      ...prev,
      [entryId]: !prev[entryId],
    }));
  }, []);

  // Determine what to render
  const showLoading = isLoading && entries.length === 0;
  const showEmpty = !isLoading && entries.length === 0 && !error;
  const showError = !!error && entries.length === 0;

  return (
    <Container>
      <Header>Agent Activity</Header>

      <Filters>
        <FilterSelect
          value={actionFilter}
          onChange={handleActionChange}
          aria-label="Filter by action type"
        >
          {ACTION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </FilterSelect>

        <FilterInput
          type="text"
          placeholder="Filter by API key name…"
          value={apiKeyNameFilter}
          onChange={handleApiKeyNameChange}
          aria-label="Filter by API key name"
        />
      </Filters>

      {showLoading && <LoadingState>Loading activity…</LoadingState>}

      {showError && (
        <ErrorState>Failed to load activity: {error.message}</ErrorState>
      )}

      {showEmpty && (
        <EmptyState>No agent activity recorded yet</EmptyState>
      )}

      {entries.length > 0 && (
        <>
          <EntryList>
            {entries.map((entry) => (
              <EntryCard key={entry.id}>
                <EntryTopRow>
                  <ActionBadge>{entry.action}</ActionBadge>
                  <StatusBadge $status={entry.status || 'success'}>
                    {entry.status || 'success'}
                  </StatusBadge>
                  <KeyName>{entry.apiKeyName}</KeyName>
                  <Timestamp dateTime={entry.createdAt}>
                    {formatTimestamp(entry.createdAt)}
                  </Timestamp>
                </EntryTopRow>

                {entry.targetResourceSlug && (
                  <ResourceLink to={`/notes/${entry.targetResourceSlug}`}>
                    {entry.targetResourceSlug}
                  </ResourceLink>
                )}
                {!entry.targetResourceSlug && entry.targetResourceId && (
                  <ResourceSlug>{entry.targetResourceId}</ResourceSlug>
                )}

                {entry.targetResourceId && (
                  <MetaRow>
                    <MetaLabel>targetResourceId</MetaLabel>
                    <MetaValue>{entry.targetResourceId}</MetaValue>
                  </MetaRow>
                )}

                {summarizeDetails(entry.details) && (
                  <DetailsSummary>{summarizeDetails(entry.details)}</DetailsSummary>
                )}

                {formatDetailsJson(entry.details) && (
                  <MetaRow style={{ display: 'block' }}>
                    <MetaLabel>details</MetaLabel>
                    <DetailsToggleButton
                      type="button"
                      onClick={() => toggleDetailsVisibility(entry.id)}
                      aria-expanded={Boolean(detailsVisibleById[entry.id])}
                    >
                      {detailsVisibleById[entry.id] ? 'Hide details' : 'Show details'}
                    </DetailsToggleButton>
                    {detailsVisibleById[entry.id] && (
                      <DetailsPre>{formatDetailsJson(entry.details)}</DetailsPre>
                    )}
                  </MetaRow>
                )}
              </EntryCard>
            ))}
          </EntryList>

          {nextCursor && (
            <LoadMoreButton
              onClick={handleLoadMore}
              disabled={isLoading}
            >
              {isLoading ? 'Loading…' : 'Load more'}
            </LoadMoreButton>
          )}
        </>
      )}
    </Container>
  );
}
