import React, { useState, useRef, useEffect } from 'react';
import styled from 'styled-components';
import { X, ChevronDown } from 'lucide-react';
import { useNotesStore } from '../../stores/notesStore.js';
import { useUIStore } from '../../stores/uiStore.js';
import { useNote, useUpdateNote } from '../../api/hooks.js';
import OutgoingLinks from './OutgoingLinks.jsx';
import BacklinksList from './BacklinksList.jsx';
import TagList from './TagList.jsx';
import RevisionHistory from './RevisionHistory.jsx';
import {
  SectionTitle,
  StatusBadge as SharedStatusBadge,
  StatusDot,
  Badge,
  Row,
  PropLabel,
  PropValue,
  EmptyState,
  PaneSection,
} from '../../styles/shared.js';

const PaneWrapper = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
`;

const PaneHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
`;

const PaneTitle = styled.h3`
  font-size: 14px;
  font-weight: 600;
  margin: 0;
  color: var(--color-text);
`;

const CloseButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.1s ease;

  &:hover {
    background: var(--color-bg-hover);
    color: var(--color-text);
  }
`;

const PaneBody = styled.div`
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const StatusButton = styled(SharedStatusBadge).attrs({ as: 'button' })`
  border: none;
  cursor: pointer;
  transition: opacity 0.15s ease;
  &:hover { opacity: 0.8; }
`;

const DropdownWrapper = styled.div`
  position: relative;
  display: inline-block;
`;

const DropdownMenu = styled.div`
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  box-shadow: 0 4px 12px var(--color-shadow);
  z-index: 10;
  min-width: 120px;
  padding: 4px 0;
  overflow: hidden;
`;

const DropdownItem = styled.button`
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 12px;
  border: none;
  background: ${(p) => (p.$active ? 'var(--color-bg-active)' : 'transparent')};
  color: var(--color-text);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  transition: background-color 0.1s ease;
  &:hover { background: var(--color-bg-hover); }
`;

/**
 * Estimate word count from content string.
 * @param {string} content
 * @returns {number}
 */
function wordCount(content) {
  if (!content) return 0;
  return content.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Format byte size to human-readable string.
 * @param {string} content
 * @returns {string}
 */
function contentSize(content) {
  if (!content) return '0 B';
  const bytes = new TextEncoder().encode(content).length;
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * Right pane "Properties" panel matching Tolaria's layout.
 * Shows properties, related links, backlinks, info, and revision history.
 *
 * @returns {React.JSX.Element}
 */
export default function RightPane() {
  const slug = useNotesStore((s) => s.selectedSlug);
  const toggleRightPane = useUIStore((s) => s.toggleRightPane);
  const { data: note } = useNote(slug ?? '', { enabled: !!slug });
  const updateNote = useUpdateNote(slug ?? '');
  const [statusOpen, setStatusOpen] = useState(false);
  const statusRef = useRef(null);

  const tags = note?.tags ?? [];

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (statusRef.current && !statusRef.current.contains(e.target)) {
        setStatusOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleStatusChange = (newStatus) => {
    setStatusOpen(false);
    if (newStatus !== note?.status) {
      updateNote.mutate({ status: newStatus });
    }
  };

  return (
    <PaneWrapper>
      <PaneHeader>
        <PaneTitle>Properties</PaneTitle>
        <CloseButton onClick={toggleRightPane} aria-label="Close properties panel">
          <X size={14} />
        </CloseButton>
      </PaneHeader>

      {!slug ? (
        <EmptyState>Select a note to see properties</EmptyState>
      ) : (
        <PaneBody>
          {/* Properties section */}
          <PaneSection>
            <SectionTitle>Properties</SectionTitle>
            <Row>
              <PropLabel>Type</PropLabel>
              <Badge>Note</Badge>
            </Row>
            <Row>
              <PropLabel>Status</PropLabel>
              <DropdownWrapper ref={statusRef}>
                <StatusButton
                  $status={note?.status}
                  onClick={() => setStatusOpen((v) => !v)}
                  aria-label="Change status"
                >
                  {note?.status ?? '—'}
                  <ChevronDown size={10} />
                </StatusButton>
                {statusOpen && (
                  <DropdownMenu>
                    {['DRAFT', 'PUBLISHED', 'ARCHIVED'].map((s) => (
                      <DropdownItem
                        key={s}
                        $active={note?.status === s}
                        onClick={() => handleStatusChange(s)}
                      >
                        <StatusDot $status={s} />
                        {s}
                      </DropdownItem>
                    ))}
                  </DropdownMenu>
                )}
              </DropdownWrapper>
            </Row>
          </PaneSection>

          {/* Tags */}
          <TagList tags={tags} />

          {/* Related to (outgoing links) */}
          <OutgoingLinks note={note ?? null} />

          {/* Belongs to (backlinks) */}
          <BacklinksList slug={slug} />

          {/* Info section */}
          <PaneSection>
            <SectionTitle>Info</SectionTitle>
            <Row>
              <PropLabel>Modified</PropLabel>
              <PropValue>
                {note?.updatedAt
                  ? new Date(note.updatedAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })
                  : '—'}
              </PropValue>
            </Row>
            <Row>
              <PropLabel>Created</PropLabel>
              <PropValue>
                {note?.createdAt
                  ? new Date(note.createdAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })
                  : '—'}
              </PropValue>
            </Row>
            <Row>
              <PropLabel>Words</PropLabel>
              <PropValue>{wordCount(note?.content)}</PropValue>
            </Row>
            <Row>
              <PropLabel>Size</PropLabel>
              <PropValue>{contentSize(note?.content)}</PropValue>
            </Row>
          </PaneSection>

          {/* History */}
          <RevisionHistory slug={slug} />
        </PaneBody>
      )}
    </PaneWrapper>
  );
}
