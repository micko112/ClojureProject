import { Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { MediaComponent } from '../media/media.component';
import { Media } from '../../models/media.model';

/** Before/after slider: drag the divider (touch, mouse or arrow keys). */
@Component({
  selector: 'app-compare-slider',
  standalone: true,
  imports: [MediaComponent],
  template: `
    <div class="cmp" #box [class.fill]="fill" [style.aspect-ratio]="fill ? null : aspect"
         (pointerdown)="down($event)" (pointermove)="move($event)"
         (pointerup)="up($event)" (pointercancel)="cancel()" (dragstart)="$event.preventDefault()">
      <app-media class="cmp-layer" [media]="after" [sizes]="sizes"></app-media>
      <div class="cmp-layer cmp-before" [style.clip-path]="'inset(0 ' + (100 - pos) + '% 0 0)'">
        <app-media [media]="before" [sizes]="sizes"></app-media>
      </div>
      <span class="cmp-label left" [class.dim]="pos < 18">Before</span>
      <span class="cmp-label right" [class.dim]="pos > 82">After</span>
      <div class="cmp-divider" [style.left.%]="pos">
        <div class="cmp-knob" role="slider" tabindex="0" aria-label="Before and after divider"
             [attr.aria-valuenow]="round(pos)" aria-valuemin="0" aria-valuemax="100"
             (keydown)="key($event)">
          <span class="material-icons">chevron_left</span><span class="material-icons">chevron_right</span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .cmp { position: relative; width: 100%; overflow: hidden; background: #000; touch-action: pan-y;
           user-select: none; -webkit-user-select: none; cursor: ew-resize; }
    .cmp.fill { height: 100%; }
    .cmp-layer { position: absolute; inset: 0; }
    .cmp-layer app-media, app-media.cmp-layer { width: 100%; height: 100%; }
    .cmp-before { will-change: clip-path; }
    .cmp-label { position: absolute; top: 12px; padding: 3px 10px; border-radius: 12px; font-size: 12px;
                 font-weight: 600; color: #fff; background: rgba(0,0,0,.55); pointer-events: none;
                 transition: opacity .2s; letter-spacing: .02em; }
    .cmp-label.left { left: 12px; } .cmp-label.right { right: 12px; }
    .cmp-label.dim { opacity: 0; }
    .cmp-divider { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: #fff;
                   box-shadow: 0 0 6px rgba(0,0,0,.5); pointer-events: none; }
    .cmp-knob { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 40px; height: 40px;
                border-radius: 50%; background: #fff; color: #111; display: flex; align-items: center;
                justify-content: center; box-shadow: 0 2px 10px rgba(0,0,0,.4); pointer-events: auto; outline: none; }
    .cmp-knob:focus-visible { box-shadow: 0 0 0 3px var(--focus-ring); }
    .cmp-knob .material-icons { font-size: 18px; margin: 0 -4px; }
  `]
})
export class CompareSliderComponent {
  @Input() before: Media | null = null;
  @Input() after: Media | null = null;
  @Input() aspect = 1;
  @Input() fill = false;
  @Input() sizes = '(max-width: 600px) 100vw, 470px';
  /** Tap without dragging (used for double-tap to like). */
  @Output() tapped = new EventEmitter<PointerEvent>();
  @ViewChild('box', { static: true }) box!: ElementRef<HTMLDivElement>;

  pos = 50;
  private startX = 0;
  private startY = 0;
  private tracking = false;
  private dragging = false;

  round(n: number): number { return Math.round(n); }

  down(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.tracking = true;
    this.dragging = false;
    this.startX = e.clientX;
    this.startY = e.clientY;
  }

  move(e: PointerEvent): void {
    if (!this.tracking) return;
    const dx = e.clientX - this.startX;
    const dy = e.clientY - this.startY;
    if (!this.dragging) {
      if (Math.abs(dx) > 5 && Math.abs(dx) >= Math.abs(dy)) {
        this.dragging = true;
        this.box.nativeElement.setPointerCapture?.(e.pointerId);
      } else if (Math.abs(dy) > 10) {
        this.tracking = false;
        return;
      }
    }
    if (this.dragging) this.setFromX(e.clientX);
  }

  up(e: PointerEvent): void {
    if (!this.tracking) return;
    this.tracking = false;
    if (this.dragging) { this.dragging = false; return; }
    this.tapped.emit(e);
  }

  cancel(): void { this.tracking = false; this.dragging = false; }

  key(e: KeyboardEvent): void {
    if (e.key === 'ArrowLeft') { this.pos = Math.max(0, this.pos - 5); e.preventDefault(); e.stopPropagation(); }
    if (e.key === 'ArrowRight') { this.pos = Math.min(100, this.pos + 5); e.preventDefault(); e.stopPropagation(); }
  }

  private setFromX(x: number): void {
    const r = this.box.nativeElement.getBoundingClientRect();
    if (!r.width) return;
    this.pos = Math.min(100, Math.max(0, ((x - r.left) / r.width) * 100));
  }
}
