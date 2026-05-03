import { describe, test, expect } from 'bun:test';
import { SlashCommandMenu, SLASH_ITEMS, createSlashCommandExtension } from '../../../src/components/editor/SlashCommandMenu.jsx';

describe('SlashCommandMenu', () => {
  test('exports SlashCommandMenu as a function component', () => {
    expect(typeof SlashCommandMenu).toBe('function');
  });

  test('exports createSlashCommandExtension as a function', () => {
    expect(typeof createSlashCommandExtension).toBe('function');
  });

  test('SLASH_ITEMS contains all required block types', () => {
    const labels = SLASH_ITEMS.map((item) => item.label);
    expect(labels).toContain('Heading 1');
    expect(labels).toContain('Heading 2');
    expect(labels).toContain('Heading 3');
    expect(labels).toContain('Bullet List');
    expect(labels).toContain('Ordered List');
    expect(labels).toContain('Code Block');
    expect(labels).toContain('Blockquote');
    expect(labels).toContain('Image');
  });

  test('each SLASH_ITEM has label, description, and command', () => {
    for (const item of SLASH_ITEMS) {
      expect(typeof item.label).toBe('string');
      expect(item.label.length).toBeGreaterThan(0);
      expect(typeof item.description).toBe('string');
      expect(item.description.length).toBeGreaterThan(0);
      expect(typeof item.command).toBe('function');
    }
  });

  test('createSlashCommandExtension returns a TipTap extension', () => {
    const ext = createSlashCommandExtension({ onSlash: () => {} });
    expect(ext).toBeDefined();
    expect(ext.name).toBe('slashCommand');
  });
});
