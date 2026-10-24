import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { AccountsService, RelationKind } from '../../services/accounts.service';
import { ToastService } from '../../services/toast.service';
import { ReelViewerComponent } from '../../components/reel-viewer/reel-viewer.component';
import { StoryViewerComponent } from '../../components/story-viewer/story-viewer.component';
import { MediaComponent } from '../../components/media/media.component';
import { UserListModalComponent } from './user-list-modal.component';
import { Media } from '../../models/media.model';
import { ListUser, Profile } from '../../models/user.model';

interface GridItem {
  post: any;
  thumb: Media | null;
  multi: boolean;
  video: boolean;
}

type Sheet = 'menu' | 'following' | null;

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, RouterModule, ReelViewerComponent, StoryViewerComponent, MediaComponent, UserListModalComponent],
  templateUrl: './profile.component.html',
  styleUrls: ['./profile.component.css']
})
export class ProfileComponent implements OnInit, OnDestroy {
  profile: Profile | null = null;
  badges: any[] = [];
  userPosts: any[] = [];
  savedPosts: any[] = [];
  postItems: GridItem[] = [];
  savedItems: GridItem[] = [];
  loading = true;
  postsLoading = false;
  savedLoading = false;
  followLoading = false;
  isMe = false;

  activeTab: 'posts' | 'saved' | 'tagged' = 'posts';

  // Stories ring
  storyGroup: any = null;
  storyOpen = false;

  // Reel viewer
  reelOpen = false;
  reelPosts: any[] = [];
  reelStartIndex = 0;

  // Followers / following modal
  listKind: 'followers' | 'following' | null = null;

  sheet: Sheet = null;

  // Discover people (own profile)
  showSuggested = false;
  suggested: ListUser[] = [];

  private sub?: Subscription;

  constructor(
    private api: ApiService,
    private accounts: AccountsService,
    public auth: AuthService,
    private toast: ToastService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.sub = this.route.params.subscribe(p => this.loadProfile(p['username']));
  }

  ngOnDestroy(): void { this.sub?.unsubscribe(); }

  get followRequestCount(): number {
    return this.auth.currentUser()?.settings?.followRequestCount || 0;
  }

  get canSeePosts(): boolean {
    return !!this.profile && (this.isMe || this.profile.canViewPosts !== false);
  }

  loadProfile(username: string): void {
    this.loading = true;
    this.activeTab = 'posts';
    this.sheet = null;
    this.listKind = null;
    this.storyGroup = null;
    this.savedPosts = [];
    this.savedItems = [];
    this.userPosts = [];
    this.postItems = [];
    this.accounts.getProfile(username).subscribe({
      next: p => {
        this.profile = p;
        this.loading = false;
        this.isMe = p.isMe ?? (p.username === this.auth.currentUser()?.username);
        if (this.canSeePosts) this.loadUserPosts(p.username);
        this.loadStoryRing(p.username);
      },
      error: () => { this.profile = null; this.loading = false; }
    });
    this.api.getBadges(username).subscribe({
      next: b => { this.badges = b || []; },
      error: () => { this.badges = []; }
    });
  }

  private refreshHeader(): void {
    if (!this.profile) return;
    const name = this.profile.username;
    this.accounts.getProfile(name).subscribe({
      next: p => {
        const couldSee = this.canSeePosts;
        this.profile = p;
        if (!couldSee && this.canSeePosts) this.loadUserPosts(name);
        if (!this.canSeePosts) { this.userPosts = []; this.postItems = []; }
      }
    });
  }

  loadUserPosts(username: string): void {
    this.postsLoading = true;
    this.api.getUserPosts(username).subscribe({
      next: posts => {
        this.userPosts = posts || [];
        this.postItems = this.userPosts.map(p => this.gridItem(p));
        this.postsLoading = false;
      },
      error: () => { this.userPosts = []; this.postItems = []; this.postsLoading = false; }
    });
  }

  private loadStoryRing(username: string): void {
    this.api.getStories().subscribe({
      next: groups => { this.storyGroup = (groups || []).find((g: any) => g.username === username && g.stories?.length) || null; },
      error: () => { this.storyGroup = null; }
    });
  }

  // ---- grid helpers ----

  private isVideoUrl(url?: string): boolean {
    return url ? /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url) : false;
  }

  /** Smallest rendition for the 3-column grid; legacy posts only have mediaUrl. */
  private gridItem(post: any): GridItem {
    const list: Media[] = Array.isArray(post.media) ? post.media : [];
    const first = list[0];
    let thumb: Media | null = null;
    let video = false;
    if (first) {
      video = first.type === 'video';
      const smallest = first.variants?.length ? first.variants[0].url : null;
      if (video && first.posterUrl) {
        thumb = { id: first.id, type: 'image', url: first.posterUrl, placeholder: first.placeholder };
      } else if (smallest && !video) {
        thumb = { ...first, url: smallest };
      } else {
        thumb = first;
      }
    } else if (post.mediaUrl) {
      video = this.isVideoUrl(post.mediaUrl);
      thumb = { id: String(post.id), type: video ? 'video' : 'image', url: post.mediaUrl };
    }
    return { post, thumb, video, multi: list.length > 1 };
  }

  likeCount(post: any): number {
    return post.likeCount ?? post.likes?.length ?? 0;
  }

  setTab(tab: 'posts' | 'saved' | 'tagged'): void {
    this.activeTab = tab;
    if (tab === 'saved' && !this.savedPosts.length && !this.savedLoading) {
      this.savedLoading = true;
      this.api.getSavedPosts().subscribe({
        next: posts => {
          this.savedPosts = posts || [];
          this.savedItems = this.savedPosts.map(p => this.gridItem(p));
          this.savedLoading = false;
        },
        error: () => { this.savedLoading = false; }
      });
    }
  }

  openReel(post: any, allPosts: any[]): void {
    const others = allPosts.filter(p => p.id !== post.id);
    this.reelPosts = [post, ...others];
    this.reelStartIndex = 0;
    this.reelOpen = true;
  }

  closeReel(): void { this.reelOpen = false; }

  onReelSaved(ev: { id: string; saved: boolean }): void {
    const inPosts = this.userPosts.find(p => p.id === ev.id);
    if (inPosts) inPosts.saved = ev.saved;
    const inSaved = this.savedPosts.find(p => p.id === ev.id);
    if (inSaved) inSaved.saved = ev.saved;
    if (!ev.saved) {
      this.savedPosts = this.savedPosts.filter(p => p.id !== ev.id);
      this.savedItems = this.savedItems.filter(i => i.post.id !== ev.id);
    }
  }

  openAvatar(): void {
    if (this.storyGroup) this.storyOpen = true;
    else if (this.isMe) this.router.navigate(['/settings', 'edit-profile']);
  }

  closeStory(): void {
    this.storyOpen = false;
    if (this.profile) this.loadStoryRing(this.profile.username);
  }

  // ---- follow ----

  followLabel(): string {
    const p = this.profile;
    if (!p) return 'Follow';
    if (p.followStatus === 'following') return 'Following';
    if (p.followStatus === 'requested') return 'Requested';
    return p.followsYou ? 'Follow back' : 'Follow';
  }

  onFollowButton(): void {
    if (!this.profile) return;
    if (this.profile.followStatus === 'following') { this.sheet = 'following'; return; }
    this.toggleFollow();
  }

  toggleFollow(): void {
    const p = this.profile;
    if (!p || this.followLoading) return;
    if (p.followStatus === 'following' && p.isPrivate &&
        !confirm(`Unfollow ${p.username}? You'll have to request to follow again to see their progress.`)) return;
    this.followLoading = true;
    const wasFollowing = p.followStatus === 'following';
    this.accounts.toggleFollow(p.username).subscribe({
      next: r => {
        p.followStatus = r.followStatus;
        p.isFollowing = r.followStatus === 'following';
        if (r.action === 'followed') p.followersCount = (p.followersCount || 0) + 1;
        if (wasFollowing) p.followersCount = Math.max(0, (p.followersCount || 1) - 1);
        this.followLoading = false;
        this.sheet = null;
        this.refreshHeader();
      },
      error: e => { this.followLoading = false; this.toast.error(e?.error?.error || 'Could not update follow.'); }
    });
  }

  // ---- menu actions ----

  private relation(kind: RelationKind, on: boolean, done: string): void {
    const p = this.profile;
    if (!p) return;
    const req = on ? this.accounts.add(kind, p.username) : this.accounts.remove(kind, p.username);
    req.subscribe({
      next: () => { this.toast.success(done); this.sheet = null; this.refreshHeader(); },
      error: e => this.toast.error(e?.error?.error || 'Something went wrong.')
    });
  }

  toggleBlock(): void {
    const p = this.profile;
    if (!p) return;
    if (!p.blocked && !confirm(`Block ${p.username}? They won't be able to find your profile, posts or story. They won't be notified.`)) return;
    this.relation('blocks', !p.blocked, p.blocked ? `Unblocked ${p.username}` : `Blocked ${p.username}`);
  }

  toggleRestrict(): void {
    const p = this.profile;
    if (p) this.relation('restricts', !p.restricted, p.restricted ? `Unrestricted ${p.username}` : `Restricted ${p.username}`);
  }

  toggleMute(): void {
    const p = this.profile;
    if (p) this.relation('mutes', !p.muted, p.muted ? `Unmuted ${p.username}` : `Muted ${p.username}. You won't see their posts in your feed.`);
  }

  toggleCloseFriend(): void {
    const p = this.profile;
    if (p) this.relation('close-friends', !p.closeFriend, p.closeFriend ? 'Removed from close friends' : 'Added to close friends');
  }

  report(): void {
    this.sheet = null;
    this.toast.info('Thanks for letting us know. Reporting is coming soon.');
  }

  profileUrl(): string {
    return `${location.origin}/profile/${this.profile?.username}`;
  }

  copyProfileUrl(): void {
    const url = this.profileUrl();
    this.sheet = null;
    const done = () => this.toast.success('Profile link copied');
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(done, () => this.toast.info(url));
    } else {
      this.toast.info(url);
    }
  }

  shareProfile(): void {
    const nav: any = navigator;
    if (nav.share) {
      nav.share({ title: this.profile?.username, url: this.profileUrl() }).catch(() => {});
    } else {
      this.copyProfileUrl();
    }
  }

  messageUser(): void {
    if (this.profile) this.router.navigate(['/chat'], { queryParams: { with: this.profile.username } });
  }

  // ---- lists ----

  openList(kind: 'followers' | 'following'): void {
    if (!this.canSeePosts) return;
    this.listKind = kind;
  }

  onListChanged(): void { this.refreshHeader(); }

  toggleSuggested(): void {
    this.showSuggested = !this.showSuggested;
    if (this.showSuggested && !this.suggested.length) {
      this.accounts.suggested(15).subscribe({ next: s => this.suggested = s, error: () => {} });
    }
  }

  followSuggested(u: ListUser): void {
    this.accounts.toggleFollow(u.username).subscribe({
      next: r => {
        u.followStatus = r.followStatus;
        if (r.action === 'followed' && this.profile) this.profile.followingCount = (this.profile.followingCount || 0) + 1;
        if (r.action === 'unfollowed' && this.profile) this.profile.followingCount = Math.max(0, (this.profile.followingCount || 1) - 1);
      }
    });
  }

  dismissSuggested(u: ListUser): void {
    this.suggested = this.suggested.filter(x => x.username !== u.username);
  }

  initials(name?: string): string {
    return (name || this.profile?.displayName || this.profile?.username || '?').charAt(0).toUpperCase();
  }

  websiteLabel(url?: string): string {
    return (url || '').replace(/^https?:\/\//i, '').replace(/\/$/, '');
  }
}
