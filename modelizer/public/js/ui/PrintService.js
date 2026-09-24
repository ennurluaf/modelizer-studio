import { DiagramRenderer } from './DiagramRenderer.js';
import { esc } from './Modal.js';

const PAPER_MM = { A4: [297, 210], A3: [420, 297], letter: [279.4, 215.9] };
const MM = 96 / 25.4;
const MARGIN_MM = 10;
const HEADER_MM = 12;

/**
 * Builds one page per chosen model in #print-root, scales each diagram to fit the
 * printable area and opens the browser print dialog ("Save as PDF" makes a PDF).
 */
export class PrintService {
  constructor(adapters, settings) {
    this.adapters = adapters;
    this.settings = settings;
  }

  static get LABELS() { return { cdm: 'Conceptual data model (CDM)', ldm: 'Logical data model (LDM)', pdm: 'Physical data model (PDM)' }; }

  print({ models, orientation, paper, title, header }) {
    this.cleanup();
    const [long, short] = PAPER_MM[paper] || PAPER_MM.A4;
    const pageW = orientation === 'landscape' ? long : short;
    const pageH = orientation === 'landscape' ? short : long;
    const areaW = (pageW - MARGIN_MM * 2) * MM;
    const areaH = (pageH - MARGIN_MM * 2 - (header ? HEADER_MM : 0)) * MM;

    const root = document.createElement('div');
    root.id = 'print-root';
    root.setAttribute('aria-hidden', 'true');
    document.body.append(root);

    const date = new Date().toLocaleDateString();
    models.forEach((key) => {
      const page = document.createElement('section');
      page.className = 'print-page';
      page.style.width = `${areaW}px`;
      page.innerHTML = (header ? `<header class="print-page__head"><strong>${esc(title)}</strong><span>${PrintService.LABELS[key]}</span><span>${esc(date)}</span></header>` : '')
        + `<div class="print-page__area" style="width:${areaW}px;height:${areaH}px"><div class="world" data-model="${key}"></div></div>`;
      root.append(page);
      const world = page.querySelector('.world');
      const renderer = new DiagramRenderer(world, { showTypes: this.settings.get('showRowTypes') }).render(this.adapters[key]);
      const box = renderer.bounds(16);
      if (!box) return;
      const scale = Math.min(areaW / box.w, areaH / box.h, 1.25);
      const offsetX = (areaW - box.w * scale) / 2;
      world.style.transform = `translate(${offsetX - box.x * scale}px, ${-box.y * scale}px) scale(${scale})`;
    });

    const style = document.createElement('style');
    style.id = 'print-page-style';
    style.textContent = `@page { size: ${paper} ${orientation}; margin: ${MARGIN_MM}mm; }`;
    document.head.append(style);

    const done = () => { window.removeEventListener('afterprint', done); this.cleanup(); };
    window.addEventListener('afterprint', done);
    // Give fonts a moment to lay out before the print snapshot.
    setTimeout(() => window.print(), 120);
  }

  cleanup() {
    document.getElementById('print-root')?.remove();
    document.getElementById('print-page-style')?.remove();
  }
}
