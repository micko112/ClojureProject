import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, map, of, switchMap } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { BRAND } from '../../core/brand';

type StepId = 'welcome' | 'goals' | 'profile' | 'people' | 'first';

const STEPS: { id: StepId; label: string }[] = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'goals', label: 'Your goals' },
  { id: 'profile', label: 'Profile' },
  { id: 'people', label: 'People' },
  { id: 'first', label: 'Day 1' },
];

export const INTERESTS = [
  { id: 'fitness', label: 'Fitness', icon: 'fitness_center' },
  { id: 'running', label: 'Running', icon: 'directions_run' },
  { id: 'weight', label: 'Weight journey', icon: 'monitor_weight' },
  { id: 'nutrition', label: 'Healthy eating', icon: 'restaurant' },
  { id: 'yoga', label: 'Yoga & mobility', icon: 'self_improvement' },
  { id: 'mindfulness', label: 'Mindfulness', icon: 'spa' },
  { id: 'reading', label: 'Reading', icon: 'menu_book' },
  { id: 'learning', label: 'Learning', icon: 'school' },
  { id: 'languages', label: 'Languages', icon: 'translate' },
  { id: 'coding', label: 'Coding', icon: 'code' },
  { id: 'art', label: 'Drawing & art', icon: 'palette' },
  { id: 'music', label: 'Music', icon: 'music_note' },
  { id: 'writing', label: 'Writing', icon: 'edit_note' },
  { id: 'cooking', label: 'Cooking', icon: 'soup_kitchen' },
  { id: 'sleep', label: 'Better sleep', icon: 'bedtime' },
  { id: 'habits', label: 'Breaking a habit', icon: 'block' },
  { id: 'career', label: 'Career & side projects', icon: 'work' },
  { id: 'outdoors', label: 'Outdoors', icon: 'landscape' },
];

const INTERESTS_KEY = 'bb-interests';

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './onboarding.component.html',
  styleUrls: ['./onboarding.component.css'],
})
export class OnboardingComponent implements OnInit {
  private router = inject(Router);
  private api = inject(ApiService);
  private http = inject(HttpClient);
  auth = inject(AuthService);

  readonly brand = BRAND;
  readonly steps = STEPS;
  readonly interests = INTERESTS;

  currentStep = 0;
  displayName = '';
  bio = '';
  saving = false;

  readonly picked = signal<Set<string>>(new Set(this.readInterests()));
  readonly suggested = signal<any[]>([]);
  readonly suggestedLoading = signal(false);
  readonly followed = signal<Set<string>>(new Set());
  private suggestedLoaded = false;

  ngOnInit(): void {
    const user = this.auth.currentUser();
    if (user) {
      this.displayName = user.displayName || user.username || '';
      this.bio = user.bio || '';
    }
  }

  get step() { return this.steps[this.currentStep]; }
  get isLast() { return this.currentStep === this.steps.length - 1; }
  get progress() { return Math.round(((this.currentStep + 1) / this.steps.length) * 100); }

  next(): void {
    if (this.isLast) { this.finish(false); return; }
    this.currentStep++;
    if (this.step.id === 'people') this.loadSuggested();
  }

  prev(): void { if (this.currentStep > 0) this.currentStep--; }

  // ----- Goals -----
  toggleInterest(id: string): void {
    this.picked.update(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
    try { localStorage.setItem(INTERESTS_KEY, JSON.stringify([...this.picked()])); } catch {}
  }
  private readInterests(): string[] {
    try { return JSON.parse(localStorage.getItem(INTERESTS_KEY) || '[]'); } catch { return []; }
  }

  // ----- Suggested accounts -----
  /** GET /api/users/suggested (may not exist yet) -> fallback to the leaderboard. */
  loadSuggested(): void {
    if (this.suggestedLoaded) return;
    this.suggestedLoaded = true;
    this.suggestedLoading.set(true);
    const me = this.auth.currentUser()?.username;
    const interests = [...this.picked()].join(',');
    const toList = (r: any): any[] => Array.isArray(r) ? r : (r?.items ?? r?.users ?? []);
    this.http.get<any>('/api/users/suggested', interests ? { params: { interests } } : {}).pipe(
      map(toList),
      catchError(() => of([] as any[])),
      switchMap(list => list.length ? of(list) : this.api.getLeaderboard().pipe(map(toList), catchError(() => of([] as any[]))))
    ).subscribe(list => {
      this.suggested.set(list.filter(u => u?.username && u.username !== me).slice(0, 8));
      this.suggestedLoading.set(false);
    });
  }

  toggleFollow(u: any): void {
    this.api.toggleFollow(u.username).subscribe({
      next: (r: any) => this.followed.update(s => {
        const n = new Set(s);
        r?.action === 'unfollowed' ? n.delete(u.username) : n.add(u.username);
        return n;
      }),
      error: () => {}
    });
  }

  initials(u: any): string { return (u?.displayName || u?.username || '?').charAt(0).toUpperCase(); }

  // ----- Finish -----
  /** @param postNow open the composer for "Day 1" right away */
  finish(postNow: boolean): void {
    if (this.saving) return;
    this.saving = true;
    const done = () => {
      try { localStorage.setItem('bb-onboarded', '1'); } catch {}
      this.auth.refresh();
      this.router.navigateByUrl(postNow ? '/feed?create=1' : '/feed');
    };
    this.api.updateProfile({ displayName: this.displayName, bio: this.bio, interests: [...this.picked()] })
      .subscribe({ next: done, error: done });
  }

  skip(): void {
    try { localStorage.setItem('bb-onboarded', '1'); } catch {}
    this.router.navigate(['/feed']);
  }
}
