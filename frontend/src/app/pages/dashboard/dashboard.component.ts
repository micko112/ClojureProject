import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
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

const TRACKING_METHODS = [
  {
    id: 'ten-wins',
    label: '10 Wins a Day',
    icon: 'trophy',
    summary: 'Write down ten small or big wins for today.'
  },
  {
    id: 'deep-work',
    label: 'Deep Work Blocks',
    icon: 'timer',
    summary: 'Plan focus blocks and check off what you completed.'
  },
  {
    id: 'habit-scorecard',
    label: 'Habit Scorecard',
    icon: 'checklist',
    summary: 'Quickly score your key habits for the day.'
  },
  {
    id: 'energy-check',
    label: 'Energy Check-in',
    icon: 'battery_charging_full',
    summary: 'Track your energy, mood, and one thing that lifts you up.'
  },
  {
    id: 'one-thing',
    label: 'One Thing',
    icon: 'flag',
    summary: 'Pick the one priority that has the biggest impact today.'
  },
  {
    id: 'daily-review',
    label: 'Daily Review',
    icon: 'rate_review',
    summary: 'Close out the day with three short questions.'
  },
  {
    id: 'streak-tracker',
    label: 'Streak Tracker',
    icon: 'local_fire_department',
    summary: 'Track streaks for habits you want to keep going.'
  },
  {
    id: 'mood-trigger',
    label: 'Mood + Trigger Log',
    icon: 'psychology_alt',
    summary: 'Connect your mood to what triggers it.'
  },
  {
    id: 'bad-habit-avoided',
    label: 'Bad Habit Avoided',
    icon: 'block',
    summary: 'Log what you managed to avoid today.'
  },
  {
    id: 'identity-votes',
    label: 'Identity Votes',
    icon: 'how_to_reg',
    summary: 'Turn small actions into votes for the person you are becoming.'
  },
  {
    id: 'weekly-focus',
    label: 'Weekly Focus',
    icon: 'calendar_view_week',
    summary: 'One theme for the week and a small daily proof of progress.'
  },
  {
    id: 'friction-log',
    label: 'Friction Log',
    icon: 'report_problem',
    summary: 'Capture what blocks you so next time is easier.'
  },
  {
    id: 'tiny-challenge',
    label: 'Tiny Challenge Generator',
    icon: 'casino',
    summary: 'Pull a small challenge when you need a quick next move.'
  },
];

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit, OnDestroy {
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
  trackingMethods = TRACKING_METHODS;
  selectedMethodId = 'ten-wins';
  trackingDate = new Date().toISOString().split('T')[0];
  trackingLoading = false;
  trackingSaving = false;
  trackingSaved = false;
  trackingError = '';
  trackingEntries: Record<string, any> = {};
  tenWins = Array.from({ length: 10 }, () => '');
  deepWorkBlocks = [
    { label: 'Blok 1', minutes: 50, done: false },
    { label: 'Blok 2', minutes: 50, done: false },
    { label: 'Blok 3', minutes: 25, done: false },
  ];
  habitScorecard = [
    { habit: 'Workout / walk', done: false },
    { habit: 'Studying / reading', done: false },
    { habit: 'No late-night scrolling', done: false },
    { habit: 'Water and meals on time', done: false },
  ];
  energyLevel = 3;
  moodLevel = 3;
  energyNote = '';
  oneThing = '';
  oneThingNextStep = '';
  dailyReview = {
    good: '',
    learned: '',
    improve: ''
  };
  streakHabits = [
    { name: 'Workout', days: 0 },
    { name: 'Reading', days: 0 },
    { name: 'Studying', days: 0 },
  ];
  moodTrigger = {
    mood: 3,
    trigger: '',
    response: ''
  };
  avoidedHabits = [
    { name: 'Doomscrolling', avoided: false },
    { name: 'Junk food', avoided: false },
    { name: 'Procrastination', avoided: false },
    { name: 'Late sleep', avoided: false },
  ];
  identityVotes = [
    { identity: 'A person who trains', votes: 0 },
    { identity: 'A person who studies', votes: 0 },
    { identity: 'A person who keeps promises to themselves', votes: 0 },
  ];
  weeklyFocus = {
    theme: 'Discipline',
    proof: '',
    confidence: 3
  };
  frictionLog = {
    goal: '',
    blocker: '',
    fix: ''
  };
  tinyChallenges = [
    '10 min walk',
    '15 min of reading',
    'Tidy your desk',
    'Send one important message',
    'Drink a glass of water and take a break',
    'Write down the next 3 steps',
    'Do 20 squats',
    'Work 25 min phone-free',
  ];
  currentChallenge = this.tinyChallenges[0];

  // Autosave
  private autosave$ = new Subject<void>();
  private autosaveSub?: Subscription;
  autosaveStatus: 'idle' | 'saving' | 'saved' | 'error' = 'idle';

  // Habit edit mode
  editingHabits = false;
  newHabitText = '';

  // Share wins
  sharingWins = false;

  constructor(
    private api: ApiService,
    public auth: AuthService
  ) {}

  ngOnInit(): void {
    this.loadActivities();
    this.loadTrackingEntries();
    this.autosaveSub = this.autosave$.pipe(
      debounceTime(1500),
      distinctUntilChanged()
    ).subscribe(() => this.runAutosave());
  }

  ngOnDestroy(): void {
    this.autosaveSub?.unsubscribe();
  }

  @HostListener('window:keydown', ['$event'])
  onGlobalKey(e: KeyboardEvent): void {
    // Escape closes the activity modal
    if (e.key === 'Escape' && this.showModal) {
      e.preventDefault();
      this.closeModal();
      return;
    }
    // Ctrl+Enter inside the modal submits it
    if (this.showModal && (e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      this.save();
      return;
    }
    // Save shortcut works even inside inputs
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (this.showModal) this.save();
      else this.saveSelectedTracking();
      return;
    }
    // Method switching: Alt+ArrowLeft / Alt+ArrowRight
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      this.cycleMethod(e.key === 'ArrowRight' ? 1 : -1);
      return;
    }
    // Bracket shortcuts only outside of editable fields
    if (this.isTypingInField(e)) return;
    if (e.key === ']') { e.preventDefault(); this.cycleMethod(1); }
    else if (e.key === '[') { e.preventDefault(); this.cycleMethod(-1); }
    else if (e.key === 'a' && !e.ctrlKey && !e.metaKey && !e.altKey && !this.showModal) {
      e.preventDefault();
      this.openAdd();
    }
  }

  private isTypingInField(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    if (!t) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t as any).isContentEditable === true;
  }

  cycleMethod(delta: number): void {
    const ids = this.trackingMethods.map(m => m.id);
    const idx = ids.indexOf(this.selectedMethodId);
    if (idx < 0) return;
    const next = (idx + delta + ids.length) % ids.length;
    this.selectedMethodId = ids[next];
    this.trackingSaved = false;
  }

  triggerAutosave(): void {
    this.autosaveStatus = 'idle';
    this.autosave$.next();
  }

  private runAutosave(): void {
    if (this.trackingSaving || this.trackingLoading) return;
    this.autosaveStatus = 'saving';
    this.api.saveTrackingEntry(
      this.selectedMethodId,
      this.trackingDate,
      this.buildTrackingPayload(this.selectedMethodId)
    ).subscribe({
      next: entry => {
        this.trackingEntries[entry.method] = entry;
        this.autosaveStatus = 'saved';
        setTimeout(() => { if (this.autosaveStatus === 'saved') this.autosaveStatus = 'idle'; }, 2000);
      },
      error: () => { this.autosaveStatus = 'error'; }
    });
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
    return this.todayActivities().reduce((sum, a) => sum + this.xp(a), 0);
  }

  todayActivities(): any[] {
    const today = new Date().toISOString().split('T')[0];
    return this.activities.filter(a => {
      const ts = a.startTime || a.date;
      if (!ts) return false;
      return new Date(ts).toISOString().split('T')[0] === today;
    });
  }

  selectedMethod(): any {
    return TRACKING_METHODS.find(m => m.id === this.selectedMethodId) || TRACKING_METHODS[0];
  }

  onTrackingDateChange(): void {
    this.trackingSaved = false;
    this.loadTrackingEntries();
  }

  loadTrackingEntries(): void {
    this.trackingLoading = true;
    this.trackingError = '';
    this.api.getTrackingEntries(this.trackingDate).subscribe({
      next: entries => {
        this.trackingEntries = {};
        entries.forEach(entry => {
          this.trackingEntries[entry.method] = entry;
          this.applyTrackingPayload(entry.method, entry.payload || {});
        });
        this.trackingLoading = false;
      },
      error: () => {
        this.trackingLoading = false;
        this.trackingError = 'Failed to load methods.';
      }
    });
  }

  saveSelectedTracking(): void {
    if (this.trackingSaving) return;
    this.trackingSaving = true;
    this.trackingSaved = false;
    this.trackingError = '';
    this.api.saveTrackingEntry(
      this.selectedMethodId,
      this.trackingDate,
      this.buildTrackingPayload(this.selectedMethodId)
    ).subscribe({
      next: entry => {
        this.trackingEntries[entry.method] = entry;
        this.trackingSaving = false;
        this.trackingSaved = true;
      },
      error: () => {
        this.trackingSaving = false;
        this.trackingError = 'Failed to save method.';
      }
    });
  }

  buildTrackingPayload(method: string): any {
    switch (method) {
      case 'ten-wins':
        return { wins: this.tenWins };
      case 'deep-work':
        return { blocks: this.deepWorkBlocks };
      case 'habit-scorecard':
        return { habits: this.habitScorecard };
      case 'energy-check':
        return { energyLevel: this.energyLevel, moodLevel: this.moodLevel, note: this.energyNote };
      case 'one-thing':
        return { thing: this.oneThing, nextStep: this.oneThingNextStep };
      case 'daily-review':
        return this.dailyReview;
      case 'streak-tracker':
        return { habits: this.streakHabits };
      case 'mood-trigger':
        return this.moodTrigger;
      case 'bad-habit-avoided':
        return { habits: this.avoidedHabits };
      case 'identity-votes':
        return { votes: this.identityVotes };
      case 'weekly-focus':
        return this.weeklyFocus;
      case 'friction-log':
        return this.frictionLog;
      case 'tiny-challenge':
        return { currentChallenge: this.currentChallenge };
      default:
        return {};
    }
  }

  applyTrackingPayload(method: string, payload: any): void {
    switch (method) {
      case 'ten-wins':
        this.tenWins = Array.from({ length: 10 }, (_, i) => payload.wins?.[i] || '');
        break;
      case 'deep-work':
        if (Array.isArray(payload.blocks)) this.deepWorkBlocks = payload.blocks;
        break;
      case 'habit-scorecard':
        if (Array.isArray(payload.habits)) this.habitScorecard = payload.habits;
        break;
      case 'energy-check':
        this.energyLevel = Number(payload.energyLevel || this.energyLevel);
        this.moodLevel = Number(payload.moodLevel || this.moodLevel);
        this.energyNote = payload.note || '';
        break;
      case 'one-thing':
        this.oneThing = payload.thing || '';
        this.oneThingNextStep = payload.nextStep || '';
        break;
      case 'daily-review':
        this.dailyReview = {
          good: payload.good || '',
          learned: payload.learned || '',
          improve: payload.improve || ''
        };
        break;
      case 'streak-tracker':
        if (Array.isArray(payload.habits)) this.streakHabits = payload.habits;
        break;
      case 'mood-trigger':
        this.moodTrigger = {
          mood: Number(payload.mood || this.moodTrigger.mood),
          trigger: payload.trigger || '',
          response: payload.response || ''
        };
        break;
      case 'bad-habit-avoided':
        if (Array.isArray(payload.habits)) this.avoidedHabits = payload.habits;
        break;
      case 'identity-votes':
        if (Array.isArray(payload.votes)) this.identityVotes = payload.votes;
        break;
      case 'weekly-focus':
        this.weeklyFocus = {
          theme: payload.theme || this.weeklyFocus.theme,
          proof: payload.proof || '',
          confidence: Number(payload.confidence || this.weeklyFocus.confidence)
        };
        break;
      case 'friction-log':
        this.frictionLog = {
          goal: payload.goal || '',
          blocker: payload.blocker || '',
          fix: payload.fix || ''
        };
        break;
      case 'tiny-challenge':
        this.currentChallenge = payload.currentChallenge || this.currentChallenge;
        break;
    }
  }

  tenWinsCount(): number {
    return this.tenWins.filter(w => w.trim()).length;
  }

  completedDeepWorkMinutes(): number {
    return this.deepWorkBlocks
      .filter(block => block.done)
      .reduce((sum, block) => sum + Number(block.minutes || 0), 0);
  }

  habitScore(): number {
    return this.habitScorecard.filter(h => h.done).length;
  }

  avoidedHabitsCount(): number {
    return this.avoidedHabits.filter(h => h.avoided).length;
  }

  totalIdentityVotes(): number {
    return this.identityVotes.reduce((sum, item) => sum + Number(item.votes || 0), 0);
  }

  generateChallenge(): void {
    const index = Math.floor(Math.random() * this.tinyChallenges.length);
    this.currentChallenge = this.tinyChallenges[index];
  }

  changeStreak(habit: any, amount: number): void {
    habit.days = Math.max(0, Number(habit.days || 0) + amount);
    this.triggerAutosave();
  }

  changeIdentityVotes(item: any, amount: number): void {
    item.votes = Math.max(0, Number(item.votes || 0) + amount);
    this.triggerAutosave();
  }

  isMethodSaved(methodId?: string): boolean {
    return !!(this.trackingEntries[(methodId ?? this.selectedMethodId)]);
  }

  savedMethodsCount(): number {
    return this.trackingMethods.filter(m => this.trackingEntries[m.id]).length;
  }

  // ---- Habit customization ----
  addHabitItem(): void {
    const text = this.newHabitText.trim();
    if (!text) return;
    switch (this.selectedMethodId) {
      case 'habit-scorecard': this.habitScorecard.push({ habit: text, done: false }); break;
      case 'streak-tracker': this.streakHabits.push({ name: text, days: 0 }); break;
      case 'bad-habit-avoided': this.avoidedHabits.push({ name: text, avoided: false }); break;
      case 'identity-votes': this.identityVotes.push({ identity: text, votes: 0 }); break;
    }
    this.newHabitText = '';
    this.triggerAutosave();
  }

  removeHabitItem(index: number): void {
    switch (this.selectedMethodId) {
      case 'habit-scorecard': this.habitScorecard.splice(index, 1); break;
      case 'streak-tracker': this.streakHabits.splice(index, 1); break;
      case 'bad-habit-avoided': this.avoidedHabits.splice(index, 1); break;
      case 'identity-votes': this.identityVotes.splice(index, 1); break;
    }
    this.triggerAutosave();
  }

  hasCustomizableList(): boolean {
    return ['habit-scorecard', 'streak-tracker', 'bad-habit-avoided', 'identity-votes'].includes(this.selectedMethodId);
  }

  // ---- Share wins to feed ----
  shareWins(): void {
    const wins = this.tenWins.filter(w => w.trim());
    if (!wins.length || this.sharingWins) return;
    this.sharingWins = true;
    const caption = '🏆 Moje pobede za danas:\n' + wins.map((w, i) => `${i + 1}. ${w}`).join('\n');
    this.api.createPost({ caption }).subscribe({
      next: () => { this.sharingWins = false; },
      error: () => { this.sharingWins = false; }
    });
  }

  // ---- Export tracking as CSV ----
  exportTrackingCsv(): void {
    const rows = [['Method', 'Date', 'Data']];
    Object.values(this.trackingEntries).forEach((entry: any) => {
      rows.push([entry.method, entry.date, JSON.stringify(entry.payload || {})]);
    });
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tracking-${this.trackingDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
