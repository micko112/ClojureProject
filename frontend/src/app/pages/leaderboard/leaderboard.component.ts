import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-leaderboard',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './leaderboard.component.html',
  styleUrls: ['./leaderboard.component.css']
})
export class LeaderboardComponent implements OnInit {
  entries: any[] = [];
  loading = true;
  filter: 'global' | 'friends' = 'global';

  constructor(private api: ApiService, public auth: AuthService) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading = true;
    this.api.getLeaderboard(this.filter === 'friends' ? 'friends' : undefined).subscribe({
      next: e => { this.entries = e; this.loading = false; },
      error: () => { this.loading = false; }
    });
  }

  setFilter(f: 'global' | 'friends'): void {
    this.filter = f;
    this.load();
  }

  isMe(entry: any): boolean {
    return entry.username === this.auth.currentUser()?.username;
  }

  initials(entry: any): string {
    return (entry.displayName || entry.username || '?').charAt(0).toUpperCase();
  }
}
