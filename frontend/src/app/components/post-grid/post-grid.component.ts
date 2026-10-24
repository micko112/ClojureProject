import { Component, EventEmitter, Input, Output } from '@angular/core';
import { Post } from '../../models/post.model';
import { compact, likeCountOf, postMedia, thumbUrl } from '../post-card/post-utils';

/** 3-column square thumbnail grid (explore, hashtag pages). */
@Component({
  selector: 'app-post-grid',
  standalone: true,
  template: `
    <div class="pg">
      @for (p of posts; track p.id) {
        <button type="button" class="pg-cell" (click)="open.emit(p)" [attr.aria-label]="'Open post by ' + p.author.username">
          @if (first(p); as m) {
            @if (thumb(p)) {
              <img [src]="thumb(p)" alt="" loading="lazy" decoding="async" />
            } @else if (m.type === 'video') {
              <video [src]="m.url" muted playsinline preload="metadata"></video>
            }
          } @else {
            <span class="pg-text">{{ p.caption }}</span>
          }
          @if (p.layout === 'compare') { <span class="pg-badge material-icons" title="Before / after">compare</span> }
          @else if ((p.media?.length || 0) > 1) { <span class="pg-badge material-icons" title="Carousel">collections</span> }
          @else if (isVideo(p)) { <span class="pg-badge material-icons" title="Video">smart_display</span> }
          <span class="pg-hover">
            @if (!p.hideLikes) { <span><span class="material-icons">favorite</span>{{ compact(likes(p)) }}</span> }
            @if (!p.commentsOff) { <span><span class="material-icons">mode_comment</span>{{ compact(p.commentCount || 0) }}</span> }
          </span>
        </button>
      }
      @if (loading) {
        @for (i of skeletons; track i) { <div class="pg-cell pg-skel"></div> }
      }
    </div>
  `,
  styles: [`
    .pg { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2px; }
    .pg-cell { position: relative; aspect-ratio: 3 / 4; overflow: hidden; background: var(--surface); border: none; padding: 0;
               display: block; color: #fff; }
    .pg-cell img, .pg-cell video { width: 100%; height: 100%; object-fit: cover; display: block; }
    .pg-text { position: absolute; inset: 0; padding: 12px; display: flex; align-items: center; justify-content: center;
               text-align: center; font-size: 13px; font-weight: 600; color: var(--text); overflow: hidden;
               background: var(--surface); line-height: 1.35; }
    .pg-badge { position: absolute; top: 8px; right: 8px; font-size: 20px; color: #fff; filter: drop-shadow(0 0 3px rgba(0,0,0,.6)); }
    .pg-hover { position: absolute; inset: 0; background: rgba(0,0,0,.3); color: #fff; display: flex; align-items: center;
                justify-content: center; gap: 24px; font-weight: 700; font-size: 16px; opacity: 0; transition: opacity .15s; }
    .pg-hover > span { display: flex; align-items: center; gap: 6px; }
    .pg-hover .material-icons { font-size: 20px; }
    @media (hover: hover) { .pg-cell:hover .pg-hover { opacity: 1; } }
    .pg-skel { animation: pulse 1.2s infinite; }
    @keyframes pulse { 50% { opacity: .5; } }
    @media (min-width: 736px) { .pg { gap: 4px; } }
  `]
})
export class PostGridComponent {
  @Input() posts: Post[] = [];
  @Input() loading = false;
  @Output() open = new EventEmitter<Post>();

  skeletons = [1, 2, 3, 4, 5, 6];
  compact = compact;

  first(p: Post) { return postMedia(p)[0] || null; }
  isVideo(p: Post): boolean { return this.first(p)?.type === 'video'; }
  thumb(p: Post): string { return thumbUrl(this.first(p)); }
  likes(p: Post): number { return likeCountOf(p); }
}
