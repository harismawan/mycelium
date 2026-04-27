import { describe, test, expect } from 'bun:test';
import { ImageDropExtension } from '../../../src/components/editor/ImageDropExtension.js';

describe('ImageDropExtension', () => {
  test('exports a TipTap extension', () => {
    expect(ImageDropExtension).toBeDefined();
    expect(ImageDropExtension.name).toBe('imageDropHandler');
  });

  test('extension has type "extension"', () => {
    expect(ImageDropExtension.type).toBe('extension');
  });

  test('extension config includes ProseMirror plugins', () => {
    // The extension should define addProseMirrorPlugins in its config
    expect(ImageDropExtension.config.addProseMirrorPlugins).toBeDefined();
    expect(typeof ImageDropExtension.config.addProseMirrorPlugins).toBe('function');
  });
});
