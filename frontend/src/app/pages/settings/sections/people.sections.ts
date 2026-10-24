import { Component, Input, OnChanges, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Subject, Subscription, debounceTime, switchMap, of, catchError } from 'rxjs';
import { ApiService } from '../../../services/api.service';
import { AuthService } from '../../../services/auth.service';
import { AccountsService, RelationKind } from '../../../services/accounts.service';
import { ToastService } from '../../../services/toast.service';
import { FollowRequest, ListUser, User } from '../../../models/user.model';

interface RelationCopy {
  title: string;
  intro: string;
  empty: string;
  removeLabel: string;
  canAdd: boolean;
}

const COPY: Record<RelationKind, RelationCopy> = {
  'close-friends': {
    title: 'Close friends',
    intro: "Only people on this list can see posts and stories you share with Close friends. We don't send notifications when you edit the list.",
    empty: 'Add people to your close friends list.',
    removeLabel: 'Remove',
    canAdd: true,
  },
  blocks: {
    title: 'Blocked accounts',
    intro: "Blocked accounts can't find your profile, posts or stories, and you won't see theirs. Blocking removes follows in both directions.",
    empty: "You haven't blocked anyone.",
    removeLabel: 'Unblock',
    canAdd: false,
  },
  mutes: {
    title: 'Muted accounts',
    intro: "You won't see posts and stories from muted accounts in your feed. They won't know you muted them, and you still follow them.",
    empty: "You haven't muted anyone.",
    removeLabel: 'Unmute',
    canAdd: false,
  },
  restricts: {
    title: 'Restricted accounts',
    intro: 'Protect yourself from unwanted interactions without blocking or unfollowing people you know.',
    empty: "You haven't restricted anyone.",
    removeLabel: 'Unrestrict',
    canAdd: false,
  },
};

@Component({
  selector: 'app-settings-relations',
  standalone: true,
  imports: [FormsModule, RouterModule],
  styleUrls: ['../settings-shared.css'],
  template: `
    <div class="sec">
      <h2 class="sec-title">{{ copy.title }}</h2>
      <p class="hint">{{ copy.intro }}</p>

      @if (copy.canAdd) {
        <div class="search">
          <span class="material-icons">search</span>
          <input type="search" placeholder="Search people to add" [(ngModel)]="q" (ngModelChange)="search$.next($event)" autocapitalize="off" />
        </div>
        @if (q.trim()) {
          <div class="card">
            @if (!results.length) { <div class="empty">No results.</div> }
            @for (u of results; track u.username) {
              <div class="user-row">
                <a class="who" [routerLink]="['/profile', u.username]">
                  <span class="avatar">@if (u.profilePic) { <img [src]="u.profilePic" alt="" /> } @else { {{ initial(u) }} }</span>
                  <span class="names"><strong>{{ u.username }}</strong><span>{{ u.displayName }}</span></span>
                </a>
                @if (inList(u.username)) {
                  <span class="material-icons" style="color:#1cd14f">check_circle</span>
                } @else {
                  <button class="btn btn-primary" (click)="add(u)">Add</button>
                }
              </div>
            }
          </div>
        }
      }

      <div class="card">
        @if (loading) { <div class="empty">Loading...</div> }
        @else if (!users.length) { <div class="empty">{{ copy.empty }}</div> }
        @for (u of users; track u.username) {
          <div class="user-row">
            <a class="who" [routerLink]="['/profile', u.username]">
              <span class="avatar">@if (u.profilePic) { <img [src]="u.profilePic" alt="" /> } @else { {{ initial(u) }} }</span>
              <span class="names"><strong>{{ u.username }}</strong><span>{{ u.displayName }}</span></span>
            </a>
            <button class="btn" (click)="remove(u)" [disabled]="busy[u.username]">{{ copy.removeLabel }}</button>
          </div>
        }
      </div>
    </div>
  `
})
export class RelationsSectionComponent implements OnChanges, OnDestroy {
  @Input() kind: RelationKind = 'blocks';
  users: ListUser[] = [];
  results: User[] = [];
  loading = true;
  q = '';
  busy: Record<string, boolean> = {};
  search$ = new Subject<string>();
  private sub: Subscription;

  constructor(private accounts: AccountsService, private api: ApiService, private toast: ToastService) {
    this.sub = this.search$.pipe(
      debounceTime(250),
      switchMap(q => q.trim() ? this.api.searchUsers(q.trim()).pipe(catchError(() => of([]))) : of([]))
    ).subscribe(r => this.results = r);
  }

  get copy(): RelationCopy { return COPY[this.kind]; }

  ngOnChanges(): void {
    this.q = '';
    this.results = [];
    this.load();
  }

  ngOnDestroy(): void { this.sub.unsubscribe(); }

  load(): void {
    this.loading = true;
    this.accounts.list(this.kind).subscribe({
      next: l => { this.users = l; this.loading = false; },
      error: () => { this.users = []; this.loading = false; }
    });
  }

  inList(username: string): boolean { return this.users.some(u => u.username === username); }

  initial(u: { username: string; displayName?: string }): string {
    return (u.displayName || u.username || '?').charAt(0).toUpperCase();
  }

  add(u: User): void {
    this.accounts.add(this.kind, u.username).subscribe({
      next: () => this.load(),
      error: e => this.toast.error(e?.error?.error || 'Could not add.')
    });
  }

  remove(u: ListUser): void {
    this.busy[u.username] = true;
    this.accounts.remove(this.kind, u.username).subscribe({
      next: () => { this.users = this.users.filter(x => x.username !== u.username); },
      error: () => { this.busy[u.username] = false; this.toast.error('Something went wrong.'); }
    });
  }
}

@Component({
  selector: 'app-settings-follow-requests',
  standalone: true,
  imports: [RouterModule],
  styleUrls: ['../settings-shared.css'],
  template: `
    <div class="sec">
      <h2 class="sec-title">Follow requests</h2>
      @if (!isPrivate) {
        <p class="hint">Your account is public, so anyone can follow you without a request.
          <a routerLink="/settings/privacy" class="btn-text">Privacy settings</a></p>
      }
      <div class="card">
        @if (loading) { <div class="empty">Loading...</div> }
        @else if (!requests.length) { <div class="empty">No pending follow requests.</div> }
        @for (r of requests; track r.id) {
          <div class="user-row">
            <a class="who" [routerLink]="['/profile', r.user.username]">
              <span class="avatar">@if (r.user.profilePic) { <img [src]="r.user.profilePic" alt="" /> } @else { {{ (r.user.displayName || r.user.username).charAt(0).toUpperCase() }} }</span>
              <span class="names"><strong>{{ r.user.username }}</strong><span>{{ r.user.displayName }}</span></span>
            </a>
            <button class="btn btn-primary" (click)="respond(r, true)" [disabled]="busy[r.id]">Confirm</button>
            <button class="btn" (click)="respond(r, false)" [disabled]="busy[r.id]">Delete</button>
          </div>
        }
      </div>
    </div>
  `
})
export class FollowRequestsSectionComponent {
  requests: FollowRequest[] = [];
  loading = true;
  busy: Record<string, boolean> = {};

  constructor(private accounts: AccountsService, private auth: AuthService) {
    this.accounts.followRequests().subscribe({
      next: r => { this.requests = r; this.loading = false; },
      error: () => { this.loading = false; }
    });
  }

  get isPrivate(): boolean { return !!this.auth.currentUser()?.settings?.isPrivate; }

  respond(r: FollowRequest, accept: boolean): void {
    this.busy[r.id] = true;
    const req = accept ? this.accounts.acceptRequest(r.user.username) : this.accounts.declineRequest(r.user.username);
    req.subscribe({
      next: () => { this.requests = this.requests.filter(x => x.id !== r.id); this.auth.refresh(); },
      error: () => { this.busy[r.id] = false; }
    });
  }
}
