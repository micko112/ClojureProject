import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

const ACTIVITY_TYPES = [
  { type: 'running', label: 'Running', icon: 'directions_run', category: 'physical', xpPerMin: 2 },
  { type: 'gym', label: 'Gym', icon: 'fitness_center', category: 'physical', xpPerMin: 2 },
  { type: 'cycling', label: 'Cycling', icon: 'directions_bike', category: 'physical', xpPerMin: 2 },
  { type: 'swimming', label: 'Swimming', icon: 'pool', category: 'physical', xpPerMin: 2 },
  { type: 'yoga', label: 'Yoga', icon: 'self_improvement', category: 'health', xpPerMin: 1.5 },
  { type: 'reading', label: 'Reading', icon: 'menu_book', category: 'cognitive', xpPerMin: 1.5 },
  { type: 'coding', label: 'Coding', icon: 'code', category: 'cognitive', xpPerMin: 2 },
  { type: 'studying', label: 'Studying', icon: 'school', category: 'cognitive', xpPerMin: 1.5 },
  { type: 'meditation', label: 'Meditation', icon: 'psychology', category: 'health', xpPerMin: 1.5 },
  { type: 'cooking', label: 'Cooking', icon: 'restaurant', category: 'health', xpPerMin: 1 },
  { type: 'drawing', label: 'Drawing', icon: 'palette', category: 'creative', xpPerMin: 1.5 },
  { type: 'writing', label: 'Writing', icon: 'edit_note', category: 'creative', xpPerMin: 1.5 },
  { type: 'music', label: 'Music', icon: 'music_note', category: 'creative', xpPerMin: 1.5 },
  { type: 'walking', label: 'Walking', icon: 'directions_walk', category: 'physical', xpPerMin: 1 },
  { type: 'socializing', label: 'Socializing', icon: 'handshake', category: 'social', xpPerMin: 1 },
];

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit {
  activities: any[] = [];
  loading = true;
  showModal = false;
  editingActivity: any = null;

  // Form
  activityType = 'running';
  duration = 30;
  intensity = 3;
  note = '';
  activityDate = new Date().toISOString().split('T')[0];
  activityTime = new Date().toTimeString().slice(0, 5);
  saving = false;

  activityTypes = ACTIVITY_TYPES;

  constructor(
    private api: ApiService,
    public auth: AuthService
  ) {}

  ngOnInit(): void {
    this.loadActivities();
  }

  loadActivities(): void {
    this.api.getActivities().subscribe({
      next: a => { this.activities = a; this.loading = false; },
      error: () => { this.loading = false; }
    });
  }

  openAdd(): void {
    this.editingActivity = null;
    this.activityType = 'running';
    this.duration = 30;
    this.intensity = 3;
    this.note = '';
    this.activityDate = new Date().toISOString().split('T')[0];
    this.activityTime = new Date().toTimeString().slice(0, 5);
    this.showModal = true;
  }

  openEdit(a: any): void {
    this.editingActivity = a;
    this.activityType = a.type;
    this.duration = a.duration;
    this.intensity = a.intensity;
    this.note = a.note || '';
    const d = new Date(a.startTime || a.date);
    this.activityDate = d.toISOString().split('T')[0];
    this.activityTime = d.toTimeString().slice(0, 5);
    this.showModal = true;
  }

  closeModal(): void { this.showModal = false; this.editingActivity = null; }

  save(): void {
    if (this.saving) return;
    this.saving = true;
    const startTime = new Date(`${this.activityDate}T${this.activityTime}`).toISOString();
    const payload = {
      type: this.activityType,
      duration: this.duration,
      intensity: this.intensity,
      note: this.note,
      startTime
    };
    const obs = this.editingActivity
      ? this.api.updateActivity(this.editingActivity.id, payload)
      : this.api.createActivity(payload);
    obs.subscribe({
      next: () => { this.saving = false; this.closeModal(); this.loadActivities(); },
      error: () => { this.saving = false; }
    });
  }

  delete(a: any): void {
    if (!confirm('Delete this activity?')) return;
    this.api.deleteActivity(a.id).subscribe(() => this.loadActivities());
  }

  xp(a: any): number {
    const t = ACTIVITY_TYPES.find(x => x.type === a.type);
    return Math.round((a.duration || 0) * (a.intensity || 3) * (t?.xpPerMin || 1.5));
  }

  icon(type: string): string {
    return ACTIVITY_TYPES.find(t => t.type === type)?.icon || 'military_tech';
  }

  label(type: string): string {
    return ACTIVITY_TYPES.find(t => t.type === type)?.label || type;
  }

  formatTime(isoStr: string): string {
    if (!isoStr) return '';
    return new Date(isoStr).toLocaleString('en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  totalXp(): number {
    return this.activities.reduce((sum, a) => sum + this.xp(a), 0);
  }
}
