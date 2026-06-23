/**
 * graph.ts — Interactive knowledge graph visualization
 *
 * Shows memories as nodes with relations as edges
 * Features:
 * - Force-directed layout (custom physics implementation)
 * - Color-coded by memory type
 * - Node size based on relation count
 * - Hover tooltips + click for details
 * - Drag nodes, zoom, filter by type/tag
 */

import type { Application } from 'express';

export function registerGraph(app: Application): void {
  // Main graph visualization page
  app.get('/graph', (_req, res) => {
    res.send(GRAPH_HTML);
  });

  // Data endpoint for graph
  app.get('/api/graph/data', async (req, res) => {
    try {
      const store = (app as any).locals?.store;
      if (!store?.db) {
        res.status(500).json({ error: 'Store not available' });
        return;
      }

      // Fetch all non-deleted memories
      const memoriesRows = store.db.exec(
        'SELECT id, title, content, type, tags_json, relations_json FROM memories WHERE deleted = 0'
      );

      if (!memoriesRows.length || !memoriesRows[0].values.length) {
        res.json({ nodes: [], edges: [] });
        return;
      }

      const nodes: any[] = [];
      const edges: any[] = [];
      const edgeSet = new Set<string>(); // dedup edges

      for (const row of memoriesRows[0].values) {
        const [id, title, content, type, tagsJson, relationsJson] = row as [string, string, string, string, string, string];

        let tags: string[] = [];
        let relations: any[] = [];

        try {
          tags = JSON.parse(tagsJson || '[]');
        } catch {}

        try {
          relations = JSON.parse(relationsJson || '[]');
        } catch {}

        // Create node
        nodes.push({
          id,
          title: title || content.slice(0, 50) + (content.length > 50 ? '...' : ''),
          content: content.slice(0, 200) + (content.length > 200 ? '...' : ''),
          type,
          tags,
          relationCount: relations.length,
        });

        // Create edges from relations
        for (const rel of relations) {
          if (rel.target) {
            const edgeId = `${id}-${rel.target}-${rel.type || 'relates_to'}`;
            const reverseEdgeId = `${rel.target}-${id}-${rel.type || 'relates_to'}`;

            // Only add if not already present (prevent duplicates from bidirectional relations)
            if (!edgeSet.has(edgeId) && !edgeSet.has(reverseEdgeId)) {
              edges.push({
                source: id,
                target: rel.target,
                type: rel.type || 'relates_to',
              });
              edgeSet.add(edgeId);
            }
          }
        }
      }

      res.json({ nodes, edges });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Failed to generate graph data' });
    }
  });
}

const GRAPH_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Knowledge Graph — SharedBrain</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a2332;
      color: #F5F3EF;
      overflow: hidden;
      height: 100vh;
    }

    .header {
      background: #232F3E;
      padding: 1rem 2rem;
      border-bottom: 2px solid #FF6100;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      display: flex;
      justify-content: space-between;
      align-items: center;
      z-index: 100;
      position: relative;
    }

    .header h1 {
      font-size: 1.75rem;
      color: #FF6100;
    }

    .controls {
      display: flex;
      gap: 1rem;
      align-items: center;
    }

    .type-filters {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .type-toggle {
      padding: 0.4rem 0.8rem;
      border: 1px solid #FF6100;
      border-radius: 20px;
      background: rgba(255,97,0,0.2);
      color: #F5F3EF;
      cursor: pointer;
      font-size: 0.85rem;
      transition: all 0.2s;
      user-select: none;
    }

    .type-toggle:hover {
      background: rgba(255,97,0,0.4);
    }

    .type-toggle.active {
      background: #FF6100;
      color: #232F3E;
      font-weight: 600;
    }

    .tag-filter {
      padding: 0.4rem 0.8rem;
      border: 1px solid #8a9ba8;
      border-radius: 6px;
      background: #232F3E;
      color: #F5F3EF;
      font-size: 0.85rem;
      cursor: pointer;
    }

    .graph-container {
      width: 100%;
      height: calc(100vh - 70px);
      position: relative;
      overflow: hidden;
    }

    #graph-svg {
      width: 100%;
      height: 100%;
      cursor: grab;
    }

    #graph-svg.dragging {
      cursor: grabbing;
    }

    .node {
      cursor: pointer;
      transition: r 0.2s;
    }

    .node:hover {
      stroke-width: 3;
    }

    .node-label {
      font-size: 12px;
      fill: #F5F3EF;
      text-anchor: middle;
      pointer-events: none;
      user-select: none;
      font-weight: 600;
    }

    .edge {
      stroke-opacity: 0.4;
      stroke-width: 1.5;
    }

    .arrowhead {
      fill-opacity: 0.6;
    }

    .tooltip {
      position: absolute;
      background: #232F3E;
      border: 2px solid #FF6100;
      border-radius: 8px;
      padding: 1rem;
      max-width: 300px;
      pointer-events: none;
      z-index: 1000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.6);
      display: none;
    }

    .tooltip.visible {
      display: block;
    }

    .tooltip h3 {
      color: #FF6100;
      margin-bottom: 0.5rem;
      font-size: 1rem;
    }

    .tooltip p {
      color: #8a9ba8;
      font-size: 0.85rem;
      margin-bottom: 0.5rem;
      line-height: 1.4;
    }

    .tooltip .tags {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
      margin-top: 0.5rem;
    }

    .tooltip .tag {
      font-size: 0.7rem;
      padding: 0.15rem 0.5rem;
      background: rgba(255,97,0,0.2);
      border: 1px solid #FF6100;
      border-radius: 10px;
      color: #F5F3EF;
    }

    .details-panel {
      position: absolute;
      top: 70px;
      right: 0;
      width: 400px;
      height: calc(100vh - 70px);
      background: #232F3E;
      border-left: 2px solid #FF6100;
      box-shadow: -4px 0 12px rgba(0,0,0,0.6);
      transform: translateX(100%);
      transition: transform 0.3s;
      overflow-y: auto;
      z-index: 50;
    }

    .details-panel.open {
      transform: translateX(0);
    }

    .details-content {
      padding: 2rem;
    }

    .details-close {
      position: absolute;
      top: 1rem;
      right: 1rem;
      background: transparent;
      border: none;
      color: #FF6100;
      font-size: 1.5rem;
      cursor: pointer;
      padding: 0.25rem 0.5rem;
    }

    .details-close:hover {
      background: rgba(255,97,0,0.1);
    }

    .details-panel h2 {
      color: #FF6100;
      margin-bottom: 1rem;
      padding-right: 2rem;
    }

    .details-panel .meta {
      color: #8a9ba8;
      font-size: 0.85rem;
      margin-bottom: 0.5rem;
    }

    .details-panel .content {
      color: #F5F3EF;
      line-height: 1.6;
      margin-top: 1rem;
      white-space: pre-wrap;
    }

    .legend {
      position: absolute;
      bottom: 1rem;
      left: 1rem;
      background: rgba(35,47,62,0.9);
      border: 1px solid #FF6100;
      border-radius: 8px;
      padding: 1rem;
      font-size: 0.85rem;
      z-index: 50;
    }

    .legend h3 {
      color: #FF6100;
      margin-bottom: 0.5rem;
      font-size: 0.95rem;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin: 0.25rem 0;
    }

    .legend-color {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      border: 2px solid #1a2332;
    }

    .stats {
      position: absolute;
      top: 80px;
      left: 1rem;
      background: rgba(35,47,62,0.9);
      border: 1px solid #8a9ba8;
      border-radius: 8px;
      padding: 1rem;
      font-size: 0.85rem;
      z-index: 50;
    }

    .stats div {
      color: #8a9ba8;
      margin: 0.25rem 0;
    }

    .stats span {
      color: #FF6100;
      font-weight: 600;
    }

    .loading {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-size: 1.2rem;
      color: #FF6100;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Knowledge Graph</h1>
    <div class="controls">
      <div class="type-filters" id="type-filters"></div>
      <select class="tag-filter" id="tag-filter">
        <option value="">All Tags</option>
      </select>
    </div>
  </div>

  <div class="graph-container">
    <div class="loading" id="loading">Loading graph...</div>
    <svg id="graph-svg"></svg>

    <div class="tooltip" id="tooltip">
      <h3 id="tooltip-title"></h3>
      <p id="tooltip-type"></p>
      <p id="tooltip-content"></p>
      <div class="tags" id="tooltip-tags"></div>
    </div>

    <div class="stats" id="stats">
      <div>Nodes: <span id="stat-nodes">0</span></div>
      <div>Edges: <span id="stat-edges">0</span></div>
      <div>Visible: <span id="stat-visible">0</span></div>
    </div>

    <div class="legend">
      <h3>Memory Types</h3>
      <div class="legend-item">
        <div class="legend-color" style="background: #3498db;"></div>
        <span>fact</span>
      </div>
      <div class="legend-item">
        <div class="legend-color" style="background: #e67e22;"></div>
        <span>decision</span>
      </div>
      <div class="legend-item">
        <div class="legend-color" style="background: #2ecc71;"></div>
        <span>procedure</span>
      </div>
      <div class="legend-item">
        <div class="legend-color" style="background: #9b59b6;"></div>
        <span>insight</span>
      </div>
      <div class="legend-item">
        <div class="legend-color" style="background: #f1c40f;"></div>
        <span>goal</span>
      </div>
      <div class="legend-item">
        <div class="legend-color" style="background: #1abc9c;"></div>
        <span>preference</span>
      </div>
      <div class="legend-item">
        <div class="legend-color" style="background: #e74c3c;"></div>
        <span>conflict</span>
      </div>
      <div class="legend-item">
        <div class="legend-color" style="background: #95a5a6;"></div>
        <span>other</span>
      </div>
    </div>
  </div>

  <div class="details-panel" id="details-panel">
    <button class="details-close" id="details-close">&times;</button>
    <div class="details-content">
      <h2 id="details-title"></h2>
      <div class="meta">Type: <span id="details-type"></span></div>
      <div class="meta">Relations: <span id="details-relations"></span></div>
      <div class="meta">Tags: <span id="details-tags"></span></div>
      <div class="content" id="details-content"></div>
    </div>
  </div>

  <script>
    // ─── Constants ─────────────────────────────────────────────────────────
    const TYPE_COLORS = {
      fact: '#3498db',
      decision: '#e67e22',
      procedure: '#2ecc71',
      insight: '#9b59b6',
      goal: '#f1c40f',
      preference: '#1abc9c',
      conflict: '#e74c3c',
    };
    const DEFAULT_COLOR = '#95a5a6';

    const RELATION_COLORS = {
      relates_to: '#8a9ba8',
      supersedes: '#e67e22',
      contradicts: '#e74c3c',
      extends: '#2ecc71',
    };

    // Physics constants
    const REPULSION = 3000;
    const ATTRACTION = 0.01;
    const CENTER_GRAVITY = 0.02;
    const DAMPING = 0.85;
    const MIN_NODE_SIZE = 8;
    const MAX_NODE_SIZE = 24;

    // ─── State ─────────────────────────────────────────────────────────────
    let graphData = { nodes: [], edges: [] };
    let nodes = [];
    let edges = [];
    let nodeMap = new Map();
    let activeTypes = new Set();
    let activeTag = '';
    let selectedNode = null;

    let transform = { x: 0, y: 0, scale: 1 };
    let isDragging = false;
    let dragNode = null;
    let panStart = null;

    // ─── DOM Elements ──────────────────────────────────────────────────────
    const svg = document.getElementById('graph-svg');
    const tooltip = document.getElementById('tooltip');
    const detailsPanel = document.getElementById('details-panel');
    const loading = document.getElementById('loading');

    // ─── Init ──────────────────────────────────────────────────────────────
    async function init() {
      try {
        const res = await fetch('/api/graph/data');
        if (!res.ok) throw new Error('Failed to fetch graph data');

        graphData = await res.json();

        if (graphData.nodes.length === 0) {
          loading.textContent = 'No memories found';
          return;
        }

        // Initialize node positions (random within viewport)
        const width = svg.clientWidth;
        const height = svg.clientHeight;

        nodes = graphData.nodes.map(n => ({
          ...n,
          x: Math.random() * width,
          y: Math.random() * height,
          vx: 0,
          vy: 0,
          radius: MIN_NODE_SIZE + Math.min(n.relationCount * 2, MAX_NODE_SIZE - MIN_NODE_SIZE),
        }));

        nodes.forEach(n => nodeMap.set(n.id, n));

        // Build edges (only keep edges where both nodes exist)
        edges = graphData.edges.filter(e =>
          nodeMap.has(e.source) && nodeMap.has(e.target)
        );

        // Extract all types and tags
        const types = new Set(nodes.map(n => n.type));
        const tags = new Set();
        nodes.forEach(n => n.tags.forEach(t => tags.add(t)));

        // Initialize filters
        types.forEach(t => activeTypes.add(t));
        renderTypeFilters([...types]);
        renderTagFilter([...tags]);

        // Render initial graph
        loading.style.display = 'none';
        renderGraph();

        // Start physics simulation
        requestAnimationFrame(simulate);

      } catch (err) {
        loading.textContent = 'Error: ' + err.message;
        console.error(err);
      }
    }

    // ─── Type Filters ──────────────────────────────────────────────────────
    function renderTypeFilters(types) {
      const container = document.getElementById('type-filters');
      container.innerHTML = '';

      types.forEach(type => {
        const btn = document.createElement('button');
        btn.className = 'type-toggle active';
        btn.textContent = type;
        btn.onclick = () => toggleType(type, btn);
        container.appendChild(btn);
      });
    }

    function toggleType(type, btn) {
      if (activeTypes.has(type)) {
        activeTypes.delete(type);
        btn.classList.remove('active');
      } else {
        activeTypes.add(type);
        btn.classList.add('active');
      }
      renderGraph();
    }

    // ─── Tag Filter ────────────────────────────────────────────────────────
    function renderTagFilter(tags) {
      const select = document.getElementById('tag-filter');
      tags.forEach(tag => {
        const opt = document.createElement('option');
        opt.value = tag;
        opt.textContent = tag;
        select.appendChild(opt);
      });
      select.onchange = (e) => {
        activeTag = e.target.value;
        renderGraph();
      };
    }

    // ─── Filter Logic ──────────────────────────────────────────────────────
    function isNodeVisible(node) {
      if (!activeTypes.has(node.type)) return false;
      if (activeTag && !node.tags.includes(activeTag)) return false;
      return true;
    }

    // ─── Render Graph ──────────────────────────────────────────────────────
    function renderGraph() {
      const width = svg.clientWidth;
      const height = svg.clientHeight;

      // Filter visible nodes/edges
      const visibleNodes = nodes.filter(isNodeVisible);
      const visibleNodeIds = new Set(visibleNodes.map(n => n.id));
      const visibleEdges = edges.filter(e =>
        visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target)
      );

      // Update stats
      document.getElementById('stat-nodes').textContent = nodes.length;
      document.getElementById('stat-edges').textContent = edges.length;
      document.getElementById('stat-visible').textContent = visibleNodes.length;

      // Clear SVG
      svg.innerHTML = '';

      // Create defs for arrowheads
      const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      Object.entries(RELATION_COLORS).forEach(([type, color]) => {
        const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
        marker.setAttribute('id', 'arrow-' + type);
        marker.setAttribute('markerWidth', '10');
        marker.setAttribute('markerHeight', '10');
        marker.setAttribute('refX', '9');
        marker.setAttribute('refY', '3');
        marker.setAttribute('orient', 'auto');
        marker.setAttribute('markerUnits', 'strokeWidth');

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M0,0 L0,6 L9,3 z');
        path.setAttribute('fill', color);
        path.classList.add('arrowhead');
        marker.appendChild(path);
        defs.appendChild(marker);
      });
      svg.appendChild(defs);

      // Apply transform
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('transform', \`translate(\${transform.x}, \${transform.y}) scale(\${transform.scale})\`);

      // Draw edges
      visibleEdges.forEach(edge => {
        const source = nodeMap.get(edge.source);
        const target = nodeMap.get(edge.target);
        if (!source || !target) return;

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', source.x);
        line.setAttribute('y1', source.y);
        line.setAttribute('x2', target.x);
        line.setAttribute('y2', target.y);
        line.setAttribute('stroke', RELATION_COLORS[edge.type] || RELATION_COLORS.relates_to);
        line.setAttribute('marker-end', \`url(#arrow-\${edge.type || 'relates_to'})\`);
        line.classList.add('edge');
        g.appendChild(line);
      });

      // Draw nodes
      visibleNodes.forEach(node => {
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', node.x);
        circle.setAttribute('cy', node.y);
        circle.setAttribute('r', node.radius);
        circle.setAttribute('fill', TYPE_COLORS[node.type] || DEFAULT_COLOR);
        circle.setAttribute('stroke', '#1a2332');
        circle.setAttribute('stroke-width', '2');
        circle.classList.add('node');
        circle.dataset.id = node.id;

        circle.addEventListener('mouseenter', () => showTooltip(node));
        circle.addEventListener('mouseleave', hideTooltip);
        circle.addEventListener('click', () => showDetails(node));
        circle.addEventListener('mousedown', (e) => startDragNode(e, node));

        g.appendChild(circle);

        // Node label (type initial)
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', node.x);
        text.setAttribute('y', node.y + 4);
        text.classList.add('node-label');
        text.textContent = node.type.charAt(0).toUpperCase();
        g.appendChild(text);
      });

      svg.appendChild(g);
    }

    // ─── Physics Simulation ────────────────────────────────────────────────
    function simulate() {
      const width = svg.clientWidth;
      const height = svg.clientHeight;
      const centerX = width / 2;
      const centerY = height / 2;

      // Reset forces
      nodes.forEach(n => {
        n.vx = 0;
        n.vy = 0;
      });

      // Repulsion between all nodes
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const n1 = nodes[i];
          const n2 = nodes[j];
          const dx = n2.x - n1.x;
          const dy = n2.y - n1.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = REPULSION / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          n1.vx -= fx;
          n1.vy -= fy;
          n2.vx += fx;
          n2.vy += fy;
        }
      }

      // Attraction along edges
      edges.forEach(edge => {
        const source = nodeMap.get(edge.source);
        const target = nodeMap.get(edge.target);
        if (!source || !target) return;

        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = dist * ATTRACTION;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        source.vx += fx;
        source.vy += fy;
        target.vx -= fx;
        target.vy -= fy;
      });

      // Center gravity
      nodes.forEach(n => {
        const dx = centerX - n.x;
        const dy = centerY - n.y;
        n.vx += dx * CENTER_GRAVITY;
        n.vy += dy * CENTER_GRAVITY;
      });

      // Apply velocity with damping
      nodes.forEach(n => {
        if (n === dragNode) return; // Don't move dragged node
        n.x += n.vx;
        n.y += n.vy;
        n.vx *= DAMPING;
        n.vy *= DAMPING;
      });

      // Re-render (only if simulation is still active)
      const maxV = Math.max(...nodes.map(n => Math.abs(n.vx) + Math.abs(n.vy)));
      if (maxV > 0.1 || dragNode) {
        renderGraph();
        requestAnimationFrame(simulate);
      } else {
        // Simulation settled, re-render one final time
        renderGraph();
      }
    }

    // ─── Tooltip ───────────────────────────────────────────────────────────
    function showTooltip(node) {
      document.getElementById('tooltip-title').textContent = node.title;
      document.getElementById('tooltip-type').textContent = 'Type: ' + node.type;
      document.getElementById('tooltip-content').textContent = node.content;

      const tagsDiv = document.getElementById('tooltip-tags');
      tagsDiv.innerHTML = '';
      node.tags.forEach(tag => {
        const span = document.createElement('span');
        span.className = 'tag';
        span.textContent = tag;
        tagsDiv.appendChild(span);
      });

      tooltip.classList.add('visible');
    }

    function hideTooltip() {
      tooltip.classList.remove('visible');
    }

    // Update tooltip position on mouse move
    document.addEventListener('mousemove', (e) => {
      if (tooltip.classList.contains('visible')) {
        tooltip.style.left = (e.clientX + 15) + 'px';
        tooltip.style.top = (e.clientY + 15) + 'px';
      }
    });

    // ─── Details Panel ─────────────────────────────────────────────────────
    function showDetails(node) {
      selectedNode = node;
      document.getElementById('details-title').textContent = node.title;
      document.getElementById('details-type').textContent = node.type;
      document.getElementById('details-relations').textContent = node.relationCount;
      document.getElementById('details-tags').textContent = node.tags.join(', ') || 'None';

      // Fetch full content from memory
      fetch('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            name: 'memory_get',
            arguments: { id: node.id }
          },
          id: Date.now()
        })
      })
      .then(r => r.text())
      .then(text => {
        // Parse SSE stream
        const lines = text.split('\\n').filter(l => l.startsWith('data: '));
        if (lines.length > 0) {
          const lastLine = lines[lines.length - 1];
          const data = JSON.parse(lastLine.slice(6));
          if (data.result?.content?.[0]?.text) {
            const mem = JSON.parse(data.result.content[0].text);
            document.getElementById('details-content').textContent = mem.content;
          }
        }
      })
      .catch(err => {
        document.getElementById('details-content').textContent = 'Error loading full content';
        console.error(err);
      });

      detailsPanel.classList.add('open');
    }

    document.getElementById('details-close').onclick = () => {
      detailsPanel.classList.remove('open');
      selectedNode = null;
    };

    // ─── Node Dragging ─────────────────────────────────────────────────────
    function startDragNode(e, node) {
      e.stopPropagation();
      dragNode = node;
      svg.classList.add('dragging');
    }

    document.addEventListener('mousemove', (e) => {
      if (dragNode) {
        const rect = svg.getBoundingClientRect();
        const x = (e.clientX - rect.left - transform.x) / transform.scale;
        const y = (e.clientY - rect.top - transform.y) / transform.scale;
        dragNode.x = x;
        dragNode.y = y;
        dragNode.vx = 0;
        dragNode.vy = 0;
        renderGraph();
      }
    });

    document.addEventListener('mouseup', () => {
      if (dragNode) {
        dragNode = null;
        svg.classList.remove('dragging');
        // Restart simulation
        requestAnimationFrame(simulate);
      }
    });

    // ─── Pan & Zoom ────────────────────────────────────────────────────────
    svg.addEventListener('mousedown', (e) => {
      if (e.target === svg || e.target.tagName === 'g') {
        panStart = { x: e.clientX - transform.x, y: e.clientY - transform.y };
        svg.classList.add('dragging');
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (panStart && !dragNode) {
        transform.x = e.clientX - panStart.x;
        transform.y = e.clientY - panStart.y;
        renderGraph();
      }
    });

    document.addEventListener('mouseup', () => {
      if (panStart) {
        panStart = null;
        svg.classList.remove('dragging');
      }
    });

    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.max(0.1, Math.min(5, transform.scale * delta));

      // Zoom toward mouse position
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      transform.x = mx - (mx - transform.x) * (newScale / transform.scale);
      transform.y = my - (my - transform.y) * (newScale / transform.scale);
      transform.scale = newScale;

      renderGraph();
    });

    // ─── Start ─────────────────────────────────────────────────────────────
    init();
  </script>
</body>
</html>
`;
