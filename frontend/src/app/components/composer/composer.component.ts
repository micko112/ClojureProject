import {
  Component, ElementRef, EventEmitter, HostListener, OnDestroy, OnInit, Output,
  ViewChild, computed, signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription, firstValueFrom } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { MediaService, MAX_VIDEO_BYTES, UploadEvent, loadImage } from '../../services/media.service';
import { ToastService } from '../../services/toast.service';
import { CreatePostRequest, Post, PostAudience, PostLayout } from '../../models/post.model';
import { Media } from '../../models/media.model';

export type ComposerAspect = '1:1' | '4:5' | 'original';
type Step = 'pick' | 'edit' | 'details';

interface ComposerItem {
  id: number;
  file: File;
  kind: 'image' | 'video';
  url: string;          // object URL for previews
  w: number;            // natural (upright) size
  h: number;
  zoom: number;         // 1..MAX_ZOOM, relative to "cover"
  panX: number;         // image-centre offset from frame centre, in frame widths
  panY: number;         // ... in frame heights
  poster?: Blob | null; // videos
  durationSec?: number;
  mediaId?: string;     // set once uploaded (so a retry doesn't re-upload)
  uploadedKey?: string; // crop signature of the uploaded version
}

export const MAX_ITEMS = 10;
export const CAPTION_MAX = 2200;
const MAX_ZOOM = 4;
const MIN_RATIO = 9 / 16;
const MAX_RATIO = 1.91;

/**
 * Instagram-style post composer: pick up to 10 photos/videos, crop each
 * (1:1, 4:5 or original) with pan/zoom, reorder/remove, optional
 * Before/After layout for exactly two photos, then caption, activity tag,
 * audience and options, and share with upload progress.
 *
 * Full-screen on phones, centred dialog on desktop. Emits `posted` with
 * the created post (and dispatches a `bb:post-created` window event so
 * pages can refresh without being wired to the composer), `closed` when
 * dismissed.
 */
@Component({
  selector: 'app-composer',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './composer.component.html',
  styleUrls: ['./composer.component.css']
})
export class ComposerComponent implements OnInit, OnDestroy {
  @Output() posted = new EventEmitter<Post>();
  @Output() closed = new EventEmitter<void>();

  @ViewChild('frame') private frameRef?: ElementRef<HTMLElement>;

  readonly maxItems = MAX_ITEMS;
  readonly captionMax = CAPTION_MAX;
  readonly maxZoom = MAX_ZOOM;

  step = signal<Step>('pick');
  items = signal<ComposerItem[]>([]);
  activeIndex = signal(0);
  aspect = signal<ComposerAspect>('4:5');
  compare = signal(false);
  dragOver = signal(false);
  adjusting = signal(false);
  confirmDiscard = signal(false);
  loadingFiles = signal(false);

  caption = '';
  activityTag = '';
  audience: PostAudience = 'public';
  hideLikes = false;
  commentsOff = false;

  sharing = signal(false);
  progress = signal(0);
  shareStatus = signal('');

  readonly tagSuggestions = ['gym', 'running', 'coding', 'reading', 'study', 'meditation', 'nutrition', 'yoga', 'walking', 'sleep'];
  readonly audiences: { value: PostAudience; label: string; icon: string; hint: string }[] = [
    { value: 'public', label: 'Public', icon: 'public', hint: 'Anyone on BeBetter' },
    { value: 'followers', label: 'Followers', icon: 'group', hint: 'Only people who follow you' },
    { value: 'close-friends', label: 'Close friends', icon: 'stars', hint: 'Only your close friends list' },
  ];
  readonly aspects: { value: ComposerAspect; label: string; icon: string }[] = [
    { value: 'original', label: 'Original', icon: 'crop_original' },
    { value: '1:1', label: '1:1', icon: 'crop_square' },
    { value: '4:5', label: '4:5', icon: 'crop_portrait' },
  ];

  active = computed<ComposerItem | null>(() => this.items()[this.activeIndex()] ?? null);
  canCompare = computed(() => this.items().length === 2 && this.items().every(i => i.kind === 'image'));
  layout = computed<PostLayout>(() =>
    this.compare() && this.canCompare() ? 'compare' : this.items().length > 1 ? 'carousel' : 'single');
  /** Frame aspect ratio (width / height); shared by all items like Instagram. */
  frameRatio = computed(() => {
    const a = this.aspect();
    if (a === '1:1') return 1;
    if (a === '4:5') return 0.8;
    const first = this.items()[0];
    return first ? clamp(first.w / first.h, MIN_RATIO, MAX_RATIO) : 1;
  });

  private nextId = 1;
  private pointers = new Map<number, { x: number; y: number }>();
  private gesture: { panX: number; panY: number; zoom: number; dist: number; cx: number; cy: number } | null = null;
  private uploadSub?: Subscription;
  private cancelUpload?: () => void;
  private dragIndex: number | null = null;
  private prevOverflow = '';

  constructor(
    private api: ApiService,
    private media: MediaService,
    private toast: ToastService,
    public auth: AuthService,
  ) {}

  ngOnInit(): void {
    this.prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }

  ngOnDestroy(): void {
    document.body.style.overflow = this.prevOverflow;
    this.uploadSub?.unsubscribe();
    this.items().forEach(i => URL.revokeObjectURL(i.url));
  }

  get user() { return this.auth.currentUser(); }

  // ===== Navigation =====

  get title(): string {
    switch (this.step()) {
      case 'pick': return 'Create new post';
      case 'edit': return 'Crop';
      default: return 'New post';
    }
  }

  get dirty(): boolean {
    return this.items().length > 0 || this.caption.trim().length > 0;
  }

  requestClose(): void {
    if (this.sharing()) return;
    if (this.dirty) { this.confirmDiscard.set(true); return; }
    this.closed.emit();
  }

  discard(): void {
    this.confirmDiscard.set(false);
    this.closed.emit();
  }

  back(): void {
    if (this.sharing()) return;
    const s = this.step();
    if (s === 'details') this.step.set(this.items().length ? 'edit' : 'pick');
    else if (s === 'edit') this.requestClose();
    else this.requestClose();
  }

  next(): void {
    if (this.step() === 'edit') this.step.set('details');
  }

  textOnly(): void {
    this.step.set('details');
  }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (this.confirmDiscard()) this.confirmDiscard.set(false);
      else this.requestClose();
      return;
    }
    if (this.step() !== 'edit' || isTyping(e)) return;
    if (e.key === 'ArrowRight') this.select(Math.min(this.items().length - 1, this.activeIndex() + 1));
    if (e.key === 'ArrowLeft') this.select(Math.max(0, this.activeIndex() - 1));
  }

  // ===== Picking =====

  onFileInput(e: Event): void {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    input.value = '';
    this.addFiles(files);
  }

  onDragOver(e: DragEvent): void {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    this.dragOver.set(true);
  }

  onDragLeave(e: DragEvent): void {
    if (e.currentTarget === e.target) this.dragOver.set(false);
  }

  onDrop(e: DragEvent): void {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    this.dragOver.set(false);
    this.addFiles(Array.from(e.dataTransfer.files));
  }

  async addFiles(files: File[]): Promise<void> {
    const room = MAX_ITEMS - this.items().length;
    const media = files.filter(f => f.type.startsWith('image/') || f.type.startsWith('video/') || /\.(heic|heif)$/i.test(f.name));
    if (media.length < files.length) this.toast.error('Only photos and videos can be added');
    if (media.length > room) this.toast.info(`You can add up to ${MAX_ITEMS} photos or videos`);
    const chosen = media.slice(0, Math.max(0, room));
    if (!chosen.length) return;

    this.loadingFiles.set(true);
    const added: ComposerItem[] = [];
    for (const file of chosen) {
      try {
        added.push(await this.makeItem(file));
      } catch (err: any) {
        this.toast.error(`${file.name}: ${err?.message || 'could not be opened'}`);
      }
    }
    this.loadingFiles.set(false);
    if (!added.length) return;

    const wasEmpty = this.items().length === 0;
    this.items.update(list => [...list, ...added]);
    if (wasEmpty) {
      // Single portrait/landscape photo: start with its own shape, like Instagram.
      this.aspect.set(added.length === 1 && added[0].kind === 'image' ? 'original' : '4:5');
      this.activeIndex.set(0);
    } else {
      this.activeIndex.set(this.items().length - added.length);
      this.reclampAll();
    }
    if (this.step() === 'pick') this.step.set('edit');
  }

  private async makeItem(file: File): Promise<ComposerItem> {
    const isVideo = file.type.startsWith('video/');
    const base = { id: this.nextId++, file, zoom: 1, panX: 0, panY: 0 };
    if (isVideo) {
      if (file.size > MAX_VIDEO_BYTES) throw new Error('videos can be at most 100 MB');
      const info = await this.media.captureVideoInfo(file);
      if (!info.width || !info.height) throw new Error('this video format is not supported by your browser');
      return { ...base, kind: 'video', url: URL.createObjectURL(file), w: info.width, h: info.height,
               poster: info.poster, durationSec: info.durationSec };
    }
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      return { ...base, kind: 'image', url, w: img.naturalWidth, h: img.naturalHeight };
    } catch (e) {
      URL.revokeObjectURL(url);
      throw e;
    }
  }

  // ===== Editing =====

  select(i: number): void {
    if (i >= 0 && i < this.items().length) this.activeIndex.set(i);
  }

  setAspect(a: ComposerAspect): void {
    this.aspect.set(a);
    this.reclampAll();
  }

  remove(i: number, ev?: Event): void {
    ev?.stopPropagation();
    const it = this.items()[i];
    if (!it) return;
    URL.revokeObjectURL(it.url);
    this.items.update(list => list.filter((_, idx) => idx !== i));
    const n = this.items().length;
    if (!this.canCompare()) this.compare.set(false);
    if (n === 0) { this.step.set('pick'); this.activeIndex.set(0); return; }
    this.activeIndex.set(Math.min(this.activeIndex(), n - 1));
    if (i === 0) this.reclampAll(); // "original" ratio follows the first item
  }

  move(i: number, delta: number, ev?: Event): void {
    ev?.stopPropagation();
    const j = i + delta;
    const list = [...this.items()];
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    this.items.set(list);
    this.activeIndex.set(j);
    if (i === 0 || j === 0) this.reclampAll();
  }

  swapCompare(): void { this.move(0, 1); }

  onThumbDragStart(i: number, e: DragEvent): void {
    this.dragIndex = i;
    e.dataTransfer?.setData('text/plain', String(i));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }

  onThumbDragOver(e: DragEvent): void {
    if (this.dragIndex !== null) e.preventDefault();
  }

  onThumbDrop(i: number, e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    const from = this.dragIndex;
    this.dragIndex = null;
    if (from === null || from === i) return;
    const list = [...this.items()];
    const [it] = list.splice(from, 1);
    list.splice(i, 0, it);
    this.items.set(list);
    this.activeIndex.set(i);
    this.reclampAll();
  }

  setZoom(value: number | string): void {
    const it = this.active();
    if (!it) return;
    this.patch(it.id, clampItem({ ...it, zoom: clamp(Number(value), 1, MAX_ZOOM) }, this.frameRatio()));
  }

  resetCrop(): void {
    const it = this.active();
    if (it) this.patch(it.id, { ...it, zoom: 1, panX: 0, panY: 0 });
  }

  onPointerDown(e: PointerEvent): void {
    const it = this.active();
    if (!it || it.kind !== 'image') return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.startGesture(it);
    this.adjusting.set(true);
  }

  onPointerMove(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId) || !this.gesture) return;
    const it = this.active();
    const frame = this.frameRef?.nativeElement;
    if (!it || !frame) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const rect = frame.getBoundingClientRect();
    const { cx, cy, dist } = this.pointerStats();
    const g = this.gesture;
    const zoom = g.dist > 0 && dist > 0 ? clamp(g.zoom * (dist / g.dist), 1, MAX_ZOOM) : g.zoom;
    const next = {
      ...it,
      zoom,
      panX: g.panX + (cx - g.cx) / rect.width,
      panY: g.panY + (cy - g.cy) / rect.height,
    };
    this.patch(it.id, clampItem(next, this.frameRatio()));
  }

  onPointerUp(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    const it = this.active();
    if (this.pointers.size && it) this.startGesture(it);
    else { this.gesture = null; this.adjusting.set(false); }
  }

  onWheel(e: WheelEvent): void {
    const it = this.active();
    if (!it || it.kind !== 'image') return;
    e.preventDefault();
    const zoom = clamp(it.zoom * Math.exp(-e.deltaY * 0.0015), 1, MAX_ZOOM);
    this.patch(it.id, clampItem({ ...it, zoom }, this.frameRatio()));
  }

  private startGesture(it: ComposerItem): void {
    const { cx, cy, dist } = this.pointerStats();
    this.gesture = { panX: it.panX, panY: it.panY, zoom: it.zoom, dist, cx, cy };
  }

  private pointerStats(): { cx: number; cy: number; dist: number } {
    const pts = [...this.pointers.values()];
    if (!pts.length) return { cx: 0, cy: 0, dist: 0 };
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const dist = pts.length >= 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    return { cx, cy, dist };
  }

  private patch(id: number, next: ComposerItem): void {
    this.items.update(list => list.map(i => i.id === id ? next : i));
  }

  private reclampAll(): void {
    const r = this.frameRatio();
    this.items.update(list => list.map(i => clampItem(i, r)));
  }

  /** CSS for an item inside a frame of the current ratio (percentages, so it works at any size). */
  mediaStyle(it: ComposerItem): Record<string, string> {
    const { dw, dh } = displaySize(it, this.frameRatio());
    return {
      width: `${dw * 100}%`,
      height: `${dh * 100}%`,
      left: `${50 + it.panX * 100}%`,
      top: `${50 + it.panY * 100}%`,
    };
  }

  // ===== Sharing =====

  get captionLength(): number { return this.caption.length; }

  pickTag(t: string): void {
    this.activityTag = this.activityTag === t ? '' : t;
  }

  async share(): Promise<void> {
    if (this.sharing()) return;
    if (this.captionLength > CAPTION_MAX) { this.toast.error('Caption is too long'); return; }
    if (!this.items().length && !this.caption.trim()) {
      this.toast.error('Add a photo, a video or a caption');
      return;
    }
    this.sharing.set(true);
    this.progress.set(0);
    try {
      const ratio = this.frameRatio();
      const items = this.items();
      // 1. Prepare upload blobs (crop photos on a canvas).
      this.shareStatus.set(items.length ? 'Preparing…' : 'Sharing…');
      const jobs: { item: ComposerItem; blob?: Blob; key: string }[] = [];
      for (const item of items) {
        const key = cropKey(item, ratio);
        if (item.mediaId && item.uploadedKey === key) { jobs.push({ item, key }); continue; }
        const blob = item.kind === 'image'
          ? await this.media.cropImageFile(item.file, cropRect(item, ratio))
          : item.file;
        jobs.push({ item, blob, key });
      }
      // 2. Upload sequentially, progress weighted by bytes.
      const total = jobs.reduce((s, j) => s + (j.blob?.size || 0), 0) || 1;
      let done = 0;
      const ids: string[] = [];
      const uploaded: Media[] = [];
      for (let n = 0; n < jobs.length; n++) {
        const job = jobs[n];
        if (!job.blob) { ids.push(job.item.mediaId!); continue; }
        this.shareStatus.set(jobs.length > 1 ? `Uploading ${n + 1} of ${jobs.length}…` : 'Uploading…');
        const m = await this.uploadOne(job.item, job.blob, loaded =>
          this.progress.set(Math.min(0.98, (done + loaded) / total)));
        done += job.blob.size;
        ids.push(m.id);
        uploaded.push(m);
        this.patch(job.item.id, { ...this.items().find(i => i.id === job.item.id)!, mediaId: m.id, uploadedKey: job.key });
      }
      // 3. Create the post.
      this.shareStatus.set('Sharing…');
      const req: CreatePostRequest = {
        caption: this.caption.trim(),
        mediaIds: ids,
        audience: this.audience,
        hideLikes: this.hideLikes,
        commentsOff: this.commentsOff,
      };
      if (ids.length) req.layout = this.layout();
      if (this.activityTag.trim()) req.activityTag = this.activityTag.trim().replace(/^#/, '');
      // `mediaUrl` keeps single-media posts working on a backend without mediaIds support.
      const firstUrl = uploaded[0]?.url;
      const body = firstUrl ? { ...req, mediaUrl: firstUrl } : req;
      const post = await firstValueFrom(this.api.createPost(body)) as Post;
      this.progress.set(1);
      this.toast.success('Shared! Another day of progress.');
      this.posted.emit(post);
      window.dispatchEvent(new CustomEvent('bb:post-created', { detail: post }));
      this.closed.emit();
    } catch (err: any) {
      this.toast.error(err?.error?.error || err?.message || 'Could not share the post');
    } finally {
      this.sharing.set(false);
      this.shareStatus.set('');
    }
  }

  private uploadOne(item: ComposerItem, blob: Blob, onLoaded: (bytes: number) => void): Promise<Media> {
    const opts = item.kind === 'video'
      ? { poster: item.poster, width: item.w, height: item.h, durationSec: item.durationSec }
      : {};
    const obs = this.media.upload(blob, item.file.name, opts);
    return new Promise<Media>((resolve, reject) => {
      this.cancelUpload = () => { this.uploadSub?.unsubscribe(); reject(new Error('Upload cancelled')); };
      this.uploadSub = obs.subscribe({
        next: (ev: UploadEvent) => {
          if (ev.type === 'progress') onLoaded(ev.loaded);
          else resolve(ev.media);
        },
        error: reject,
      });
    });
  }

  cancelShare(): void {
    this.cancelUpload?.();
  }
}

// ===== Pure crop maths (exported for reuse/tests) =====

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, isFinite(v) ? v : min));
}

/** Displayed media size relative to the frame (1 = frame width/height) for "cover" * zoom. */
export function displaySize(it: { w: number; h: number; zoom: number }, frameRatio: number): { dw: number; dh: number } {
  const ir = it.w / it.h;
  return { dw: it.zoom * Math.max(1, ir / frameRatio), dh: it.zoom * Math.max(1, frameRatio / ir) };
}

/** Keeps the media covering the whole frame. */
export function clampItem<T extends { w: number; h: number; zoom: number; panX: number; panY: number }>(it: T, frameRatio: number): T {
  const zoom = clamp(it.zoom, 1, MAX_ZOOM);
  const { dw, dh } = displaySize({ ...it, zoom }, frameRatio);
  const mx = (dw - 1) / 2, my = (dh - 1) / 2;
  return { ...it, zoom, panX: clamp(it.panX, -mx, mx), panY: clamp(it.panY, -my, my) };
}

/** Source rectangle (natural pixels) the frame shows. */
export function cropRect(it: { w: number; h: number; zoom: number; panX: number; panY: number }, frameRatio: number) {
  const { dw, dh } = displaySize(it, frameRatio);
  const fw = 1 / dw, fh = 1 / dh;               // frame size as a fraction of the media
  const cx = 0.5 - it.panX * fw, cy = 0.5 - it.panY * fh;
  const sw = fw * it.w, sh = fh * it.h;
  const sx = clamp((cx - fw / 2) * it.w, 0, it.w - sw);
  const sy = clamp((cy - fh / 2) * it.h, 0, it.h - sh);
  return { sx, sy, sw, sh };
}

function cropKey(it: ComposerItem, r: number): string {
  return [it.id, r.toFixed(4), it.zoom.toFixed(3), it.panX.toFixed(4), it.panY.toFixed(4)].join('|');
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
