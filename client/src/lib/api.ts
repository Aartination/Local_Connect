import type { FileItem } from '../types';
import { captureVideoThumbnail } from './format';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json().catch(() => ({})) : {};
  if (!res.ok) {
    throw new ApiError(res.status, data.error || `Request failed (${res.status})`, data.code);
  }
  return data as T;
}

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.body && typeof init.body === 'string' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: 'include',
    headers,
  });
  return handleResponse<T>(res);
}

export const post = <T = any>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined });

export const patch = <T = any>(path: string, body?: unknown) =>
  api<T>(path, { method: 'PATCH', body: body !== undefined ? JSON.stringify(body) : undefined });

export const del = <T = any>(path: string) => api<T>(path, { method: 'DELETE' });

export interface UploadOptions {
  scope?: 'CHAT' | 'WORKSPACE';
  folder?: string;
  description?: string;
  audioHint?: boolean;
  duration?: number;
  waveform?: number[];
  onProgress?: (pct: number, loaded: number, total: number) => void;
  signal?: AbortSignal;
}

const CHUNK_THRESHOLD = 8 * 1024 * 1024; // 8 MB -> use resumable chunked uploads
const CHUNK_SIZE = 2 * 1024 * 1024;

/** Uploads a File or Blob with real progress reporting and automatic chunking for large files. */
export async function uploadFile(file: File | Blob, name: string, opts: UploadOptions = {}): Promise<FileItem> {
  let uploaded: FileItem;

  if (file.size > CHUNK_THRESHOLD) {
    uploaded = await uploadChunked(file, name, opts);
  } else {
    uploaded = await uploadSingle(file, name, opts);
  }

  // If it's a video, try generating and attaching a thumbnail asynchronously
  if (file instanceof File && uploaded.category === 'VIDEO' && !uploaded.thumbUrl) {
    captureVideoThumbnail(file)
      .then(async (thumb) => {
        if (!thumb) return;
        await fetch(`/api/files/${uploaded.id}/thumbnail`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'image/jpeg',
            'x-media-duration': String(thumb.duration),
          },
          body: thumb.blob,
        }).catch(() => {});
      })
      .catch(() => {});
  }

  return uploaded;
}

function uploadSingle(file: Blob, name: string, opts: UploadOptions): Promise<FileItem> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/files/upload');
    xhr.withCredentials = true;
    xhr.setRequestHeader('x-file-name', encodeURIComponent(name));
    xhr.setRequestHeader('x-file-scope', opts.scope || 'CHAT');
    if (opts.folder) xhr.setRequestHeader('x-file-folder', opts.folder);
    if (opts.description) xhr.setRequestHeader('x-file-description', opts.description);
    if (opts.audioHint) xhr.setRequestHeader('x-audio-hint', '1');
    if (opts.duration !== undefined) xhr.setRequestHeader('x-media-duration', String(opts.duration));
    if (opts.waveform) xhr.setRequestHeader('x-audio-waveform', JSON.stringify(opts.waveform));

    const onAbort = () => xhr.abort();
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && opts.onProgress) {
        opts.onProgress(Math.round((ev.loaded / ev.total) * 100), ev.loaded, ev.total);
      }
    };
    xhr.onload = () => {
      opts.signal?.removeEventListener('abort', onAbort);
      try {
        const json = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 200 && xhr.status < 300) {
          opts.onProgress?.(100, file.size, file.size);
          resolve(json.file as FileItem);
        } else {
          reject(new ApiError(xhr.status, json.error || `Upload failed (${xhr.status})`, json.code));
        }
      } catch {
        reject(new ApiError(xhr.status, `Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => {
      opts.signal?.removeEventListener('abort', onAbort);
      reject(new ApiError(0, 'Network error while uploading file.'));
    };
    xhr.onabort = () => reject(new ApiError(0, 'Upload cancelled.'));
    xhr.send(file);
  });
}

async function uploadChunked(file: Blob, name: string, opts: UploadOptions): Promise<FileItem> {
  const purpose = opts.audioHint ? 'VOICE' : opts.scope === 'WORKSPACE' ? 'WORKSPACE' : 'CHAT';
  const init = await post<{ uploadId: string; received: number }>('/files/uploads/init', {
    name,
    size: file.size,
    purpose,
    folder: opts.folder,
    description: opts.description,
    duration: opts.duration,
    waveform: opts.waveform,
  });

  let offset = init.received;
  try {
    while (offset < file.size) {
      if (opts.signal?.aborted) throw new ApiError(0, 'Upload cancelled.');
      const end = Math.min(file.size, offset + CHUNK_SIZE);
      const slice = file.slice(offset, end);

      let attempts = 0;
      while (true) {
        attempts++;
        try {
          const res = await fetch(`/api/files/uploads/${init.uploadId}`, {
            method: 'PATCH',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/octet-stream',
              'x-upload-offset': String(offset),
            },
            body: slice,
            signal: opts.signal,
          });
          if (res.status === 409) {
            const body = await res.json();
            offset = body.received;
            break;
          }
          const data = await handleResponse<{ received: number }>(res);
          offset = data.received;
          opts.onProgress?.(Math.round((offset / file.size) * 100), offset, file.size);
          break;
        } catch (err: any) {
          if (opts.signal?.aborted || attempts >= 3 || (err instanceof ApiError && err.status >= 400 && err.status < 500)) {
            throw err;
          }
          await new Promise((r) => setTimeout(r, 800 * attempts));
          const status = await api<{ received: number }>(`/files/uploads/${init.uploadId}`).catch(() => null);
          if (status) offset = status.received;
        }
      }
    }

    const done = await post<{ file: FileItem }>(`/files/uploads/${init.uploadId}/complete`);
    opts.onProgress?.(100, file.size, file.size);
    return done.file;
  } catch (err) {
    del(`/files/uploads/${init.uploadId}`).catch(() => {});
    throw err;
  }
}

/** Downloads a file while reporting exact download progress. */
export async function downloadWithProgress(
  url: string,
  filename: string,
  onProgress?: (pct: number, loaded: number, total: number) => void,
) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new ApiError(res.status, 'Could not download file.');
  const total = Number(res.headers.get('content-length') || 0);
  const reader = res.body?.getReader();
  if (!reader) {
    const blob = await res.blob();
    triggerSave(blob, filename);
    onProgress?.(100, blob.size, blob.size);
    return;
  }
  const chunks: BlobPart[] = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.byteLength;
      if (total > 0) onProgress?.(Math.round((loaded / total) * 100), loaded, total);
    }
  }
  onProgress?.(100, loaded, total || loaded);
  const blob = new Blob(chunks, { type: res.headers.get('content-type') || 'application/octet-stream' });
  triggerSave(blob, filename);
}

function triggerSave(blob: Blob, filename: string) {
  const a = document.createElement('a');
  const href = URL.createObjectURL(blob);
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 15_000);
}

