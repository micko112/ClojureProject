import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../services/api.service';
import { AuthService } from '../../../services/auth.service';
import { AccountsService } from '../../../services/accounts.service';
import { ToastService } from '../../../services/toast.service';

@Component({
  selector: 'app-settings-edit-profile',
  standalone: true,
  imports: [FormsModule],
  styleUrls: ['../settings-shared.css'],
  styles: [`
    .pic-row { display: flex; align-items: center; gap: 14px; background: var(--bg2); border: 1px solid var(--border); border-radius: 14px; padding: 14px; }
    .pic-row .avatar { width: 56px; height: 56px; font-size: 22px; }
    .pic-row .names { flex: 1; }
    input[type=file] { display: none; }
  `],
  template: `
    <div class="sec">
      <h2 class="sec-title">Edit profile</h2>

      <div class="pic-row">
        <div class="avatar">
          @if (profilePic) { <img [src]="profilePic" alt="" /> } @else { {{ (displayName || username || '?').charAt(0).toUpperCase() }} }
        </div>
        <div class="names">
          <strong>{{ auth.currentUser()?.username }}</strong>
          <span>{{ displayName }}</span>
        </div>
        <label class="btn btn-primary" for="pic-file">{{ uploading ? 'Uploading...' : 'Change photo' }}</label>
        <input id="pic-file" type="file" accept="image/*" (change)="onFile($event)" />
      </div>
      @if (profilePic) {
        <div class="actions" style="justify-content:flex-start;margin-top:-10px">
          <button class="btn-text danger" (click)="profilePic = ''">Remove current photo</button>
        </div>
      }

      <div class="field">
        <label for="ep-name">Name</label>
        <input id="ep-name" type="text" [(ngModel)]="displayName" maxlength="64" placeholder="Name" />
        <span class="hint">Help people discover your account by using the name you're known by.</span>
      </div>
      <div class="field">
        <label for="ep-username">Username</label>
        <input id="ep-username" type="text" [(ngModel)]="username" maxlength="30" autocapitalize="off" spellcheck="false" />
        <span class="hint">3-30 characters: letters, numbers, periods and underscores.</span>
      </div>
      <div class="field">
        <label for="ep-pronouns">Pronouns</label>
        <input id="ep-pronouns" type="text" [(ngModel)]="pronouns" maxlength="30" placeholder="e.g. she/her" />
      </div>
      <div class="field">
        <label for="ep-bio">Bio</label>
        <textarea id="ep-bio" rows="3" [(ngModel)]="bio" maxlength="150" placeholder="What are you working on?"></textarea>
        <span class="counter">{{ bio.length }} / 150</span>
      </div>
      <div class="field">
        <label for="ep-web">Website</label>
        <input id="ep-web" type="url" [(ngModel)]="website" placeholder="example.com" autocapitalize="off" />
      </div>

      @if (error) { <div class="error">{{ error }}</div> }
      <div class="actions">
        <button class="btn btn-primary" (click)="save()" [disabled]="saving || uploading">{{ saving ? 'Saving...' : 'Submit' }}</button>
      </div>
    </div>
  `
})
export class EditProfileSectionComponent implements OnInit {
  displayName = '';
  username = '';
  pronouns = '';
  bio = '';
  website = '';
  profilePic = '';
  saving = false;
  uploading = false;
  error = '';

  constructor(public auth: AuthService, private accounts: AccountsService, private api: ApiService, private toast: ToastService) {}

  ngOnInit(): void {
    const u = this.auth.currentUser();
    if (!u) return;
    this.displayName = u.displayName || '';
    this.username = u.username;
    this.pronouns = u.pronouns || '';
    this.bio = u.bio || '';
    this.website = u.website || '';
    this.profilePic = u.profilePic || '';
  }

  onFile(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.uploading = true;
    this.api.uploadFile(file).subscribe({
      next: r => { this.profilePic = r.url; this.uploading = false; },
      error: () => { this.uploading = false; this.toast.error('Upload failed.'); }
    });
    input.value = '';
  }

  save(): void {
    this.saving = true;
    this.error = '';
    this.accounts.updateProfile({
      displayName: this.displayName,
      username: this.username.trim(),
      pronouns: this.pronouns,
      bio: this.bio,
      website: this.website,
      profilePic: this.profilePic
    }).subscribe({
      next: () => { this.saving = false; this.toast.success('Profile saved.'); },
      error: e => { this.saving = false; this.error = e?.error?.error || 'Could not save your profile.'; }
    });
  }
}
