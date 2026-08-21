import './style.css';
import type { DriveItem } from './types';
import type { UploadEntry } from './api';
import {
  listItems,
  createFolder,
  uploadFiles,
  deleteItem,
  renameItem,
  downloadUrl,
  getStats,
} from './api';
import { formatBytes, formatDate, iconFor, joinPath, escapeHtml, icons, isImage } from './utils';

const app = document.querySelector<HTMLDivElement>('#app')!;

app.innerHTML = `
  <div class="app-shell">
    <aside id="sidebar" class="sidebar">
      <div class="sidebar-header">
        <div class="brand">
          <div class="brand-logo">${icons.cloud}</div>
          <span class="brand-name">My Drive</span>
        </div>
      </div>
      <div class="sidebar-body">
        <div class="new-btn-wrap">
          <button id="new-btn" class="btn btn-primary btn-full" type="button" aria-haspopup="menu" aria-expanded="false">
            ${icons.plus}<span>New</span>
          </button>
        </div>
        <nav class="nav">
          <button class="nav-item nav-item-active" type="button">${icons.hardDrive}<span>My Drive</span></button>
        </nav>
      </div>
      <div class="sidebar-footer">
        <div class="storage">
          <div class="storage-header">
            <span class="storage-label">Storage</span>
            <span id="storage-text" class="text-muted">…</span>
          </div>
          <div class="storage-bar"><div id="storage-fill" class="storage-fill"></div></div>
        </div>
      </div>
    </aside>
    <div id="sidebar-backdrop" class="sidebar-backdrop" hidden></div>

    <div class="main-col">
      <header class="topbar">
        <button id="mobile-menu-btn" class="btn btn-icon btn-ghost sidebar-toggle" type="button" aria-label="Open menu">${icons.menu}</button>
        <div class="search">
          <span class="search-icon">${icons.search}</span>
          <input id="search-input" class="search-input" type="search" placeholder="Search in My Drive" />
        </div>
        <div class="topbar-right">
          <button id="theme-toggle-btn" class="btn btn-icon btn-ghost" type="button" aria-label="Toggle theme"></button>
        </div>
      </header>

      <div class="toolbar">
        <div id="toolbar-left" class="toolbar-left"></div>
        <div id="toolbar-right" class="toolbar-right"></div>
      </div>

      <main id="drop-zone" class="content">
        <div id="loading-state" class="loading-state" hidden>
          <div class="spinner"></div>
        </div>
        <div id="grid" class="grid"></div>
        <div id="empty-state" class="empty-state" hidden>
          <div class="empty-icon">${icons.hardDrive}</div>
          <p class="empty-title">This folder is empty</p>
          <p class="empty-sub">Drag files here, or click New to get started</p>
        </div>
        <div id="drag-overlay" class="drag-overlay" hidden>
          <div class="drag-overlay-inner">
            ${icons.upload}
            <span>Drop files to upload</span>
          </div>
        </div>
      </main>
    </div>

    <input id="file-input" type="file" multiple hidden />
    <input id="folder-input" type="file" multiple hidden webkitdirectory directory />
    <button id="fab-new" class="fab" type="button" aria-label="New" aria-haspopup="menu" aria-expanded="false">
      ${icons.plus}
    </button>
    <div id="new-menu" class="dropdown-menu new-menu-portal" role="menu" hidden>
      <button role="menuitem" type="button" data-action="new-folder">${icons.folderPlus}<span>New folder</span></button>
      <div class="dropdown-separator"></div>
      <button role="menuitem" type="button" data-action="upload-files">${icons.upload}<span>File upload</span></button>
      <button role="menuitem" type="button" data-action="upload-folder">${icons.upload}<span>Folder upload</span></button>
    </div>
    <div class="sheet-scrim" aria-hidden="true"></div>
    <div id="upload-progress" class="upload-progress" hidden aria-live="polite"></div>
    <div id="toast-container" class="toast-container"></div>
    <div id="modal-root"></div>
  </div>
`;

let currentPath = '';
let currentItems: DriveItem[] = [];
const selected = new Set<string>();

type SortKey = 'name' | 'modified' | 'size';
let sortKey: SortKey = 'name';
let sortDir: 'asc' | 'desc' = 'asc';

// ============================================================
// Dropdown helper
// A single, reliable helper for click-triggered popover menus.
// Uses capture-phase outside clicks + Esc, and stops the trigger
// click from immediately closing what it just opened.
// ============================================================

interface Dropdown {
  toggle(): void;
  open(): void;
  close(): void;
  isOpen(): boolean;
}

// Position a body-level (portal) dropdown next to its trigger, clamped to
// the viewport. Used when the menu can't be nested inside the trigger's own
// relative-positioned parent (e.g. the FAB, which floats over content).
function positionPortalMenu(menu: HTMLElement, anchor: HTMLElement): void {
  // Reset then measure.
  menu.style.top = '0px';
  menu.style.left = '0px';
  const rect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const pad = 8;

  let top = rect.bottom + 6;
  if (top + menuRect.height > window.innerHeight - pad) {
    top = rect.top - menuRect.height - 6;
  }
  if (top < pad) top = pad;

  let left = rect.right - menuRect.width;
  if (left + menuRect.width > window.innerWidth - pad) {
    left = window.innerWidth - menuRect.width - pad;
  }
  if (left < pad) left = pad;

  menu.style.top = `${top + window.scrollY}px`;
  menu.style.left = `${left + window.scrollX}px`;
}

function createDropdown(anchors: HTMLElement | HTMLElement[], menu: HTMLElement): Dropdown {
  const anchorList = Array.isArray(anchors) ? anchors : [anchors];
  const isMobile = (): boolean => window.matchMedia('(max-width: 640px)').matches;

  const onOutsideClick = (e: MouseEvent) => {
    const target = e.target as Node;
    if (!menu.contains(target) && !anchorList.some((a) => a.contains(target))) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };

  const open = (): void => {
    if (!menu.hidden) return;
    menu.hidden = false;
    anchorList.forEach((a) => a.setAttribute('aria-expanded', 'true'));

    // On mobile the menu is displayed as a bottom sheet (CSS positions it),
    // with a scrim behind. On desktop, if the menu lives outside its trigger's
    // relative parent (e.g. body-level portal like the FAB's menu), position
    // it manually next to whichever anchor was clicked last.
    if (isMobile()) {
      document.body.classList.add('sheet-open');
    } else if (menu.parentElement === document.body || menu.classList.contains('portal-menu')) {
      const trigger =
        (anchorList.find((a) => document.activeElement === a) as HTMLElement | undefined) ??
        anchorList[0];
      positionPortalMenu(menu, trigger);
    }

    setTimeout(() => {
      document.addEventListener('click', onOutsideClick, true);
      document.addEventListener('keydown', onKey);
    }, 0);
  };

  const close = (): void => {
    if (menu.hidden) return;
    menu.hidden = true;
    anchorList.forEach((a) => a.setAttribute('aria-expanded', 'false'));
    document.body.classList.remove('sheet-open');
    document.removeEventListener('click', onOutsideClick, true);
    document.removeEventListener('keydown', onKey);
  };

  const toggle = (): void => {
    if (menu.hidden) open();
    else close();
  };

  anchorList.forEach((a) =>
    a.addEventListener('click', (e) => {
      e.stopPropagation();
      toggle();
    })
  );

  menu.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[role="menuitem"], [data-menu-item]')) {
      setTimeout(close, 0);
    }
  });

  return { toggle, open, close, isOpen: () => !menu.hidden };
}

// ============================================================
// Theme
// ============================================================

const THEME_KEY = 'gdrive-theme';
const themeToggleBtn = document.getElementById('theme-toggle-btn')!;

function getInitialTheme(): 'light' | 'dark' {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: 'light' | 'dark'): void {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
  themeToggleBtn.innerHTML = theme === 'dark' ? icons.sun : icons.moon;
  themeToggleBtn.setAttribute(
    'aria-label',
    theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
  );

  // Sync the browser chrome / iOS status-bar color to match the active theme.
  // We overwrite ALL existing `theme-color` metas (including the media-scoped
  // ones from index.html) so the installed PWA follows the manual toggle too.
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((el) => el.remove());
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = theme === 'dark' ? '#0a0a0a' : '#ffffff';
  document.head.appendChild(meta);
}

applyTheme(getInitialTheme());

themeToggleBtn.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

// ============================================================
// Data loading
// ============================================================

async function loadFolder(path: string): Promise<void> {
  currentPath = path;
  selected.clear();
  closeItemMenu();
  const loading = document.getElementById('loading-state')!;
  const grid = document.getElementById('grid')!;
  const emptyState = document.getElementById('empty-state')!;
  loading.hidden = false;
  grid.innerHTML = '';
  emptyState.hidden = true;
  try {
    const res = await listItems(path);
    currentItems = res.items;
    renderToolbar();
    renderGrid();
    closeSidebarOnMobile();
  } catch (err) {
    showToast((err as Error).message, 'error');
  } finally {
    loading.hidden = true;
  }
}

async function refreshStats(): Promise<void> {
  const fill = document.getElementById('storage-fill') as HTMLElement;
  const text = document.getElementById('storage-text')!;
  try {
    const stats = await getStats();
    if (stats.total) {
      const pct = Math.min(100, (stats.used / stats.total) * 100);
      fill.style.width = `${pct}%`;
      text.textContent = `${formatBytes(stats.used)} / ${formatBytes(stats.total)}`;
    } else {
      fill.style.width = '0%';
      text.textContent = formatBytes(stats.used);
    }
  } catch {
    text.textContent = 'unavailable';
  }
}

// ============================================================
// Toolbar (breadcrumb + sort, or selection actions)
// ============================================================

const SORT_LABELS: Record<SortKey, string> = {
  name: 'Name',
  modified: 'Last modified',
  size: 'Size',
};

function renderToolbar(): void {
  const left = document.getElementById('toolbar-left')!;
  const right = document.getElementById('toolbar-right')!;

  if (selected.size > 0) {
    renderSelectionToolbar(left, right);
  } else {
    renderBreadcrumb(left);
    renderSortControl(right);
  }
}

function renderSelectionToolbar(left: HTMLElement, right: HTMLElement): void {
  const selectedPaths = Array.from(selected);
  const singlePath = selectedPaths.length === 1 ? selectedPaths[0] : null;
  const singleItem = singlePath
    ? currentItems.find((i) => joinPath(currentPath, i.name) === singlePath)
    : null;

  left.innerHTML = `
    <button id="clear-selection-btn" class="btn btn-icon btn-ghost" type="button" aria-label="Clear selection">${icons.close}</button>
    <span class="selection-count">${selected.size} selected</span>
  `;
  document.getElementById('clear-selection-btn')!.addEventListener('click', () => {
    selected.clear();
    renderToolbar();
    renderGrid();
  });

  right.innerHTML = `
    ${
      singleItem && singleItem.type === 'file'
        ? `<button id="sel-download-btn" class="btn btn-icon btn-ghost" type="button" aria-label="Download">${icons.download}</button>`
        : ''
    }
    ${
      singleItem
        ? `<button id="sel-rename-btn" class="btn btn-icon btn-ghost" type="button" aria-label="Rename">${icons.pencil}</button>`
        : ''
    }
    <button id="sel-delete-btn" class="btn btn-icon btn-ghost btn-icon-danger" type="button" aria-label="Delete">${icons.trash}</button>
  `;

  if (singleItem && singleItem.type === 'file' && singlePath) {
    document
      .getElementById('sel-download-btn')!
      .addEventListener('click', () => window.open(downloadUrl(singlePath), '_blank'));
  }
  if (singleItem && singlePath) {
    document.getElementById('sel-rename-btn')!.addEventListener('click', () => {
      handleRename(singlePath, singleItem.name);
    });
  }
  document.getElementById('sel-delete-btn')!.addEventListener('click', async () => {
    const confirmed = await openConfirmModal(
      selected.size > 1 ? 'Delete items?' : 'Delete item?',
      `This will permanently delete ${
        selected.size > 1 ? `${selected.size} items` : `"${singleItem?.name ?? 'this item'}"`
      }. This action cannot be undone.`
    );
    if (!confirmed) return;
    try {
      await Promise.all(Array.from(selected).map((p) => deleteItem(p)));
      showToast('Deleted');
      loadFolder(currentPath);
      refreshStats();
    } catch (err) {
      showToast((err as Error).message, 'error');
    }
  });
}

function renderBreadcrumb(container: HTMLElement): void {
  const segments = currentPath ? currentPath.split('/') : [];
  const crumbs = [{ label: 'My Drive', path: '' }];
  let acc = '';
  for (const seg of segments) {
    acc = joinPath(acc, seg);
    crumbs.push({ label: seg, path: acc });
  }

  container.innerHTML = `<nav class="breadcrumb">${crumbs
    .map((c, i) => {
      const isLast = i === crumbs.length - 1;
      const btn = `<button class="crumb${
        isLast ? ' crumb-current' : ''
      }" data-path="${escapeHtml(c.path)}" ${isLast ? 'disabled' : ''}>${escapeHtml(c.label)}</button>`;
      return isLast ? btn : `${btn}<span class="crumb-sep">/</span>`;
    })
    .join('')}</nav>`;

  container.querySelectorAll<HTMLButtonElement>('.crumb:not(:disabled)').forEach((btn) => {
    btn.addEventListener('click', () => loadFolder(btn.dataset.path ?? ''));
  });
}

function renderSortControl(container: HTMLElement): void {
  container.innerHTML = `
    <div class="dropdown-anchor">
      <button id="sort-btn" class="btn btn-outline" type="button" aria-haspopup="menu" aria-expanded="false">
        ${icons.sort}<span>${SORT_LABELS[sortKey]}</span>${
          sortDir === 'asc' ? icons.arrowUp : icons.arrowDown
        }
      </button>
      <div id="sort-menu" class="dropdown-menu dropdown-menu-right" role="menu" hidden>
        ${(Object.keys(SORT_LABELS) as SortKey[])
          .map(
            (key) => `<button role="menuitem" type="button" data-sort-key="${key}" class="${
              key === sortKey ? 'menu-item-active' : ''
            }">
              <span>${SORT_LABELS[key]}</span>
              <span class="menu-item-trailing">${
                key === sortKey ? (sortDir === 'asc' ? icons.arrowUp : icons.arrowDown) : ''
              }</span>
            </button>`
          )
          .join('')}
      </div>
    </div>
  `;

  const sortBtn = document.getElementById('sort-btn')!;
  const sortMenu = document.getElementById('sort-menu')!;
  createDropdown(sortBtn, sortMenu);

  sortMenu.querySelectorAll<HTMLButtonElement>('[data-sort-key]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.sortKey as SortKey;
      if (key === sortKey) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortKey = key;
        sortDir = 'asc';
      }
      renderToolbar();
      renderGrid();
    });
  });
}

// ============================================================
// Grid
// ============================================================

const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_THRESHOLD = 10; // pixels

// Attach touch-only long-press behavior: after `LONG_PRESS_MS` of a stationary
// touch, `onLongPress` fires and the subsequent `click` on the same element
// is suppressed. Cancels on move, touchend, touchcancel, or scroll.
function attachLongPress(el: HTMLElement, onLongPress: () => void): void {
  let timer: number | null = null;
  let startX = 0;
  let startY = 0;
  let firedForThisTouch = false;

  const cancel = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  el.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      firedForThisTouch = false;
      cancel();
      timer = window.setTimeout(() => {
        timer = null;
        firedForThisTouch = true;
        // Haptic feedback on Android (WebView proxies to Vibration API when
        // permitted — no-op on iOS Safari, harmless).
        if ('vibrate' in navigator) navigator.vibrate?.(15);
        onLongPress();
      }, LONG_PRESS_MS);
    },
    { passive: true }
  );

  el.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length !== 1) return cancel();
      const t = e.touches[0];
      if (
        Math.abs(t.clientX - startX) > LONG_PRESS_MOVE_THRESHOLD ||
        Math.abs(t.clientY - startY) > LONG_PRESS_MOVE_THRESHOLD
      ) {
        cancel();
      }
    },
    { passive: true }
  );

  el.addEventListener('touchend', cancel);
  el.addEventListener('touchcancel', cancel);

  // If the long-press did fire, swallow the click event that touchend
  // would otherwise synthesize afterward.
  el.addEventListener(
    'click',
    (e) => {
      if (firedForThisTouch) {
        firedForThisTouch = false;
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true
  );
}

function sortItems(items: DriveItem[]): DriveItem[] {
  const sorted = [...items].sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'name') cmp = a.name.localeCompare(b.name);
    else if (sortKey === 'modified')
      cmp = new Date(a.modified).getTime() - new Date(b.modified).getTime();
    else cmp = a.size - b.size;
    return sortDir === 'asc' ? cmp : -cmp;
  });
  sorted.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return 0;
  });
  return sorted;
}

function renderGrid(): void {
  const grid = document.getElementById('grid')!;
  const emptyState = document.getElementById('empty-state')!;
  const searchInput = document.getElementById('search-input') as HTMLInputElement;
  const search = searchInput.value.trim().toLowerCase();
  const filtered = search
    ? currentItems.filter((i) => i.name.toLowerCase().includes(search))
    : currentItems;
  const items = sortItems(filtered);

  grid.innerHTML = '';
  emptyState.hidden = items.length > 0 || search.length > 0;

  items.forEach((item) => {
    const itemPath = joinPath(currentPath, item.name);
    const isSelected = selected.has(itemPath);

    const card = document.createElement('div');
    card.className = `card${isSelected ? ' card-selected' : ''}`;
    card.dataset.type = item.type;
    card.innerHTML = `
      <button class="card-select" type="button" aria-label="${isSelected ? 'Deselect' : 'Select'}">${icons.check}</button>
      <div class="card-icon card-icon-${item.type}">${iconFor(item.name, item.type)}</div>
      <div class="card-body">
        <div class="card-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
        <div class="card-meta">${
          item.type === 'file' ? `${formatBytes(item.size)} · ` : ''
        }${formatDate(item.modified)}</div>
      </div>
      <button class="card-menu-btn" type="button" aria-label="More actions">${icons.moreVertical}</button>
    `;

    card.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('.card-menu-btn')) return;

      // Explicit checkbox = toggle selection.
      if (target.closest('.card-select')) {
        if (selected.has(itemPath)) selected.delete(itemPath);
        else selected.add(itemPath);
        renderToolbar();
        renderGrid();
        return;
      }

      // Ctrl/Cmd click = multi-select (desktop convention).
      if (e.ctrlKey || e.metaKey) {
        if (selected.has(itemPath)) selected.delete(itemPath);
        else selected.add(itemPath);
        renderToolbar();
        renderGrid();
        return;
      }

      // If any items are already selected, treat plain click as add-to-selection
      // (so mobile users can build up a selection without holding Ctrl).
      if (selected.size > 0) {
        if (selected.has(itemPath)) selected.delete(itemPath);
        else selected.add(itemPath);
        renderToolbar();
        renderGrid();
        return;
      }

      // Otherwise: open.
      openItem(item);
    });

    card.addEventListener('dblclick', () => openItem(item));

    const menuBtn = card.querySelector<HTMLButtonElement>('.card-menu-btn')!;
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openItemMenu(menuBtn, item);
    });

    // Long-press on touch devices opens the action sheet (Android convention).
    // Also cancels the pending click so the item doesn't open+action-sheet.
    attachLongPress(card, () => openItemMenu(card, item));

    grid.appendChild(card);
  });
}

document.getElementById('drop-zone')!.addEventListener('click', (e) => {
  if (!(e.target as HTMLElement).closest('.card')) {
    if (selected.size > 0) {
      selected.clear();
      renderToolbar();
      renderGrid();
    }
  }
});

function openItem(item: DriveItem): void {
  const itemPath = joinPath(currentPath, item.name);
  if (item.type === 'folder') {
    loadFolder(itemPath);
    return;
  }
  if (isImage(item.name)) {
    const images = currentItems.filter((i) => i.type === 'file' && isImage(i.name));
    const index = images.findIndex((i) => i.name === item.name);
    openImageViewer(images, Math.max(0, index));
    return;
  }
  window.open(downloadUrl(itemPath), '_blank');
}

// ============================================================
// Image viewer (in-app lightbox with swipe / keyboard nav)
// ============================================================

let imageViewerCleanup: (() => void) | null = null;

function openImageViewer(images: DriveItem[], startIndex: number): void {
  if (imageViewerCleanup) imageViewerCleanup();
  if (images.length === 0) return;

  let index = startIndex;

  const overlay = document.createElement('div');
  overlay.className = 'viewer-overlay';
  overlay.innerHTML = `
    <header class="viewer-header">
      <div class="viewer-title" id="viewer-title"></div>
      <div class="viewer-actions">
        <span class="viewer-counter" id="viewer-counter"></span>
        <a class="btn btn-icon btn-ghost viewer-btn" id="viewer-download" href="#" target="_blank" rel="noopener" aria-label="Download">${icons.download}</a>
        <button class="btn btn-icon btn-ghost viewer-btn" id="viewer-close" type="button" aria-label="Close">${icons.close}</button>
      </div>
    </header>
    <button class="viewer-nav viewer-prev" id="viewer-prev" type="button" aria-label="Previous">${icons.chevronLeft}</button>
    <div class="viewer-stage" id="viewer-stage">
      <div class="viewer-spinner"><div class="spinner"></div></div>
      <img class="viewer-image" id="viewer-image" alt="" />
    </div>
    <button class="viewer-nav viewer-next" id="viewer-next" type="button" aria-label="Next">${icons.chevronRight}</button>
  `;
  document.body.appendChild(overlay);
  document.body.classList.add('no-scroll');

  const img = overlay.querySelector<HTMLImageElement>('#viewer-image')!;
  const spinner = overlay.querySelector<HTMLDivElement>('.viewer-spinner')!;
  const title = overlay.querySelector<HTMLDivElement>('#viewer-title')!;
  const counter = overlay.querySelector<HTMLSpanElement>('#viewer-counter')!;
  const dl = overlay.querySelector<HTMLAnchorElement>('#viewer-download')!;
  const prev = overlay.querySelector<HTMLButtonElement>('#viewer-prev')!;
  const next = overlay.querySelector<HTMLButtonElement>('#viewer-next')!;

  function show(newIndex: number): void {
    index = ((newIndex % images.length) + images.length) % images.length;
    const item = images[index];
    const itemPath = joinPath(currentPath, item.name);
    img.classList.remove('loaded');
    spinner.hidden = false;
    img.src = downloadUrl(itemPath);
    img.alt = item.name;
    title.textContent = item.name;
    counter.textContent = images.length > 1 ? `${index + 1} / ${images.length}` : '';
    dl.href = downloadUrl(itemPath);
    dl.setAttribute('download', item.name);
    prev.disabled = images.length < 2;
    next.disabled = images.length < 2;
  }

  img.addEventListener('load', () => {
    spinner.hidden = true;
    img.classList.add('loaded');
  });
  img.addEventListener('error', () => {
    spinner.hidden = true;
  });

  const close = (): void => {
    if (!imageViewerCleanup) return;
    imageViewerCleanup();
  };

  prev.addEventListener('click', (e) => {
    e.stopPropagation();
    show(index - 1);
  });
  next.addEventListener('click', (e) => {
    e.stopPropagation();
    show(index + 1);
  });
  overlay.querySelector('#viewer-close')!.addEventListener('click', close);

  // Click on empty backdrop area = close. Ignore clicks on the image itself
  // (so the user can select/interact) and on the controls.
  overlay.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (
      target === overlay ||
      target.classList.contains('viewer-stage') ||
      target.classList.contains('viewer-header')
    ) {
      close();
    }
  });

  // Keyboard navigation
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft' && images.length > 1) show(index - 1);
    else if (e.key === 'ArrowRight' && images.length > 1) show(index + 1);
  };
  document.addEventListener('keydown', onKey);

  // Touch swipe navigation
  let touchStartX = 0;
  let touchStartY = 0;
  let swiping = false;
  const stage = overlay.querySelector<HTMLDivElement>('#viewer-stage')!;
  stage.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    swiping = true;
  }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    if (!swiping) return;
    swiping = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartX;
    const dy = t.clientY - touchStartY;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
      if (dx > 0) show(index - 1);
      else show(index + 1);
    } else if (dy < -80 && Math.abs(dy) > Math.abs(dx)) {
      close();
    }
  }, { passive: true });

  imageViewerCleanup = () => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    document.body.classList.remove('no-scroll');
    imageViewerCleanup = null;
  };

  show(index);
}

// ============================================================
// Item context menu (three-dots on each card)
// ============================================================

let openItemMenuEl: HTMLElement | null = null;
let itemMenuCloseListeners: (() => void) | null = null;

function closeItemMenu(): void {
  if (openItemMenuEl) {
    openItemMenuEl.remove();
    openItemMenuEl = null;
  }
  if (itemMenuCloseListeners) {
    itemMenuCloseListeners();
    itemMenuCloseListeners = null;
  }
  document.body.classList.remove('sheet-open');
}

function openItemMenu(anchor: HTMLElement, item: DriveItem): void {
  closeItemMenu();

  const menu = document.createElement('div');
  menu.className = 'dropdown-menu floating-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = `
    ${
      item.type === 'file'
        ? `<button role="menuitem" type="button" data-action="download">${icons.download}<span>Download</span></button>`
        : ''
    }
    <button role="menuitem" type="button" data-action="rename">${icons.pencil}<span>Rename</span></button>
    <div class="dropdown-separator"></div>
    <button role="menuitem" type="button" data-action="delete" class="menu-item-danger">${icons.trash}<span>Delete</span></button>
  `;
  document.body.appendChild(menu);
  openItemMenuEl = menu;

  const isMobile = window.matchMedia('(max-width: 640px)').matches;
  if (isMobile) {
    // Mobile: menu is a bottom sheet (CSS handles the layout); we just add
    // the scrim + prevent the inline positioning below.
    document.body.classList.add('sheet-open');
  } else {
    // Desktop: position anchored below the trigger, clamped to the viewport.
    const rect = anchor.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    let top = rect.bottom + 6;
    let left = rect.right - menuRect.width;
    if (left < 8) left = 8;
    if (top + menuRect.height > window.innerHeight - 8) {
      top = rect.top - menuRect.height - 6;
    }
    menu.style.top = `${top + window.scrollY}px`;
    menu.style.left = `${left + window.scrollX}px`;
  }

  const itemPath = joinPath(currentPath, item.name);

  menu.addEventListener('click', async (e) => {
    const action = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
    closeItemMenu();
    if (action === 'download') {
      window.open(downloadUrl(itemPath), '_blank');
    } else if (action === 'rename') {
      handleRename(itemPath, item.name);
    } else if (action === 'delete') {
      const confirmed = await openConfirmModal(
        'Delete item?',
        `This will permanently delete "${item.name}". This action cannot be undone.`
      );
      if (!confirmed) return;
      try {
        await deleteItem(itemPath);
        showToast('Deleted');
        loadFolder(currentPath);
        refreshStats();
      } catch (err) {
        showToast((err as Error).message, 'error');
      }
    }
  });

  const onOutside = (ev: MouseEvent) => {
    const target = ev.target as Node;
    if (!menu.contains(target) && !anchor.contains(target)) closeItemMenu();
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') closeItemMenu();
  };
  setTimeout(() => {
    document.addEventListener('click', onOutside, true);
    document.addEventListener('keydown', onKey);
  }, 0);
  itemMenuCloseListeners = () => {
    document.removeEventListener('click', onOutside, true);
    document.removeEventListener('keydown', onKey);
  };
}

async function handleRename(itemPath: string, currentName: string): Promise<void> {
  const newName = await openPromptModal({
    title: 'Rename',
    label: 'Name',
    defaultValue: currentName,
    confirmLabel: 'Rename',
  });
  if (!newName || newName === currentName) return;
  try {
    await renameItem(itemPath, newName);
    showToast('Renamed');
    loadFolder(currentPath);
  } catch (err) {
    showToast((err as Error).message, 'error');
  }
}

// ============================================================
// Modals
// ============================================================

interface PromptOptions {
  title: string;
  label?: string;
  defaultValue?: string;
  confirmLabel?: string;
}

function openPromptModal(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root')!;
    root.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal">
          <div class="modal-header">
            <h2 class="modal-title">${escapeHtml(opts.title)}</h2>
          </div>
          <div class="modal-body">
            ${opts.label ? `<label class="modal-label">${escapeHtml(opts.label)}</label>` : ''}
            <input class="input modal-input" type="text" value="${escapeHtml(opts.defaultValue ?? '')}" />
          </div>
          <div class="modal-footer">
            <button class="btn btn-outline" type="button" data-action="cancel">Cancel</button>
            <button class="btn btn-primary" type="button" data-action="confirm">${escapeHtml(
              opts.confirmLabel ?? 'Confirm'
            )}</button>
          </div>
        </div>
      </div>
    `;

    const backdrop = root.querySelector('.modal-backdrop')!;
    const input = root.querySelector<HTMLInputElement>('.modal-input')!;
    input.focus();
    input.select();

    const close = (value: string | null): void => {
      root.innerHTML = '';
      resolve(value);
    };

    root.querySelector('[data-action="cancel"]')!.addEventListener('click', () => close(null));
    root
      .querySelector('[data-action="confirm"]')!
      .addEventListener('click', () => close(input.value.trim()));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') close(input.value.trim());
      if (e.key === 'Escape') close(null);
    });
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close(null);
    });
  });
}

function openConfirmModal(title: string, message: string, confirmLabel = 'Delete'): Promise<boolean> {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root')!;
    root.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal">
          <div class="modal-header">
            <h2 class="modal-title">${escapeHtml(title)}</h2>
          </div>
          <div class="modal-body">
            <p class="modal-message">${escapeHtml(message)}</p>
          </div>
          <div class="modal-footer">
            <button class="btn btn-outline" type="button" data-action="cancel">Cancel</button>
            <button class="btn btn-destructive" type="button" data-action="confirm">${escapeHtml(
              confirmLabel
            )}</button>
          </div>
        </div>
      </div>
    `;

    const backdrop = root.querySelector('.modal-backdrop')!;

    const close = (value: boolean): void => {
      root.innerHTML = '';
      resolve(value);
    };

    root.querySelector('[data-action="cancel"]')!.addEventListener('click', () => close(false));
    root.querySelector('[data-action="confirm"]')!.addEventListener('click', () => close(true));
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close(false);
    });
  });
}

// ============================================================
// Toasts
// ============================================================

function showToast(message: string, type: 'info' | 'error' = 'info'): void {
  const container = document.getElementById('toast-container')!;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 200);
  }, 3000);
}

// ============================================================
// Uploads
// ============================================================

// Recursively walk a directory entry from a drag-and-drop DataTransfer,
// collecting every file with its relative path (e.g. "photos/vacation/img.jpg").
// Uses the legacy but broadly-supported `webkitGetAsEntry` API.
function readEntry(entry: FileSystemEntry, pathPrefix: string): Promise<UploadEntry[]> {
  if (entry.isFile) {
    return new Promise((resolve, reject) => {
      (entry as FileSystemFileEntry).file(
        (file) => resolve([{ file, relativePath: pathPrefix + file.name }]),
        reject
      );
    });
  }

  const dirReader = (entry as FileSystemDirectoryEntry).createReader();
  const childPrefix = pathPrefix + entry.name + '/';

  // `readEntries` may return the children in multiple batches — call until empty.
  const readAllEntries = (): Promise<FileSystemEntry[]> =>
    new Promise((resolve, reject) => {
      const all: FileSystemEntry[] = [];
      const readBatch = (): void => {
        dirReader.readEntries((batch) => {
          if (batch.length === 0) resolve(all);
          else {
            all.push(...batch);
            readBatch();
          }
        }, reject);
      };
      readBatch();
    });

  return readAllEntries()
    .then((children) => Promise.all(children.map((c) => readEntry(c, childPrefix))))
    .then((results) => results.flat());
}

async function collectFromDataTransfer(dt: DataTransfer): Promise<UploadEntry[]> {
  const items = Array.from(dt.items).filter((i) => i.kind === 'file');
  if (items.length === 0) return [];

  // Only walk the entry tree when we actually have folders to descend into.
  // For flat multi-file drops, `dt.files` is faster and doesn't need the async
  // reader gymnastics.
  const entries = items
    .map((item) => (item.webkitGetAsEntry ? item.webkitGetAsEntry() : null))
    .filter((e): e is FileSystemEntry => e !== null);

  const hasDirectory = entries.some((e) => e.isDirectory);
  if (!hasDirectory) {
    return Array.from(dt.files).map((file) => ({ file, relativePath: file.name }));
  }

  const nested = await Promise.all(entries.map((e) => readEntry(e, '')));
  return nested.flat();
}

// Files picked via <input webkitdirectory> come with a `webkitRelativePath`
// like "myFolder/sub/pic.jpg" — perfect as-is.
function entriesFromInputFolder(files: FileList): UploadEntry[] {
  return Array.from(files).map((file) => ({
    file,
    relativePath: file.webkitRelativePath || file.name,
  }));
}

function entriesFromInputFiles(files: FileList): UploadEntry[] {
  return Array.from(files).map((file) => ({ file, relativePath: file.name }));
}

async function handleUpload(entries: UploadEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const totalBytes = entries.reduce((sum, e) => sum + e.file.size, 0);
  const startedAt = performance.now();

  const el = document.getElementById('upload-progress')!;
  el.hidden = false;
  document.body.classList.add('uploading');
  el.innerHTML = `
    <div class="upload-progress-header">
      <div class="upload-progress-title" id="upload-progress-title"></div>
      <button class="btn btn-icon btn-ghost upload-progress-cancel" id="upload-progress-cancel" type="button" aria-label="Cancel upload">${icons.close}</button>
    </div>
    <div class="upload-progress-bar"><div class="upload-progress-fill" id="upload-progress-fill"></div></div>
    <div class="upload-progress-meta">
      <span id="upload-progress-bytes"></span>
      <span id="upload-progress-percent">0%</span>
    </div>
  `;

  const titleEl = el.querySelector<HTMLDivElement>('#upload-progress-title')!;
  const fillEl = el.querySelector<HTMLDivElement>('#upload-progress-fill')!;
  const bytesEl = el.querySelector<HTMLSpanElement>('#upload-progress-bytes')!;
  const percentEl = el.querySelector<HTMLSpanElement>('#upload-progress-percent')!;
  const cancelBtn = el.querySelector<HTMLButtonElement>('#upload-progress-cancel')!;

  const label =
    entries.length === 1
      ? entries[0].file.name
      : `Uploading ${entries.length} file${entries.length > 1 ? 's' : ''}`;
  titleEl.textContent = label;
  bytesEl.textContent = `0 B of ${formatBytes(totalBytes)}`;

  const handle = uploadFiles(currentPath, entries, ({ loaded, total, fraction }) => {
    const knownTotal = total || totalBytes;
    const pct = Math.min(100, Math.round(fraction * 100));
    fillEl.style.width = `${pct}%`;
    percentEl.textContent = `${pct}%`;

    const elapsedSec = Math.max(0.1, (performance.now() - startedAt) / 1000);
    const bytesPerSec = loaded / elapsedSec;
    const speed = bytesPerSec > 0 ? `${formatBytes(bytesPerSec)}/s` : '';
    bytesEl.textContent = speed
      ? `${formatBytes(loaded)} of ${formatBytes(knownTotal)} · ${speed}`
      : `${formatBytes(loaded)} of ${formatBytes(knownTotal)}`;
  });

  cancelBtn.addEventListener('click', () => handle.abort());

  try {
    await handle.promise;
    fillEl.style.width = '100%';
    percentEl.textContent = '100%';
    titleEl.textContent = 'Upload complete';
    bytesEl.textContent = formatBytes(totalBytes);
    cancelBtn.hidden = true;
    // Give the user a moment to see the completed state, then hide.
    setTimeout(() => {
      el.hidden = true;
      document.body.classList.remove('uploading');
    }, 1500);
    showToast('Upload complete');
    loadFolder(currentPath);
    refreshStats();
  } catch (err) {
    el.hidden = true;
    document.body.classList.remove('uploading');
    showToast((err as Error).message, 'error');
  }
}

// ============================================================
// Wire up: New button + upload input
// ============================================================

const newBtn = document.getElementById('new-btn')!;
const newMenu = document.getElementById('new-menu')!;
const fabBtn = document.getElementById('fab-new')!;
// Both the sidebar "New" button (desktop) and the mobile FAB trigger the same
// menu. On mobile the menu is styled as a bottom sheet via CSS.
createDropdown([newBtn, fabBtn], newMenu);

const fileInput = document.getElementById('file-input') as HTMLInputElement;
const folderInput = document.getElementById('folder-input') as HTMLInputElement;

newMenu.querySelector('[data-action="new-folder"]')!.addEventListener('click', async () => {
  const name = await openPromptModal({
    title: 'New folder',
    label: 'Folder name',
    defaultValue: 'Untitled folder',
    confirmLabel: 'Create',
  });
  if (!name) return;
  try {
    await createFolder(currentPath, name);
    showToast('Folder created');
    loadFolder(currentPath);
  } catch (err) {
    showToast((err as Error).message, 'error');
  }
});

newMenu.querySelector('[data-action="upload-files"]')!.addEventListener('click', () => {
  fileInput.click();
});

newMenu.querySelector('[data-action="upload-folder"]')!.addEventListener('click', () => {
  folderInput.click();
});

fileInput.addEventListener('change', () => {
  if (fileInput.files) handleUpload(entriesFromInputFiles(fileInput.files));
  fileInput.value = '';
});

folderInput.addEventListener('change', () => {
  if (folderInput.files) handleUpload(entriesFromInputFolder(folderInput.files));
  folderInput.value = '';
});

document.getElementById('search-input')!.addEventListener('input', () => renderGrid());

// ============================================================
// Mobile sidebar drawer
// ============================================================

const sidebar = document.getElementById('sidebar')!;
const sidebarBackdrop = document.getElementById('sidebar-backdrop')!;

function openSidebar(): void {
  sidebar.classList.add('sidebar-open');
  sidebarBackdrop.hidden = false;
}
function closeSidebar(): void {
  sidebar.classList.remove('sidebar-open');
  sidebarBackdrop.hidden = true;
}
function closeSidebarOnMobile(): void {
  if (window.matchMedia('(max-width: 900px)').matches) closeSidebar();
}

document.getElementById('mobile-menu-btn')!.addEventListener('click', openSidebar);
sidebarBackdrop.addEventListener('click', closeSidebar);

// ============================================================
// Drag & drop upload
// ============================================================

const dropZone = document.getElementById('drop-zone')!;
const dragOverlay = document.getElementById('drag-overlay') as HTMLElement;
let dragCounter = 0;

// Only react to drags that carry actual files (not text, links, in-page drags, etc.)
function isFileDrag(e: DragEvent): boolean {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
}

function hideDragOverlay(): void {
  dragCounter = 0;
  dragOverlay.hidden = true;
}

// Block the browser's default behavior of opening dropped files as navigation.
// This has to be on window, because `drop-zone` doesn't cover the whole app
// (sidebar/topbar wouldn't be caught otherwise).
window.addEventListener('dragover', (e) => {
  if (isFileDrag(e)) e.preventDefault();
});

window.addEventListener('dragenter', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragCounter++;
  dragOverlay.hidden = false;
});

window.addEventListener('dragleave', (e) => {
  if (!isFileDrag(e)) return;
  // `relatedTarget === null` means the cursor left the browser viewport.
  // In that case, force-hide regardless of the counter to avoid a stuck overlay.
  if (e.relatedTarget === null) {
    hideDragOverlay();
    return;
  }
  dragCounter--;
  if (dragCounter <= 0) hideDragOverlay();
});

window.addEventListener('drop', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  hideDragOverlay();
  // Only actually upload if the drop landed inside the content area.
  if (dropZone.contains(e.target as Node) && e.dataTransfer) {
    const dt = e.dataTransfer;
    collectFromDataTransfer(dt)
      .then((entries) => handleUpload(entries))
      .catch((err) => showToast((err as Error).message, 'error'));
  }
});

// Belt-and-suspenders: reset if the drag is cancelled (Esc) or ends anywhere.
window.addEventListener('dragend', hideDragOverlay);

loadFolder('');
refreshStats();

// ============================================================
// PWA service worker registration
// ============================================================

// Only register in production. During `vite dev` the service worker would
// happily cache dev bundles and break HMR / cause stale reloads.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Registration failing (e.g. served over http on a non-localhost host)
      // is not fatal — the app still works, just without offline support.
    });
  });
}
