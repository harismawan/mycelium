import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

const editorViewSource = readFileSync(new URL('../../src/pages/EditorView.jsx', import.meta.url), 'utf8');
const noteListSource = readFileSync(new URL('../../src/components/NoteListPanel.jsx', import.meta.url), 'utf8');

describe('pin icons', () => {
  test('EditorView uses the sidebar Pin icon instead of Star for pinning', () => {
    expect(editorViewSource).toContain("import { Code, Pin, Save, PanelRight } from 'lucide-react';");
    expect(editorViewSource).toContain('<Pin size={15} />');
    expect(editorViewSource).not.toContain('Star');
  });

  test('NoteListPanel renders a pin icon for pinned notes', () => {
    expect(noteListSource).toContain("import { Search, Plus, Archive, Trash2, RotateCcw, Pin } from 'lucide-react';");
    expect(noteListSource).toContain('{note.pinned && <PinnedIcon size={12} aria-label="Pinned note" />}');
  });
});
