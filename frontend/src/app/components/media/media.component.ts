import {
  AfterViewInit, Component, ElementRef, Input, NgZone, OnChanges, OnDestroy,
  SimpleChanges, ViewChild, booleanAttribute, signal
} from '@angular/core';
import { Media } from '../../models/media.model';

/** Sound preference shared by every video on the page (Instagram-like). */
const soundOn = signal(false);

/**
 * Renders one image/video from a Media DTO. OWNER: media agent.
 *
 * - Images: responsive `srcset` from `variants`, lazy + async decoding,
 *   blur-up placeholder that fades out once the real image has loaded.
 * - The host is an aspect-ratio box from `width`/`height` (no layout shift).
 *   Parents can still size it (e.g. `app-media { aspect-ratio: 1 }` or
 *   `fill`), the media then covers/contains that box.
 * - Videos: poster, muted autoplay only while >= 60% visible
 *   (IntersectionObserver), paused otherwise; source attached on first view.
 *   With `controls` the native controls are shown too (and still autoplay).
 *   The sound preference is shared by all videos on the page.
 *
 * Stable inputs: `media`, `sizes`, `controls`. Optional: `fit`, `priority`,
 * `fill`, `ratio`, `alt`, `autoplay`.
 */
@Component({
  selector: 'app-media',
  standalone: true,
  host: {
    '[class.sized]': 'boxRatio !== null || fill',
    '[class.fill]': 'fill',
    '[class.loaded]': 'loaded()',
    '[class.contain]': "fit === 'contain'",
    '[style.aspect-ratio]': 'fill ? null : boxRatio',
  },
  template: `
    @if (media?.placeholder) {
      <div class="ph" aria-hidden="true" [class.out]="loaded()"
           [style.background-image]="'url(' + media!.placeholder + ')'"></div>
    }
    @if (media?.type === 'video') {
      <video #vid
             [attr.src]="activated ? media!.url : null"
             [attr.poster]="media!.posterUrl || null"
             [attr.width]="media!.width || null"
             [attr.height]="media!.height || null"
             [muted]="!soundOn()"
             [controls]="controls"
             [attr.aria-label]="alt || 'Video'"
             playsinline loop preload="metadata"
             (loadeddata)="onLoad()" (playing)="paused.set(false)" (pause)="paused.set(true)"
             (volumechange)="onVolumeChange()"
             (error)="onLoad()"></video>
      @if (!controls) {
        @if (paused() && userPaused) {
          <button type="button" class="play" (click)="playClick($event)" aria-label="Play video">
            <span class="material-icons">play_arrow</span>
          </button>
        }
        <button type="button" class="sound" (click)="toggleSound($event)"
                [attr.aria-label]="soundOn() ? 'Mute' : 'Unmute'">
          <span class="material-icons">{{ soundOn() ? 'volume_up' : 'volume_off' }}</span>
        </button>
      }
    } @else if (media) {
      <img [src]="src" [attr.srcset]="srcset" [attr.sizes]="srcset ? sizes : null"
           [attr.width]="media.width || null" [attr.height]="media.height || null"
           [attr.loading]="priority ? 'eager' : 'lazy'"
           [attr.fetchpriority]="priority ? 'high' : null"
           decoding="async" [alt]="alt" draggable="false"
           (load)="onLoad()" (error)="onLoad()" />
    }
  `,
  styles: [`
    :host { display: block; position: relative; overflow: hidden; background: var(--bg3); }
    :host(.fill) { width: 100%; height: 100%; }
    img, video { width: 100%; height: 100%; object-fit: cover; display: block; }
    :host(.sized) img, :host(.sized) video { position: absolute; inset: 0; }
    :host(.contain) img, :host(.contain) video { object-fit: contain; }
    :host(.contain) { background: #000; }
    img { opacity: 0; transition: opacity .35s var(--ease, ease); -webkit-user-drag: none; }
    :host(.loaded) img, :host(:not(.sized)) img { opacity: 1; }
    .ph {
      position: absolute; inset: 0; z-index: 1; pointer-events: none;
      background-size: cover; background-position: center;
      filter: blur(14px); transform: scale(1.15);
      transition: opacity .45s var(--ease, ease);
    }
    .ph.out { opacity: 0; }
    .sound, .play {
      position: absolute; z-index: 2; border: none; color: #fff; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      background: rgba(0, 0, 0, .55); border-radius: 50%;
    }
    .sound { right: 10px; bottom: 10px; width: 30px; height: 30px; }
    .sound .material-icons { font-size: 17px; }
    .play { left: 50%; top: 50%; width: 64px; height: 64px; transform: translate(-50%, -50%); }
    .play .material-icons { font-size: 40px; }
    @media (prefers-reduced-motion: reduce) { img, .ph { transition: none; } }
  `]
})
export class MediaComponent implements OnChanges, AfterViewInit, OnDestroy {
  @Input() media: Media | null = null;
  /** CSS sizes attribute for srcset selection, e.g. '(max-width: 600px) 100vw, 470px' */
  @Input() sizes = '100vw';
  @Input() controls = false;
  /** How the media fills its box. */
  @Input() fit: 'cover' | 'contain' = 'cover';
  /** Above-the-fold image (first feed post): eager load, high fetch priority. */
  @Input({ transform: booleanAttribute }) priority = false;
  /** Fill the parent box instead of using the media's own aspect ratio. */
  @Input({ transform: booleanAttribute }) fill = false;
  /** Force a box aspect ratio (width / height), e.g. 1 or 0.8. */
  @Input() ratio: number | null = null;
  @Input() alt = '';
  /** Videos: muted autoplay while visible. */
  @Input({ transform: booleanAttribute }) autoplay = true;

  @ViewChild('vid') private vid?: ElementRef<HTMLVideoElement>;

  readonly loaded = signal(false);
  readonly paused = signal(true);
  readonly soundOn = soundOn;
  /** Video source is attached the first time the element comes into view. */
  activated = false;
  /** True when autoplay is not possible/allowed and the user must tap play. */
  userPaused = false;
  src = '';
  srcset: string | null = null;
  boxRatio: string | null = null;

  private io?: IntersectionObserver;
  private visible = false;
  private readonly reducedMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly onVisibility = () => this.syncPlayback();

  constructor(private host: ElementRef<HTMLElement>, private zone: NgZone) {}

  ngOnChanges(ch: SimpleChanges): void {
    if (ch['media'] || ch['ratio']) {
      const m = this.media;
      const prevUrl = ch['media']?.previousValue?.url;
      if (ch['media'] && prevUrl !== m?.url) {
        this.loaded.set(false);
        if (m?.type !== 'video') this.activated = false;
      }
      const variants = (m?.variants || []).filter(v => v && v.url && v.w > 0).sort((a, b) => a.w - b.w);
      this.srcset = variants.length > 1 ? variants.map(v => `${v.url} ${v.w}w`).join(', ') : null;
      this.src = variants.length ? variants[variants.length - 1].url : (m?.url || '');
      const r = this.ratio ?? (m?.width && m?.height ? m.width / m.height : null);
      this.boxRatio = r && isFinite(r) && r > 0 ? String(Math.round(r * 10000) / 10000) : null;
    }
  }

  ngAfterViewInit(): void {
    if (typeof IntersectionObserver === 'undefined') { this.activated = true; return; }
    this.zone.runOutsideAngular(() => {
      this.io = new IntersectionObserver(entries => {
        const e = entries[entries.length - 1];
        this.visible = e.isIntersecting && e.intersectionRatio >= 0.6;
        if (e.isIntersecting && !this.activated && this.media?.type === 'video') {
          this.zone.run(() => { this.activated = true; });
        }
        this.syncPlayback();
      }, { threshold: [0, 0.6] });
      this.io.observe(this.host.nativeElement);
      document.addEventListener('visibilitychange', this.onVisibility);
    });
  }

  ngOnDestroy(): void {
    this.io?.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  onLoad(): void { this.loaded.set(true); }

  /** Native controls changed mute: remember it for every video. */
  onVolumeChange(): void {
    const v = this.vid?.nativeElement;
    if (v && this.controls && !v.paused && v.muted === soundOn()) soundOn.set(!v.muted);
  }

  toggleSound(ev: Event): void {
    ev.stopPropagation();
    soundOn.set(!soundOn());
    const v = this.vid?.nativeElement;
    if (v) { v.muted = !soundOn(); if (v.paused) this.play(v); }
  }

  playClick(ev: Event): void {
    ev.stopPropagation();
    this.userPaused = false;
    const v = this.vid?.nativeElement;
    if (v) this.play(v);
  }

  private syncPlayback(): void {
    if (this.media?.type !== 'video') return;
    // Wait a tick so a freshly attached [src] is in the DOM.
    setTimeout(() => {
      const v = this.vid?.nativeElement;
      if (!v) return;
      const canAuto = this.autoplay && !this.reducedMotion;
      const onScreen = this.visible && !document.hidden;
      if (onScreen && canAuto && !this.userPaused && v.paused) this.play(v);
      else if (!onScreen && !v.paused) v.pause();
      if (!canAuto && !this.controls && v.paused) this.zone.run(() => { this.userPaused = true; });
    });
  }

  private play(v: HTMLVideoElement): void {
    v.muted = !soundOn();
    v.play().catch(() => {
      // Autoplay with sound blocked: retry muted, else ask for a tap.
      if (!v.muted) {
        v.muted = true;
        v.play().catch(() => this.zone.run(() => { this.userPaused = true; }));
      } else {
        this.zone.run(() => { this.userPaused = true; });
      }
    });
  }
}
