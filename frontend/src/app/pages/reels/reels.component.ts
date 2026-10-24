import {
  AfterViewInit, Component, ElementRef, HostListener, OnDestroy, OnInit,
  QueryList, ViewChild, ViewChildren, computed, inject, signal
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Observable, catchError, forkJoin, map, of } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { ComposerService } from '../../services/composer.service';
import { ToastService } from '../../services/toast.service';
import { BRAND } from '../../core/brand';

export interface Reel {
  post: any;
  src: string;
  poster?: string;
}

interface Page { items: any[]; nextCursor?: string | null; }

const VIDEO_RE = /\.(mp4|webm|mov|m4v|ogv)(\?.*)?$/i;

/** Normalises `[...]` or `{items, nextCursor}` list responses. */
function toPage(r: any): Page {
  if (Array.isArray(r)) return { items: r, nextCursor: null };
  return { items: r?.items ?? r?.posts ?? [], nextCursor: r?.nextCursor ?? null };
}

/** Picks the first video of a post (media[] contract or legacy mediaUrl). */
export function reelFromPost(post: any): Reel | null {
  const media: any[] = Array.isArray(post?.media) ? post.media : [];
  const v = media.find(m => m?.type === 'video' || VIDEO_RE.test(m?.url || ''));
  if (v?.url) return { post, src: v.url, poster: v.posterUrl || v.placeholder };
  if (post?.mediaUrl && VIDEO_RE.test(post.mediaUrl)) return { post, src: post.mediaUrl };
  return null;
}

@Component({
  selector: 'app-reels',
  standalone: true,
  imports: [FormsModule, RouterModule],
  templateUrl: './reels.component.html',
  styleUrls: ['./reels.component.css']
})
export class ReelsComponent implements OnInit, AfterViewInit, OnDestroy {
  private api = inject(ApiService);
  private http = inject(HttpClient);
  private toast = inject(ToastService);
  auth = inject(AuthService);
  composer = inject(ComposerService);
  readonly brand = BRAND;

  @ViewChild('scroller') scroller?: ElementRef<HTMLElement>;
  @ViewChildren('reelEl') reelEls!: QueryList<ElementRef<HTMLElement>>;

  readonly reels = signal<Reel[]>([]);
  readonly loading = signal(true);
  readonly active = signal(0);
  readonly muted = signal(true);
  readonly paused = signal(false);
  readonly flash = signal<'mute' | 'unmute' | null>(null);
  readonly heartAt = signal<number | null>(null);
  readonly expanded = signal<Set<string>>(new Set());

  // Comments sheet
  readonly commentsFor = signal<Reel | null>(null);
  readonly comments = signal<any[]>([]);
  readonly commentsLoading = signal(false);
  newComment = '';
  posting = false;

  readonly current = computed(() => this.reels()[this.active()]);

  private cursors: { feed?: string | null; explore?: string | null } = {};
  private loadingMore = false;
  private io?: IntersectionObserver;
  private tapTimer: any;
  private flashTimer: any;
  private changesSub?: { unsubscribe(): void };

  ngOnInit(): void { this.load(); }

  ngAfterViewInit(): void {
    this.changesSub = this.reelEls.changes.subscribe(() => this.observe());
  }

  ngOnDestroy(): void {
    this.io?.disconnect();
    this.changesSub?.unsubscribe();
    clearTimeout(this.tapTimer);
    clearTimeout(this.flashTimer);
  }

  // ---------- Data ----------
  private fetch(url: string, cursor?: string | null): Observable<Page> {
    const opts = cursor ? { params: { cursor } } : {};
    return this.http.get<any>(url, opts).pipe(map(toPage), catchError(() => of({ items: [], nextCursor: null } as Page)));
  }

  load(): void {
    this.loading.set(true);
    forkJoin([this.fetch('/api/feed'), this.fetch('/api/explore')]).subscribe(([feed, explore]) => {
      this.cursors = { feed: feed.nextCursor, explore: explore.nextCursor };
      this.reels.set(this.merge([], [...feed.items, ...explore.items]));
      this.loading.set(false);
    });
  }

  private loadMore(): void {
    if (this.loadingMore) return;
    const calls: Observable<Page>[] = [];
    if (this.cursors.feed) calls.push(this.fetch('/api/feed', this.cursors.feed));
    if (this.cursors.explore) calls.push(this.fetch('/api/explore', this.cursors.explore));
    if (!calls.length) return;
    this.loadingMore = true;
    const hadFeed = !!this.cursors.feed;
    forkJoin(calls).subscribe(pages => {
      if (hadFeed) this.cursors.feed = pages[0].nextCursor;
      if (this.cursors.explore) this.cursors.explore = pages[pages.length - 1].nextCursor;
      this.reels.set(this.merge(this.reels(), pages.flatMap(p => p.items)));
      this.loadingMore = false;
    });
  }

  private merge(existing: Reel[], posts: any[]): Reel[] {
    const seen = new Set(existing.map(r => String(r.post.id)));
    const out = [...existing];
    for (const p of posts) {
      if (!p || seen.has(String(p.id))) continue;
      const r = reelFromPost(p);
      if (r) { out.push(r); seen.add(String(p.id)); }
    }
    return out;
  }

  // ---------- Playback ----------
  private observe(): void {
    this.io?.disconnect();
    this.io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.isIntersecting && e.intersectionRatio >= 0.6) {
          const idx = Number((e.target as HTMLElement).dataset['idx']);
          if (idx !== this.active()) { this.active.set(idx); this.paused.set(false); }
          setTimeout(() => this.syncPlayback());
          if (idx >= this.reels().length - 3) this.loadMore();
        }
      }
    }, { root: this.scroller?.nativeElement, threshold: [0.6] });
    this.reelEls.forEach(el => this.io!.observe(el.nativeElement));
    setTimeout(() => this.syncPlayback());
  }

  /** Plays the active video, pauses every other one. */
  syncPlayback(): void {
    this.reelEls?.forEach(ref => {
      const el = ref.nativeElement;
      const idx = Number(el.dataset['idx']);
      const video = el.querySelector('video');
      if (!video) return;
      video.muted = this.muted();
      if (idx === this.active() && !this.paused()) {
        video.play().catch(() => {
          // Autoplay with sound blocked: fall back to muted playback.
          if (!video.muted) { this.muted.set(true); video.muted = true; video.play().catch(() => {}); }
        });
      } else {
        video.pause();
        if (idx !== this.active()) video.currentTime = 0;
      }
    });
  }

  /** Render a <video> only near the active reel to keep memory low. */
  isNear(i: number): boolean { return Math.abs(i - this.active()) <= 1; }

  onTap(i: number): void {
    if (this.tapTimer) {
      clearTimeout(this.tapTimer);
      this.tapTimer = null;
      this.doubleTapLike(i);
      return;
    }
    this.tapTimer = setTimeout(() => {
      this.tapTimer = null;
      this.toggleMute();
    }, 260);
  }

  toggleMute(): void {
    this.muted.update(m => !m);
    this.flash.set(this.muted() ? 'mute' : 'unmute');
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => this.flash.set(null), 700);
    this.syncPlayback();
  }

  togglePause(): void {
    this.paused.update(p => !p);
    this.syncPlayback();
  }

  // ---------- Keyboard (desktop) ----------
  @HostListener('window:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (this.commentsFor()) { if (e.key === 'Escape') this.closeComments(); return; }
    switch (e.key) {
      case 'ArrowDown': case 'j': e.preventDefault(); this.go(1); break;
      case 'ArrowUp': case 'k': e.preventDefault(); this.go(-1); break;
      case 'm': case 'M': this.toggleMute(); break;
      case ' ': e.preventDefault(); this.togglePause(); break;
      case 'l': case 'L': this.like(this.current()); break;
    }
  }

  go(delta: number): void {
    const next = Math.min(Math.max(this.active() + delta, 0), this.reels().length - 1);
    const el = this.reelEls?.get(next)?.nativeElement;
    el?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }

  // ---------- Actions ----------
  likeCount(p: any): number {
    if (typeof p?.likeCount === 'number') return p.likeCount;
    if (Array.isArray(p?.likes)) return p.likes.length;
    return typeof p?.likes === 'number' ? p.likes : 0;
  }

  private doubleTapLike(i: number): void {
    const r = this.reels()[i];
    this.heartAt.set(i);
    setTimeout(() => { if (this.heartAt() === i) this.heartAt.set(null); }, 900);
    if (r && !r.post.liked) this.like(r);
  }

  like(r?: Reel): void {
    if (!r) return;
    const p = r.post;
    const was = !!p.liked;
    const before = this.likeCount(p);
    this.patchPost(r, { liked: !was, likeCount: Math.max(0, before + (was ? -1 : 1)) });
    this.api.likePost(p.id).subscribe({
      next: (res: any) => {
        const patch: any = {};
        if (typeof res?.liked === 'boolean') patch.liked = res.liked;
        if (Array.isArray(res?.likes)) { patch.likes = res.likes; patch.likeCount = res.likes.length; }
        else if (typeof res?.likeCount === 'number') patch.likeCount = res.likeCount;
        this.patchPost(r, patch);
      },
      error: () => this.patchPost(r, { liked: was, likeCount: before })
    });
  }

  toggleSave(r: Reel): void {
    const was = !!r.post.saved;
    this.patchPost(r, { saved: !was });
    (was ? this.api.unsavePost(r.post.id) : this.api.savePost(r.post.id)).subscribe({
      next: () => { if (!was) this.toast.success('Saved for later'); },
      error: () => this.patchPost(r, { saved: was })
    });
  }

  async share(r: Reel): Promise<void> {
    const url = `${location.origin}/post/${r.post.id}`;
    const title = `${r.post.author?.username || 'Someone'}'s progress on ${BRAND.name}`;
    try {
      if (navigator.share) { await navigator.share({ title, url }); return; }
      await navigator.clipboard.writeText(url);
      this.toast.success('Link copied');
    } catch { /* share sheet dismissed */ }
  }

  private patchPost(r: Reel, patch: any): void {
    this.reels.update(list => list.map(x => x === r || x.post.id === r.post.id
      ? Object.assign(x, { post: { ...x.post, ...patch } })
      : x));
  }

  toggleCaption(id: string, e: Event): void {
    e.stopPropagation();
    this.expanded.update(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  // ---------- Comments sheet ----------
  openComments(r: Reel): void {
    this.commentsFor.set(r);
    this.comments.set([]);
    this.commentsLoading.set(true);
    this.api.getComments(r.post.id).subscribe({
      next: c => { this.comments.set(Array.isArray(c) ? c : ((c as any)?.items ?? [])); this.commentsLoading.set(false); },
      error: () => this.commentsLoading.set(false)
    });
  }

  closeComments(): void { this.commentsFor.set(null); this.newComment = ''; }

  addComment(): void {
    const r = this.commentsFor();
    const content = this.newComment.trim();
    if (!r || !content || this.posting) return;
    this.posting = true;
    this.api.createComment(r.post.id, content).subscribe({
      next: (c: any) => {
        this.posting = false;
        this.newComment = '';
        const me = this.auth.currentUser();
        this.comments.update(list => [...list, c?.id ? c : { id: 'tmp' + Date.now(), content, author: me, createdAt: new Date().toISOString() }]);
        this.patchPost(r, { commentCount: (r.post.commentCount || 0) + 1 });
      },
      error: () => { this.posting = false; this.toast.error("Couldn't post your comment. Please try again."); }
    });
  }

  initials(u: any): string { return (u?.displayName || u?.username || '?').charAt(0).toUpperCase(); }

  compact(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 10_000) return Math.floor(n / 1000) + 'K';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
  }

  timeAgo(dateStr: string): string {
    if (!dateStr) return '';
    const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
    if (diff < 60) return 'now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h';
    return Math.floor(diff / 86400) + 'd';
  }
}
