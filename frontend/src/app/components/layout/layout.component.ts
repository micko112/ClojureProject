import { Component, signal, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, RouterOutlet } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ApiService } from '../../services/api.service';
import { UserStats } from '../../models/feed.model';
import { getRank, RankInfo } from '../../shared/ranks';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [CommonModule, RouterModule, RouterOutlet],
  templateUrl: './layout.component.html',
  styleUrls: ['./layout.component.css']
})
export class LayoutComponent {
  menuOpen = signal(false);
  settingsOpen = signal(false);
  stats: UserStats | null = null;
  statsLoading = false;

  constructor(public auth: AuthService, private api: ApiService) {}

  toggleMenu(): void {
    this.menuOpen.update(v => !v);
    if (this.menuOpen() && !this.stats) this.loadStats();
  }

  openSettings(): void {
    this.menuOpen.set(false);
    this.settingsOpen.set(true);
    if (!this.stats) this.loadStats();
  }

  closeSettings(): void { this.settingsOpen.set(false); }

  private loadStats(): void {
    const username = this.auth.currentUser()?.username;
    if (!username) return;
    this.statsLoading = true;
    this.api.getUserStats(username).subscribe({
      next: s => { this.stats = s; this.statsLoading = false; },
      error: () => { this.statsLoading = false; }
    });
  }

  logout(): void {
    this.menuOpen.set(false);
    this.auth.logout().subscribe();
  }

  @HostListener('document:click', ['$event'])
  onDocClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    if (!target.closest('.user-menu-wrap')) this.menuOpen.set(false);
  }

  rankFor(xp: number): RankInfo { return getRank(xp); }

  avatarColor(username: string): string {
    const colors = ['#7c6aff','#3b82f6','#22c55e','#f59e0b','#ef4444','#a855f7','#f97316','#10b981'];
    let hash = 0;
    for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }
}
