export interface DriveItem {
  name: string;
  type: 'file' | 'folder';
  size: number;
  modified: string;
}

export interface ListResponse {
  path: string;
  items: DriveItem[];
}

export interface DriveStats {
  used: number;
  total: number | null;
  free: number | null;
}
