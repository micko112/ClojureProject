import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

const CATEGORY_MAP: Record<string, string> = {
  running: 'physical', gym: 'physical', cycling: 'physical', swimming: 'physical', walking: 'physical',
  yoga: 'health', meditation: 'health', cooking: 'health',
  reading: 'cognitive', coding: 'cognitive', studying: 'cognitive',
  drawing: 'creative', writing: 'creative', music: 'creative',
  socializing: 'social',
};
const CATEGORY_COLORS: Record<string, string> = {
  physical: '#4caf50', health: '#2a9d8f', cognitive: '#4a90d9', creative: '#e67e22', social: '#9b59b6',
};
const TYPE_ICONS: Record<string, string> = {
  running: 'directions_run', gym: 'fitness_center', cycling: 'directions_bike', swimming: 'pool',
  yoga: 'self_improvement', reading: 'menu_book', coding: 'code', studying: 'school',
  meditation: 'psychology', cooking: 'restaurant', drawing: 'palette', writing: 'edit_note',
  music: 'music_note', walking: 'directions_walk', socializing: 'handshake',
};

@Component({
  selector: 'app-stats',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './stats.component.html',
  styleUrls: ['./stats.component.css'],
})
export class StatsComponent implements OnInit {
  period = 30;
  loading = false;
  error = '';

  stats: any = null;
  trackingRange: any[] = [];

  // Calendar heatmap
  calendarMonths: { label: string; days: { date: string; count: number }[] }[] = [];
  today = new Date().toISOString().split('T')[0];

  constructor(private api: ApiService, public auth: AuthService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = '';
    this.api.getStats(this.period).subscribe({
      next: data => {
        this.stats = data;
        this.buildCalendar(data.trackingDates || []);
        this.loading = false;
      },
      error: () => {
        this.error = 'Nije moguće učitati statistike.';
        this.loading = false;
      }
    });
  }

  onPeriodChange(): void {
    this.load();
  }

  // ---- XP Chart ----
  xpDays(): { date: string; xp: number }[] {
    if (!this.stats?.xpPerDay) return [];
    return Object.entries(this.stats.xpPerDay)
      .map(([date, xp]) => ({ date, xp: xp as number }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  chartBars(): { date: string; xp: number; height: number; label: string }[] {
    const days = this.xpDays();
    if (!days.length) return [];
    const max = Math.max(...days.map(d => d.xp), 1);
    return days.map(d => ({
      date: d.date,
      xp: d.xp,
      height: Math.max(4, Math.round((d.xp / max) * 160)),
      label: d.date.slice(5),
    }));
  }

  maxXpInPeriod(): number {
    const days = this.xpDays();
    return days.length ? Math.max(...days.map(d => d.xp)) : 0;
  }

  avgXpPerDay(): number {
    const days = this.xpDays();
    if (!days.length) return 0;
    return Math.round(days.reduce((s, d) => s + d.xp, 0) / days.length);
  }

  // ---- Type breakdown ----
  typeBreakdownEntries(): { type: string; count: number; icon: string; category: string; color: string }[] {
    if (!this.stats?.typeBreakdown) return [];
    return Object.entries(this.stats.typeBreakdown)
      .map(([type, count]) => ({
        type,
        count: count as number,
        icon: TYPE_ICONS[type] || 'sports',
        category: CATEGORY_MAP[type] || 'other',
        color: CATEGORY_COLORS[CATEGORY_MAP[type] || 'other'] || '#888',
      }))
      .sort((a, b) => b.count - a.count);
  }

  categoryBreakdown(): { category: string; count: number; color: string; pct: number }[] {
    const entries = this.typeBreakdownEntries();
    const total = entries.reduce((s, e) => s + e.count, 0) || 1;
    const byCategory: Record<string, number> = {};
    entries.forEach(e => { byCategory[e.category] = (byCategory[e.category] || 0) + e.count; });
    return Object.entries(byCategory)
      .map(([category, count]) => ({
        category,
        count,
        color: CATEGORY_COLORS[category] || '#888',
        pct: Math.round((count / total) * 100),
      }))
      .sort((a, b) => b.count - a.count);
  }

  // Donut SVG segments
  donutSegments(): { d: string; color: string; category: string; pct: number }[] {
    const entries = this.categoryBreakdown();
    if (!entries.length) return [];
    const total = entries.reduce((s, e) => s + e.count, 0);
    const R = 54;
    const cx = 64;
    const cy = 64;
    let startAngle = -Math.PI / 2;
    return entries.map(e => {
      const sweep = (e.count / total) * 2 * Math.PI;
      const endAngle = startAngle + sweep;
      const x1 = cx + R * Math.cos(startAngle);
      const y1 = cy + R * Math.sin(startAngle);
      const x2 = cx + R * Math.cos(endAngle);
      const y2 = cy + R * Math.sin(endAngle);
      const large = sweep > Math.PI ? 1 : 0;
      const d = `M ${cx} ${cy} L ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} Z`;
      startAngle = endAngle;
      return { d, color: e.color, category: e.category, pct: e.pct };
    });
  }

  // ---- Calendar heatmap ----
  buildCalendar(trackingDates: string[]): void {
    const tracked = new Set(trackingDates);
    const today = new Date();
    const months: { label: string; days: { date: string; count: number }[] }[] = [];
    // Show last 3 months
    for (let m = 2; m >= 0; m--) {
      const d = new Date(today.getFullYear(), today.getMonth() - m, 1);
      const label = d.toLocaleString('default', { month: 'long', year: 'numeric' });
      const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      const days = [];
      for (let day = 1; day <= daysInMonth; day++) {
        const dt = new Date(d.getFullYear(), d.getMonth(), day);
        const dateStr = dt.toISOString().split('T')[0];
        days.push({ date: dateStr, count: tracked.has(dateStr) ? 1 : 0 });
      }
      months.push({ label, days });
    }
    this.calendarMonths = months;
  }

  trackingConsistencyPct(): number {
    if (!this.stats?.trackingDates?.length) return 0;
    const n = this.stats.trackingDates.filter((d: string) => d >= this.periodStartDate()).length;
    return Math.round((n / this.period) * 100);
  }

  periodStartDate(): string {
    const d = new Date();
    d.setDate(d.getDate() - this.period);
    return d.toISOString().split('T')[0];
  }

  // ---- Export CSV ----
  exportCsv(): void {
    const rows = [['Date', 'XP']];
    this.xpDays().forEach(d => rows.push([d.date, String(d.xp)]));
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bebetter-stats-${this.period}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
