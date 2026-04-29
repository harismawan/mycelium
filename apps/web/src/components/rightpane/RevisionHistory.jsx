import { useState } from 'react';
import styled from 'styled-components';
import { useRevisions, useRevertNote } from '../../api/hooks.js';
import { useEditorStore } from '../../stores/editorStore.js';
import { PaneSection, SectionTitle, MutedText } from '../../styles/shared.js';
import ConfirmDialog from '../ConfirmDialog.jsx';

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
 * Agent badge displayed next to revisions made via API key.
 * Background #1a5276 (dark blue) with #ffffff text gives a contrast ratio
 * of approximately 8.6:1, well above the WCAG AA 4.5:1 threshold.
 */
const AgentBadge = styled.span`
  display: inline-block;
  margin-left: 4px;
  padding: 1px 5px;
  font-size: 9px;
  border-radius: 3px;
  background: #1a5276;
  color: #ffffff;
  font-weight: 600;
`;

const RevertButton = styled.button`
  display: block;
  margin-top: 4px;
  margin-left: 6px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 500;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: background-color 0.1s ease, color 0.1s ease;

  &:hover:not(:disabled) {
    background: var(--color-bg-hover);
    color: var(--color-text);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
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

  const revertMutation = useRevertNote(slug ?? '');
  const [revertTarget, setRevertTarget] = useState(null);

  const revisions = data?.revisions ?? data ?? [];

  const handleClick = (rev) => {
    if (diffRevisionId === rev.id) {
      closeDiff();
    } else {
      showDiff(rev.id, rev.content || '');
    }
  };

  const handleRevertClick = (e, rev) => {
    e.stopPropagation();
    setRevertTarget(rev);
  };

  const handleRevertConfirm = async () => {
    if (!revertTarget) return;
    try {
      await revertMutation.mutateAsync({ revisionId: revertTarget.id });
      closeDiff();
    } finally {
      setRevertTarget(null);
    }
  };

  const handleRevertCancel = () => {
    setRevertTarget(null);
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
            const isAgent = rev.authType === 'apikey';
            return (
              <RevisionItem key={rev.id}>
                <RevisionButton $active={isActive} onClick={() => handleClick(rev)}>
                  {new Date(rev.createdAt).toLocaleString()}
                  {rev.message ? ` — ${rev.message}` : ''}
                  {isOldest && <InitialLabel>initial</InitialLabel>}
                  {isAgent && (
                    <AgentBadge>agent · {rev.apiKeyName}</AgentBadge>
                  )}
                </RevisionButton>
                {isActive && (
                  <RevertButton
                    onClick={(e) => handleRevertClick(e, rev)}
                    disabled={revertMutation.isPending}
                  >
                    {revertMutation.isPending ? 'Reverting…' : 'Revert to this version'}
                  </RevertButton>
                )}
              </RevisionItem>
            );
          })}
        </List>
      )}

      {revertTarget && (
        <ConfirmDialog
          title="Revert to this version?"
          message={`This will replace the current note content with the revision from ${new Date(revertTarget.createdAt).toLocaleString()}. A new revision will be created to preserve history.`}
          confirmLabel="Revert"
          onConfirm={handleRevertConfirm}
          onCancel={handleRevertCancel}
        />
      )}
    </PaneSection>
  );
}
