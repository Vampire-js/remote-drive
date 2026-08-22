// ============================================================
// In-app PDF viewer.
//
// Renders a PDF as a vertically-scrolling stack of canvases using pdf.js.
// Each page renders at the container's CSS width, at devicePixelRatio, so
// it stays crisp on any screen size (phone → 4K desktop) without ever
// overflowing horizontally. Only pages near the viewport are painted
// (IntersectionObserver), keeping big documents responsive.
// ============================================================

import * as pdfjsLib from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?worker';
import type { PDFDocumentProxy, PDFDocumentLoadingTask, PDFPageProxy } from 'pdfjs-dist';
import { icons } from './utils';

// Wire up the worker once. Vite's ?worker import gives us a Worker
// constructor that bundles the pdf.js worker as a separate chunk.
pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();

// Cap the rendered CSS width so pages don't become gigantic on ultra-wide
// monitors. On narrow screens the container will just be the viewport width.
const MAX_PAGE_CSS_WIDTH = 1100;

// Cap the pixel ratio so we don't burn memory on 3x/4x HiDPI displays.
const MAX_PIXEL_RATIO = 2.5;

interface PageEntry {
  pageNum: number;
  wrapper: HTMLDivElement;
  canvas: HTMLCanvasElement;
  page: PDFPageProxy | null;
  rendered: boolean;
  rendering: boolean;
  // The CSS width the current canvas was rendered at. If the container
  // resizes, we re-render pages whose width no longer matches.
  renderedCssWidth: number;
}

let pdfViewerCleanup: (() => void) | null = null;

export interface OpenPdfOptions {
  title: string;
  src: string;
  downloadUrl: string;
}

export function openPdfViewer({ title, src, downloadUrl }: OpenPdfOptions): void {
  if (pdfViewerCleanup) pdfViewerCleanup();

  const overlay = document.createElement('div');
  overlay.className = 'viewer-overlay pdf-viewer';
  overlay.innerHTML = `
    <header class="viewer-header">
      <div class="viewer-title" id="pdf-title"></div>
      <div class="viewer-actions">
        <span class="viewer-counter" id="pdf-counter"></span>
        <button class="btn btn-icon btn-ghost viewer-btn" id="pdf-zoom-out" type="button" aria-label="Zoom out">${icons.chevronDown}</button>
        <button class="btn btn-icon btn-ghost viewer-btn" id="pdf-zoom-in" type="button" aria-label="Zoom in">${icons.chevronDown}</button>
        <a class="btn btn-icon btn-ghost viewer-btn" id="pdf-download" href="#" aria-label="Download">${icons.download}</a>
        <button class="btn btn-icon btn-ghost viewer-btn" id="pdf-close" type="button" aria-label="Close">${icons.close}</button>
      </div>
    </header>
    <div class="pdf-scroll" id="pdf-scroll">
      <div class="pdf-pages" id="pdf-pages"></div>
      <div class="viewer-spinner" id="pdf-spinner"><div class="spinner"></div></div>
      <div class="pdf-error" id="pdf-error" hidden></div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.classList.add('no-scroll');

  const titleEl = overlay.querySelector<HTMLDivElement>('#pdf-title')!;
  const counter = overlay.querySelector<HTMLSpanElement>('#pdf-counter')!;
  const scroll = overlay.querySelector<HTMLDivElement>('#pdf-scroll')!;
  const pagesEl = overlay.querySelector<HTMLDivElement>('#pdf-pages')!;
  const spinner = overlay.querySelector<HTMLDivElement>('#pdf-spinner')!;
  const errorEl = overlay.querySelector<HTMLDivElement>('#pdf-error')!;
  const closeBtn = overlay.querySelector<HTMLButtonElement>('#pdf-close')!;
  const dl = overlay.querySelector<HTMLAnchorElement>('#pdf-download')!;
  const zoomInBtn = overlay.querySelector<HTMLButtonElement>('#pdf-zoom-in')!;
  const zoomOutBtn = overlay.querySelector<HTMLButtonElement>('#pdf-zoom-out')!;

  titleEl.textContent = title;
  dl.href = downloadUrl;
  dl.setAttribute('download', title);

  // Give zoom buttons distinguishing look via +/- glyphs. We use the plain
  // svg icons above only as fallback; overwrite with clearer text symbols.
  zoomInBtn.innerHTML = '<span aria-hidden="true" style="font-size:1.15rem;font-weight:600;line-height:1">+</span>';
  zoomOutBtn.innerHTML = '<span aria-hidden="true" style="font-size:1.25rem;font-weight:600;line-height:1">−</span>';

  const entries: PageEntry[] = [];
  let doc: PDFDocumentProxy | null = null;
  let loadingTask: PDFDocumentLoadingTask | null = null;
  let destroyed = false;
  // User-controlled zoom multiplier on top of fit-to-width sizing.
  let zoom = 1;
  const MIN_ZOOM = 0.5;
  const MAX_ZOOM = 3;

  // ---- Rendering ---------------------------------------------------------

  function getBaseCssWidth(): number {
    // Fit to available scroll-area width, minus a small gutter, capped.
    const avail = scroll.clientWidth - 16;
    return Math.max(200, Math.min(avail, MAX_PAGE_CSS_WIDTH));
  }

  function getTargetCssWidth(): number {
    return getBaseCssWidth() * zoom;
  }

  async function renderPage(entry: PageEntry): Promise<void> {
    if (destroyed || entry.rendering) return;
    if (!entry.page) return;

    const cssWidth = getTargetCssWidth();
    if (entry.rendered && Math.abs(entry.renderedCssWidth - cssWidth) < 0.5) return;

    entry.rendering = true;
    try {
      const page = entry.page;
      // viewport at scale=1 gives us intrinsic PDF units; compute the scale
      // needed to hit our target CSS width.
      const baseViewport = page.getViewport({ scale: 1 });
      const cssScale = cssWidth / baseViewport.width;
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      const renderViewport = page.getViewport({ scale: cssScale * dpr });

      const canvas = entry.canvas;
      canvas.width = Math.floor(renderViewport.width);
      canvas.height = Math.floor(renderViewport.height);
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${(baseViewport.height * cssScale).toFixed(2)}px`;

      // Also size the wrapper so the placeholder height matches even before
      // the canvas paints. Prevents scroll jumps on first render.
      entry.wrapper.style.width = `${cssWidth}px`;
      entry.wrapper.style.height = canvas.style.height;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      await page.render({ canvasContext: ctx, viewport: renderViewport, canvas }).promise;
      entry.rendered = true;
      entry.renderedCssWidth = cssWidth;
    } catch (err) {
      // Rendering can be cancelled by pdf.js when we start a new render for
      // the same page (resize). That's fine — swallow.
      // eslint-disable-next-line no-console
      console.warn('PDF page render failed', err);
    } finally {
      entry.rendering = false;
    }
  }

  // Reserve placeholder space for every page using the first page's aspect
  // ratio scaled to the target width. Prevents the whole document from
  // collapsing before pages render.
  function reserveSpace(firstPage: PDFPageProxy): void {
    const cssWidth = getTargetCssWidth();
    const vp = firstPage.getViewport({ scale: 1 });
    const guessHeight = (vp.height / vp.width) * cssWidth;
    entries.forEach((entry) => {
      if (entry.rendered) return;
      entry.wrapper.style.width = `${cssWidth}px`;
      entry.wrapper.style.height = `${guessHeight}px`;
    });
  }

  // ---- Load document -----------------------------------------------------

  (async () => {
    try {
      loadingTask = pdfjsLib.getDocument({ url: src, withCredentials: false });
      const pdf = await loadingTask.promise;
      if (destroyed) {
        // Loading finished after the viewer was closed — tear down.
        loadingTask.destroy().catch(() => {});
        return;
      }
      doc = pdf;

      const firstPage = await pdf.getPage(1);
      if (destroyed) return;

      // Build a wrapper + canvas per page.
      for (let i = 1; i <= pdf.numPages; i++) {
        const wrapper = document.createElement('div');
        wrapper.className = 'pdf-page';
        wrapper.dataset.page = String(i);

        const canvas = document.createElement('canvas');
        canvas.className = 'pdf-page-canvas';
        wrapper.appendChild(canvas);

        pagesEl.appendChild(wrapper);
        entries.push({
          pageNum: i,
          wrapper,
          canvas,
          page: null,
          rendered: false,
          rendering: false,
          renderedCssWidth: 0,
        });
      }

      // First page is already loaded; stash it.
      entries[0].page = firstPage;
      reserveSpace(firstPage);

      spinner.hidden = true;
      updateCounter();

      // Kick off render of the first page immediately so the user sees
      // something as soon as possible.
      await renderPage(entries[0]);

      // Lazy-load & render subsequent pages via IntersectionObserver.
      setupObserver();
      // Also render page 2 eagerly so scrolling feels instant.
      if (entries[1]) queueLoadAndRender(entries[1]);
    } catch (err) {
      spinner.hidden = true;
      errorEl.hidden = false;
      errorEl.textContent =
        err instanceof Error ? `Could not load PDF: ${err.message}` : 'Could not load PDF';
    }
  })();

  async function queueLoadAndRender(entry: PageEntry): Promise<void> {
    if (!doc || entry.rendering) return;
    if (!entry.page) {
      try {
        entry.page = await doc.getPage(entry.pageNum);
      } catch {
        return;
      }
      if (destroyed) return;
    }
    await renderPage(entry);
  }

  // ---- Viewport tracking -------------------------------------------------

  let observer: IntersectionObserver | null = null;
  function setupObserver(): void {
    observer = new IntersectionObserver(
      (records) => {
        records.forEach((rec) => {
          const pageNum = Number((rec.target as HTMLElement).dataset.page);
          const entry = entries[pageNum - 1];
          if (!entry) return;
          if (rec.isIntersecting) {
            queueLoadAndRender(entry);
          }
        });
      },
      {
        root: scroll,
        // Preload a viewport ahead & behind so scrolling feels seamless.
        rootMargin: '200% 0px 200% 0px',
        threshold: 0,
      }
    );
    entries.forEach((e) => observer!.observe(e.wrapper));
  }

  // Track which page is centered for the counter.
  function updateCounter(): void {
    if (entries.length === 0) {
      counter.textContent = '';
      return;
    }
    const scrollMid = scroll.scrollTop + scroll.clientHeight / 2;
    let current = 1;
    for (const entry of entries) {
      const top = entry.wrapper.offsetTop;
      const bottom = top + entry.wrapper.offsetHeight;
      if (scrollMid >= top && scrollMid <= bottom) {
        current = entry.pageNum;
        break;
      }
      if (scrollMid > bottom) current = entry.pageNum;
    }
    counter.textContent = `${current} / ${entries.length}`;
  }

  scroll.addEventListener('scroll', updateCounter, { passive: true });

  // ---- Resize handling ---------------------------------------------------

  let resizeRaf = 0;
  function onResize(): void {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      // Re-reserve placeholders using page-1's aspect ratio so unrendered
      // pages don't jump.
      if (entries[0]?.page) reserveSpace(entries[0].page);
      // Re-render already-rendered pages that no longer match target width.
      const target = getTargetCssWidth();
      entries.forEach((entry) => {
        if (entry.rendered && Math.abs(entry.renderedCssWidth - target) > 0.5 && entry.page) {
          entry.rendered = false;
          renderPage(entry);
        }
      });
      updateCounter();
    });
  }
  const ro = new ResizeObserver(onResize);
  ro.observe(scroll);
  window.addEventListener('orientationchange', onResize);

  // ---- Zoom --------------------------------------------------------------

  function setZoom(next: number): void {
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
    if (Math.abs(clamped - zoom) < 0.001) return;
    zoom = clamped;
    onResize();
  }
  zoomInBtn.addEventListener('click', () => setZoom(zoom * 1.25));
  zoomOutBtn.addEventListener('click', () => setZoom(zoom / 1.25));

  // Ctrl/Cmd + wheel = zoom (desktop convention).
  scroll.addEventListener(
    'wheel',
    (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      setZoom(zoom * factor);
    },
    { passive: false }
  );

  // ---- Close / keyboard --------------------------------------------------

  function close(): void {
    if (!pdfViewerCleanup) return;
    pdfViewerCleanup();
  }
  closeBtn.addEventListener('click', close);

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'PageDown') {
      // Let native scrolling handle it, but nudge by page height when PageDown.
      if (e.key === 'PageDown') {
        e.preventDefault();
        scroll.scrollBy({ top: scroll.clientHeight * 0.9, behavior: 'smooth' });
      }
    } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
      if (e.key === 'PageUp') {
        e.preventDefault();
        scroll.scrollBy({ top: -scroll.clientHeight * 0.9, behavior: 'smooth' });
      }
    } else if (e.key === 'Home') {
      e.preventDefault();
      scroll.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (e.key === 'End') {
      e.preventDefault();
      scroll.scrollTo({ top: scroll.scrollHeight, behavior: 'smooth' });
    } else if ((e.key === '+' || e.key === '=') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setZoom(zoom * 1.25);
    } else if (e.key === '-' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setZoom(zoom / 1.25);
    } else if (e.key === '0' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setZoom(1);
    }
  };
  document.addEventListener('keydown', onKey);

  // ---- Cleanup -----------------------------------------------------------

  pdfViewerCleanup = () => {
    destroyed = true;
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('orientationchange', onResize);
    if (observer) observer.disconnect();
    ro.disconnect();
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    // Free page + doc resources so we don't leak memory across opens.
    entries.forEach((entry) => {
      try {
        entry.page?.cleanup();
      } catch {
        // ignore
      }
    });
    doc = null;
    if (loadingTask) {
      // Destroying the loading task also tears down the worker + document.
      loadingTask.destroy().catch(() => {});
      loadingTask = null;
    }
    overlay.remove();
    document.body.classList.remove('no-scroll');
    pdfViewerCleanup = null;
  };
}
