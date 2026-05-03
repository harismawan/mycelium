import { useMemo } from 'react';
import styled from 'styled-components';
import { diffLines } from 'diff';
import { X } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore.js';

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg-surface);
  flex-shrink: 0;
`;

const HeaderLabel = styled.span`
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-secondary);
`;

const Stats = styled.span`
  font-size: 12px;
  color: var(--color-text-muted);
`;

const CloseBtn = styled.button`
  margin-left: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  &:hover { background: var(--color-bg-hover); color: var(--color-text); }
`;

const Columns = styled.div`
  display: flex;
  flex: 1;
  overflow: hidden;
`;

const Column = styled.div`
  flex: 1;
  overflow-y: auto;
  font-family: 'SF Mono', 'Fira Code', Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
  &:first-child { border-right: 1px solid var(--color-border); }
`;

const ColumnHeader = styled.div`
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
  background: var(--color-bg-surface);
  border-bottom: 1px solid var(--color-border);
`;

const Line = styled.div`
  display: flex;
  padding: 0 12px;
  min-height: 20px;
  background: ${(p) => {
    if (p.$type === 'added') return 'rgba(34, 197, 94, 0.08)';
    if (p.$type === 'removed') return 'rgba(239, 68, 68, 0.08)';
    return 'transparent';
  }};
`;

const LineNum = styled.span`
  width: 36px;
  flex-shrink: 0;
  text-align: right;
  padding-right: 8px;
  color: var(--color-text-muted);
  user-select: none;
  opacity: 0.5;
`;

const LineText = styled.span`
  flex: 1;
  white-space: pre-wrap;
  word-break: break-word;
  color: ${(p) => {
    if (p.$type === 'added') return '#4ade80';
    if (p.$type === 'removed') return '#f87171';
    return 'var(--color-text)';
  }};
`;

const EmptyLine = styled.div`
  min-height: 20px;
  padding: 0 12px;
  background: var(--color-bg-hover);
  opacity: 0.3;
`;

/**
 * Side-by-side diff view comparing a revision against the current content.
 * Shows old (revision) on the left and current on the right.
 *
 * @param {{ currentContent: string }} props
 */
export default function DiffView({ currentContent }) {
  const diffContent = useEditorStore((s) => s.diffContent);
  const closeDiff = useEditorStore((s) => s.closeDiff);

  const { leftLines, rightLines, addedCount, removedCount } = useMemo(() => {
    const changes = diffLines(diffContent || '', currentContent || '');
    const left = [];
    const right = [];
    let leftNum = 1;
    let rightNum = 1;

    for (const part of changes) {
      const lines = part.value.replace(/\n$/, '').split('\n');

      if (part.removed) {
        for (const line of lines) {
          left.push({ num: leftNum++, text: line, type: 'removed' });
          right.push({ num: null, text: '', type: 'empty' });
        }
      } else if (part.added) {
        for (const line of lines) {
          left.push({ num: null, text: '', type: 'empty' });
          right.push({ num: rightNum++, text: line, type: 'added' });
        }
      } else {
        for (const line of lines) {
          left.push({ num: leftNum++, text: line, type: 'context' });
          right.push({ num: rightNum++, text: line, type: 'context' });
        }
      }
    }

    return {
      leftLines: left,
      rightLines: right,
      addedCount: right.filter((l) => l.type === 'added').length,
      removedCount: left.filter((l) => l.type === 'removed').length,
    };
  }, [diffContent, currentContent]);

  return (
    <Container>
      <Header>
        <HeaderLabel>Diff View</HeaderLabel>
        <Stats>
          <span style={{ color: '#4ade80' }}>+{addedCount}</span>
          {' '}
          <span style={{ color: '#f87171' }}>-{removedCount}</span>
        </Stats>
        <CloseBtn onClick={closeDiff} aria-label="Close diff view">
          <X size={14} />
        </CloseBtn>
      </Header>
      <Columns>
        <Column>
          <ColumnHeader>Revision (old)</ColumnHeader>
          {leftLines.map((line, i) =>
            line.type === 'empty' ? (
              <EmptyLine key={i} />
            ) : (
              <Line key={i} $type={line.type}>
                <LineNum>{line.num ?? ''}</LineNum>
                <LineText $type={line.type}>{line.text}</LineText>
              </Line>
            ),
          )}
        </Column>
        <Column>
          <ColumnHeader>Current</ColumnHeader>
          {rightLines.map((line, i) =>
            line.type === 'empty' ? (
              <EmptyLine key={i} />
            ) : (
              <Line key={i} $type={line.type}>
                <LineNum>{line.num ?? ''}</LineNum>
                <LineText $type={line.type}>{line.text}</LineText>
              </Line>
            ),
          )}
        </Column>
      </Columns>
    </Container>
  );
}
