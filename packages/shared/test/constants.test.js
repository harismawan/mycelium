import { describe, test, expect } from 'bun:test';
import {
  MAX_GRAPH_NODES,
  MAX_GRAPH_DEPTH,
  MAX_LINK_RESULTS,
  GRAPH_DECAY,
} from '../constants.js';
import * as barrel from '../index.js';

describe('graph budget constants', () => {
  test('MAX_GRAPH_NODES is a positive integer (200)', () => {
    expect(Number.isInteger(MAX_GRAPH_NODES)).toBe(true);
    expect(MAX_GRAPH_NODES).toBe(200);
  });

  test('MAX_GRAPH_DEPTH is a small positive integer (5)', () => {
    expect(Number.isInteger(MAX_GRAPH_DEPTH)).toBe(true);
    expect(MAX_GRAPH_DEPTH).toBe(5);
  });

  test('MAX_LINK_RESULTS is a positive integer (25)', () => {
    expect(Number.isInteger(MAX_LINK_RESULTS)).toBe(true);
    expect(MAX_LINK_RESULTS).toBe(25);
  });

  test('barrel re-exports the new constants', () => {
    expect(barrel.MAX_GRAPH_NODES).toBe(MAX_GRAPH_NODES);
    expect(barrel.MAX_GRAPH_DEPTH).toBe(MAX_GRAPH_DEPTH);
    expect(barrel.MAX_LINK_RESULTS).toBe(MAX_LINK_RESULTS);
  });
});

import { RELATION_VOCAB } from '../constants.js';

describe('RELATION_VOCAB', () => {
  test('contains the canonical relation vocabulary', () => {
    expect(RELATION_VOCAB).toEqual([
      'supports',
      'contradicts',
      'derived-from',
      'refines',
      'related-to',
    ]);
  });

  test('is frozen', () => {
    expect(Object.isFrozen(RELATION_VOCAB)).toBe(true);
  });
});

describe('GRAPH_DECAY', () => {
  test('is a per-hop decay factor in the open interval (0, 1)', () => {
    expect(typeof GRAPH_DECAY).toBe('number');
    expect(GRAPH_DECAY).toBeGreaterThan(0);
    expect(GRAPH_DECAY).toBeLessThan(1);
  });

  test('is re-exported from the package barrel', () => {
    expect(barrel.GRAPH_DECAY).toBe(GRAPH_DECAY);
  });
});
