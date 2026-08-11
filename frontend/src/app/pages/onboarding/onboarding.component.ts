import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

const STEPS = [
  {
    id: 'welcome',
    title: 'Dobrodošao u BeBetter 👋',
    subtitle: 'Gamified platforma za produktivnost i discipline. Loguješ aktivnosti, zaradiš XP, takmiče se s prijateljima.',
    icon: 'emoji_events',
  },
  {
    id: 'activities',
    title: 'Loguj aktivnosti',
    subtitle: 'Svaki trening, čitanje, kodiranje ili meditacija donosi XP. Izaberi tip, trajanje i intenzitet.',
    icon: 'fitness_center',
  },
  {
    id: 'tracking',
    title: '13 metoda pracenja',
    subtitle: '10 Pobeda, Deep Work, Habit Scorecard i još 10 metoda za svakodnevni ritual. Autosave radi automatski.',
    icon: 'checklist',
  },
  {
    id: 'social',
    title: 'Socijalni aspekt',
    subtitle: 'Prati prijatelje, ostavljaj komentare, uđi u grupe i kompetecije. Leaderboard te drži odgovornim.',
    icon: 'group',
  },
  {
    id: 'profile',
    title: 'Podesi profil',
    subtitle: 'Dodaj display name i bio da te prijatelji lakše pronađu.',
    icon: 'person',
    hasForm: true,
  },
];

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './onboarding.component.html',
  styleUrls: ['./onboarding.component.css'],
})
export class OnboardingComponent {
  steps = STEPS;
  currentStep = 0;
  displayName = '';
  bio = '';
  saving = false;

  constructor(
    private router: Router,
    private api: ApiService,
    public auth: AuthService
  ) {
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
    if (this.isLast) {
      this.finish();
    } else {
      this.currentStep++;
    }
  }

  prev(): void {
    if (this.currentStep > 0) this.currentStep--;
  }

  finish(): void {
    if (this.saving) return;
    this.saving = true;
    this.api.updateProfile({ displayName: this.displayName, bio: this.bio }).subscribe({
      next: () => {
        localStorage.setItem('bb-onboarded', '1');
        this.router.navigate(['/dashboard']);
      },
      error: () => {
        localStorage.setItem('bb-onboarded', '1');
        this.router.navigate(['/dashboard']);
      }
    });
  }

  skip(): void {
    localStorage.setItem('bb-onboarded', '1');
    this.router.navigate(['/dashboard']);
  }
}
