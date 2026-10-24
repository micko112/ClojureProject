import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { PostGridComponent } from '../../components/post-grid/post-grid.component';
import { InViewDirective } from '../../components/post-grid/in-view.directive';
import { PostModalComponent } from '../../components/post-modal/post-modal.component';
import { PostService } from '../../services/post.service';
import { ComposerService } from '../../services/composer.service';
import { Post } from '../../models/post.model';
import { thumbUrl, postMedia } from '../../components/post-card/post-utils';

/** /explore/tags/:tag */
@Component({
  selector: 'app-hashtag',
  standalone: true,
  imports: [PostGridComponent, InViewDirective, PostModalComponent],
  template: `
    <div class="ht-page">
      <header class="ht-head">
        <div class="ht-cover">
          @if (cover) { <img [src]="cover" alt="" /> } @else { <span>#</span> }
        </div>
        <div>
          <h1>#{{ tag }}</h1>
          <p class="ht-count">@if (count !== null) { <strong>{{ count.toLocaleString('en-US') }}</strong> {{ count === 1 ? 'post' : 'posts' }} }</p>
          <button type="button" class="ht-btn" (click)="post()">Post your progress</button>
        </div>
      </header>
      <h2 class="ht-sub">Most recent</h2>
      @if (!loading && !posts.length) {
        <div class="ht-empty">No posts with #{{ tag }} yet. Be the first one.</div>
      }
      <app-post-grid [posts]="posts" [loading]="loading" (open)="selected = $event"></app-post-grid>
      @if (nextCursor) { <div appInView (inView)="loadMore()" style="height:1px"></div> }
    </div>
    @if (selected) {
      <app-post-modal [initialPost]="selected" [postId]="selected.id" (closed)="selected = null" (removed)="onRemoved($event)"></app-post-modal>
    }
  `,
  styles: [`
    .ht-page { max-width: 935px; margin: 0 auto; padding: 32px 20px; }
    .ht-head { display: flex; align-items: center; gap: 40px; padding: 0 0 32px 40px; }
    .ht-cover { width: 152px; height: 152px; border-radius: 50%; overflow: hidden; flex-shrink: 0; background: var(--bg3);
                display: flex; align-items: center; justify-content: center; font-size: 64px; font-weight: 300; }
    .ht-cover img { width: 100%; height: 100%; object-fit: cover; }
    h1 { font-size: 28px; font-weight: 400; margin-bottom: 8px; word-break: break-all; }
    .ht-count { font-size: 16px; margin-bottom: 14px; min-height: 24px; }
    .ht-btn { background: var(--brand-solid); color: #fff; border: none; border-radius: 8px; height: 32px; padding: 0 16px; font-weight: 600; font-size: 14px; }
    .ht-btn:hover { background: var(--brand-solid-hover); }
    .ht-sub { font-size: 14px; color: var(--text-muted); font-weight: 600; margin: 8px 0 12px; }
    .ht-empty { color: var(--text-muted); padding: 32px 0; text-align: center; }
    @media (max-width: 735px) {
      .ht-page { padding: 16px 0 24px; }
      .ht-head { gap: 20px; padding: 0 16px 20px; }
      .ht-cover { width: 77px; height: 77px; font-size: 34px; }
      h1 { font-size: 22px; }
      .ht-sub { padding: 0 16px; }
    }
  `]
})
export class HashtagComponent implements OnInit {
  tag = '';
  count: number | null = null;
  posts: Post[] = [];
  nextCursor: string | null = null;
  loading = true;
  selected: Post | null = null;
  cover = '';

  constructor(private route: ActivatedRoute, private svc: PostService, private composer: ComposerService) {}

  ngOnInit(): void {
    this.route.paramMap.subscribe(pm => {
      this.tag = (pm.get('tag') || '').replace(/^#+/, '').toLowerCase();
      this.posts = [];
      this.count = null;
      this.cover = '';
      this.nextCursor = null;
      this.load();
    });
  }

  load(cursor: string | null = null): void {
    this.loading = true;
    this.svc.hashtag(this.tag, cursor).subscribe({
      next: p => {
        this.posts = [...this.posts, ...p.items];
        this.count = p.count;
        this.nextCursor = p.nextCursor || null;
        this.loading = false;
        if (!this.cover) {
          const withMedia = this.posts.find(x => thumbUrl(postMedia(x)[0]));
          this.cover = withMedia ? thumbUrl(postMedia(withMedia)[0]) : '';
        }
      },
      error: () => { this.loading = false; this.count = 0; }
    });
  }

  loadMore(): void { if (!this.loading && this.nextCursor) this.load(this.nextCursor); }

  post(): void { this.composer.open({ source: 'hashtag:' + this.tag }); }

  onRemoved(p: Post): void { this.posts = this.posts.filter(x => x.id !== p.id); }
}
