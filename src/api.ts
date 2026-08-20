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

export function uploadFiles(path: string, files: FileList | File[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    Array.from(files).forEach((file) => formData.append('files', file));

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}/upload?path=${encodeURIComponent(path)}`);
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
    xhr.send(formData);
  });
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
