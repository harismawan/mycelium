import { describe, test, expect } from 'bun:test';
import {
  WikilinkAutocomplete,
  createWikilinkExtension,
} from '../../../src/components/editor/WikilinkAutocomplete.jsx';

describe('WikilinkAutocomplete', () => {
  test('exports WikilinkAutocomplete as a function component', () => {
    expect(typeof WikilinkAutocomplete).toBe('function');
    expect(WikilinkAutocomplete.name).toBe('WikilinkAutocomplete');
  });

  test('exports createWikilinkExtension as a function', () => {
    expect(typeof createWikilinkExtension).toBe('function');
  });

  test('createWikilinkExtension returns a TipTap extension', () => {
    const ext = createWikilinkExtension({ onOpen: () => {} });
    expect(ext).toBeDefined();
    expect(ext.name).toBe('wikilinkAutocomplete');
    // TipTap extensions have a config object with addProseMirrorPlugins
    expect(ext.config).toBeDefined();
    expect(typeof ext.config.addProseMirrorPlugins).toBe('function');
  });

  test('default export is WikilinkAutocomplete', async () => {
    const mod = await import('../../../src/components/editor/WikilinkAutocomplete.jsx');
    expect(mod.default).toBe(WikilinkAutocomplete);
  });
});
