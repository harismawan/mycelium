import { useEffect, useCallback, useState } from 'react';
import { useParams } from 'react-router-dom';
import styled from 'styled-components';
import { Code, Star, Save, PanelRight } from 'lucide-react';
import { useNote, useUpdateNote } from '../api/hooks.js';
import { useNotesStore } from '../stores/notesStore.js';
import { useEditorStore } from '../stores/editorStore.js';
import { useUIStore } from '../stores/uiStore.js';
import BlockNoteEditor from '../components/editor/BlockNoteEditor.jsx';
import DiffView from '../components/editor/DiffView.jsx';
import {
  IconButton as ToolbarButton,
  LoadingState,
  ErrorState,
} from '../styles/shared.js';

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
`;

const TopBar = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 20px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
  background: var(--color-bg);
`;

const NoteLabel = styled.span`
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-muted);
`;

const SlugText = styled.span`
  font-size: 13px;
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Spacer = styled.div`
  flex: 1;
`;

const DirtyDot = styled.span`
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #f59e0b;
  flex-shrink: 0;
`;

const EditorArea = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px;
`;

const CodeArea = styled.textarea`
  flex: 1;
  margin: 0;
  padding: 20px 24px;
  border: none;
  outline: none;
  resize: none;
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.6;
  tab-size: 2;
  background: var(--color-bg);
  color: var(--color-text);
  overflow-y: auto;

  &::placeholder {
    color: var(--color-text-muted);
  }
`;

/**
 * Editor view with block editor and raw markdown code toggle.
 */
export default function EditorView() {
  const { slug } = useParams();
  const selectNote = useNotesStore((s) => s.selectNote);
  const togglePin = useNotesStore((s) => s.togglePin);
  const pinnedSlugs = useNotesStore((s) => s.pinnedSlugs);
  const resetDirty = useEditorStore((s) => s.resetDirty);
  const isDirty = useEditorStore((s) => s.isDirty);
  const content = useEditorStore((s) => s.content);
  const setContent = useEditorStore((s) => s.setContent);
  const diffRevisionId = useEditorStore((s) => s.diffRevisionId);
  const closeDiff = useEditorStore((s) => s.closeDiff);
  const rightPaneOpen = useUIStore((s) => s.rightPaneOpen);
  const toggleRightPane = useUIStore((s) => s.toggleRightPane);
  const defaultView = useUIStore((s) => s.defaultView);

  const [codeView, setCodeView] = useState(defaultView === 'code');

  const { data: noteData, isLoading, error } = useNote(slug);
  const updateNote = useUpdateNote(slug);

  const isPinned = pinnedSlugs.includes(slug ?? '');

  useEffect(() => {
    if (slug) selectNote(slug);
  }, [slug, selectNote]);

  // Reset to default view and close diff when switching notes
  useEffect(() => {
    setCodeView(defaultView === 'code');
    closeDiff();
  }, [slug, closeDiff, defaultView]);

  const handleSave = useCallback(() => {
    if (!noteData) return;
    const tags = noteData.tags?.map((/** @type {{ name: string }} */ t) => t.name ?? t) ?? [];
    updateNote.mutate(
      { content, status: noteData.status, tags },
      { onSuccess: () => resetDirty() },
    );
  }, [content, noteData, updateNote, resetDirty]);

  if (isLoading) return <LoadingState>Loading note…</LoadingState>;
  if (error) return <ErrorState>Failed to load note: {error.message}</ErrorState>;

  // Content is stored without frontmatter — pass directly to editor
  const initialMarkdown = noteData?.content ?? '';

  return (
    <Container>
      <TopBar>
        <NoteLabel>Note</NoteLabel>
        <SlugText>{slug}</SlugText>
        {isDirty && <DirtyDot title="Unsaved changes" />}
        <Spacer />
        <ToolbarButton
          $active={codeView}
          onClick={() => setCodeView((v) => !v)}
          aria-label={codeView ? 'Switch to block editor' : 'Switch to markdown view'}
          title={codeView ? 'Block editor' : 'Markdown code'}
        >
          <Code size={15} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => slug && togglePin(slug)}
          aria-label={isPinned ? 'Unpin note' : 'Pin note'}
          title={isPinned ? 'Unpin' : 'Pin'}
        >
          <Star size={15} fill={isPinned ? 'currentColor' : 'none'} />
        </ToolbarButton>
        <ToolbarButton
          onClick={handleSave}
          disabled={!isDirty || updateNote.isPending}
          aria-label="Save note"
          title="Save"
        >
          <Save size={15} />
        </ToolbarButton>
        <ToolbarButton
          onClick={toggleRightPane}
          aria-label={rightPaneOpen ? 'Hide properties' : 'Show properties'}
          title="Properties"
        >
          <PanelRight size={15} />
        </ToolbarButton>
      </TopBar>

      {diffRevisionId ? (
        <DiffView currentContent={initialMarkdown} />
      ) : codeView ? (
        <CodeArea
          key={slug}
          defaultValue={initialMarkdown}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Write markdown here…"
          spellCheck={false}
        />
      ) : (
        <EditorArea>
          <BlockNoteEditor
            key={slug}
            initialContent={initialMarkdown}
            onSave={() => handleSave()}
          />
        </EditorArea>
      )}
    </Container>
  );
}
