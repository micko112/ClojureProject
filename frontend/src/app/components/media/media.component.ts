import { Component, Input } from '@angular/core';
import { Media } from '../../models/media.model';

// Renders one image/video. OWNER: media agent (adds srcset, lazy loading,
// blur-up placeholder, aspect-ratio box). Inputs are the stable contract.
@Component({
  selector: 'app-media',
  standalone: true,
  template: `
    @if (media?.type === 'video') {
      <video [src]="media!.url" [poster]="media!.posterUrl || ''" [muted]="true" playsinline [controls]="controls"></video>
    } @else if (media) {
      <img [src]="media.url" alt="" loading="lazy" />
    }
  `,
  styles: [`:host{display:block} img,video{width:100%;height:100%;object-fit:cover;display:block}`]
})
export class MediaComponent {
  @Input() media: Media | null = null;
  /** CSS sizes attribute for srcset selection, e.g. '(max-width: 600px) 100vw, 470px' */
  @Input() sizes = '100vw';
  @Input() controls = false;
}
