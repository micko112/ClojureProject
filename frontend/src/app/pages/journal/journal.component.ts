import { Component, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiService } from '../../services/api.service';

const ACTIVITY_ICONS: Record<string, string> = {
  running: 'directions_run', gym: 'fitness_center', cycling: 'directions_bike', swimming: 'pool',
  yoga: 'self_improvement', reading: 'menu_book', coding: 'code', studying: 'school',
  meditation: 'psychology', cooking: 'restaurant', drawing: 'palette', writing: 'edit_note',
  music: 'music_note', walking: 'directions_walk', socializing: 'handshake',
};
const ACTIVITY_XP: Record<string, number> = {
  running: 2, gym: 2, cycling: 2, swimming: 2, walking: 1,
  yoga: 1.5, reading: 1.5, coding: 2, studying: 1.5, meditation: 1.5,
  cooking: 1, drawing: 1.5, writing: 1.5, music: 1.5, socializing: 1,
};
const TRACKING_LABELS: Record<string, string> = {
  'ten-wins': '10 Wins a Day',
  'deep-work': 'Deep Work Blocks',
  'habit-scorecard': 'Habit Scorecard',
  'energy-check': 'Energy Check-in',
  'one-thing': 'One Thing',
  'daily-review': 'Daily Review',
  'streak-tracker': 'Streak Tracker',
  'mood-trigger': 'Mood + Trigger Log',
  'bad-habit-avoided': 'Bad Habit Avoided',
  'identity-votes': 'Identity Votes',
  'weekly-focus': 'Weekly Focus',
  'friction-log': 'Friction Log',
  'tiny-challenge': 'Tiny Challenge',
};

interface DayCell {
  date: string;      // YYYY-MM-DD
  day: number;       // 1..31
  inMonth: boolean;
  isToday: boolean;
  isFuture: boolean;
  activityCount: number;
  trackingCount: number;
}

@Component({
  selector: 'app-journal',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './journal.component.html',
  styleUrls: ['./journal.component.css'],
})
export class JournalComponent implements OnInit {
  loading = true;
  error = '';

  viewYear: number;
  viewMonth: number;                // 0..11
  today = new Date().toISOString().split('T')[0];
  selectedDate: string;

  weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  monthLabels = ['January','February','March','April','May','June',
                 'July','August','September','October','November','December'];

  cells: DayCell[] = [];
  activitiesByDate: Record<string, any[]> = {};
  trackingByDate: Record<string, any[]> = {};

  constructor(private api: ApiService) {
    const now = new Date();
    this.viewYear = now.getFullYear();
    this.viewMonth = now.getMonth();
    this.selectedDate = this.today;
  }

  ngOnInit(): void {
    this.loadMonth();
  }

  monthLabel(): string {
    return `${this.monthLabels[this.viewMonth]} ${this.viewYear}`;
  }

  prevMonth(): void {
    if (this.viewMonth === 0) { this.viewMonth = 11; this.viewYear--; }
    else { this.viewMonth--; }
    this.loadMonth();
  }

  nextMonth(): void {
    if (this.viewMonth === 11) { this.viewMonth = 0; this.viewYear++; }
    else { this.viewMonth++; }
    this.loadMonth();
  }

  goToToday(): void {
    const now = new Date();
    this.viewYear = now.getFullYear();
    this.viewMonth = now.getMonth();
    this.selectedDate = this.today;
    this.loadMonth();
  }

  private pad(n: number): string { return n < 10 ? '0' + n : '' + n; }
  private isoOf(y: number, m: number, d: number): string {
    return `${y}-${this.pad(m + 1)}-${this.pad(d)}`;
  }

  loadMonth(): void {
    this.loading = true;
    this.error = '';
    const first = this.isoOf(this.viewYear, this.viewMonth, 1);
    const lastDay = new Date(this.viewYear, this.viewMonth + 1, 0).getDate();
    const last = this.isoOf(this.viewYear, this.viewMonth, lastDay);

    forkJoin({
      activities: this.api.getActivities(),
      tracking: this.api.getTrackingRange(first, last),
    }).subscribe({
      next: ({ activities, tracking }) => {
        this.activitiesByDate = {};
        for (const a of activities) {
          const ts = a.startTime || a.date;
          if (!ts) continue;
          const key = new Date(ts).toISOString().split('T')[0];
          (this.activitiesByDate[key] ||= []).push(a);
        }
        this.trackingByDate = {};
        for (const t of tracking) {
          const key = t.date;
          if (!key) continue;
          (this.trackingByDate[key] ||= []).push(t);
        }
        this.buildCells();
        this.loading = false;
      },
      error: () => {
        this.error = 'Failed to load journal data.';
        this.loading = false;
      }
    });
  }

  private buildCells(): void {
    const cells: DayCell[] = [];
    const first = new Date(this.viewYear, this.viewMonth, 1);
    // Monday as first day of week: JS getDay returns 0=Sun..6=Sat
    const jsDow = first.getDay();
    const leading = (jsDow + 6) % 7; // 0 if Monday
    // Previous month tail
    for (let i = leading - 1; i >= 0; i--) {
      const d = new Date(this.viewYear, this.viewMonth, -i);
      const iso = this.isoOf(d.getFullYear(), d.getMonth(), d.getDate());
      cells.push(this.makeCell(iso, d.getDate(), false));
    }
    const lastDay = new Date(this.viewYear, this.viewMonth + 1, 0).getDate();
    for (let d = 1; d <= lastDay; d++) {
      const iso = this.isoOf(this.viewYear, this.viewMonth, d);
      cells.push(this.makeCell(iso, d, true));
    }
    // Trailing to complete 6 rows (42 cells) for stable layout
    while (cells.length < 42) {
      const next = new Date(this.viewYear, this.viewMonth + 1, cells.length - leading - lastDay + 1);
      const iso = this.isoOf(next.getFullYear(), next.getMonth(), next.getDate());
      cells.push(this.makeCell(iso, next.getDate(), false));
    }
    this.cells = cells;
  }

  private makeCell(iso: string, day: number, inMonth: boolean): DayCell {
    return {
      date: iso,
      day,
      inMonth,
      isToday: iso === this.today,
      isFuture: iso > this.today,
      activityCount: this.activitiesByDate[iso]?.length || 0,
      trackingCount: this.trackingByDate[iso]?.length || 0,
    };
  }

  selectDay(cell: DayCell): void {
    if (!cell.inMonth || cell.isFuture) return;
    this.selectedDate = cell.date;
  }

  @HostListener('window:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target) {
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target as any).isContentEditable) return;
    }
    switch (e.key) {
      case 'ArrowLeft':  e.preventDefault(); this.shiftSelectedDate(-1); break;
      case 'ArrowRight': e.preventDefault(); this.shiftSelectedDate(1); break;
      case 'ArrowUp':    e.preventDefault(); this.shiftSelectedDate(-7); break;
      case 'ArrowDown':  e.preventDefault(); this.shiftSelectedDate(7); break;
      case 'PageUp':     e.preventDefault(); this.prevMonth(); break;
      case 'PageDown':   e.preventDefault(); this.nextMonth(); break;
      case 'Home':       e.preventDefault(); this.shiftSelectedDateToWeekBoundary('start'); break;
      case 'End':        e.preventDefault(); this.shiftSelectedDateToWeekBoundary('end'); break;
      case 't': case 'T': e.preventDefault(); this.goToToday(); break;
    }
  }

  private shiftSelectedDate(days: number): void {
    const [y, m, d] = this.selectedDate.split('-').map(Number);
    const next = new Date(y, m - 1, d + days);
    if (this.isoOf(next.getFullYear(), next.getMonth(), next.getDate()) > this.today) return;
    this.selectedDate = this.isoOf(next.getFullYear(), next.getMonth(), next.getDate());
    if (next.getFullYear() !== this.viewYear || next.getMonth() !== this.viewMonth) {
      this.viewYear = next.getFullYear();
      this.viewMonth = next.getMonth();
      this.loadMonth();
    }
  }

  private shiftSelectedDateToWeekBoundary(edge: 'start' | 'end'): void {
    const [y, m, d] = this.selectedDate.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const jsDow = date.getDay();
    const dowMon = (jsDow + 6) % 7; // 0=Mon..6=Sun
    const shift = edge === 'start' ? -dowMon : (6 - dowMon);
    this.shiftSelectedDate(shift);
  }

  selectedActivities(): any[] {
    return this.activitiesByDate[this.selectedDate] || [];
  }

  selectedTracking(): any[] {
    return this.trackingByDate[this.selectedDate] || [];
  }

  activityIcon(type: string): string {
    return ACTIVITY_ICONS[type] || 'military_tech';
  }

  activityXp(a: any): number {
    const xpm = ACTIVITY_XP[a.type] || 1.5;
    return Math.round((a.duration || 0) * (a.intensity || 3) * xpm);
  }

  dayXp(iso: string): number {
    return (this.activitiesByDate[iso] || []).reduce((s, a) => s + this.activityXp(a), 0);
  }

  trackingLabel(method: string): string {
    return TRACKING_LABELS[method] || method;
  }

  trackingSummary(entry: any): string {
    const p = entry.payload || {};
    switch (entry.method) {
      case 'ten-wins': {
        const count = (p.wins || []).filter((w: string) => w && w.trim()).length;
        return `${count}/10 wins recorded`;
      }
      case 'deep-work': {
        const done = (p.blocks || []).filter((b: any) => b.done).length;
        const total = (p.blocks || []).length;
        return `${done}/${total} focus blocks completed`;
      }
      case 'habit-scorecard': {
        const done = (p.habits || []).filter((h: any) => h.done).length;
        const total = (p.habits || []).length;
        return `${done}/${total} habits done`;
      }
      case 'energy-check':
        return `Energy ${p.energyLevel ?? '-'}/5, Mood ${p.moodLevel ?? '-'}/5`;
      case 'one-thing':
        return p.thing ? `Priority: ${p.thing}` : 'No priority set';
      case 'daily-review':
        return [p.good, p.learned, p.improve].filter(Boolean).length + '/3 reflections written';
      case 'streak-tracker':
        return (p.habits || []).map((h: any) => `${h.name}: ${h.days}d`).join(', ') || 'No streaks';
      case 'mood-trigger':
        return `Mood ${p.mood ?? '-'}/5${p.trigger ? ' - ' + p.trigger : ''}`;
      case 'bad-habit-avoided': {
        const done = (p.habits || []).filter((h: any) => h.avoided).length;
        const total = (p.habits || []).length;
        return `${done}/${total} avoided`;
      }
      case 'identity-votes': {
        const total = (p.votes || []).reduce((s: number, v: any) => s + Number(v.votes || 0), 0);
        return `${total} identity votes`;
      }
      case 'weekly-focus':
        return `${p.theme || '-'} - confidence ${p.confidence ?? '-'}/5`;
      case 'friction-log':
        return p.goal ? `Goal: ${p.goal}` : 'No friction logged';
      case 'tiny-challenge':
        return p.currentChallenge || 'No challenge';
      default:
        return '';
    }
  }

  formatSelectedDate(): string {
    const [y, m, d] = this.selectedDate.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }

  formatTime(iso: string): string {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
}
