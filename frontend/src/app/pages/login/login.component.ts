import { Component, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { BRAND } from '../../core/brand';

// Replace with your actual Google Client ID
const GOOGLE_CLIENT_ID = 'REPLACE_WITH_GOOGLE_CLIENT_ID';

const USERNAME_RE = /^[A-Za-z0-9._]{3,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent implements AfterViewInit {
  brand = BRAND;
  mode: 'login' | 'register' = 'login';
  // login: username OR email
  username = '';
  password = '';
  // register
  email = '';
  displayName = '';
  showPassword = false;

  loading = false;
  oauthLoading = false;
  error = '';
  info = '';
  selectedUser = '';

  seedUsers = ['Micko', 'Uros', 'Milan', 'Pavel', 'Toda', 'Vule'];

  constructor(private auth: AuthService, private router: Router, route: ActivatedRoute) {
    if (this.auth.isLoggedIn()) this.router.navigate(['/dashboard']);
    const q = route.snapshot.queryParamMap;
    if (q.get('mode') === 'register') this.mode = 'register';
    if (q.get('reason') === 'deleted') this.info = 'Your account was deleted.';
    if (q.get('reason') === 'deactivated') this.info = 'Your account is deactivated. Log in again any time to reactivate it.';
    if (q.get('reason') === 'logged-out') this.info = 'You were logged out of all devices.';
  }

  ngAfterViewInit(): void {
    this.tryInitGoogle(0);
  }

  setMode(m: 'login' | 'register'): void {
    this.mode = m;
    this.error = '';
    this.info = '';
  }

  private tryInitGoogle(attempts: number): void {
    const g = (window as any).google;
    if (!g) {
      if (attempts < 10) setTimeout(() => this.tryInitGoogle(attempts + 1), 300);
      return;
    }
    g.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (resp: any) => this.handleGoogleCredential(resp.credential)
    });
    const btnEl = document.getElementById('google-btn');
    if (btnEl) {
      g.accounts.id.renderButton(btnEl, { theme: 'filled_black', size: 'large', width: 300, text: 'continue_with' });
    }
  }

  private handleGoogleCredential(idToken: string): void {
    this.oauthLoading = true;
    this.error = '';
    this.auth.loginWithOAuth('/api/oauth/google', { idToken }).subscribe({
      next: () => this.router.navigate(['/dashboard']),
      error: e => { this.oauthLoading = false; this.error = e?.error?.error || 'Google login failed.'; }
    });
  }

  loginWithFacebook(): void {
    const FB = (window as any).FB;
    if (!FB) { this.error = 'Facebook SDK not loaded. Check your app ID configuration.'; return; }
    this.oauthLoading = true;
    this.error = '';
    FB.login((response: any) => {
      if (response.authResponse?.accessToken) {
        this.auth.loginWithOAuth('/api/oauth/facebook', { accessToken: response.authResponse.accessToken }).subscribe({
          next: () => this.router.navigate(['/dashboard']),
          error: e => { this.oauthLoading = false; this.error = e?.error?.error || 'Facebook login failed.'; }
        });
      } else {
        this.oauthLoading = false;
      }
    }, { scope: 'public_profile,email' });
  }

  selectUser(u: string): void {
    this.selectedUser = u;
    this.username = u;
    this.password = '';
  }

  get canSubmit(): boolean {
    if (this.loading || this.oauthLoading) return false;
    if (this.mode === 'login') return !!this.username.trim() && !!this.password;
    return !!this.email.trim() && !!this.username.trim() && this.password.length >= 6;
  }

  private validateRegister(): string {
    if (!EMAIL_RE.test(this.email.trim())) return 'Enter a valid email address.';
    if (!USERNAME_RE.test(this.username.trim()))
      return 'Usernames must be 3-30 characters: letters, numbers, periods and underscores.';
    if (this.password.length < 6) return 'Password must be at least 6 characters.';
    return '';
  }

  submit(): void {
    if (!this.canSubmit) return;
    this.error = this.mode === 'register' ? this.validateRegister() : '';
    if (this.error) return;
    this.loading = true;
    this.info = '';
    const obs = this.mode === 'login'
      ? this.auth.login(this.username.trim(), this.password)
      : this.auth.register({
          username: this.username.trim(),
          password: this.password,
          email: this.email.trim(),
          displayName: this.displayName.trim() || undefined
        });
    obs.subscribe({
      next: () => {
        const dest = (this.mode === 'register' && !localStorage.getItem('bb-onboarded'))
          ? '/onboarding'
          : '/dashboard';
        this.router.navigate([dest]);
      },
      error: (e) => {
        this.loading = false;
        this.error = e?.error?.error || 'Something went wrong.';
      }
    });
  }
}
