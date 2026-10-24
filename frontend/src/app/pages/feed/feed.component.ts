import { Component, ElementRef, HostListener, OnDestroy, OnInit } from '@angular/core';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { PostService } from '../../services/post.service';
import { ComposerService } from '../../services/composer.service';
import { StoriesBarComponent } from '../../components/stories-bar/stories-bar.component';
import { StoryViewerComponent } from '../../components/story-viewer/story-viewer.component';
import { PostCardComponent } from '../../components/post-card/post-card.component';
import { PostModalComponent } from '../../components/post-modal/post-modal.component';
import { InViewDirective } from '../../components/post-grid/in-view.directive';
import { likePost, savePost } from '../../components/post-card/post-actions.component';
import { Post, Streak } from '../../models/post.model';

@Component({
  selector: 'app-feed',
  standalone: true,
  imports: [RouterModule, StoriesBarComponent, StoryViewerComponent, PostCardComponent, PostModalComponent, InViewDirective],
  templateUrl: './feed.component.html',
  styleUrls: ['./feed.component.css']
})
export class FeedComponent implements OnInit, OnDestroy {
  // Story viewer
  viewerGroups: any[] | null = null;
  viewerStartIndex = 0;

  posts: Post[] = [];
  nextCursor: string | null = null;
  loading = true;
  loadingMore = false;
  loadError = false;
  trending: { tag: string; count: number; kind?: string }[] = [];
  streak: Streak | null = null;
  bannerDismissed = false;

  selected: Post | null = null;
  focusedIndex = -1;
  private sub?: Subscription;

  constructor(
    private api: ApiService,
    private postsSvc: PostService,
    private composer: ComposerService,
    public auth: AuthService,
    private host: ElementRef
  ) {}

  ngOnInit(): void {
    this.loadFeed();
    this.loadStreak();
    this.api.getTrending().subscribe({ next: t => { this.trending = t; }, error: () => {} });
    this.sub = this.composer.posted$.subscribe(p => {
      if (!this.posts.some(x => x.id === p.id)) this.posts = [p, ...this.posts];
      this.loadStreak();
    });
    this.bannerDismissed = this.readDismissed();
  }

  ngOnDestroy(): void { this.sub?.unsubscribe(); }

  loadFeed(): void {
    this.loading = true;
    this.loadError = false;
    this.postsSvc.feed(null).subscribe({
      next: p => { this.posts = p.items; this.nextCursor = p.nextCursor || null; this.loading = false; },
      error: () => { this.loading = false; this.loadError = true; }
    });
  }

  loadMore(): void {
    if (!this.nextCursor || this.loadingMore || this.loading) return;
    this.loadingMore = true;
    this.postsSvc.feed(this.nextCursor).subscribe({
      next: p => {
        const seen = new Set(this.posts.map(x => x.id));
        this.posts = [...this.posts, ...p.items.filter(x => !seen.has(x.id))];
        this.nextCursor = p.nextCursor || null;
        this.loadingMore = false;
      },
      error: () => { this.loadingMore = false; }
    });
  }

  loadStreak(): void {
    this.postsSvc.myStreak().subscribe({ next: s => { this.streak = s; }, error: () => {} });
  }

  openComposer(): void { this.composer.open({ source: 'streak-banner' }); }

  // "Maybe later" hides the prompt for the rest of today only.
  private static readonly DISMISS_KEY = 'bb-streak-banner-dismissed';
  private todayKey(): string { return new Date().toDateString(); }

  dismissBanner(): void {
    this.bannerDismissed = true;
    try { localStorage.setItem(FeedComponent.DISMISS_KEY, this.todayKey()); } catch {}
  }

  private readDismissed(): boolean {
    try { return localStorage.getItem(FeedComponent.DISMISS_KEY) === this.todayKey(); } catch { return false; }
  }

  streakMessage(s: Streak): string {
    if (s.current > 0) return `You're on a ${s.current}-day streak. Share today's step to keep it going.`;
    if (s.totalDays > 0) return 'Every day counts — no pressure, just progress. Pick up where you left off.';
    return 'Share your first day. Small steps count, and nobody starts perfect.';
  }

  onRemoved(p: Post): void {
    this.posts = this.posts.filter(x => x.id !== p.id);
    this.loadStreak();
  }

  open(p: Post): void { this.selected = p; }

  // Story viewer
  openStoryViewer(e: { groups: any[]; index: number }): void {
    this.viewerGroups = e.groups;
    this.viewerStartIndex = e.index;
  }
  closeStoryViewer(): void { this.viewerGroups = null; }

  @HostListener('window:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    // Do not hijack keys inside inputs or when overlays are open
    if (this.selected || this.viewerGroups) return;
    const target = e.target as HTMLElement | null;
    if (target) {
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
    }
    if (!this.posts.length || e.metaKey || e.ctrlKey || e.altKey) return;
    const post = this.posts[this.focusedIndex];
    switch (e.key) {
      case 'j': case 'ArrowDown': e.preventDefault(); this.moveFocus(1); break;
      case 'k': case 'ArrowUp': e.preventDefault(); this.moveFocus(-1); break;
      case 'Enter': if (post) { e.preventDefault(); this.open(post); } break;
      case 'l': case 'L': if (post) { e.preventDefault(); likePost(this.postsSvc, post); } break;
      case 's': case 'S': if (post) { e.preventDefault(); savePost(this.postsSvc, post); } break;
    }
  }

  private moveFocus(delta: number): void {
    const n = this.posts.length;
    this.focusedIndex = this.focusedIndex < 0 ? (delta > 0 ? 0 : n - 1) : (this.focusedIndex + delta + n) % n;
    setTimeout(() => {
      const el = this.host.nativeElement.querySelectorAll('app-post-card')[this.focusedIndex] as HTMLElement | undefined;
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
}
