import { useState } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { useQuery } from '@tanstack/react-query';
import { useTags } from '../../api/hooks.js';
import { apiGet } from '../../api/client.js';

const SectionTitle = styled.h4`
  margin: 0 0 8px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary);
`;

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
`;

const TagRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  padding: 5px 8px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--color-text);
  transition: background-color 0.1s ease;

  &:hover {
    background: var(--color-bg-hover);
  }
`;

const Arrow = styled.span`
  font-size: 9px;
  width: 14px;
  text-align: center;
  color: var(--color-text-secondary);
  transition: transform 0.15s ease;
  transform: ${(props) => (props.$expanded ? 'rotate(90deg)' : 'rotate(0deg)')};
`;

const TagName = styled.span`
  flex: 1;
`;

const Count = styled.span`
  font-size: 11px;
  color: var(--color-text-secondary);
  background: var(--color-bg-hover);
  padding: 1px 6px;
  border-radius: 8px;
`;

const NoteList = styled.ul`
  list-style: none;
  margin: 2px 0 4px;
  padding: 0 0 0 28px;
`;

const NoteLink = styled(Link)`
  display: block;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--color-text);
  text-decoration: none;
  transition: background-color 0.1s ease;

  &:hover {
    background: var(--color-bg-hover);
    color: var(--color-text);
  }
`;

const SmallText = styled.div`
  padding: 3px 8px;
  font-size: 12px;
  color: var(--color-text-secondary);
`;

const StatusText = styled.div`
  padding: 8px 0;
  font-size: 13px;
  color: var(--color-text-secondary);
`;

const ErrorText = styled.div`
  padding: 8px 0;
  font-size: 13px;
  color: var(--color-danger);
`;

/**
 * Inline note list for an expanded tag. Fetches notes from the API.
 * @param {{ tagName: string }} props
 */
function TagNotes({ tagName }) {
  const { data, isLoading } = useQuery({
    queryKey: ['tags', tagName, 'notes'],
    queryFn: () => apiGet(`/tags/${encodeURIComponent(tagName)}/notes?limit=20`),
  });

  const notes = data?.notes ?? [];

  if (isLoading) return <SmallText>Loading…</SmallText>;
  if (notes.length === 0) return <SmallText>No notes</SmallText>;

  return (
    <NoteList>
      {notes.map((/** @type {{ slug: string, title: string, id: string }} */ note) => (
        <li key={note.id ?? note.slug}>
          <NoteLink to={`/notes/${note.slug}`}>{note.title}</NoteLink>
        </li>
      ))}
    </NoteList>
  );
}

/**
 * Expandable tag tree with note counts.
 * Clicking a tag expands it to show the notes under that tag.
 */
export default function TagTree() {
  const { data, isLoading, error } = useTags();
  const [expanded, setExpanded] = useState(/** @type {Record<string, boolean>} */ ({}));

  if (isLoading) return <StatusText>Loading tags…</StatusText>;
  if (error) return <ErrorText>Failed to load tags</ErrorText>;

  const tags = data?.tags ?? data ?? [];

  if (tags.length === 0) {
    return <StatusText>No tags yet</StatusText>;
  }

  const toggle = (tagName) => {
    setExpanded((prev) => ({ ...prev, [tagName]: !prev[tagName] }));
  };

  return (
    <div>
      <SectionTitle>Tags</SectionTitle>
      <List>
        {tags.map((tag) => {
          const count = tag._count?.notes ?? tag.noteCount ?? 0;
          const isExpanded = !!expanded[tag.name];
          return (
            <li key={tag.id ?? tag.name}>
              <TagRow
                onClick={() => toggle(tag.name)}
                role="button"
                tabIndex={0}
                aria-expanded={isExpanded}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggle(tag.name); }}
              >
                <Arrow $expanded={isExpanded}>▶</Arrow>
                <TagName>{tag.name}</TagName>
                <Count>{count}</Count>
              </TagRow>
              {isExpanded && <TagNotes tagName={tag.name} />}
            </li>
          );
        })}
      </List>
    </div>
  );
}
