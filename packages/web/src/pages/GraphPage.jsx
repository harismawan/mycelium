/**
 * GraphPage — Interactive force-directed graph visualization of notes and links.
 */

import { useMemo, useCallback, useRef, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import ForceGraph2D from 'react-force-graph-2d';
import { useGraph } from '../api/hooks.js';
import { useUIStore } from '../stores/uiStore.js';

const STATUS_COLORS = {
  DRAFT: '#f59e0b',
  PUBLISHED: '#22c55e',
  ARCHIVED: '#9ca3af',
};

const DEFAULT_COLOR = '#6b7280';

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

export default function GraphPage() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useGraph();
  const fgRef = useRef(null);
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // Hide right pane on mount, restore on unmount
  const prevRightPane = useRef(null);
  useEffect(() => {
    const state = useUIStore.getState();
    prevRightPane.current = state.rightPaneOpen;
    if (state.rightPaneOpen) {
      useUIStore.setState({ rightPaneOpen: false });
    }
    return () => {
      if (prevRightPane.current) {
        useUIStore.setState({ rightPaneOpen: true });
      }
    };
  }, []);

  // Measure container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setDimensions({ width: Math.floor(width), height: Math.floor(height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Center graph after data loads
  useEffect(() => {
    if (fgRef.current && data?.nodes?.length) {
      setTimeout(() => fgRef.current?.zoomToFit(400, 60), 500);
    }
  }, [data]);

  const graphData = useMemo(() => {
    if (!data) return { nodes: [], links: [] };
    const nodes = (data.nodes ?? []).map((n) => ({
      id: n.id,
      label: n.title,
      slug: n.slug,
      status: n.status,
      color: STATUS_COLORS[n.status] ?? DEFAULT_COLOR,
    }));
    const links = (data.edges ?? []).map((e) => ({
      source: e.fromId,
      target: e.toId,
    }));
    return { nodes, links };
  }, [data]);

  const handleNodeClick = useCallback(
    (node) => {
      if (node.slug) navigate(`/notes/${node.slug}`);
    },
    [navigate],
  );

  const paintNode = useCallback((node, ctx, globalScale) => {
    const radius = 5;
    const fontSize = Math.max(12 / globalScale, 1.5);
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = node.color ?? DEFAULT_COLOR;
    ctx.fill();
    if (globalScale > 0.6) {
      ctx.font = `${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#e5e7eb';
      ctx.fillText(node.label ?? '', node.x, node.y + radius + 2);
    }
  }, []);

  if (isLoading) return <CenteredMessage>Loading graph…</CenteredMessage>;
  if (error) return <CenteredMessage $color="var(--color-danger)">Failed to load graph: {error.message}</CenteredMessage>;
  if (graphData.nodes.length === 0) return <CenteredMessage>No notes to display.</CenteredMessage>;

  return (
    <GraphContainer ref={containerRef}>
      <ForceGraph2D
        ref={fgRef}
        width={dimensions.width}
        height={dimensions.height}
        graphData={graphData}
        nodeCanvasObject={paintNode}
        nodePointerAreaPaint={(node, color, ctx) => {
          ctx.beginPath();
          ctx.arc(node.x, node.y, 5, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.fill();
        }}
        onNodeClick={handleNodeClick}
        linkColor={() => '#4b5563'}
        linkWidth={1}
        linkDirectionalArrowLength={4}
        linkDirectionalArrowRelPos={1}
      />
    </GraphContainer>
  );
}
