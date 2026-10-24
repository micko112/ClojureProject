import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../../services/auth.service';
import { AccountsService } from '../../../services/accounts.service';
import { ToastService } from '../../../services/toast.service';
import { MessagesFrom, NotificationPrefs } from '../../../models/user.model';

@Component({
  selector: 'app-settings-privacy',
  standalone: true,
  imports: [FormsModule, RouterModule],
  styleUrls: ['../settings-shared.css'],
  template: `
    <div class="sec">
      <h2 class="sec-title">Account privacy</h2>
      <div class="card">
        <div class="toggle-row">
          <div class="txt">
            <strong>Private account</strong>
            <span class="hint">When your account is public, anyone can see your profile and posts.
              When it's private, only followers you approve can see what you share. Your name, photo and bio stay visible.</span>
          </div>
          <label class="switch"><input type="checkbox" [ngModel]="s?.isPrivate" (ngModelChange)="save({ isPrivate: $event })" aria-label="Private account" /><span></span></label>
        </div>
        @if (s?.isPrivate) {
          <a routerLink="/settings/follow-requests" class="link-row">
            <span>Follow requests @if (s?.followRequestCount) { <strong>({{ s?.followRequestCount }})</strong> }</span>
            <span class="material-icons">chevron_right</span>
          </a>
        }
      </div>

      <h3 class="sec-sub">Activity status</h3>
      <div class="card">
        <div class="toggle-row">
          <div class="txt">
            <strong>Show activity status</strong>
            <span class="hint">Let accounts you follow and anyone you message see when you were last active.
              When turned off, you won't see others' activity status either.</span>
          </div>
          <label class="switch"><input type="checkbox" [ngModel]="!s?.hideActivity" (ngModelChange)="save({ hideActivity: !$event })" aria-label="Show activity status" /><span></span></label>
        </div>
      </div>

      <h3 class="sec-sub">Messages</h3>
      <div class="card">
        <span class="hint">Who can send you message requests</span>
        <label class="radio-row">
          <span>Everyone</span>
          <input type="radio" name="mf" value="everyone" [ngModel]="s?.messagesFrom" (ngModelChange)="saveMf($event)" />
        </label>
        <label class="radio-row">
          <span>Only people who follow you or you follow</span>
          <input type="radio" name="mf" value="followers" [ngModel]="s?.messagesFrom" (ngModelChange)="saveMf($event)" />
        </label>
      </div>
    </div>
  `
})
export class PrivacySectionComponent {
  constructor(private auth: AuthService, private accounts: AccountsService, private toast: ToastService) {}

  get s() { return this.auth.currentUser()?.settings; }

  saveMf(v: MessagesFrom): void { this.save({ messagesFrom: v }); }

  save(data: { isPrivate?: boolean; hideActivity?: boolean; messagesFrom?: MessagesFrom }): void {
    if (data.isPrivate === false && this.s?.followRequestCount &&
        !confirm('Switch to public? Your pending follow requests will be approved automatically.')) {
      this.auth.refresh();
      return;
    }
    this.accounts.updatePrivacy(data).subscribe({
      next: () => this.toast.success('Saved'),
      error: e => { this.toast.error(e?.error?.error || 'Could not save.'); this.auth.refresh(); }
    });
  }
}

const NOTIF_ROWS: { key: keyof NotificationPrefs; label: string; hint: string }[] = [
  { key: 'likes', label: 'Likes', hint: 'When someone likes your posts, stories or comments.' },
  { key: 'comments', label: 'Comments', hint: 'Comments and replies on your posts.' },
  { key: 'follows', label: 'Follows', hint: 'New followers, follow requests and accepted requests.' },
  { key: 'mentions', label: 'Mentions and tags', hint: 'When someone mentions or tags you.' },
  { key: 'messages', label: 'Messages', hint: 'New direct messages and message requests.' },
  { key: 'live', label: 'Live', hint: 'When someone you follow starts a live broadcast.' },
];

@Component({
  selector: 'app-settings-notifications',
  standalone: true,
  imports: [FormsModule],
  styleUrls: ['../settings-shared.css'],
  template: `
    <div class="sec">
      <h2 class="sec-title">Notifications</h2>
      <div class="card">
        @for (r of rows; track r.key) {
          <div class="toggle-row">
            <div class="txt"><strong>{{ r.label }}</strong><span class="hint">{{ r.hint }}</span></div>
            <label class="switch">
              <input type="checkbox" [ngModel]="prefs?.[r.key] ?? true" (ngModelChange)="set(r.key, $event)" [attr.aria-label]="r.label" />
              <span></span>
            </label>
          </div>
        }
      </div>
    </div>
  `
})
export class NotificationsSectionComponent {
  rows = NOTIF_ROWS;
  constructor(private auth: AuthService, private accounts: AccountsService, private toast: ToastService) {}

  get prefs(): NotificationPrefs | undefined { return this.auth.currentUser()?.settings?.notifications; }

  set(key: keyof NotificationPrefs, on: boolean): void {
    this.accounts.updateNotifications({ [key]: on }).subscribe({
      error: () => { this.toast.error('Could not save.'); this.auth.refresh(); }
    });
  }
}
