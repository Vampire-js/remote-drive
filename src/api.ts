import type { ListResponse, DriveStats } from './types';

const BASE = '/api';

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = await res.json();
      message = data.error || message;
    } catch {
      // response had no JSON body; keep the status text
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export function listItems(path: string): Promise<ListResponse> {
  return fetch(`${BASE}/items?path=${encodeURIComponent(path)}`).then((res) => handle<ListResponse>(res));
}

export function createFolder(path: string, name: string): Promise<void> {
  return fetch(`${BASE}/folders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, name }),
  }).then((res) => handle<void>(res));
}

export interface UploadEntry {
  file: File;
  /**
   * Relative path (forward-slash separated) under the target folder, including
   * the file's own name. For flat file uploads this is just the file name;
   * for folder uploads it preserves the nested structure, e.g. "sub/dir/pic.jpg".
   */
  relativePath: string;
}

export interface UploadProgress {
  /** Bytes transferred so far. */
  loaded: number;
  /** Total bytes to transfer, if known. */
  total: number;
  /** Fraction 0..1, or 0 if total is unknown. */
  fraction: number;
}

export interface UploadHandle {
  promise: Promise<void>;
  abort(): void;
}

export function uploadFiles(
  path: string,
  entries: UploadEntry[],
  onProgress?: (p: UploadProgress) => void
): UploadHandle {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<void>((resolve, reject) => {
    const formData = new FormData();
    entries.forEach(({ file, relativePath }) => {
      // The 3rd arg to FormData.append becomes the file's `originalname` on the
      // server. We URL-encode the relative path so path separators survive the
      // multipart encoder — some browsers strip everything before the last `/`
      // in a filename, which would flatten folder uploads. The backend decodes
      // it back to the original.
      formData.append('files', file, encodeURIComponent(relativePath));
    });

    xhr.open('POST', `${BASE}/upload?path=${encodeURIComponent(path)}`);

    if (onProgress) {
      xhr.upload.addEventListener('progress', (ev) => {
        const total = ev.lengthComputable ? ev.total : 0;
        onProgress({
          loaded: ev.loaded,
          total,
          fraction: total > 0 ? ev.loaded / total : 0,
        });
      });
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        let message = xhr.statusText;
        try {
          message = JSON.parse(xhr.responseText).error || message;
        } catch {
          // ignore malformed error body
        }
        reject(new Error(message));
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.onabort = () => reject(new Error('Upload cancelled'));
    xhr.send(formData);
  });

  return { promise, abort: () => xhr.abort() };
}

export function deleteItem(path: string): Promise<void> {
  return fetch(`${BASE}/items?path=${encodeURIComponent(path)}`, {
    method: 'DELETE',
  }).then((res) => handle<void>(res));
}

export function renameItem(path: string, newName: string): Promise<void> {
  return fetch(`${BASE}/items`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, newName }),
  }).then((res) => handle<void>(res));
}

export function downloadUrl(path: string): string {
  return `${BASE}/download?path=${encodeURIComponent(path)}`;
}

export function getStats(): Promise<DriveStats> {
  return fetch(`${BASE}/stats`).then((res) => handle<DriveStats>(res));
}
