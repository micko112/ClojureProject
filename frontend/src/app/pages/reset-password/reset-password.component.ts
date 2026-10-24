import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [FormsModule, RouterModule],
  styleUrls: ['../login/login.component.css'],
  template: `
    <div class="login-page">
      <div class="login-card">
        <div class="center-icon"><span class="material-icons">key</span></div>
        <h2 class="center">Create a new password</h2>
        @if (!token) {
          <p class="error-msg center">This link is missing its token. Request a new one.</p>
          <a routerLink="/forgot-password" class="submit-btn center">Request a new link</a>
        } @else {
          <p class="subtitle center">Your password must be at least 6 characters.</p>
          <form (ngSubmit)="submit()">
            <div class="form-group">
              <label for="rp-new">New password</label>
              <input id="rp-new" type="password" [(ngModel)]="password" name="password" autocomplete="new-password" required />
            </div>
            <div class="form-group">
              <label for="rp-confirm">Confirm new password</label>
              <input id="rp-confirm" type="password" [(ngModel)]="confirm" name="confirm" autocomplete="new-password" required />
            </div>
            @if (error) { <div class="error-msg" role="alert">{{ error }}</div> }
            <button type="submit" class="submit-btn" [disabled]="loading || password.length < 6 || !confirm">
              {{ loading ? 'Saving...' : 'Reset password' }}
            </button>
          </form>
          @if (expired) {
            <a routerLink="/forgot-password" class="forgot-link">Request a new link</a>
          }
        }
        <div class="switch-mode">
          <a routerLink="/login" class="text-btn">Back to login</a>
        </div>
      </div>
    </div>
  `
})
export class ResetPasswordComponent {
  token = '';
  password = '';
  confirm = '';
  loading = false;
  error = '';
  expired = false;

  constructor(route: ActivatedRoute, private auth: AuthService, private router: Router) {
    this.token = route.snapshot.queryParamMap.get('token') || '';
  }

  submit(): void {
    if (this.loading) return;
    if (this.password !== this.confirm) { this.error = "Passwords don't match."; return; }
    this.loading = true;
    this.error = '';
    this.auth.resetPassword(this.token, this.password).subscribe({
      next: () => this.router.navigate(['/feed']),
      error: e => {
        this.loading = false;
        this.error = e?.error?.error || 'Something went wrong.';
        this.expired = /expired|invalid/i.test(this.error);
      }
    });
  }
}
