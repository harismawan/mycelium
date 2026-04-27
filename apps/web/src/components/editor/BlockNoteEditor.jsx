import React, { useEffect, useRef } from 'react';
import {
  BlockNoteSchema,
  defaultInlineContentSpecs,
} from '@blocknote/core';
import { filterSuggestionItems } from '@blocknote/core/extensions';
import {
  useCreateBlockNote,
  SuggestionMenuController,
} from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/mantine/style.css';
import { useEditorStore } from '../../stores/editorStore.js';
import { useUIStore } from '../../stores/uiStore.js';
import { Wikilink } from './WikilinkInlineContent.jsx';
import { apiGet } from '../../api/client.js';

/**
 * Custom schema with wikilink inline content support.
 */
const schema = BlockNoteSchema.create({
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    wikilink: Wikilink,
  },
});

/**
 * Fetch note titles from the API and return suggestion items.
 * @param {ReturnType<typeof schema.BlockNoteEditor>} editor
 * @param {string} query
 * @returns {Promise<DefaultReactSuggestionItem[]>}
 */
async function getWikilinkItems(editor, query) {
  let notes = [];
  try {
    const res = await apiGet(`/notes?q=${encodeURIComponent(query)}&limit=8`);
    notes = res.notes ?? res ?? [];
  } catch {
    notes = [];
  }

  return notes.map((/** @type {{ title: string, slug: string }} */ note) => ({
    title: note.title,
    onItemClick: () => {
      editor.insertInlineContent([
        {
          type: 'wikilink',
          props: { title: note.title },
        },
        ' ',
      ]);
    },
  }));
}

/**
 * Regex to match [[wikilink]] patterns in text.
 */
const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

/**
 * Convert [[Title]] text within a block's inline content into wikilink nodes.
 * Recursively processes child blocks.
 * @param {object} block
 * @returns {object}
 */
function convertWikilinksInBlock(block) {
  // Process children recursively
  if (block.children?.length) {
    block.children = block.children.map(convertWikilinksInBlock);
  }

  // Only process blocks that have inline content array
  if (!Array.isArray(block.content)) return block;

  /** @type {any[]} */
  const newContent = [];

  for (const item of block.content) {
    // Only process text nodes
    if (item.type !== 'text' || !item.text) {
      newContent.push(item);
      continue;
    }

    const text = item.text;
    const styles = item.styles ?? {};
    let lastIndex = 0;
    let match;

    WIKILINK_RE.lastIndex = 0;
    let hasMatch = false;
    while ((match = WIKILINK_RE.exec(text)) !== null) {
      hasMatch = true;
      // Add text before the match
      if (match.index > lastIndex) {
        newContent.push({ type: 'text', text: text.slice(lastIndex, match.index), styles });
      }
      // Add wikilink inline content
      newContent.push({ type: 'wikilink', props: { title: match[1] } });
      lastIndex = match.index + match[0].length;
    }

    if (!hasMatch) {
      // No wikilinks — keep original item as-is
      newContent.push(item);
    } else {
      // Add remaining text after last match
      if (lastIndex < text.length) {
        newContent.push({ type: 'text', text: text.slice(lastIndex), styles });
      }
    }
  }

  block.content = newContent;
  return block;
}

/**
 * @typedef {object} BlockNoteEditorProps
 * @property {string} [initialContent] - Markdown string to initialize the editor with
 * @property {(markdown: string) => void} [onSave] - Callback invoked on Ctrl/Cmd+S
 */

/**
 * Block-based Markdown editor with wikilink support.
 * Type `[[` to open the wikilink suggestion menu.
 *
 * @param {BlockNoteEditorProps} props
 */
export default function BlockNoteEditor({ initialContent = '', onSave }) {
  const setContent = useEditorStore((s) => s.setContent);
  const theme = useUIStore((s) => s.theme);

  const editor = useCreateBlockNote({
    schema,
    initialContent: undefined,
    domAttributes: {
      editor: { class: 'mycelium-editor' },
    },
  });

  const loadedRef = useRef(false);
  const isLoadingRef = useRef(false);

  // Load initial content once (key prop on parent handles note switching)
  useEffect(() => {
    if (!editor || !initialContent || loadedRef.current) return;
    loadedRef.current = true;
    isLoadingRef.current = true;

    async function load() {
      try {
        const blocks = await editor.tryParseMarkdownToBlocks(initialContent);
        const processed = blocks.map((block) => convertWikilinksInBlock(block));
        const docIds = editor.document.map((b) => b.id);
        editor.replaceBlocks(docIds, processed);
      } catch {
        // fallback
      } finally {
        // Allow a microtask for BlockNote's internal onChange to fire, then unlock
        queueMicrotask(() => { isLoadingRef.current = false; });
      }
    }
    load();
  }, [editor, initialContent]);

  // Sync editor changes to the store as markdown
  useEffect(() => {
    if (!editor) return;

    const handler = async () => {
      try {
        const md = await editor.blocksToMarkdownLossy(editor.document);
        if (isLoadingRef.current) {
          // Programmatic load — set content without marking dirty
          useEditorStore.getState().setContentClean(md);
        } else {
          // User edit — mark dirty
          setContent(md);
        }
      } catch {
        // ignore
      }
    };

    editor.onChange(handler);
  }, [editor, setContent]);

  // Ctrl/Cmd+S to save
  useEffect(() => {
    if (!editor || !onSave) return;

    /** @param {KeyboardEvent} e */
    const onKeyDown = async (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        try {
          const md = await editor.blocksToMarkdownLossy(editor.document);
          onSave(md);
        } catch {
          // ignore
        }
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [editor, onSave]);

  if (!editor) return null;

  return (
    <BlockNoteView
      editor={editor}
      theme={theme === 'dark' ? 'dark' : 'light'}
    >
      <SuggestionMenuController
        triggerCharacter="["
        getItems={async (query) => {
          const items = await getWikilinkItems(editor, query);
          return filterSuggestionItems(items, query);
        }}
      />
    </BlockNoteView>
  );
}
