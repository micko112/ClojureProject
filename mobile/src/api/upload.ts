import { Platform } from 'react-native';

import { ApiError, authHeaders, buildUrl, errorMessageFor, handleUnauthorized } from './client';
import { getToken } from './config';
import type { Media } from './types';

/** A local file to upload, e.g. from expo-image-picker (`asset.uri`). */
export interface UploadFile {
  uri: string;
  /** e.g. "photo.jpg" */
  name?: string;
  /** e.g. "image/jpeg", "video/mp4" */
  type?: string;
}

export interface UploadProgress {
  loaded: number;
  total: number;
  /** 0..1 */
  fraction: number;
}

export interface MultipartUploadOptions {
  /** Extra form fields (strings) */
  fields?: Record<string, string | number | undefined>;
  /** Extra files, e.g. { poster: {...} } */
  files?: Record<string, UploadFile | undefined>;
  onProgress?: (p: UploadProgress) => void;
}

export interface UploadTask<T> {
  promise: Promise<T>;
  abort: () => void;
}

/**
 * Multipart POST with upload progress (fetch can't report upload progress,
 * so this uses XMLHttpRequest).
 *
 *   const task = uploadMultipart<Media>('/api/media', 'file', file, { onProgress });
 *   const media = await task.promise;   // task.abort() cancels
 */
export function uploadMultipart<T>(
  path: string,
  fieldName: string,
  file: UploadFile,
  opts: MultipartUploadOptions = {},
): UploadTask<T> {
  const xhr = new XMLHttpRequest();
  let aborted = false;

  const promise = (async () => {
    const form = new FormData();
    await appendFile(form, fieldName, file);
    for (const [k, f] of Object.entries(opts.files ?? {})) {
      if (f) await appendFile(form, k, f);
    }
    for (const [k, v] of Object.entries(opts.fields ?? {})) {
      if (v !== undefined) form.append(k, String(v));
    }
    if (aborted) throw new ApiError(0, 'Upload cancelled');

    return new Promise<T>((resolve, reject) => {
      xhr.open('POST', buildUrl(path));
      const headers = authHeaders();
      for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
      xhr.upload.onprogress = (e) => {
        if (!opts.onProgress) return;
        const total = e.lengthComputable ? e.total : 0;
        opts.onProgress({ loaded: e.loaded, total, fraction: total ? Math.min(1, e.loaded / total) : 0 });
      };
      xhr.onload = () => {
        let body: unknown = undefined;
        try {
          body = xhr.responseText ? JSON.parse(xhr.responseText) : undefined;
        } catch {
          body = xhr.responseText;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(body as T);
        } else {
          if (xhr.status === 401 && getToken()) handleUnauthorized();
          reject(new ApiError(xhr.status, errorMessageFor(xhr.status, body), body));
        }
      };
      xhr.onerror = () => reject(new ApiError(0, 'Network error while uploading'));
      xhr.onabort = () => reject(new ApiError(0, 'Upload cancelled'));
      xhr.send(form);
    });
  })();

  return {
    promise,
    abort: () => {
      aborted = true;
      if (xhr.readyState !== XMLHttpRequest.UNSENT && xhr.readyState !== XMLHttpRequest.DONE) xhr.abort();
    },
  };
}

export interface MediaUploadOptions {
  /** Poster frame for videos (multipart `poster`). */
  poster?: UploadFile;
  width?: number;
  height?: number;
  durationSec?: number;
  onProgress?: (p: UploadProgress) => void;
}

/** POST /api/media → Media DTO (with `suggestions` from the activity classifier). */
export function uploadMedia(file: UploadFile, opts: MediaUploadOptions = {}): UploadTask<Media> {
  return uploadMultipart<Media>('/api/media', 'file', file, {
    files: { poster: opts.poster },
    fields: {
      width: opts.width ? Math.round(opts.width) : undefined,
      height: opts.height ? Math.round(opts.height) : undefined,
      durationSec: opts.durationSec,
    },
    onProgress: opts.onProgress,
  });
}

async function appendFile(form: FormData, field: string, file: UploadFile): Promise<void> {
  const name = file.name ?? guessName(file);
  const type = file.type ?? guessType(name);
  if (Platform.OS === 'web') {
    // On web, picker URIs are blob:/data: URLs: turn them into a real Blob.
    const blob = await (await fetch(file.uri)).blob();
    form.append(field, blob, name);
    return;
  }
  // React Native's FormData understands {uri, name, type}.
  form.append(field, { uri: file.uri, name, type } as unknown as Blob);
}

function guessName(file: UploadFile): string {
  const last = file.uri.split(/[/?#]/).filter(Boolean).pop() ?? 'upload';
  return /\.\w{2,5}$/.test(last) ? last : `${last}.${file.type?.startsWith('video') ? 'mp4' : 'jpg'}`;
}

function guessType(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'heic':
      return 'image/heic';
    case 'mp4':
    case 'm4v':
      return 'video/mp4';
    case 'mov':
      return 'video/quicktime';
    case 'webm':
      return 'video/webm';
    default:
      return 'image/jpeg';
  }
}
