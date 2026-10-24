import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { Media } from '../models/media.model';

/** Progress events emitted by {@link MediaService.upload}. */
export type UploadEvent =
  | { type: 'progress'; loaded: number; total: number; fraction: number }
  | { type: 'done'; media: Media };

export interface UploadOptions {
  /** Poster frame for videos (sent as multipart `poster`). */
  poster?: Blob | null;
  width?: number;
  height?: number;
  durationSec?: number;
}

export interface VideoInfo {
  poster: Blob | null;
  width: number;
  height: number;
  durationSec: number;
}

/** Source rectangle in natural image pixels. */
export interface CropRect { sx: number; sy: number; sw: number; sh: number; }

export const MAX_UPLOAD_SIDE = 2160;
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

const SERVER_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

@Injectable({ providedIn: 'root' })
export class MediaService {

  /**
   * Uploads a file to POST /api/media and reports upload progress.
   * Uses XMLHttpRequest directly: the app's HttpClient is configured with
   * `withFetch()`, and fetch cannot report upload progress.
   * Unsubscribing aborts the upload.
   */
  upload(file: Blob, filename = 'upload', opts: UploadOptions = {}): Observable<UploadEvent> {
    return new Observable<UploadEvent>(sub => {
      const fd = new FormData();
      fd.append('file', file, (file as File).name || filename);
      if (opts.poster) fd.append('poster', opts.poster, 'poster.jpg');
      if (opts.width) fd.append('width', String(Math.round(opts.width)));
      if (opts.height) fd.append('height', String(Math.round(opts.height)));
      if (opts.durationSec) fd.append('durationSec', String(opts.durationSec));

      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/media');
      xhr.withCredentials = true;
      xhr.upload.onprogress = e => {
        const total = e.lengthComputable ? e.total : file.size;
        sub.next({ type: 'progress', loaded: e.loaded, total, fraction: total ? Math.min(1, e.loaded / total) : 0 });
      };
      xhr.onload = () => {
        const body = safeJson(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && body) {
          sub.next({ type: 'done', media: body as Media });
          sub.complete();
        } else {
          sub.error(new Error(body?.error || uploadErrorText(xhr.status)));
        }
      };
      xhr.onerror = () => sub.error(new Error('Network error while uploading'));
      xhr.onabort = () => sub.error(new Error('Upload cancelled'));
      xhr.send(fd);
      return () => { if (xhr.readyState !== XMLHttpRequest.DONE) xhr.abort(); };
    });
  }

  /**
   * Prepares a picked file for upload: images larger than `maxSide`, HEIC
   * (iPhone) and other formats the server can't decode are re-encoded to
   * JPEG with a canvas. Small JPEG/PNG/WebP/GIF files are returned untouched
   * (the server strips their metadata).
   */
  async prepareImage(file: File, maxSide = MAX_UPLOAD_SIDE): Promise<File> {
    const needsConvert = !SERVER_IMAGE_TYPES.includes(file.type);
    if (file.type === 'image/gif' && file.size <= MAX_IMAGE_BYTES) return file; // keep animation
    const img = await loadImage(file);
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!needsConvert && Math.max(w, h) <= maxSide && file.size <= MAX_IMAGE_BYTES) return file;
    const blob = await this.renderToJpeg(img, { sx: 0, sy: 0, sw: w, sh: h }, maxSide);
    return new File([blob], replaceExt(file.name, 'jpg'), { type: 'image/jpeg' });
  }

  /**
   * Crops `source` to `rect` (natural pixels) and encodes a JPEG whose
   * longest side is at most `maxSide`. Browsers apply EXIF orientation when
   * decoding, so the output is upright and carries no metadata.
   */
  renderToJpeg(source: CanvasImageSource & { naturalWidth?: number }, rect: CropRect,
               maxSide = MAX_UPLOAD_SIDE, quality = 0.9): Promise<Blob> {
    const scale = Math.min(1, maxSide / Math.max(rect.sw, rect.sh));
    const outW = Math.max(1, Math.round(rect.sw * scale));
    const outH = Math.max(1, Math.round(rect.sh * scale));
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, outW, outH);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, outW, outH);
    return new Promise((resolve, reject) =>
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('Could not encode image')), 'image/jpeg', quality));
  }

  /** Crops an image file and returns an upload-ready JPEG file. */
  async cropImageFile(file: File, rect: CropRect, maxSide = MAX_UPLOAD_SIDE): Promise<File> {
    const img = await loadImage(file);
    const blob = await this.renderToJpeg(img, rect, maxSide);
    return new File([blob], replaceExt(file.name, 'jpg'), { type: 'image/jpeg' });
  }

  /**
   * Reads a video's size/duration and grabs a poster frame (JPEG) with a
   * canvas. Resolves with `poster: null` if the browser can't decode it.
   */
  captureVideoInfo(file: Blob, atSec = 0.5, timeoutMs = 8000): Promise<VideoInfo> {
    return new Promise(resolve => {
      const url = URL.createObjectURL(file);
      const video = document.createElement('video');
      let settled = false;
      const finish = (info: VideoInfo) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(url);
        resolve(info);
      };
      const meta = () => ({
        width: video.videoWidth, height: video.videoHeight,
        durationSec: isFinite(video.duration) ? Math.round(video.duration * 100) / 100 : 0
      });
      const timer = setTimeout(() => finish({ poster: null, ...meta() }), timeoutMs);
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.onloadedmetadata = () => {
        const d = isFinite(video.duration) ? video.duration : 0;
        video.currentTime = Math.min(atSec, d > 0 ? d / 3 : 0);
      };
      video.onseeked = () => {
        const { width, height } = meta();
        if (!width || !height) { finish({ poster: null, ...meta() }); return; }
        const scale = Math.min(1, 1080 / width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        try {
          canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(b => finish({ poster: b, ...meta() }), 'image/jpeg', 0.85);
        } catch {
          finish({ poster: null, ...meta() });
        }
      };
      video.onerror = () => finish({ poster: null, width: 0, height: 0, durationSec: 0 });
      video.src = url;
    });
  }

  /**
   * Convenience for single-file uploads (e.g. profile picture): prepares an
   * image or captures a video poster, then uploads.
   */
  uploadFile(file: File): Observable<UploadEvent> {
    return new Observable<UploadEvent>(sub => {
      let inner: { unsubscribe(): void } | null = null;
      let cancelled = false;
      (async () => {
        if (file.type.startsWith('video/')) {
          const info = await this.captureVideoInfo(file);
          return { blob: file as Blob, opts: { poster: info.poster, width: info.width, height: info.height, durationSec: info.durationSec } };
        }
        return { blob: await this.prepareImage(file) as Blob, opts: {} };
      })().then(({ blob, opts }) => {
        if (cancelled) return;
        inner = this.upload(blob, file.name, opts).subscribe(sub);
      }, err => sub.error(err));
      return () => { cancelled = true; inner?.unsubscribe(); };
    });
  }
}

export function loadImage(src: Blob | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = typeof src === 'string' ? src : URL.createObjectURL(src);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => { if (typeof src !== 'string') URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => {
      if (typeof src !== 'string') URL.revokeObjectURL(url);
      reject(new Error('This image format is not supported by your browser'));
    };
    img.src = url;
  });
}

function replaceExt(name: string, ext: string): string {
  const base = (name || 'image').replace(/\.[^.]+$/, '');
  return `${base}.${ext}`;
}

function safeJson(text: string): any {
  try { return JSON.parse(text); } catch { return null; }
}

function uploadErrorText(status: number): string {
  if (status === 401) return 'Please log in again';
  if (status === 413) return 'File is too large';
  if (status === 415) return 'Unsupported file type';
  return 'Upload failed';
}
