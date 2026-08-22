export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// Lucide-style monochrome icon set. All icons inherit `currentColor` so they
// adapt to the surrounding text color, matching shadcn/ui's approach.
const svg = (
  paths: string,
  { size = 16, strokeWidth = 2 }: { size?: number; strokeWidth?: number } = {}
): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const icons = {
  plus: svg(`<path d="M5 12h14"/><path d="M12 5v14"/>`),
  upload: svg(`<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>`),
  folderPlus: svg(`<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>`),
  download: svg(`<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>`),
  pencil: svg(`<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/>`),
  trash: svg(`<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>`),
  close: svg(`<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`, { size: 18 }),
  sun: svg(`<circle cx="12" cy="12" r="4"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>`, { size: 18 }),
  moon: svg(`<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>`, { size: 18 }),
  menu: svg(`<line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>`, { size: 18 }),
  sort: svg(`<path d="M3 6h13"/><path d="M3 12h9"/><path d="M3 18h5"/><path d="m17 20 4-4-4-4"/><path d="M21 16H8"/>`),
  check: svg(`<polyline points="20 6 9 17 4 12"/>`, { size: 12, strokeWidth: 3 }),
  chevronDown: svg(`<polyline points="6 9 12 15 18 9"/>`, { size: 14 }),
  chevronLeft: svg(`<polyline points="15 18 9 12 15 6"/>`, { size: 24, strokeWidth: 2 }),
  chevronRight: svg(`<polyline points="9 18 15 12 9 6"/>`, { size: 24, strokeWidth: 2 }),
  arrowUp: svg(`<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>`, { size: 14, strokeWidth: 2.25 }),
  arrowDown: svg(`<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>`, { size: 14, strokeWidth: 2.25 }),
  search: svg(`<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>`, { size: 16 }),
  cloud: svg(`<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>`, { size: 18 }),
  hardDrive: svg(`<line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/>`, { size: 18 }),
  moreVertical: svg(`<circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>`, { size: 18 }),
  folder: svg(`<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>`, { size: 40, strokeWidth: 1.5 }),
  fileGeneric: svg(`<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><polyline points="14 2 14 8 20 8"/>`, { size: 40, strokeWidth: 1.5 }),
  fileImage: svg(`<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><polyline points="14 2 14 8 20 8"/><circle cx="10" cy="13" r="1.5"/><path d="m20 17-3.5-3.5-6 6"/>`, { size: 40, strokeWidth: 1.5 }),
  fileVideo: svg(`<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><polyline points="14 2 14 8 20 8"/><path d="m10 11 5 3-5 3v-6Z"/>`, { size: 40, strokeWidth: 1.5 }),
  fileAudio: svg(`<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><polyline points="14 2 14 8 20 8"/><path d="M8 18v-5"/><path d="M12 18v-3"/><path d="M16 18v-7"/>`, { size: 40, strokeWidth: 1.5 }),
  fileArchive: svg(`<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><polyline points="14 2 14 8 20 8"/><path d="M10 12h.01"/><path d="M10 15h.01"/><path d="M10 18h.01"/>`, { size: 40, strokeWidth: 1.5 }),
  fileCode: svg(`<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><polyline points="14 2 14 8 20 8"/><path d="m9 18-2-2 2-2"/><path d="m14 14 2 2-2 2"/>`, { size: 40, strokeWidth: 1.5 }),
  fileText: svg(`<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/>`, { size: 40, strokeWidth: 1.5 }),
};

const EXT_TO_CATEGORY: Record<string, keyof typeof icons> = {
  png: 'fileImage', jpg: 'fileImage', jpeg: 'fileImage', gif: 'fileImage',
  svg: 'fileImage', webp: 'fileImage', bmp: 'fileImage',
  mp4: 'fileVideo', mov: 'fileVideo', mkv: 'fileVideo', avi: 'fileVideo', webm: 'fileVideo',
  mp3: 'fileAudio', wav: 'fileAudio', flac: 'fileAudio', ogg: 'fileAudio',
  zip: 'fileArchive', rar: 'fileArchive', '7z': 'fileArchive', tar: 'fileArchive', gz: 'fileArchive',
  js: 'fileCode', ts: 'fileCode', jsx: 'fileCode', tsx: 'fileCode', json: 'fileCode',
  html: 'fileCode', css: 'fileCode', py: 'fileCode', go: 'fileCode', rs: 'fileCode', java: 'fileCode',
  txt: 'fileText', md: 'fileText', pdf: 'fileText', doc: 'fileText', docx: 'fileText',
  xls: 'fileText', xlsx: 'fileText', csv: 'fileText', ppt: 'fileText', pptx: 'fileText',
};

export function iconFor(name: string, type: 'file' | 'folder'): string {
  if (type === 'folder') return icons.folder;
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const key = EXT_TO_CATEGORY[ext] ?? 'fileGeneric';
  return icons[key];
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'mkv', 'm4v', 'ogv']);

export function isImage(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTS.has(ext);
}

export function isVideo(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return VIDEO_EXTS.has(ext);
}

export function isMedia(name: string): boolean {
  return isImage(name) || isVideo(name);
}

export function isPdf(name: string): boolean {
  return name.split('.').pop()?.toLowerCase() === 'pdf';
}

export function joinPath(base: string, segment: string): string {
  return base ? `${base}/${segment}` : segment;
}

export function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
