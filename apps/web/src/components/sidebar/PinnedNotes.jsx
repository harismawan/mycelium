import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { Pin } from 'lucide-react';
import { useNotesStore } from '../../stores/notesStore.js';

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

const NoteLink = styled(Link)`
  display: block;
  padding: 5px 8px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--color-text);
  text-decoration: none;
  transition: background-color 0.1s ease;

  &:hover {
    background: var(--color-bg-hover);
    color: var(--color-text);
  }
`;

/**
 * Displays the list of pinned notes as clickable links.
 * Reads pinnedSlugs from useNotesStore.
 *
 * @returns {JSX.Element}
 */
export default function PinnedNotes() {
  const pinnedSlugs = useNotesStore((s) => s.pinnedSlugs);

  if (pinnedSlugs.length === 0) {
    return null;
  }

  return (
    <div>
      <SectionTitle>Pinned</SectionTitle>
      <List>
        {pinnedSlugs.map((slug) => (
          <li key={slug}>
            <NoteLink to={`/notes/${slug}`}>
              <Pin size={12} style={{ flexShrink: 0 }} /> {slug}
            </NoteLink>
          </li>
        ))}
      </List>
    </div>
  );
}
