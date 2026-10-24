import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [FormsModule, RouterModule],
  styleUrls: ['../login/login.component.css'],
  template: `
    <div class="login-page">
      <div class="login-card">
        <div class="center-icon"><span class="material-icons">lock_outline</span></div>
        <h2 class="center">Trouble logging in?</h2>
        @if (sent) {
          <p class="subtitle center">{{ sent }}</p>
          <p class="subtitle center">Didn't get it? Check your spam folder or try again in a few minutes.</p>
          <button type="button" class="submit-btn" (click)="sent = ''">Send another link</button>
        } @else {
          <p class="subtitle center">Enter your email or username and we'll send you a link to get back into your account.</p>
          <form (ngSubmit)="submit()">
            <div class="form-group">
              <label for="fp-email">Email or username</label>
              <input id="fp-email" type="text" [(ngModel)]="email" name="email" autocomplete="email"
                autocapitalize="off" placeholder="you@example.com" required />
            </div>
            @if (error) { <div class="error-msg" role="alert">{{ error }}</div> }
            <button type="submit" class="submit-btn" [disabled]="loading || !email.trim()">
              {{ loading ? 'Sending...' : 'Send login link' }}
            </button>
          </form>
        }
        <div class="switch-mode">
          <a routerLink="/login" class="text-btn">Back to login</a>
        </div>
        <div class="legal-links">
          <a routerLink="/login" [queryParams]="{ mode: 'register' }">Create new account</a>
        </div>
      </div>
    </div>
  `
})
export class ForgotPasswordComponent {
  email = '';
  loading = false;
  error = '';
  sent = '';

  constructor(private auth: AuthService) {}

  submit(): void {
    if (this.loading || !this.email.trim()) return;
    this.loading = true;
    this.error = '';
    this.auth.forgotPassword(this.email.trim()).subscribe({
      next: r => {
        this.loading = false;
        this.sent = r.message || 'If an account exists, we sent you a link to reset your password.';
      },
      error: e => {
        this.loading = false;
        this.error = e?.error?.error || 'Something went wrong. Please try again.';
      }
    });
  }
}
