import React from 'react';
import styled from 'styled-components';
import { useRevisions } from '../../api/hooks.js';
import { useEditorStore } from '../../stores/editorStore.js';
import { PaneSection, SectionTitle, MutedText } from '../../styles/shared.js';

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
`;

const RevisionItem = styled.li`
  margin-bottom: 2px;
`;

const RevisionButton = styled.button`
  background: ${(p) => (p.$active ? 'var(--color-bg-active)' : 'none')};
  border: none;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 4px;
  font-size: 12px;
  color: ${(p) => (p.$active ? 'var(--color-text)' : 'var(--color-primary)')};
  text-align: left;
  width: 100%;
  transition: background-color 0.1s ease;

  &:hover {
    background: var(--color-bg-hover);
  }
`;

const InitialLabel = styled.span`
  display: inline-block;
  margin-left: 4px;
  padding: 1px 5px;
  font-size: 9px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--color-primary) 15%, transparent);
  color: var(--color-primary);
  font-weight: 600;
`;

/**
 * Revision history list. Clicking a revision opens a side-by-side diff
 * in the center editor pane. Clicking the active revision closes the diff.
 *
 * @param {{ slug: string | undefined }} props
 */
export default function RevisionHistory({ slug }) {
  const { data, isLoading } = useRevisions(slug ?? '', { enabled: !!slug });
  const diffRevisionId = useEditorStore((s) => s.diffRevisionId);
  const showDiff = useEditorStore((s) => s.showDiff);
  const closeDiff = useEditorStore((s) => s.closeDiff);

  const revisions = data?.revisions ?? data ?? [];

  const handleClick = (rev) => {
    if (diffRevisionId === rev.id) {
      closeDiff();
    } else {
      showDiff(rev.id, rev.content || '');
    }
  };

  return (
    <PaneSection>
      <SectionTitle>Revisions</SectionTitle>
      {isLoading && <MutedText>Loading…</MutedText>}
      {!isLoading && revisions.length === 0 && <MutedText>No revisions</MutedText>}
      {revisions.length > 0 && (
        <List>
          {revisions.map((rev, idx) => {
            const isActive = diffRevisionId === rev.id;
            const isOldest = idx === revisions.length - 1;
            return (
              <RevisionItem key={rev.id}>
                <RevisionButton $active={isActive} onClick={() => handleClick(rev)}>
                  {new Date(rev.createdAt).toLocaleString()}
                  {rev.message ? ` — ${rev.message}` : ''}
                  {isOldest && <InitialLabel>initial</InitialLabel>}
                </RevisionButton>
              </RevisionItem>
            );
          })}
        </List>
      )}
    </PaneSection>
  );
}
