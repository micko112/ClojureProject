import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { LeaderboardEntry } from '../../models/leaderboard.model';
import { getRank, RankInfo } from '../../shared/ranks';

@Component({
  selector: 'app-leaderboard',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './leaderboard.component.html',
  styleUrls: ['./leaderboard.component.css']
})
export class LeaderboardComponent implements OnInit {
  entries: LeaderboardEntry[] = [];
  period = 'weekly';
  loading = false;
  error = '';

  constructor(private api: ApiService, public auth: AuthService) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading = true;
    this.error = '';
    this.api.getLeaderboard(this.period).subscribe({
      next: data => { this.entries = data; this.loading = false; },
      error: err => { this.error = err?.error?.error || 'Error'; this.loading = false; }
    });
  }

  setPeriod(p: string): void { this.period = p; this.load(); }

  deltaText(d: number): string {
    if (d > 0) return `↑${d}`;
    if (d < 0) return `↓${Math.abs(d)}`;
    return '—';
  }

  deltaClass(d: number): string {
    if (d > 0) return 'up';
    if (d < 0) return 'down';
    return 'same';
  }

  periodLabel(): string {
    return { daily:'Today',weekly:'This week',monthly:'This month',all:'All time' }[this.period] || this.period;
  }

  rankFor(totalXp: number): RankInfo { return getRank(totalXp); }

  avatarColor(username: string): string {
    const colors = ['#7c6aff','#3b82f6','#22c55e','#f59e0b','#ef4444','#a855f7','#f97316','#10b981'];
    let hash = 0;
    for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }
}
