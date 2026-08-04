import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

interface DayXp { date: string; xp: number; }
interface TypeStat { type: string; xp: number; count: number; }

interface RecapData {
  totalXp: number;
  dailyXp: DayXp[];
  topTypes: TypeStat[];
  activeDays: number;
  totalActs: number;
  bestDay: DayXp | null;
  streak: number;
  period: string;
}

@Component({
  selector: 'app-recap',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './recap.component.html',
  styleUrls: ['./recap.component.css']
})
export class RecapComponent implements OnInit {
  period: 'weekly' | 'monthly' = 'weekly';
  data: RecapData | null = null;
  loading = false;

  constructor(private api: ApiService, public auth: AuthService) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    const username = this.auth.currentUser()?.username;
    if (!username) return;
    this.loading = true;
    this.api.getRecap(username, this.period).subscribe({
      next: d => { this.data = d; this.loading = false; },
      error: () => { this.loading = false; }
    });
  }

  setPeriod(p: 'weekly' | 'monthly'): void {
    this.period = p;
    this.load();
  }

  maxXp(): number {
    if (!this.data?.dailyXp.length) return 1;
    return Math.max(...this.data.dailyXp.map(d => d.xp), 1);
  }

  barPct(xp: number): number { return Math.round((xp / this.maxXp()) * 100); }

  maxTypeXp(): number {
    if (!this.data?.topTypes.length) return 1;
    return Math.max(...this.data.topTypes.map(t => t.xp), 1);
  }

  typeBarPct(xp: number): number { return Math.round((xp / this.maxTypeXp()) * 100); }

  formatDate(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  shortDate(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00');
    if (this.period === 'weekly') return d.toLocaleDateString('en-US', { weekday: 'short' });
    return String(d.getDate());
  }

  typeColor(type: string): string {
    const m: Record<string, string> = {
      'Training / Gym': '#fff', 'Running': '#ddd', 'Swimming': '#bbb',
      'Cycling': '#ccc', 'Coding': '#999', 'Study': '#aaa',
      'Work': '#bbb', 'Meditation': '#888', 'Deep Work': '#ddd',
    };
    return m[type] || '#333';
  }

  typeInitials(type: string): string {
    const words = type.replace(/[^a-zA-Z\s]/g, '').split(/\s+/).filter(w => w.length > 0);
    return (words.length >= 2 ? words[0][0] + words[1][0] : type.substring(0, 2)).toUpperCase();
  }
}
