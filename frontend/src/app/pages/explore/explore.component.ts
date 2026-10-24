import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { PostGridComponent } from '../../components/post-grid/post-grid.component';
import { InViewDirective } from '../../components/post-grid/in-view.directive';
import { PostModalComponent } from '../../components/post-modal/post-modal.component';
import { PostService } from '../../services/post.service';
import { Post } from '../../models/post.model';

@Component({
  selector: 'app-explore',
  standalone: true,
  imports: [FormsModule, RouterModule, PostGridComponent, InViewDirective, PostModalComponent],
  template: `
    <div class="ex-page">
      <div class="ex-search">
        <span class="material-icons">search</span>
        <input [(ngModel)]="q" (ngModelChange)="onQuery()" placeholder="Search hashtags" aria-label="Search hashtags" />
        @if (q) { <button type="button" (click)="q = ''; tags = []" aria-label="Clear"><span class="material-icons">cancel</span></button> }
        @if (tags.length) {
          <div class="ex-results">
            @for (t of tags; track t.tag) {
              <a class="ex-tag" [routerLink]="['/explore/tags', t.tag]">
                <span class="ex-hash">#</span>
                <span><strong>#{{ t.tag }}</strong><small>{{ t.count }} {{ t.count === 1 ? 'post' : 'posts' }}</small></span>
              </a>
            }
          </div>
        }
      </div>

      @if (!loading && !posts.length) {
        <div class="ex-empty">
          <span class="material-icons">travel_explore</span>
          <p>Nothing to explore yet. As more people share their progress, it will show up here.</p>
        </div>
      }
      <app-post-grid [posts]="posts" [loading]="loading" (open)="selected = $event"></app-post-grid>
      @if (nextCursor) { <div appInView (inView)="loadMore()" class="ex-sentinel"></div> }
    </div>
    @if (selected) {
      <app-post-modal [initialPost]="selected" [postId]="selected.id" (closed)="selected = null" (removed)="onRemoved($event)"></app-post-modal>
    }
  `,
  styles: [`
    .ex-page { max-width: 935px; margin: 0 auto; padding: 24px 20px; }
    .ex-search { position: relative; display: flex; align-items: center; gap: 8px; background: var(--bg3);
                 border-radius: 8px; padding: 0 12px; height: 40px; margin-bottom: 24px; max-width: 470px; }
    .ex-search .material-icons { color: var(--text-muted); font-size: 20px; }
    .ex-search input { flex: 1; background: none; border: none; outline: none; color: var(--text); padding: 10px 0; font-size: 16px; }
    .ex-search input::placeholder { color: var(--text-muted); font-weight: 300; }
    .ex-search button { background: none; border: none; display: flex; padding: 0; color: var(--text-muted); }
    .ex-results { position: absolute; top: calc(100% + 6px); left: 0; right: 0; z-index: 40; background: var(--modal-bg);
                  border-radius: 8px; box-shadow: var(--shadow-lg);
                  max-height: 360px; overflow-y: auto; padding: 6px 0; }
    .ex-tag { display: flex; align-items: center; gap: 12px; padding: 8px 14px; }
    .ex-tag:hover { background: var(--hover-bg); }
    .ex-tag strong { display: block; font-size: 14px; }
    .ex-tag small { color: var(--text-muted); font-size: 12px; }
    .ex-hash { width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--border-mid); display: flex;
               align-items: center; justify-content: center; font-size: 18px; }
    .ex-empty { text-align: center; color: var(--text-muted); padding: 48px 16px; }
    .ex-empty .material-icons { font-size: 48px; margin-bottom: 8px; }
    .ex-sentinel { height: 1px; }
    @media (max-width: 735px) {
      .ex-page { padding: 8px 0 24px; }
      .ex-search { margin: 0 12px 10px; }
    }
  `]
})
export class ExploreComponent implements OnInit, OnDestroy {
  posts: Post[] = [];
  nextCursor: string | null = null;
  loading = true;
  selected: Post | null = null;
  q = '';
  tags: { tag: string; count: number }[] = [];
  private timer: any;

  constructor(private svc: PostService) {}

  ngOnInit(): void { this.load(); }
  ngOnDestroy(): void { clearTimeout(this.timer); }

  load(cursor: string | null = null): void {
    this.loading = true;
    this.svc.explore(cursor).subscribe({
      next: p => {
        const seen = new Set(this.posts.map(x => x.id));
        this.posts = [...this.posts, ...p.items.filter(x => !seen.has(x.id))];
        this.nextCursor = p.nextCursor || null;
        this.loading = false;
      },
      error: () => { this.loading = false; }
    });
  }

  loadMore(): void { if (!this.loading && this.nextCursor) this.load(this.nextCursor); }

  onQuery(): void {
    clearTimeout(this.timer);
    const q = this.q.trim().replace(/^#+/, '');
    if (!q) { this.tags = []; return; }
    this.timer = setTimeout(() => this.svc.searchHashtags(q).subscribe({ next: t => this.tags = t, error: () => {} }), 200);
  }

  onRemoved(p: Post): void { this.posts = this.posts.filter(x => x.id !== p.id); }
}
