import { Component, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { FeedItem, UserDaySummary, Reactions } from '../../models/feed.model';
import { Post } from '../../models/post.model';
import { ActivityType } from '../../models/activity.model';

const EMOJIS = [
  { emoji: '💪', label: 'Strong' },
  { emoji: '🔥', label: 'Fire' },
  { emoji: '😂', label: 'Haha' },
  { emoji: '😴', label: 'Lazy' },
  { emoji: '👏', label: 'Bravo' },
  { emoji: '🤦', label: 'Smh' },
];

export interface Story {
  username: string;
  activities: FeedItem[];
  totalXp: number;
  date: string;
}

@Component({
  selector: 'app-feed',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './feed.component.html',
  styleUrls: ['./feed.component.css']
})
export class FeedComponent implements OnInit {
  selectedDate = new Date().toISOString().slice(0, 10);
  period: 'daily' | 'weekly' = 'daily';
  groups: UserDaySummary[] = [];
  stories: Story[] = [];
  posts: Post[] = [];
  activityTypes: ActivityType[] = [];
  loading = false;
  error = '';
  emojis = EMOJIS;

  // Story overlay
  storyOpen = false;
  storyIndex = 0;

  // Create post
  showComposer = false;
  postContent = '';
  postTag = '';
  posting = false;

  constructor(private api: ApiService, public auth: AuthService) {}

  ngOnInit(): void {
    this.load();
    this.loadPosts();
    this.api.getActivityTypes().subscribe({ next: t => this.activityTypes = t });
  }

  load(): void {
    this.loading = true;
    this.error = '';
    this.api.getFeed(this.selectedDate, this.period).subscribe({
      next: data => {
        this.groups = this.buildGroups(data.items, data.reactions);
        this.stories = this.buildStories(data.items);
        this.loading = false;
      },
      error: err => { this.error = err?.error?.error || 'Error'; this.loading = false; }
    });
  }

  loadPosts(): void {
    this.api.getPosts(30).subscribe({
      next: p => this.posts = p,
      error: () => {}
    });
  }

  private buildGroups(items: FeedItem[], reactions: Reactions): UserDaySummary[] {
    const map = new Map<string, UserDaySummary>();
    for (const item of items) {
      const key = `${item.username}|${item.date}`;
      if (!map.has(key)) {
        const rxns = reactions?.[item.username]?.[item.date] || {};
        map.set(key, { username: item.username, date: item.date, items: [], totalXp: 0, reactions: rxns });
      }
      const g = map.get(key)!;
      g.items.push(item);
      g.totalXp += item.xp;
    }
    return Array.from(map.values()).sort((a, b) => b.totalXp - a.totalXp);
  }

  private buildStories(items: FeedItem[]): Story[] {
    const map = new Map<string, Story>();
    for (const item of items) {
      if (!map.has(item.username)) {
        map.set(item.username, { username: item.username, activities: [], totalXp: 0, date: item.date });
      }
      const s = map.get(item.username)!;
      s.activities.push(item);
      s.totalXp += item.xp;
    }
    const me = this.auth.currentUser()?.username;
    return Array.from(map.values()).sort((a, b) =>
      a.username === me ? -1 : b.username === me ? 1 : b.totalXp - a.totalXp
    );
  }

  // ── Stories ──────────────────────────────────────────────

  openStory(index: number): void {
    if (!this.stories[index]?.activities.length) return;
    this.storyIndex = index;
    this.storyOpen = true;
    document.body.style.overflow = 'hidden';
  }

  closeStory(): void {
    this.storyOpen = false;
    document.body.style.overflow = '';
  }

  prevStory(): void {
    if (this.storyIndex > 0) this.storyIndex--;
  }

  nextStory(): void {
    if (this.storyIndex < this.stories.length - 1) this.storyIndex++;
    else this.closeStory();
  }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    if (!this.storyOpen) return;
    if (e.key === 'ArrowRight') this.nextStory();
    if (e.key === 'ArrowLeft')  this.prevStory();
    if (e.key === 'Escape')     this.closeStory();
  }

  get currentStory(): Story { return this.stories[this.storyIndex]; }

  // ── Create post ───────────────────────────────────────────

  openComposer(): void { this.showComposer = true; }

  closeComposer(): void {
    this.showComposer = false;
    this.postContent = '';
    this.postTag = '';
  }

  submitPost(): void {
    const content = this.postContent.trim();
    if (!content || this.posting) return;
    this.posting = true;
    this.api.createPost({ content, activityTag: this.postTag || undefined }).subscribe({
      next: () => {
        this.posting = false;
        this.closeComposer();
        this.loadPosts();
      },
      error: err => {
        this.posting = false;
        this.error = err?.error?.error || 'Failed to post';
      }
    });
  }

  // ── Post likes ────────────────────────────────────────────

  toggleLike(post: Post): void {
    const me = this.auth.currentUser()?.username;
    if (!me) return;
    this.api.togglePostLike(post.id).subscribe({
      next: res => {
        if (res.action === 'added') {
          post.likes = [...post.likes, me];
        } else {
          post.likes = post.likes.filter(u => u !== me);
        }
      }
    });
  }

  iLiked(post: Post): boolean {
    const me = this.auth.currentUser()?.username;
    return !!me && post.likes.includes(me);
  }

  // ── Activity reactions ────────────────────────────────────

  toggleReaction(group: UserDaySummary, emoji: string): void {
    const me = this.auth.currentUser()?.username;
    if (!me || me === group.username) return;
    this.api.toggleReaction(group.username, group.date, emoji).subscribe({
      next: res => {
        if (res.action === 'added') {
          if (!group.reactions[emoji]) group.reactions[emoji] = [];
          group.reactions[emoji] = [...group.reactions[emoji], me];
        } else {
          group.reactions[emoji] = (group.reactions[emoji] || []).filter(u => u !== me);
          if (!group.reactions[emoji].length) delete group.reactions[emoji];
        }
      }
    });
  }

  iReacted(g: UserDaySummary, emoji: string): boolean {
    const me = this.auth.currentUser()?.username;
    return !!me && (g.reactions[emoji] || []).includes(me);
  }

  reactionCount(g: UserDaySummary, emoji: string): number {
    return (g.reactions[emoji] || []).length;
  }

  totalReactions(g: UserDaySummary): number {
    return Object.values(g.reactions).reduce((s, a) => s + a.length, 0);
  }

  // ── Navigation ────────────────────────────────────────────

  prevDay(): void {
    const d = new Date(this.selectedDate);
    d.setDate(d.getDate() - (this.period === 'weekly' ? 7 : 1));
    this.selectedDate = d.toISOString().slice(0, 10);
    this.load();
  }

  nextDay(): void {
    const d = new Date(this.selectedDate);
    d.setDate(d.getDate() + (this.period === 'weekly' ? 7 : 1));
    this.selectedDate = d.toISOString().slice(0, 10);
    this.load();
  }

  today(): void { this.selectedDate = new Date().toISOString().slice(0, 10); this.load(); }

  isToday(): boolean { return this.selectedDate === new Date().toISOString().slice(0, 10); }

  setPeriod(p: 'daily' | 'weekly'): void { this.period = p; this.load(); }

  // ── Helpers ───────────────────────────────────────────────

  isMe(u: string): boolean { return u === this.auth.currentUser()?.username; }

  avatarColor(username: string): string {
    const colors = ['#7c6aff','#3b82f6','#22c55e','#f59e0b','#ef4444','#a855f7','#f97316','#10b981'];
    let hash = 0;
    for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }

  storyGradient(username: string): string {
    const c = this.avatarColor(username);
    return `linear-gradient(145deg, ${c}33, ${c}11)`;
  }

  typeColor(type: string): string {
    const m: Record<string, string> = {
      'Training':'#3b82f6','Study':'#22c55e','Coding':'#a855f7','Work':'#f59e0b','Hobby / Yard work':'#f97316'
    };
    return m[type] || '#7c6aff';
  }

  typeEmoji(type: string): string {
    const m: Record<string, string> = {
      'Training':'🏋️','Study':'📚','Coding':'💻','Work':'💼','Hobby / Yard work':'🌿'
    };
    return m[type] || '⚡';
  }

  intensityLabel(n: number): string {
    return ['','Easy','Moderate','Medium','Hard','Max'][n] || String(n);
  }

  get periodLabel(): string {
    if (this.period === 'weekly') {
      const d = new Date(this.selectedDate);
      const day = d.getDay() || 7;
      const mon = new Date(d); mon.setDate(d.getDate() - day + 1);
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      return `${mon.toLocaleDateString('en-US',{day:'numeric',month:'short'})} – ${sun.toLocaleDateString('en-US',{day:'numeric',month:'short'})}`;
    }
    return new Date(this.selectedDate + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'long', day: 'numeric', month: 'long'
    });
  }

  timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days === 1) return 'yesterday';
    return `${days}d ago`;
  }

  activityTimeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr + 'T12:00:00').getTime();
    const days = Math.floor(diff / 86_400_000);
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    return `${days}d ago`;
  }
}
