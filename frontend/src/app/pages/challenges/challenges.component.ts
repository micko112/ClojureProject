import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-challenges',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './challenges.component.html',
  styleUrls: ['./challenges.component.css']
})
export class ChallengesComponent implements OnInit {
  challenges: any[] = [];
  loading = false;

  // New challenge
  newChallenged = '';
  sending = false;
  sendError = '';
  sendSuccess = '';

  constructor(private api: ApiService, public auth: AuthService) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading = true;
    this.api.getChallenges().subscribe({
      next: c => { this.challenges = c; this.loading = false; },
      error: () => { this.loading = false; }
    });
  }

  sendChallenge(): void {
    const target = this.newChallenged.trim();
    if (!target || this.sending) return;
    this.sending = true;
    this.sendError = '';
    this.sendSuccess = '';
    this.api.createChallenge(target).subscribe({
      next: () => {
        this.sending = false;
        this.sendSuccess = `Challenge sent to @${target}!`;
        this.newChallenged = '';
        this.load();
      },
      error: err => {
        this.sending = false;
        this.sendError = err?.error?.error || 'Failed to send challenge';
      }
    });
  }

  respond(id: number, action: 'accept' | 'decline'): void {
    this.api.respondChallenge(id, action).subscribe({
      next: () => this.load(),
      error: () => {}
    });
  }

  me(): string { return this.auth.currentUser()?.username || ''; }

  isPending(c: any): boolean { return c.status === 'pending'; }
  isActive(c: any): boolean  { return c.status === 'active'; }
  isDone(c: any): boolean    { return c.status === 'completed' || c.status === 'declined'; }

  isChallenged(c: any): boolean { return c.challenged.username === this.me(); }

  statusLabel(c: any): string {
    const m: Record<string, string> = { pending: 'Pending', active: 'Active', completed: 'Completed', declined: 'Declined' };
    return m[c.status] || c.status;
  }

  statusClass(c: any): string { return `status-${c.status}`; }

  timeAgo(dateStr: string): string {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const days = Math.floor(diff / 86_400_000);
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    return `${days}d ago`;
  }
}
