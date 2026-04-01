import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { Activity, ActivityType } from '../../models/activity.model';

export interface CalendarDay {
  date: Date;
  dateStr: string;
  isToday: boolean;
  isCurrentMonth: boolean;
  activities: Activity[];
  totalXp: number;
}

const HOUR_PX = 64;

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit, OnDestroy {
  viewMode: 'week' | 'month' = 'week';
  currentDate = new Date();
  weekDays: Date[] = [];
  monthDays: CalendarDay[] = [];
  activitiesMap = new Map<string, { activities: Activity[]; totalXp: number }>();
  loading = false;
  activityTypes: ActivityType[] = [];
  slideAnim = '';

  hours = Array.from({ length: 24 }, (_, i) => i);
  now = new Date();
  private timer: any;

  showModal = false;
  modalDate = '';
  modalHour = 9;
  formType = '';
  formDuration = 60;
  formIntensity = 3;
  submitting = false;

  selectedActivity: Activity | null = null;
  selectedActivityDate = '';

  readonly MONTH_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  constructor(private api: ApiService, public auth: AuthService) {}

  ngOnInit(): void {
    this.api.getActivityTypes().subscribe({
      next: t => {
        this.activityTypes = t;
        if (!this.formType && t.length) this.formType = t[0].key;
      }
    });
    this.loadView();
    this.timer = setInterval(() => this.now = new Date(), 30_000);
  }

  ngOnDestroy(): void { clearInterval(this.timer); }

  // ── Navigation ───────────────────────────────────────────

  navigate(dir: 1 | -1): void {
    this.slideAnim = dir === 1 ? 'slide-in-right' : 'slide-in-left';
    const d = new Date(this.currentDate);
    if (this.viewMode === 'week') d.setDate(d.getDate() + dir * 7);
    else d.setMonth(d.getMonth() + dir);
    this.currentDate = d;
    this.loadView();
    setTimeout(() => this.slideAnim = '', 300);
  }

  goToday(): void { this.currentDate = new Date(); this.loadView(); }

  switchView(mode: 'week' | 'month'): void {
    if (this.viewMode === mode) return;
    this.viewMode = mode;
    this.loadView();
  }

  // ── Load data ────────────────────────────────────────────

  loadView(): void {
    if (this.viewMode === 'week') {
      this.weekDays = this.calcWeekDays(this.currentDate);
      this.loadDays(this.weekDays);
    } else {
      this.monthDays = this.calcMonthDays(this.currentDate);
      const toLoad = this.monthDays.filter(d => d.isCurrentMonth).map(d => d.date);
      this.loadDays(toLoad);
    }
  }

  private loadDays(days: Date[]): void {
    this.loading = true;
    const req = days.map(d =>
      this.api.getActivities(this.dk(d)).pipe(
        catchError(() => of({ date: this.dk(d), username: '', activities: [], totalXp: 0 } as any))
      )
    );
    forkJoin(req).subscribe({
      next: results => {
        (results as any[]).forEach(r => {
          this.activitiesMap.set(r.date, { activities: r.activities || [], totalXp: r.totalXp || 0 });
        });
        if (this.viewMode === 'month') {
          this.monthDays = this.monthDays.map(d => {
            const data = this.activitiesMap.get(d.dateStr);
            return data ? { ...d, activities: data.activities, totalXp: data.totalXp } : d;
          });
        }
        this.loading = false;
      },
      error: () => { this.loading = false; }
    });
  }

  private reloadDay(dateStr: string): void {
    this.api.getActivities(dateStr).pipe(
      catchError(() => of({ date: dateStr, username: '', activities: [], totalXp: 0 } as any))
    ).subscribe((r: any) => {
      this.activitiesMap.set(dateStr, { activities: r.activities || [], totalXp: r.totalXp || 0 });
      if (this.viewMode === 'month') {
        this.monthDays = this.monthDays.map(d =>
          d.dateStr === dateStr ? { ...d, activities: r.activities || [], totalXp: r.totalXp || 0 } : d
        );
      }
    });
  }

  // ── Calendar math ────────────────────────────────────────

  private calcWeekDays(date: Date): Date[] {
    const d = new Date(date);
    const dow = d.getDay() || 7;
    d.setDate(d.getDate() - dow + 1);
    d.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, i) => {
      const day = new Date(d); day.setDate(d.getDate() + i); return day;
    });
  }

  private calcMonthDays(date: Date): CalendarDay[] {
    const year = date.getFullYear(), month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const today = this.dk(new Date());
    let start = new Date(firstDay);
    const dow = start.getDay() || 7;
    start.setDate(start.getDate() - dow + 1);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const ds = this.dk(d);
      const cached = this.activitiesMap.get(ds);
      return {
        date: d, dateStr: ds, isToday: ds === today,
        isCurrentMonth: d.getMonth() === month,
        activities: cached?.activities || [],
        totalXp: cached?.totalXp || 0,
      };
    });
  }

  // ── Event handlers ────────────────────────────────────────

  onSlotClick(date: Date, hour: number, event: MouseEvent): void {
    event.stopPropagation();
    this.modalDate = this.dk(date);
    this.modalHour = hour;
    this.showModal = true;
    this.selectedActivity = null;
  }

  onDayClick(day: CalendarDay): void {
    if (!day.isCurrentMonth) return;
    this.currentDate = new Date(day.date);
    this.switchView('week');
  }

  onActivityClick(activity: Activity, dateStr: string, event: MouseEvent): void {
    event.stopPropagation();
    this.selectedActivity = this.selectedActivity?.id === activity.id ? null : activity;
    this.selectedActivityDate = dateStr;
    this.showModal = false;
  }

  @HostListener('click')
  closeAll(): void { this.showModal = false; this.selectedActivity = null; }

  stopProp(e: MouseEvent): void { e.stopPropagation(); }

  // ── Submit / Delete ───────────────────────────────────────

  submitActivity(event: MouseEvent): void {
    event.stopPropagation();
    if (!this.formType || this.submitting) return;
    const dt = new Date(`${this.modalDate}T${String(this.modalHour).padStart(2,'0')}:00:00`);
    this.submitting = true;
    this.api.addActivity({
      activityType: this.formType,
      duration: Number(this.formDuration),
      intensity: Number(this.formIntensity),
      startTime: dt.getTime()
    }).subscribe({
      next: () => {
        this.submitting = false;
        this.showModal = false;
        this.formDuration = 60;
        this.formIntensity = 3;
        this.reloadDay(this.modalDate);
        this.auth.refreshUser();
      },
      error: () => { this.submitting = false; }
    });
  }

  deleteActivity(event: MouseEvent): void {
    event.stopPropagation();
    if (!this.selectedActivity) return;
    const dateStr = this.selectedActivityDate;
    this.api.deleteActivity(this.selectedActivity.id).subscribe({
      next: () => {
        this.selectedActivity = null;
        this.reloadDay(dateStr);
        this.auth.refreshUser();
      }
    });
  }

  // ── Helpers ───────────────────────────────────────────────

  dk(d: Date): string { return d.toISOString().slice(0, 10); }

  dayActivities(date: Date): Activity[] {
    return this.activitiesMap.get(this.dk(date))?.activities || [];
  }

  dayXp(date: Date): number {
    return this.activitiesMap.get(this.dk(date))?.totalXp || 0;
  }

  isToday(date: Date): boolean { return this.dk(date) === this.dk(new Date()); }

  isCurrentPeriod(): boolean {
    const now = new Date();
    if (this.viewMode === 'week') {
      return this.weekDays.some(d => this.isToday(d));
    }
    return this.currentDate.getFullYear() === now.getFullYear() &&
           this.currentDate.getMonth() === now.getMonth();
  }

  activityStyle(a: Activity): object {
    const [h, m] = a.time.split(':').map(Number);
    const top = (h + m / 60) * HOUR_PX;
    const height = Math.max((a.duration / 60) * HOUR_PX, 22);
    return { top: `${top}px`, height: `${height}px`, background: this.typeColor(a.type) };
  }

  nowTop(): number { return (this.now.getHours() + this.now.getMinutes() / 60) * HOUR_PX; }

  typeColor(type: string): string {
    const m: Record<string, string> = {
      'Training':'#3b82f6','Study':'#22c55e','Coding':'#a855f7',
      'Work':'#f59e0b','Hobby / Yard work':'#f97316'
    };
    return m[type] || '#7c6aff';
  }

  typeBg(type: string): string {
    const m: Record<string, string> = {
      'Training':'rgba(59,130,246,0.15)','Study':'rgba(34,197,94,0.15)',
      'Coding':'rgba(168,85,247,0.15)','Work':'rgba(245,158,11,0.15)',
      'Hobby / Yard work':'rgba(249,115,22,0.15)'
    };
    return m[type] || 'rgba(124,106,255,0.15)';
  }

  typeEmoji(type: string): string {
    const m: Record<string, string> = {
      'Training':'🏋️','Study':'📚','Coding':'💻','Work':'💼','Hobby / Yard work':'🌿'
    };
    return m[type] || '⚡';
  }

  formatHour(h: number): string {
    if (h === 0) return '12 AM';
    if (h < 12) return `${h} AM`;
    if (h === 12) return '12 PM';
    return `${h - 12} PM`;
  }

  weekLabel(): string {
    if (!this.weekDays.length) return '';
    const s = this.weekDays[0], e = this.weekDays[6];
    const sm = s.toLocaleDateString('en-US', { month: 'short' });
    const em = e.toLocaleDateString('en-US', { month: 'short' });
    if (sm === em) return `${sm} ${s.getDate()}–${e.getDate()}, ${e.getFullYear()}`;
    return `${sm} ${s.getDate()} – ${em} ${e.getDate()}, ${e.getFullYear()}`;
  }

  monthLabel(): string {
    return this.currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  modalDateLabel(): string {
    if (!this.modalDate) return '';
    return new Date(this.modalDate + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric'
    });
  }

  previewXp(): number {
    const t = this.activityTypes.find(t => t.key === this.formType);
    return t ? t.xpPerMinute * Number(this.formDuration) * Number(this.formIntensity) : 0;
  }

  intensityLabel(n: number): string {
    return ['','Easy','Moderate','Medium','Hard','Max'][n] || '';
  }

  track(_i: number, d: CalendarDay): string { return d.dateStr; }
  trackH(_i: number, h: number): number { return h; }
  trackA(_i: number, a: Activity): number { return a.id; }
}
