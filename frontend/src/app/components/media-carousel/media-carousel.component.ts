import { Component, ElementRef, EventEmitter, Input, OnChanges, Output, ViewChild } from '@angular/core';
import { MediaComponent } from '../media/media.component';
import { CompareSliderComponent } from '../compare-slider/compare-slider.component';
import { Media } from '../../models/media.model';
import { PostLayout } from '../../models/post.model';
import { aspectOf } from '../post-card/post-utils';

/**
 * Instagram-style media slider: touch swipe, mouse drag, arrow buttons on
 * desktop, dot indicators and a "1/5" counter. Keeps the aspect ratio of the
 * first media (clamped 4:5 … 1.91:1). `layout === 'compare'` with two media
 * renders the before/after slider instead.
 */
@Component({
  selector: 'app-media-carousel',
  standalone: true,
  imports: [MediaComponent, CompareSliderComponent],
  template: `
    @if (layout === 'compare' && media.length === 2) {
      <app-compare-slider [before]="media[0]" [after]="media[1]" [aspect]="aspect" [fill]="fill"
                          [sizes]="sizes" (tapped)="tapped.emit($event)"></app-compare-slider>
    } @else if (media.length) {
      <div class="mc" #box [class.fill]="fill" [style.aspect-ratio]="fill ? null : aspect"
           (pointerdown)="down($event)" (pointermove)="move($event)" (pointerup)="up($event)"
           (pointercancel)="cancel()" (dragstart)="$event.preventDefault()"
           (keydown.arrowleft)="key($event, -1)" (keydown.arrowright)="key($event, 1)" tabindex="-1">
        <div class="mc-track" [class.anim]="!dragging" [style.transform]="transform">
          @for (m of media; track m.id; let i = $index) {
            <div class="mc-slide" [attr.aria-hidden]="i !== index">
              @if (near(i)) {
                <app-media [media]="m" [sizes]="sizes" [controls]="m.type === 'video'"></app-media>
              }
            </div>
          }
        </div>
        @if (media.length > 1) {
          <span class="mc-count">{{ index + 1 }}/{{ media.length }}</span>
          @if (index > 0) {
            <button type="button" class="mc-arrow prev" aria-label="Previous" (pointerdown)="$event.stopPropagation()" (click)="go(-1, $event)">
              <span class="material-icons">chevron_left</span>
            </button>
          }
          @if (index < media.length - 1) {
            <button type="button" class="mc-arrow next" aria-label="Next" (pointerdown)="$event.stopPropagation()" (click)="go(1, $event)">
              <span class="material-icons">chevron_right</span>
            </button>
          }
          <div class="mc-dots">
            @for (m of media; track m.id; let i = $index) { <span class="mc-dot" [class.on]="i === index"></span> }
          </div>
        }
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .mc { position: relative; width: 100%; overflow: hidden; background: #000; touch-action: pan-y;
          user-select: none; -webkit-user-select: none; outline: none; }
    .mc.fill { height: 100%; }
    .mc-track { display: flex; height: 100%; will-change: transform; }
    .mc-track.anim { transition: transform .32s cubic-bezier(.25,.8,.25,1); }
    .mc-slide { flex: 0 0 100%; height: 100%; }
    .mc-slide app-media { width: 100%; height: 100%; }
    .mc-count { position: absolute; top: 12px; right: 12px; background: rgba(0,0,0,.6); color: #fff;
                font-size: 12px; font-weight: 600; padding: 3px 9px; border-radius: 12px; pointer-events: none; }
    .mc-arrow { position: absolute; top: 50%; transform: translateY(-50%); width: 30px; height: 30px;
                border-radius: 50%; border: none; background: rgba(255,255,255,.85); color: #111;
                display: none; align-items: center; justify-content: center; padding: 0;
                box-shadow: 0 1px 6px rgba(0,0,0,.3); opacity: 0; transition: opacity .15s; }
    .mc-arrow .material-icons { font-size: 22px; }
    .mc-arrow.prev { left: 10px; } .mc-arrow.next { right: 10px; }
    @media (hover: hover) and (pointer: fine) {
      .mc-arrow { display: flex; }
      .mc:hover .mc-arrow { opacity: 1; }
    }
    .mc-dots { position: absolute; bottom: 10px; left: 0; right: 0; display: flex; justify-content: center;
               gap: 4px; pointer-events: none; }
    .mc-dot { width: 6px; height: 6px; border-radius: 50%; background: rgba(255,255,255,.45); transition: background .2s, transform .2s; }
    .mc-dot.on { background: #fff; transform: scale(1.1); }
  `]
})
export class MediaCarouselComponent implements OnChanges {
  @Input() media: Media[] = [];
  @Input() layout: PostLayout | string | undefined = 'single';
  /** Fill the host's box (host sized by parent) instead of using the first media's aspect ratio. */
  @Input() fill = false;
  @Input() sizes = '(max-width: 600px) 100vw, 470px';
  /** Tap without swiping (for double-tap to like). */
  @Output() tapped = new EventEmitter<PointerEvent>();
  @Output() indexChange = new EventEmitter<number>();
  @ViewChild('box') box?: ElementRef<HTMLDivElement>;

  index = 0;
  dx = 0;
  dragging = false;
  aspect = 1;
  private tracking = false;
  private startX = 0;
  private startY = 0;
  private width = 1;

  ngOnChanges(): void {
    this.aspect = aspectOf(this.media?.[0]);
    if (this.index >= (this.media?.length || 0)) this.index = 0;
  }

  get transform(): string {
    return `translate3d(calc(${-this.index * 100}% + ${this.dx}px), 0, 0)`;
  }

  /** Render only the current slide and its neighbours. */
  near(i: number): boolean { return Math.abs(i - this.index) <= 1; }

  go(delta: number, e?: Event): void {
    e?.stopPropagation();
    const n = Math.min(this.media.length - 1, Math.max(0, this.index + delta));
    if (n !== this.index) { this.index = n; this.indexChange.emit(n); }
  }

  key(e: Event, delta: number): void { e.stopPropagation(); this.go(delta); }

  down(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.tracking = true;
    this.dragging = false;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.width = this.box?.nativeElement.clientWidth || 1;
  }

  move(e: PointerEvent): void {
    if (!this.tracking) return;
    const dx = e.clientX - this.startX;
    const dy = e.clientY - this.startY;
    if (!this.dragging) {
      if (this.media.length > 1 && Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) {
        this.dragging = true;
        this.box?.nativeElement.setPointerCapture?.(e.pointerId);
      } else if (Math.abs(dy) > 10 || Math.abs(dx) > 10) {
        this.tracking = false;
        return;
      }
    }
    if (this.dragging) {
      const atEdge = (this.index === 0 && dx > 0) || (this.index === this.media.length - 1 && dx < 0);
      this.dx = atEdge ? dx / 3 : dx;
    }
  }

  up(e: PointerEvent): void {
    if (!this.tracking) return;
    this.tracking = false;
    if (this.dragging) {
      const dx = this.dx;
      this.dragging = false;
      this.dx = 0;
      if (Math.abs(dx) > this.width * 0.15) this.go(dx < 0 ? 1 : -1);
      return;
    }
    this.tapped.emit(e);
  }

  cancel(): void { this.tracking = false; this.dragging = false; this.dx = 0; }
}
