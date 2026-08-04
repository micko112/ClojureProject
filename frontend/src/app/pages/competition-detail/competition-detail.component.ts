import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

const THEMES: Record<string, { label: string; color: string }> = {
  fitness:  { label: 'Fitness',  color: '#e63946' },
  coding:   { label: 'Coding',   color: '#457b9d' },
  learning: { label: 'Learning', color: '#2a9d8f' },
  creative: { label: 'Creative', color: '#e9c46a' },
  wellness: { label: 'Wellness', color: '#a8dadc' },
  sports:   { label: 'Sports',   color: '#f4a261' },
  general:  { label: 'General',  color: '#6c757d' },
};

@Component({
  selector: 'app-competition-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './competition-detail.component.html',
  styleUrls: ['./competition-detail.component.css']
})
export class CompetitionDetailComponent implements OnInit, OnDestroy {
  comp: any = null;
  leaderboard: any[] = [];
  feed: any[] = [];
  loading = true;

  activeTab: 'feed' | 'rules' | 'members' = 'feed';
  lbOpen = signal(false);

  private pollTimer: any;
  private compId = '';

  constructor(
    private api: ApiService,
    public auth: AuthService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.route.params.subscribe(p => {
      this.compId = p['id'];
      this.loadAll();
    });
    this.pollTimer = setInterval(() => this.loadAll(), 30_000);
  }

  ngOnDestroy(): void {
    clearInterval(this.pollTimer);
  }

  loadAll(): void {
    this.api.getCompetition(this.compId).subscribe({
      next: c => { this.comp = c; this.loading = false; },
      error: () => { this.loading = false; }
    });
    this.api.getCompetitionLeaderboard(this.compId).subscribe({
      next: lb => { this.leaderboard = lb; },
      error: () => {}
    });
    this.api.getCompetitionFeed(this.compId).subscribe({
      next: f => { this.feed = f; },
      error: () => {}
    });
  }

  get top3(): any[] { return this.leaderboard.slice(0, 3); }
  get rest(): any[] { return this.leaderboard.slice(3); }

  themeColor(): string {
    return THEMES[this.comp?.theme]?.color || '#6c757d';
  }

  themeLabel(): string {
    return THEMES[this.comp?.theme]?.label || 'General';
  }

  isMember(): boolean {
    const me = this.auth.currentUser()?.username;
    return this.comp?.members?.some((m: any) => m.username === me) ?? false;
  }

  isCreator(): boolean {
    return this.comp?.creator?.username === this.auth.currentUser()?.username;
  }

  toggleMembership(): void {
    this.api.toggleCompetitionMembership(this.compId).subscribe({
      next: r => {
        if (r.action === 'left') this.router.navigate(['/competitions']);
        else this.loadAll();
      },
      error: () => {}
    });
  }

  copyInviteCode(): void {
    navigator.clipboard.writeText(this.comp?.inviteCode || '').catch(() => {});
  }

  daysLeft(): string {
    if (!this.comp?.endDate) return '';
    const diff = (new Date(this.comp.endDate).getTime() - Date.now()) / 86400000;
    if (diff < 0) return 'Ended';
    if (diff < 1) return 'Ends today';
    return Math.ceil(diff) + ' days left';
  }

  podiumOrder(): any[] {
    const t = this.top3;
    if (t.length === 1) return [t[0]];
    if (t.length === 2) return [t[1], t[0]];
    return [t[1], t[0], t[2]];
  }

  podiumHeight(idx: number): number {
    const heights = [80, 110, 60];
    return heights[idx] || 60;
  }

  podiumRank(item: any, podiumIdx: number): number {
    const order = this.podiumOrder();
    return order[podiumIdx]?.rank || podiumIdx + 1;
  }

  medalIcon(rank: number): string {
    return ['looks_one', 'looks_two', 'looks_3'][rank - 1] || '';
  }

  avatar(u: any): string { return u?.profilePic || ''; }
  initials(u: any): string { return (u?.displayName || u?.username || '?').charAt(0).toUpperCase(); }

  timeAgo(dateStr: string): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  formatDate(d: string): string {
    if (!d) return '';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  intensityLabel(i: number): string {
    return ['', 'Easy', 'Light', 'Moderate', 'Hard', 'Extreme'][i] || '';
  }
}
