import { describe, test, expect } from 'bun:test';
import TipTapEditor from '../../../src/components/editor/TipTapEditor.jsx';

describe('TipTapEditor', () => {
  test('exports a default function component', () => {
    expect(typeof TipTapEditor).toBe('function');
    expect(TipTapEditor.name).toBe('TipTapEditor');
  });
});
