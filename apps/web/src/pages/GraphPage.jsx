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
 *
 * Chrome (toolbar/legend) uses the app theme tokens (CSS vars); the Cytoscape
 * canvas can't read CSS vars, so the theme tokens are read at runtime via
 * getComputedStyle and re-read on theme toggle so the graph matches the
 * active (black) dark theme rather than a hardcoded palette.
 *
 * Interaction:
 *   - click a node  → recenter the ego-subgraph on it (explore outward)
 *   - dbl-click     → open the note
 *   - hover         → highlight the node's neighbourhood
 *   - toolbar       → switch between full graph / ego focus + ego depth
 */

import { useMemo, useCallback, useRef, useEffect, useState } from 'react';
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

// Semantic data-encoding palettes (intentional, theme-independent).
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
  'derived-from': '#60a5fa',
  refines: '#a78bfa',
  'related-to': '#2dd4bf',
};
const DEFAULT_EDGE_COLOR = '#5a5a5a';

// Read the active theme's chrome tokens for the canvas (which can't use CSS vars).
function readThemeTokens() {
  const fallback = {
    text: '#e2e8f0',
    textSecondary: '#8b8b8b',
    border: '#2e2e2e',
    surface: '#1f1f1f',
  };
  if (typeof window === 'undefined') return fallback;
  const cs = getComputedStyle(document.documentElement);
  const get = (name, fb) => cs.getPropertyValue(name).trim() || fb;
  return {
    text: get('--color-text', fallback.text),
    textSecondary: get('--color-text-secondary', fallback.textSecondary),
    border: get('--color-border', fallback.border),
    surface: get('--color-bg-surface', fallback.surface),
  };
}

const CenteredMessage = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-size: 15px;
  color: ${(props) => props.$color || 'var(--color-text-secondary)'};
`;

const GraphContainer = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--color-bg);
`;

const Panel = styled.div`
  position: absolute;
  z-index: 10;
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: 0 2px 8px var(--color-shadow);
  color: var(--color-text-secondary);
`;

const Toolbar = styled(Panel)`
  top: 12px;
  left: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  font-size: 13px;
`;

const ToolButton = styled.button`
  background: var(--color-bg-hover);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 3px 8px;
  font-size: 12px;
  cursor: pointer;
  &:hover {
    background: var(--color-bg-active);
  }
  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
`;

const DepthSelect = styled.select`
  background: var(--color-bg-hover);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 2px 4px;
  font-size: 12px;
`;

const Legend = styled(Panel)`
  bottom: 12px;
  left: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  font-size: 11px;
`;

const LegendRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
`;

const Swatch = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  &::before {
    content: '';
    width: ${(p) => (p.$line ? '14px' : '10px')};
    height: ${(p) => (p.$line ? '3px' : '10px')};
    border-radius: ${(p) => (p.$line ? '2px' : '50%')};
    background: ${(p) => p.$color};
  }
`;

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
  const cyRef = useRef(null);

  // Ego focus: null = full graph. depth only applies to the ego view.
  const [focusSlug, setFocusSlug] = useState(null);
  const [depth, setDepth] = useState(1);

  // Theme tokens for the canvas; re-read when the app toggles data-theme.
  const [tokens, setTokens] = useState(readThemeTokens);
  useEffect(() => {
    const obs = new MutationObserver(() => setTokens(readThemeTokens()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  const { data, isLoading, error } = useGraph(focusSlug ?? undefined, focusSlug ? depth : undefined);

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

  const stylesheet = useMemo(
    () => [
      {
        selector: 'node',
        style: {
          'background-color': 'data(color)',
          width: 'data(size)',
          height: 'data(size)',
          label: 'data(label)',
          color: tokens.text,
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
        selector: 'node[?focus]',
        style: { 'border-width': 3, 'border-color': tokens.text },
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
          color: tokens.textSecondary,
          'text-rotation': 'autorotate',
          'text-background-color': tokens.surface,
          'text-background-opacity': 0.85,
          'text-background-padding': 1,
          opacity: 0.9,
        },
      },
      { selector: 'node:selected', style: { 'border-width': 2, 'border-color': tokens.text } },
      { selector: 'node.faded', style: { opacity: 0.2 } },
      { selector: 'edge.faded', style: { opacity: 0.06 } },
    ],
    [tokens],
  );

  // Apply theme changes to a live graph without remounting.
  useEffect(() => {
    const cy = cyRef.current;
    if (cy) cy.style(stylesheet);
  }, [stylesheet]);

  const elements = useMemo(() => {
    if (!data) return [];

    // Node size from ego `score` (decayed relevance); flat size for the full
    // graph where score is absent.
    const scores = (data.nodes ?? []).map((n) => n.score).filter((s) => typeof s === 'number');
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
        focus: focusSlug != null && (n.slug === focusSlug || n.hop === 0) ? 1 : 0,
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
  }, [data, focusSlug]);

  const handleCy = useCallback(
    (cy) => {
      cyRef.current = cy;
      cy.removeAllListeners();

      cy.on('tap', 'node', (evt) => {
        const slug = evt.target.data('slug');
        if (slug) setFocusSlug(slug);
      });
      cy.on('dbltap', 'node', (evt) => {
        const slug = evt.target.data('slug');
        if (slug) navigate(`/notes/${slug}`);
      });
      cy.on('mouseover', 'node', (evt) => {
        const keep = evt.target.closedNeighborhood();
        cy.elements().addClass('faded');
        keep.removeClass('faded');
      });
      cy.on('mouseout', 'node', () => cy.elements().removeClass('faded'));
    },
    [navigate],
  );

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || elements.length === 0) return;
    cy.layout(LAYOUT).run();
  }, [elements]);

  const focusTitle = useMemo(() => {
    if (!focusSlug || !data?.nodes) return null;
    const center = data.nodes.find((n) => n.slug === focusSlug || n.hop === 0);
    return center?.title ?? focusSlug;
  }, [focusSlug, data]);

  if (isLoading) return <CenteredMessage>Loading graph…</CenteredMessage>;
  if (error)
    return (
      <CenteredMessage $color="var(--color-danger)">
        Failed to load graph: {error.message}
      </CenteredMessage>
    );

  return (
    <GraphContainer>
      <Toolbar>
        {focusSlug ? (
          <>
            <ToolButton onClick={() => setFocusSlug(null)}>← Full graph</ToolButton>
            <span>
              Focus: <strong style={{ color: 'var(--color-text)' }}>{focusTitle}</strong>
            </span>
            <span>depth</span>
            <DepthSelect value={depth} onChange={(e) => setDepth(Number(e.target.value))}>
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </DepthSelect>
          </>
        ) : (
          <span>Full graph · click a node to focus · double-click to open</span>
        )}
      </Toolbar>

      {elements.length === 0 ? (
        <CenteredMessage>No notes to display.</CenteredMessage>
      ) : (
        <CytoscapeComponent
          key={focusSlug ?? '__full__'}
          elements={elements}
          stylesheet={stylesheet}
          layout={LAYOUT}
          cy={handleCy}
          style={{ width: '100%', height: '100%' }}
          minZoom={0.2}
          maxZoom={3}
          wheelSensitivity={0.2}
        />
      )}

      <Legend>
        <LegendRow>
          <span style={{ color: 'var(--color-text-muted)' }}>nodes</span>
          <Swatch $color={STATUS_COLORS.PUBLISHED}>published</Swatch>
          <Swatch $color={STATUS_COLORS.DRAFT}>draft</Swatch>
          <Swatch $color={STATUS_COLORS.ARCHIVED}>archived</Swatch>
        </LegendRow>
        <LegendRow>
          <span style={{ color: 'var(--color-text-muted)' }}>edges</span>
          <Swatch $line $color={RELATION_COLORS.supports}>supports</Swatch>
          <Swatch $line $color={RELATION_COLORS.contradicts}>contradicts</Swatch>
          <Swatch $line $color={RELATION_COLORS['derived-from']}>derived-from</Swatch>
          <Swatch $line $color={RELATION_COLORS.refines}>refines</Swatch>
          <Swatch $line $color={RELATION_COLORS['related-to']}>related-to</Swatch>
          <Swatch $line $color={DEFAULT_EDGE_COLOR}>link</Swatch>
        </LegendRow>
      </Legend>
    </GraphContainer>
  );
}
