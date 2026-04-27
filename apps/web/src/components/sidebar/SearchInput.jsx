import { useState } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { useSearch } from '../../api/hooks.js';

const Input = styled.input`
  width: 100%;
  padding: 8px 12px;
  font-size: 13px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text);
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;

  &::placeholder {
    color: var(--color-text-secondary);
  }

  &:focus {
    border-color: var(--color-primary);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 20%, transparent);
  }
`;

const Dropdown = styled.div`
  margin-top: 6px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg-surface);
  overflow: hidden;
  box-shadow: 0 4px 12px var(--color-shadow);
`;

const StatusText = styled.div`
  font-size: 12px;
  color: var(--color-text-secondary);
  padding: 8px 12px;
`;

const ResultList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 4px 0;
`;

const ResultLink = styled(Link)`
  display: block;
  padding: 6px 12px;
  border-radius: 4px;
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
 * Sidebar search input that queries the API and displays results inline.
 *
 * @returns {JSX.Element}
 */
export default function SearchInput() {
  const [query, setQuery] = useState('');
  const trimmed = query.trim();
  const { data, isLoading } = useSearch(trimmed, { enabled: trimmed.length >= 2 });

  /** @type {Array<{ slug: string, title: string }>} */
  const results = data?.notes ?? data ?? [];

  return (
    <div>
      <Input
        type="search"
        placeholder="Search notes…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search notes"
      />
      {trimmed.length >= 2 && (
        <Dropdown>
          {isLoading && <StatusText>Searching…</StatusText>}
          {!isLoading && results.length === 0 && (
            <StatusText>No results</StatusText>
          )}
          {!isLoading && results.length > 0 && (
            <ResultList>
              {results.map((note) => (
                <li key={note.slug}>
                  <ResultLink to={`/notes/${note.slug}`}>
                    {note.title}
                  </ResultLink>
                </li>
              ))}
            </ResultList>
          )}
        </Dropdown>
      )}
    </div>
  );
}
