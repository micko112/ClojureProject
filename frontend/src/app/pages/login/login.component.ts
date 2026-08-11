import { Component, OnInit, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

// Replace with your actual Google Client ID
const GOOGLE_CLIENT_ID = 'REPLACE_WITH_GOOGLE_CLIENT_ID';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent implements OnInit, AfterViewInit {
  mode: 'login' | 'register' = 'login';
  username = '';
  password = '';
  loading = false;
  oauthLoading = false;
  error = '';
  selectedUser = '';
  showPasswordFor = '';

  seedUsers = ['Micko', 'Uros', 'Milan', 'Pavel', 'Toda', 'Vule'];

  constructor(private auth: AuthService, private router: Router) {
    if (this.auth.isLoggedIn()) this.router.navigate(['/dashboard']);
  }

  ngOnInit(): void {}

  ngAfterViewInit(): void {
    this.tryInitGoogle(0);
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
    this.showPasswordFor = u;
    this.password = '';
  }

  submit(): void {
    if (!this.username.trim() || this.loading) return;
    if (this.mode === 'register' && this.password.length < 6) {
      this.error = 'Password must be at least 6 characters.';
      return;
    }
    this.loading = true;
    this.error = '';
    const obs = this.mode === 'login'
      ? this.auth.login(this.username.trim(), this.password)
      : this.auth.register(this.username.trim(), this.password);
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
