const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const r1 = (n) => Math.round(n * 10) / 10;

/**
 * Renders the nodes of a model as HTML and its edges as SVG inside a "world" element.
 * Measurements of every node and row are cached so edges can be redrawn cheaply while dragging.
 */
export class DiagramRenderer {
  constructor(world, { showTypes = true } = {}) {
    this.world = world;
    this.showTypes = showTypes;
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'edges');
    this.nodeLayer = document.createElement('div');
    this.nodeLayer.className = 'nodes';
    world.append(this.svg, this.nodeLayer);
    this.cache = new Map();
    this.edgeMids = new Map();
    this.edges = [];
    this.adapter = null;
  }

  // ---------- full render ----------

  render(adapter) {
    this.adapter = adapter;
    const nodes = adapter.nodes();
    adapter.ensurePositions(nodes);
    this.edges = adapter.edges();
    this.nodeLayer.innerHTML = nodes.map((n) => this.nodeHtml(n, adapter.position(n.id), adapter.key)).join('');
    this.measure();
    this.drawEdges();
    return this;
  }

  nodeHtml(node, pos, modelKey) {
    const rows = node.rows.length
      ? node.rows.map((r) => this.rowHtml(r)).join('')
      : `<li class="node__empty">No ${modelKey === 'cdm' ? 'attributes' : 'fields'} yet</li>`;
    const icon = node.variant === 'assocClass' || node.variant === 'assocTable'
      ? '<i class="fa-solid fa-link node__icon" aria-hidden="true"></i>' : '';
    return `<div class="node node--${node.variant}" data-node="${esc(node.id)}" style="left:${pos.x}px;top:${pos.y}px">`
      + `<div class="node__head">${icon}<span class="node__title">${esc(node.title)}</span></div>`
      + `<ol class="node__rows">${rows}</ol></div>`;
  }

  rowHtml(row) {
    const keys = row.badges.map((b) => (b === 'id'
      ? '<i class="fa-solid fa-key key key--id" title="Identifier"></i>'
      : `<b class="key key--${b}">${b.toUpperCase()}</b>`)).join('');
    const detail = this.showTypes && row.detail ? `<span class="row__detail">${esc(row.detail)}</span>` : '';
    const idClass = row.badges.includes('id') ? ' row--identifier' : '';
    return `<li class="row${idClass}" data-row="${esc(row.id)}"><span class="row__keys">${keys}</span>`
      + `<span class="row__name">${esc(row.name)}</span>${detail}</li>`;
  }

  measure() {
    this.cache.clear();
    this.nodeLayer.querySelectorAll('.node').forEach((el) => {
      const id = el.dataset.node;
      const pos = this.adapter.position(id);
      const rows = new Map();
      el.querySelectorAll('.row').forEach((r) => rows.set(r.dataset.row, { top: r.offsetTop, h: r.offsetHeight }));
      this.cache.set(id, { el, x: pos.x, y: pos.y, w: el.offsetWidth, h: el.offsetHeight, rows });
    });
  }

  moveNode(id, pos) {
    const n = this.cache.get(id);
    if (!n) return;
    n.x = pos.x;
    n.y = pos.y;
    n.el.style.left = `${pos.x}px`;
    n.el.style.top = `${pos.y}px`;
  }

  bounds(padding = 0) {
    const all = [...this.cache.values()];
    if (!all.length) return null;
    const box = {
      x: Math.min(...all.map((n) => n.x)),
      y: Math.min(...all.map((n) => n.y)),
      x2: Math.max(...all.map((n) => n.x + n.w)),
      y2: Math.max(...all.map((n) => n.y + n.h))
    };
    // edge labels and reflexive loops stick out a bit
    this.edgeMids.forEach((m) => {
      box.x = Math.min(box.x, m.x - 40); box.y = Math.min(box.y, m.y - 40);
      box.x2 = Math.max(box.x2, m.x + 40); box.y2 = Math.max(box.y2, m.y + 40);
    });
    return { x: box.x - padding, y: box.y - padding, w: box.x2 - box.x + padding * 2, h: box.y2 - box.y + padding * 2 };
  }

  // ---------- geometry ----------

  static center(n) { return { x: n.x + n.w / 2, y: n.y + n.h / 2 }; }

  static clampInside(n, x, y) {
    return { x: Math.min(Math.max(x, n.x + 6), n.x + n.w - 6), y: Math.min(Math.max(y, n.y + 6), n.y + n.h - 6) };
  }

  /** Point where a ray from (ox,oy) inside rect n in direction (dx,dy) leaves the rect. */
  static rayExit(n, o, dx, dy) {
    let t = Infinity;
    if (dx > 0) t = Math.min(t, (n.x + n.w - o.x) / dx);
    if (dx < 0) t = Math.min(t, (n.x - o.x) / dx);
    if (dy > 0) t = Math.min(t, (n.y + n.h - o.y) / dy);
    if (dy < 0) t = Math.min(t, (n.y - o.y) / dy);
    if (!Number.isFinite(t)) t = 0;
    return { x: o.x + dx * t, y: o.y + dy * t };
  }

  rowY(n, rowId) {
    const row = rowId && n.rows.get(rowId);
    return row ? n.y + row.top + row.h / 2 : n.y + 16;
  }

  // ---------- edges ----------

  drawEdges() {
    this.edgeMids.clear();
    const parts = [];
    const groups = new Map();
    this.edges.forEach((e) => {
      const key = [e.from, e.to].sort().join('|');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    });
    let fkIndex = 0;
    this.edges.forEach((e) => {
      const group = groups.get([e.from, e.to].sort().join('|'));
      if (e.kind === 'association') parts.push(this.associationSvg(e, group.indexOf(e), group.length));
      else parts.push(this.foreignKeySvg(e, fkIndex++));
    });
    this.edges.filter((e) => e.hasClass).forEach((e) => parts.push(this.associationClassSvg(e)));
    this.svg.innerHTML = parts.join('');
  }

  text(cls, p, value, anchor = 'middle') {
    if (!value) return '';
    return `<text class="${cls}" x="${r1(p.x)}" y="${r1(p.y)}" text-anchor="${anchor}" dominant-baseline="middle">${esc(value)}</text>`;
  }

  group(e, inner, extraClass = '') {
    const title = e.title ? `<title>${esc(e.title)}</title>` : '';
    return `<g class="edge edge--${e.kind}${extraClass}" data-edge="${esc(e.id)}">${title}${inner}</g>`;
  }

  associationSvg(e, index, count) {
    const A = this.cache.get(e.from);
    const B = this.cache.get(e.to);
    if (!A || !B) return '';
    if (e.from === e.to) return this.reflexiveSvg(e, A, index);

    const ca = DiagramRenderer.center(A);
    const cb = DiagramRenderer.center(B);
    // Parallel associations between the same classes are spread out, always in the same orientation.
    const flip = e.from > e.to ? -1 : 1;
    const len = Math.hypot(cb.x - ca.x, cb.y - ca.y) || 1;
    const nx = (-(cb.y - ca.y) / len) * flip;
    const ny = ((cb.x - ca.x) / len) * flip;
    const off = (index - (count - 1) / 2) * 34;
    const oa = DiagramRenderer.clampInside(A, ca.x + nx * off, ca.y + ny * off);
    const ob = DiagramRenderer.clampInside(B, cb.x + nx * off, cb.y + ny * off);
    const p1 = DiagramRenderer.rayExit(A, oa, ob.x - oa.x, ob.y - oa.y);
    const p2 = DiagramRenderer.rayExit(B, ob, oa.x - ob.x, oa.y - ob.y);

    const segLen = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
    const ux = (p2.x - p1.x) / segLen;
    const uy = (p2.y - p1.y) / segLen;
    const px = -uy;
    const py = ux;
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    this.edgeMids.set(e.id, mid);
    const at = (p, along, side) => ({ x: p.x + ux * along + px * side, y: p.y + uy * along + py * side });
    const d = `M${r1(p1.x)} ${r1(p1.y)} L${r1(p2.x)} ${r1(p2.y)}`;

    return this.group(e, `<path class="edge__hit" d="${d}"/><path class="edge__line" d="${d}"/>`
      + this.text('edge__label', { x: mid.x + px * -12, y: mid.y + py * -12 }, e.label)
      + this.text('edge__card', at(p1, 20, 12), e.fromCard)
      + this.text('edge__role', at(p1, 26, -13), e.fromRole)
      + this.text('edge__card', at(p2, -20, 12), e.toCard)
      + this.text('edge__role', at(p2, -26, -13), e.toRole));
  }

  reflexiveSvg(e, A, k) {
    const r = 38 + k * 22;
    const right = A.x + A.w;
    const s = { x: right - 28 - k * 16, y: A.y };
    const t = { x: right, y: A.y + 26 + k * 16 };
    const d = `M${s.x} ${s.y} V${A.y - r} H${right + r} V${t.y} H${t.x}`;
    this.edgeMids.set(e.id, { x: right + r, y: (A.y - r + t.y) / 2 });
    return this.group(e, `<path class="edge__hit" d="${d}"/><path class="edge__line" d="${d}"/>`
      + this.text('edge__label', { x: (s.x + right + r) / 2, y: A.y - r - 10 }, e.label)
      + this.text('edge__card', { x: s.x - 8, y: s.y - 12 }, e.fromCard, 'end')
      + this.text('edge__role', { x: s.x - 8, y: s.y - 26 }, e.fromRole, 'end')
      + this.text('edge__card', { x: t.x + 8, y: t.y + 12 }, e.toCard, 'start')
      + this.text('edge__role', { x: t.x + 8, y: t.y + 26 }, e.toRole, 'start'));
  }

  associationClassSvg(e) {
    const mid = this.edgeMids.get(e.id);
    const node = this.cache.get(e.id);
    if (!mid || !node) return '';
    const c = DiagramRenderer.center(node);
    const p = DiagramRenderer.rayExit(node, c, mid.x - c.x, mid.y - c.y);
    return `<path class="edge__class-link" d="M${r1(mid.x)} ${r1(mid.y)} L${r1(p.x)} ${r1(p.y)}"/>`;
  }

  foreignKeySvg(e, k) {
    const A = this.cache.get(e.from);
    const B = this.cache.get(e.to);
    if (!A || !B) return '';
    const ya = this.rowY(A, e.fromRow);
    const yb = this.rowY(B, e.toRow);
    const stagger = ((k % 5) - 2) * 7;
    let d;
    let tip;
    let dir;
    let mid;
    if (e.from === e.to) {
      const x = A.x + A.w;
      const out = x + 26 + (k % 4) * 10;
      d = `M${x} ${ya} H${out} V${yb} H${x + 9}`;
      tip = { x, y: yb };
      dir = -1;
      mid = { x: out, y: (ya + yb) / 2 };
    } else if (B.x >= A.x + A.w + 40) {
      const sx = A.x + A.w;
      const mx = (sx + B.x) / 2 + stagger;
      d = `M${sx} ${ya} H${mx} V${yb} H${B.x - 9}`;
      tip = { x: B.x, y: yb };
      dir = 1;
      mid = { x: mx, y: (ya + yb) / 2 };
    } else if (B.x + B.w <= A.x - 40) {
      const sx = A.x;
      const tx = B.x + B.w;
      const mx = (sx + tx) / 2 + stagger;
      d = `M${sx} ${ya} H${mx} V${yb} H${tx + 9}`;
      tip = { x: tx, y: yb };
      dir = -1;
      mid = { x: mx, y: (ya + yb) / 2 };
    } else {
      const x = Math.max(A.x + A.w, B.x + B.w) + 32 + stagger;
      const tx = B.x + B.w;
      d = `M${A.x + A.w} ${ya} H${x} V${yb} H${tx + 9}`;
      tip = { x: tx, y: yb };
      dir = -1;
      mid = { x, y: (ya + yb) / 2 };
    }
    this.edgeMids.set(e.id, mid);
    const arrow = `M${tip.x} ${tip.y} L${tip.x - 10 * dir} ${tip.y - 5} L${tip.x - 10 * dir} ${tip.y + 5} Z`;
    return this.group(e, `<path class="edge__hit" d="${d}"/><path class="edge__line" d="${d}"/>`
      + `<path class="edge__arrow" d="${arrow}"/><circle class="edge__dot" cx="${d.split(' ')[0].slice(1)}" cy="${ya}" r="2.5"/>`);
  }

  // ---------- state classes ----------

  applySelection(selection) {
    this.world.querySelectorAll('.is-selected').forEach((el) => el.classList.remove('is-selected'));
    selection.items().forEach((item) => {
      let el = null;
      if (item.type === 'node') el = this.cache.get(item.id)?.el;
      else if (item.type === 'row') el = this.cache.get(item.nodeId)?.el.querySelector(`[data-row="${CSS.escape(item.rowId)}"]`);
      else if (item.type === 'edge') el = this.svg.querySelector(`[data-edge="${CSS.escape(item.id)}"]`);
      if (el) el.classList.add('is-selected');
    });
  }

  applyIssues(issues) {
    this.world.querySelectorAll('.has-error, .has-warning').forEach((el) => el.classList.remove('has-error', 'has-warning'));
    issues.forEach((issue) => {
      const cls = issue.level === 'error' ? 'has-error' : 'has-warning';
      let el = null;
      if (issue.rowId) el = this.cache.get(issue.nodeId)?.el.querySelector(`[data-row="${CSS.escape(issue.rowId)}"]`);
      else if (issue.nodeId) el = this.cache.get(issue.nodeId)?.el.querySelector('.node__head');
      else if (issue.edgeId) el = this.svg.querySelector(`[data-edge="${CSS.escape(issue.edgeId)}"]`);
      if (el && !el.classList.contains('has-error')) {
        el.classList.remove('has-warning');
        el.classList.add(cls);
      }
    });
  }
}
