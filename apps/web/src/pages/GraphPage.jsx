/**
 * GraphPage — knowledge-graph visualization (Cytoscape.js + fcose).
 *
 * Renders the typed/weighted/directed graph from `/api/v1/graph`:
 *   - node colour  ← status
 *   - node size    ← ego `score` (decayed relevance) when present
 *   - edge width   ← `weight` (wikilink occurrence count)
 *   - edge colour  ← `relation` (typed wikilink vocabulary)
 *   - edge label   ← `relation` (only for typed edges)
 *   - arrowheads   ← edge direction (from → to)
 */

import { useMemo, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import CytoscapeComponent from 'react-cytoscapejs';
import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
import { useGraph } from '../api/hooks.js';
import { useUIStore } from '../stores/uiStore.js';

// Register the fcose layout once (guard against HMR double-registration).
if (!cytoscape.__fcoseRegistered) {
  cytoscape.use(fcose);
  cytoscape.__fcoseRegistered = true;
}

const STATUS_COLORS = {
  DRAFT: '#f59e0b',
  PUBLISHED: '#22c55e',
  ARCHIVED: '#9ca3af',
};
const DEFAULT_NODE_COLOR = '#6b7280';

// Typed-wikilink relation vocabulary → edge colour. `null` = plain wikilink.
const RELATION_COLORS = {
  supports: '#22c55e',
  contradicts: '#ef4444',
  'derived-from': '#3b82f6',
  refines: '#a855f7',
  'related-to': '#14b8a6',
};
const DEFAULT_EDGE_COLOR = '#4b5563';

const CenteredMessage = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-size: 15px;
  color: ${(props) => props.$color || 'var(--color-text-secondary)'};
`;

const GraphContainer = styled.div`
  width: 100%;
  height: 100%;
  overflow: hidden;
`;

const STYLESHEET = [
  {
    selector: 'node',
    style: {
      'background-color': 'data(color)',
      width: 'data(size)',
      height: 'data(size)',
      label: 'data(label)',
      color: '#e5e7eb',
      'font-size': 10,
      'text-valign': 'bottom',
      'text-halign': 'center',
      'text-margin-y': 3,
      'text-wrap': 'ellipsis',
      'text-max-width': 120,
      'min-zoomed-font-size': 7,
      'border-width': 0,
    },
  },
  {
    selector: 'edge',
    style: {
      width: 'data(width)',
      'line-color': 'data(color)',
      'target-arrow-color': 'data(color)',
      'target-arrow-shape': 'triangle',
      'arrow-scale': 0.8,
      'curve-style': 'bezier',
      label: 'data(label)',
      'font-size': 8,
      color: '#9ca3af',
      'text-rotation': 'autorotate',
      'text-background-color': '#111827',
      'text-background-opacity': 0.6,
      'text-background-padding': 1,
      opacity: 0.85,
    },
  },
  {
    selector: 'node:selected',
    style: { 'border-width': 2, 'border-color': '#e5e7eb' },
  },
  {
    selector: 'node.faded',
    style: { opacity: 0.25 },
  },
  {
    selector: 'edge.faded',
    style: { opacity: 0.08 },
  },
];

const LAYOUT = {
  name: 'fcose',
  quality: 'default',
  animate: true,
  animationDuration: 500,
  randomize: true,
  fit: true,
  padding: 60,
  nodeSeparation: 90,
  idealEdgeLength: 110,
};

export default function GraphPage() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useGraph();
  const cyRef = useRef(null);

  // Hide right pane on mount, restore on unmount.
  const prevRightPane = useRef(null);
  useEffect(() => {
    const state = useUIStore.getState();
    prevRightPane.current = state.rightPaneOpen;
    if (state.rightPaneOpen) useUIStore.setState({ rightPaneOpen: false });
    return () => {
      if (prevRightPane.current) useUIStore.setState({ rightPaneOpen: true });
    };
  }, []);

  const elements = useMemo(() => {
    if (!data) return [];

    // Node size from ego `score` (decayed relevance); fall back to a flat size
    // for the full graph where score is absent.
    const scores = (data.nodes ?? [])
      .map((n) => n.score)
      .filter((s) => typeof s === 'number');
    const maxScore = scores.length ? Math.max(...scores) : 0;
    const sizeFor = (score) => {
      if (typeof score !== 'number' || maxScore <= 0) return 22;
      return 16 + (score / maxScore) * 26; // 16–42px
    };

    const nodes = (data.nodes ?? []).map((n) => ({
      data: {
        id: n.id,
        label: n.title,
        slug: n.slug,
        status: n.status,
        color: STATUS_COLORS[n.status] ?? DEFAULT_NODE_COLOR,
        size: sizeFor(n.score),
        hop: n.hop ?? null,
      },
    }));

    const nodeIds = new Set(nodes.map((n) => n.data.id));
    const edges = (data.edges ?? [])
      .filter((e) => e.toId && nodeIds.has(e.fromId) && nodeIds.has(e.toId))
      .map((e, i) => {
        const weight = typeof e.weight === 'number' ? e.weight : 1;
        return {
          data: {
            id: `e${i}-${e.fromId}-${e.toId}-${e.relation ?? ''}`,
            source: e.fromId,
            target: e.toId,
            relation: e.relation ?? null,
            label: e.relation ?? '',
            width: 1 + Math.min(weight, 6), // 2–7px
            color: RELATION_COLORS[e.relation] ?? DEFAULT_EDGE_COLOR,
          },
        };
      });

    return [...nodes, ...edges];
  }, [data]);

  const handleCy = useCallback(
    (cy) => {
      cyRef.current = cy;
      cy.removeAllListeners();

      // Click a node → open the note.
      cy.on('tap', 'node', (evt) => {
        const slug = evt.target.data('slug');
        if (slug) navigate(`/notes/${slug}`);
      });

      // Hover a node → highlight its neighbourhood.
      cy.on('mouseover', 'node', (evt) => {
        const keep = evt.target.closedNeighborhood();
        cy.elements().addClass('faded');
        keep.removeClass('faded');
      });
      cy.on('mouseout', 'node', () => cy.elements().removeClass('faded'));
    },
    [navigate],
  );

  // Re-run layout + fit whenever the element set changes.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || elements.length === 0) return;
    cy.layout(LAYOUT).run();
  }, [elements]);

  if (isLoading) return <CenteredMessage>Loading graph…</CenteredMessage>;
  if (error)
    return (
      <CenteredMessage $color="var(--color-danger)">
        Failed to load graph: {error.message}
      </CenteredMessage>
    );
  if (elements.length === 0) return <CenteredMessage>No notes to display.</CenteredMessage>;

  return (
    <GraphContainer>
      <CytoscapeComponent
        elements={elements}
        stylesheet={STYLESHEET}
        layout={LAYOUT}
        cy={handleCy}
        style={{ width: '100%', height: '100%' }}
        minZoom={0.2}
        maxZoom={3}
        wheelSensitivity={0.2}
      />
    </GraphContainer>
  );
}
