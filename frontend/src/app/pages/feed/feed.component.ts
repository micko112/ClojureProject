import { Component, OnInit, HostListener, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { StoriesBarComponent } from '../../components/stories-bar/stories-bar.component';
import { StoryViewerComponent } from '../../components/story-viewer/story-viewer.component';
import { ReelViewerComponent } from '../../components/reel-viewer/reel-viewer.component';

@Component({
  selector: 'app-feed',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, StoriesBarComponent, StoryViewerComponent, ReelViewerComponent],
  templateUrl: './feed.component.html',
  styleUrls: ['./feed.component.css']
})
export class FeedComponent implements OnInit {
  // Story viewer
  viewerGroups: any[] | null = null;
  viewerStartIndex = 0;

  // Reel viewer
  reelOpen = false;
  reelPosts: any[] = [];
  reelStartIndex = 0;

  posts: any[] = [];
  loading = true;
  trending: any[] = [];

  focusedIndex = -1;

  constructor(private api: ApiService, public auth: AuthService, private host: ElementRef) {}

  @HostListener('window:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    // Do not hijack keys inside inputs or when overlays are open
    if (this.reelOpen || this.viewerGroups) return;
    const target = e.target as HTMLElement | null;
    if (target) {
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target as any).isContentEditable) return;
    }
    if (!this.posts.length) return;

    switch (e.key) {
      case 'j':
      case 'ArrowDown':
        e.preventDefault();
        this.moveFocus(1);
        break;
      case 'k':
      case 'ArrowUp':
        e.preventDefault();
        this.moveFocus(-1);
        break;
      case 'Enter':
        if (this.focusedIndex >= 0) {
          e.preventDefault();
          this.openReel(this.posts[this.focusedIndex]);
        }
        break;
      case 'l':
      case 'L':
        if (this.focusedIndex >= 0) {
          e.preventDefault();
          this.likeFocused();
        }
        break;
      case 's':
      case 'S':
        if (this.focusedIndex >= 0) {
          e.preventDefault();
          this.toggleSaveFocused();
        }
        break;
    }
  }

  private moveFocus(delta: number): void {
    if (this.focusedIndex < 0) {
      this.focusedIndex = delta > 0 ? 0 : this.posts.length - 1;
    } else {
      const n = this.posts.length;
      this.focusedIndex = (this.focusedIndex + delta + n) % n;
    }
    // Wait for DOM update, then scroll into view
    setTimeout(() => {
      const cards = this.host.nativeElement.querySelectorAll('.post-card');
      const el = cards[this.focusedIndex] as HTMLElement | undefined;
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 0);
  }

  private likeFocused(): void {
    const post = this.posts[this.focusedIndex];
    if (!post) return;
    this.api.likePost(post.id).subscribe({
      next: r => { post.likes = r.likes; post.liked = r.liked; }
    });
  }

  private toggleSaveFocused(): void {
    const post = this.posts[this.focusedIndex];
    if (!post) return;
    const wasSaved = post.saved;
    post.saved = !wasSaved;
    const call = wasSaved ? this.api.unsavePost(post.id) : this.api.savePost(post.id);
    call.subscribe({ error: () => { post.saved = wasSaved; } });
  }

  ngOnInit(): void {
    this.loadFeed();
    this.loadTrending();
  }

  loadFeed(): void {
    this.loading = true;
    this.api.getFeed().subscribe({
      next: p => { this.posts = p; this.loading = false; },
      error: () => { this.loading = false; }
    });
  }

  loadTrending(): void {
    this.api.getTrending().subscribe({ next: t => { this.trending = t; }, error: () => {} });
  }

  // Story viewer
  openStoryViewer(e: { groups: any[]; index: number }): void {
    this.viewerGroups = e.groups;
    this.viewerStartIndex = e.index;
  }
  closeStoryViewer(): void { this.viewerGroups = null; }

  // Reel viewer — builds a relevance-sorted queue starting with the tapped post
  openReel(post: any): void {
    this.reelPosts = this.buildReelQueue(post);
    this.reelStartIndex = 0;
    this.reelOpen = true;
  }

  closeReel(): void { this.reelOpen = false; }

  onReelSaved(ev: { id: string; saved: boolean }): void {
    const p = this.posts.find(p => p.id === ev.id);
    if (p) p.saved = ev.saved;
  }

  private buildReelQueue(anchor: any): any[] {
    const score = (p: any): number => {
      let s = 0;
      if (p.activityTag && p.activityTag === anchor.activityTag) s += 50;
      const likes = Array.isArray(p.likes) ? p.likes.length : (p.likes || 0);
      s += Math.min(likes, 30);
      s += Math.min(p.commentCount || 0, 20);
      const ageH = (Date.now() - new Date(p.createdAt).getTime()) / 3_600_000;
      if (ageH < 24) s += 20;
      else if (ageH < 48) s += 10;
      return s;
    };
    const others = this.posts.filter(p => p.id !== anchor.id);
    others.sort((a, b) => score(b) - score(a));
    return [anchor, ...others];
  }

  like(post: any, event: Event): void {
    event.stopPropagation();
    this.api.likePost(post.id).subscribe({
      next: r => { post.likes = r.likes; post.liked = r.liked; },
      error: () => {}
    });
  }

  toggleSave(post: any, event: Event): void {
    event.stopPropagation();
    const wasSaved = post.saved;
    post.saved = !wasSaved;
    const call = wasSaved ? this.api.unsavePost(post.id) : this.api.savePost(post.id);
    call.subscribe({ error: () => { post.saved = wasSaved; } });
  }

  isVideo(url: string): boolean {
    return url ? /\.(mp4|webm|mov)$/i.test(url) : false;
  }

  timeAgo(dateStr: string): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) +
           ' · ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  me(): string { return this.auth.currentUser()?.username || ''; }

  initials(user: any): string {
    return (user?.displayName || user?.username || '?').charAt(0).toUpperCase();
  }

  likeCount(post: any): number {
    return Array.isArray(post.likes) ? post.likes.length : (post.likes || 0);
  }
}
