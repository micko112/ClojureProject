import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../../services/auth.service';
import { ToastService } from '../../../services/toast.service';
import { BRAND } from '../../../core/brand';

/** Same localStorage key and attribute the layout's theme toggle uses. */
const THEME_KEY = 'bb-theme';

@Component({
  selector: 'app-settings-theme',
  standalone: true,
  imports: [FormsModule],
  styleUrls: ['../settings-shared.css'],
  template: `
    <div class="sec">
      <h2 class="sec-title">Theme</h2>
      <div class="card">
        <label class="radio-row"><span>Dark</span>
          <input type="radio" name="theme" value="dark" [ngModel]="theme" (ngModelChange)="set($event)" /></label>
        <label class="radio-row"><span>Light</span>
          <input type="radio" name="theme" value="light" [ngModel]="theme" (ngModelChange)="set($event)" /></label>
      </div>
    </div>
  `
})
export class ThemeSectionComponent {
  theme: 'dark' | 'light';

  constructor() {
    let saved: string | null = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch { /* storage blocked */ }
    this.theme = saved === 'light' ? 'light' : 'dark';
  }

  set(t: 'dark' | 'light'): void {
    this.theme = t;
    try { localStorage.setItem(THEME_KEY, t); } catch { /* storage blocked */ }
    document.documentElement.setAttribute('data-theme', t);
  }
}

@Component({
  selector: 'app-settings-security',
  standalone: true,
  styleUrls: ['../settings-shared.css'],
  template: `
    <div class="sec">
      <h2 class="sec-title">Login activity</h2>
      <div class="card">
        <div class="toggle-row">
          <div class="txt">
            <strong>Log out of other devices</strong>
            <span class="hint">Ends every session except this one — useful if you logged in on a shared or lost device.</span>
          </div>
          <button class="btn" (click)="logoutAll(true)" [disabled]="busy">Log out others</button>
        </div>
        <div class="toggle-row">
          <div class="txt">
            <strong>Log out of all devices</strong>
            <span class="hint">Ends every session, including this one.</span>
          </div>
          <button class="btn btn-danger" (click)="logoutAll(false)" [disabled]="busy">Log out all</button>
        </div>
      </div>
      <p class="hint">Changing or resetting your password also logs you out of your other devices.</p>
    </div>
  `
})
export class SecuritySectionComponent {
  busy = false;
  constructor(private auth: AuthService, private toast: ToastService, private router: Router) {}

  logoutAll(keepCurrent: boolean): void {
    if (!keepCurrent && !confirm('Log out of all devices, including this one?')) return;
    this.busy = true;
    this.auth.logoutAll(keepCurrent).subscribe({
      next: () => {
        this.busy = false;
        if (keepCurrent) this.toast.success('Logged out of all other devices.');
        else this.router.navigate(['/login'], { queryParams: { reason: 'logged-out' } });
      },
      error: () => { this.busy = false; this.toast.error('Something went wrong.'); }
    });
  }
}

@Component({
  selector: 'app-settings-about',
  standalone: true,
  imports: [RouterModule],
  styleUrls: ['../settings-shared.css'],
  template: `
    <div class="sec">
      <h2 class="sec-title">About</h2>
      <p class="hint">{{ brand.name }} — {{ brand.tagline }}</p>
      <div class="card" style="gap:0">
        <a routerLink="/privacy" class="link-row"><span>Privacy policy</span><span class="material-icons">chevron_right</span></a>
        <a routerLink="/terms" class="link-row"><span>Terms of use</span><span class="material-icons">chevron_right</span></a>
      </div>
    </div>
  `
})
export class AboutSectionComponent {
  brand = BRAND;
}
