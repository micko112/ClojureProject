import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { UserStats, FeedItem } from '../../models/feed.model';
import { Post } from '../../models/post.model';
import { getRank, RankInfo } from '../../shared/ranks';
import { forkJoin } from 'rxjs';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './profile.component.html',
  styleUrls: ['./profile.component.css']
})
export class ProfileComponent implements OnInit {
  username = '';
  stats: UserStats | null = null;
  rank: RankInfo | null = null;
  posts: Post[] = [];
  weekGroups: { date: string; items: FeedItem[]; totalXp: number }[] = [];
  loading = true;
  postsLoading = true;
  weekLoading = true;

  constructor(
    private route: ActivatedRoute,
    private api: ApiService,
    public auth: AuthService
  ) {}

  ngOnInit(): void {
    this.route.params.subscribe(params => {
      this.username = params['username'];
      this.loadAll();
    });
  }

  loadAll(): void {
    this.loading = true;
    this.postsLoading = true;
    this.weekLoading = true;
    const today = new Date().toISOString().slice(0, 10);

    forkJoin({
      stats: this.api.getUserStats(this.username),
      posts: this.api.getUserPosts(this.username),
      feed:  this.api.getFeed(today, 'weekly'),
    }).subscribe({
      next: ({ stats, posts, feed }) => {
        this.stats = stats;
        this.rank = getRank(stats.totalXp);
        this.posts = posts;
        const myItems = feed.items.filter(i => i.username === this.username);
        this.weekGroups = this.buildWeekGroups(myItems);
        this.loading = false;
        this.postsLoading = false;
        this.weekLoading = false;
      },
      error: () => {
        this.loading = false;
        this.postsLoading = false;
        this.weekLoading = false;
      }
    });
  }

  private buildWeekGroups(items: FeedItem[]): { date: string; items: FeedItem[]; totalXp: number }[] {
    const map = new Map<string, { date: string; items: FeedItem[]; totalXp: number }>();
    for (const item of items) {
      if (!map.has(item.date)) map.set(item.date, { date: item.date, items: [], totalXp: 0 });
      const g = map.get(item.date)!;
      g.items.push(item);
      g.totalXp += item.xp;
    }
    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }

  isMe(): boolean { return this.username === this.auth.currentUser()?.username; }

  formatDay(dateStr: string): string {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'short', day: 'numeric', month: 'short'
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

  avatarColor(username: string): string {
    const colors = ['#7c6aff','#3b82f6','#22c55e','#f59e0b','#ef4444','#a855f7','#f97316','#10b981'];
    let hash = 0;
    for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }

  typeEmoji(type: string): string {
    const m: Record<string, string> = {
      'Training':'🏋️','Study':'📚','Coding':'💻','Work':'💼','Hobby / Yard work':'🌿'
    };
    return m[type] || '⚡';
  }

  typeColor(type: string): string {
    const m: Record<string, string> = {
      'Training':'#3b82f6','Study':'#22c55e','Coding':'#a855f7','Work':'#f59e0b','Hobby / Yard work':'#f97316'
    };
    return m[type] || '#7c6aff';
  }

  intensityLabel(n: number): string {
    return ['','Easy','Moderate','Medium','Hard','Max'][n] || String(n);
  }

  xpTypeEntries(): { type: string; xp: number; pct: number }[] {
    if (!this.stats?.xpByType) return [];
    const entries = Object.entries(this.stats.xpByType).map(([type, xp]) => ({ type, xp }));
    const max = Math.max(...entries.map(e => e.xp), 1);
    return entries.sort((a, b) => b.xp - a.xp).map(e => ({ ...e, pct: (e.xp / max) * 100 }));
  }
}
