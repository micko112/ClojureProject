import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

const THEMES = [
  { key: 'fitness',  label: 'Fitness',   color: '#e63946' },
  { key: 'coding',   label: 'Coding',    color: '#457b9d' },
  { key: 'learning', label: 'Learning',  color: '#2a9d8f' },
  { key: 'creative', label: 'Creative',  color: '#e9c46a' },
  { key: 'wellness', label: 'Wellness',  color: '#a8dadc' },
  { key: 'sports',   label: 'Sports',    color: '#f4a261' },
  { key: 'general',  label: 'General',   color: '#6c757d' },
];

@Component({
  selector: 'app-competitions',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './competitions.component.html',
  styleUrls: ['./competitions.component.css']
})
export class CompetitionsComponent implements OnInit {
  competitions: any[] = [];
  loading = true;
  themes = THEMES;

  createOpen = signal(false);
  joinOpen = signal(false);
  joinCode = '';
  joining = false;
  creating = false;

  // Form
  cName = '';
  cDescription = '';
  cRules = '';
  cTheme = 'general';
  cStartDate = '';
  cEndDate = '';
  cBannerUrl = '';
  cFile: File | null = null;
  cBannerPreview = '';

  constructor(
    private api: ApiService,
    public auth: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.loadCompetitions();
    const today = new Date();
    const nextWeek = new Date(today.getTime() + 7 * 86400000);
    this.cStartDate = this.toISO(today);
    this.cEndDate = this.toISO(nextWeek);
  }

  private toISO(d: Date): string {
    return d.toISOString().split('T')[0];
  }

  loadCompetitions(): void {
    this.api.getCompetitions().subscribe({
      next: c => { this.competitions = c; this.loading = false; },
      error: () => { this.loading = false; }
    });
  }

  openComp(c: any): void {
    this.router.navigate(['/competitions', c.id]);
  }

  themeFor(key: string) {
    return this.themes.find(t => t.key === key) || this.themes[this.themes.length - 1];
  }

  openCreate(): void { this.createOpen.set(true); }
  closeCreate(): void {
    this.createOpen.set(false);
    this.cName = ''; this.cDescription = ''; this.cRules = '';
    this.cTheme = 'general'; this.cBannerUrl = ''; this.cFile = null; this.cBannerPreview = '';
  }

  onBannerSelect(e: Event): void {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    this.cFile = f;
    const r = new FileReader();
    r.onload = ev => { this.cBannerPreview = ev.target?.result as string; };
    r.readAsDataURL(f);
  }

  createCompetition(): void {
    if (!this.cName.trim() || this.creating) return;
    this.creating = true;
    const doCreate = (bannerUrl?: string) => {
      this.api.createCompetition({
        name: this.cName.trim(),
        description: this.cDescription,
        rules: this.cRules,
        theme: this.cTheme,
        startDate: this.cStartDate,
        endDate: this.cEndDate,
        bannerUrl
      }).subscribe({
        next: r => {
          this.creating = false;
          this.closeCreate();
          this.loadCompetitions();
          if (r?.id) this.router.navigate(['/competitions', r.id]);
        },
        error: () => { this.creating = false; }
      });
    };
    if (this.cFile) {
      this.api.uploadFile(this.cFile).subscribe({
        next: r => doCreate(r.url),
        error: () => { this.creating = false; }
      });
    } else {
      doCreate(this.cBannerUrl || undefined);
    }
  }

  openJoin(): void { this.joinOpen.set(true); this.joinCode = ''; }
  closeJoin(): void { this.joinOpen.set(false); this.joinCode = ''; }

  joinByCode(): void {
    if (!this.joinCode.trim() || this.joining) return;
    this.joining = true;
    this.api.joinCompetitionByCode(this.joinCode.trim()).subscribe({
      next: () => {
        this.joining = false;
        this.closeJoin();
        this.loadCompetitions();
      },
      error: () => { this.joining = false; }
    });
  }

  daysLeft(endDate: string): string {
    if (!endDate) return '';
    const diff = (new Date(endDate).getTime() - Date.now()) / 86400000;
    if (diff < 0) return 'Ended';
    if (diff < 1) return 'Ends today';
    return Math.ceil(diff) + 'd left';
  }

  formatDate(d: string): string {
    if (!d) return '';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}
