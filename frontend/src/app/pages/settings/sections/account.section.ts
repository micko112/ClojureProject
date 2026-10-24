import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../../services/auth.service';
import { AccountsService } from '../../../services/accounts.service';
import { ToastService } from '../../../services/toast.service';

@Component({
  selector: 'app-settings-account',
  standalone: true,
  imports: [FormsModule, RouterModule],
  styleUrls: ['../settings-shared.css'],
  template: `
    <div class="sec">
      <h2 class="sec-title">Account</h2>

      <div class="card">
        <h3 class="sec-sub" style="margin:0">Username</h3>
        <div class="toggle-row">
          <div class="txt"><strong>{{ auth.currentUser()?.username }}</strong>
            <span class="hint">You can change your username in Edit profile.</span></div>
          <a routerLink="/settings/edit-profile" class="btn">Edit</a>
        </div>
      </div>

      <div class="card">
        <h3 class="sec-sub" style="margin:0">Email</h3>
        <div class="field">
          <label for="ac-email">Email address</label>
          <input id="ac-email" type="email" [(ngModel)]="email" autocomplete="email" placeholder="you@example.com" />
          <span class="hint">Used to log in and to reset your password. It isn't shown on your profile.</span>
        </div>
        @if (emailError) { <div class="error">{{ emailError }}</div> }
        <div class="actions">
          <button class="btn btn-primary" (click)="saveEmail()" [disabled]="busy || !email.trim() || email.trim() === currentEmail">Save email</button>
        </div>
      </div>

      <div class="card">
        <h3 class="sec-sub" style="margin:0">{{ hasPassword ? 'Change password' : 'Set a password' }}</h3>
        @if (!hasPassword) {
          <p class="hint">You signed up with Google or Facebook. Set a password to also log in with your username or email.</p>
        }
        @if (hasPassword) {
          <div class="field">
            <label for="ac-cur">Current password</label>
            <input id="ac-cur" type="password" [(ngModel)]="currentPassword" autocomplete="current-password" />
          </div>
        }
        <div class="field">
          <label for="ac-new">New password</label>
          <input id="ac-new" type="password" [(ngModel)]="newPassword" autocomplete="new-password" />
        </div>
        <div class="field">
          <label for="ac-conf">Re-type new password</label>
          <input id="ac-conf" type="password" [(ngModel)]="confirmPassword" autocomplete="new-password" />
        </div>
        @if (pwError) { <div class="error">{{ pwError }}</div> }
        <div class="actions">
          @if (hasPassword) { <a routerLink="/forgot-password" class="btn-text">Forgot password?</a> }
          <button class="btn btn-primary" (click)="savePassword()" [disabled]="busy || newPassword.length < 6">
            {{ hasPassword ? 'Change password' : 'Set password' }}
          </button>
        </div>
        <p class="hint">Changing your password logs you out of your other devices.</p>
      </div>

      <div class="card">
        <h3 class="sec-sub" style="margin:0">Deactivate or delete</h3>
        <p class="hint">
          <strong>Deactivating</strong> is temporary: your profile, posts and stories are hidden until you log back in.<br>
          <strong>Deleting</strong> is permanent: your profile, posts, comments, stories and likes are removed.
        </p>
        <div class="field">
          <label for="ac-confirm">{{ hasPassword ? 'Confirm with your password' : 'Type your username to confirm' }}</label>
          <input id="ac-confirm" [type]="hasPassword ? 'password' : 'text'" [(ngModel)]="confirm" autocomplete="off" />
        </div>
        @if (dangerError) { <div class="error">{{ dangerError }}</div> }
        <div class="actions">
          <button class="btn" (click)="deactivate()" [disabled]="busy || !confirm">Deactivate account</button>
          <button class="btn btn-danger" (click)="deleteAccount()" [disabled]="busy || !confirm">Delete account</button>
        </div>
      </div>
    </div>
  `
})
export class AccountSectionComponent implements OnInit {
  email = '';
  currentEmail = '';
  currentPassword = '';
  newPassword = '';
  confirmPassword = '';
  confirm = '';
  busy = false;
  emailError = '';
  pwError = '';
  dangerError = '';

  constructor(public auth: AuthService, private accounts: AccountsService, private toast: ToastService, private router: Router) {}

  get hasPassword(): boolean { return this.auth.currentUser()?.settings?.hasPassword !== false; }

  ngOnInit(): void {
    this.currentEmail = this.auth.currentUser()?.settings?.email || '';
    this.email = this.currentEmail;
  }

  saveEmail(): void {
    this.busy = true;
    this.emailError = '';
    this.accounts.changeEmail(this.email.trim()).subscribe({
      next: u => { this.busy = false; this.currentEmail = u.settings?.email || ''; this.email = this.currentEmail; this.toast.success('Email updated.'); },
      error: e => { this.busy = false; this.emailError = e?.error?.error || 'Could not update email.'; }
    });
  }

  savePassword(): void {
    this.pwError = '';
    if (this.newPassword !== this.confirmPassword) { this.pwError = "Passwords don't match."; return; }
    this.busy = true;
    this.accounts.changePassword(this.currentPassword, this.newPassword).subscribe({
      next: () => {
        this.busy = false;
        this.currentPassword = this.newPassword = this.confirmPassword = '';
        this.toast.success('Password saved.');
      },
      error: e => { this.busy = false; this.pwError = e?.error?.error || 'Could not change password.'; }
    });
  }

  deactivate(): void {
    if (!confirm('Deactivate your account? You can come back any time by logging in.')) return;
    this.busy = true;
    this.dangerError = '';
    this.accounts.deactivate(this.confirm).subscribe({
      next: () => this.router.navigate(['/login'], { queryParams: { reason: 'deactivated' } }),
      error: e => { this.busy = false; this.dangerError = e?.error?.error || 'Could not deactivate.'; }
    });
  }

  deleteAccount(): void {
    if (!confirm('Permanently delete your account and everything you posted? This cannot be undone.')) return;
    this.busy = true;
    this.dangerError = '';
    this.accounts.deleteAccount(this.confirm).subscribe({
      next: () => this.router.navigate(['/login'], { queryParams: { reason: 'deleted' } }),
      error: e => { this.busy = false; this.dangerError = e?.error?.error || 'Could not delete account.'; }
    });
  }
}
