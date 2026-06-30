import { describe, test, expect } from 'bun:test';
import { GraphResponse } from '../../src/schemas/responses.js';

describe('GraphResponse — optional ego-subgraph fields (R10)', () => {
  const nodeItems = GraphResponse.properties.nodes.items;
  const edgeItems = GraphResponse.properties.edges.items;

  test('node schema declares optional hop and score', () => {
    expect('hop' in nodeItems.properties).toBe(true);
    expect('score' in nodeItems.properties).toBe(true);
    // optional ⇒ not required, so _getFullGraph nodes (no hop/score) still validate
    expect(nodeItems.required).not.toContain('hop');
    expect(nodeItems.required).not.toContain('score');
  });

  test('edge schema declares optional createdAt', () => {
    expect('createdAt' in edgeItems.properties).toBe(true);
    expect(edgeItems.required ?? []).not.toContain('createdAt');
  });

  test('core node/edge fields remain required', () => {
    expect(nodeItems.required).toEqual(
      expect.arrayContaining(['id', 'slug', 'title', 'status']),
    );
    expect(edgeItems.required).toEqual(
      expect.arrayContaining(['fromId', 'toId', 'relation']),
    );
  });

  test('R5 top-level truncated stays optional', () => {
    expect('truncated' in GraphResponse.properties).toBe(true);
    expect(GraphResponse.required ?? []).not.toContain('truncated');
  });
});
