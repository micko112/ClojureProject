import { Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Subject, Subscription, debounceTime, switchMap, of, catchError } from 'rxjs';
import { AccountsService } from '../../services/accounts.service';
import { ListUser } from '../../models/user.model';

/** Followers / following list with search and Remove / Follow buttons. */
@Component({
  selector: 'app-user-list-modal',
  standalone: true,
  imports: [FormsModule, RouterModule],
  template: `
    <div class="ulm-overlay" (click)="closed.emit()">
      <div class="ulm-sheet" (click)="$event.stopPropagation()" role="dialog" [attr.aria-label]="title">
        <div class="ulm-header">
          <span class="ulm-spacer"></span>
          <h3>{{ title }}</h3>
          <button class="ulm-close" (click)="closed.emit()" aria-label="Close"><span class="material-icons">close</span></button>
        </div>
        <div class="ulm-search">
          <span class="material-icons">search</span>
          <input type="search" placeholder="Search" [(ngModel)]="q" (ngModelChange)="search$.next($event)" autocapitalize="off" />
        </div>
        <div class="ulm-list">
          @if (loading) {
            <div class="ulm-empty">Loading...</div>
          } @else if (error) {
            <div class="ulm-empty">{{ error }}</div>
          } @else if (!users.length) {
            <div class="ulm-empty">{{ q ? 'No results.' : (kind === 'followers' ? 'No followers yet.' : 'Not following anyone yet.') }}</div>
          }
          @for (u of users; track u.username) {
            <div class="ulm-row">
              <a class="ulm-user" [routerLink]="['/profile', u.username]" (click)="closed.emit()">
                <div class="ulm-avatar">
                  @if (u.profilePic) { <img [src]="u.profilePic" alt="" loading="lazy" /> }
                  @else { <span>{{ (u.displayName || u.username).charAt(0).toUpperCase() }}</span> }
                </div>
                <div class="ulm-names">
                  <span class="ulm-username">{{ u.username }}
                    @if (u.isPrivate) { <span class="material-icons ulm-lock">lock</span> }
                  </span>
                  <span class="ulm-display">{{ u.displayName }}</span>
                </div>
              </a>
              @if (!u.isMe) {
                @if (isOwner && kind === 'followers') {
                  <button class="ulm-btn" (click)="removeFollower(u)" [disabled]="busy[u.username]">Remove</button>
                } @else {
                  <button class="ulm-btn" [class.primary]="u.followStatus === 'none'" (click)="toggleFollow(u)" [disabled]="busy[u.username]">
                    {{ u.followStatus === 'following' ? 'Following' : u.followStatus === 'requested' ? 'Requested' : (u.followsYou ? 'Follow back' : 'Follow') }}
                  </button>
                }
              }
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .ulm-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.65); z-index: 400; display: flex; align-items: center; justify-content: center; }
    .ulm-sheet { background: var(--bg2); border: 1px solid var(--border); border-radius: 12px; width: 400px; max-width: calc(100vw - 32px); height: min(560px, 80vh); display: flex; flex-direction: column; overflow: hidden; }
    .ulm-header { display: flex; align-items: center; padding: 10px 12px; border-bottom: 1px solid var(--border); }
    .ulm-header h3 { flex: 1; text-align: center; font-size: 16px; font-weight: 700; }
    .ulm-spacer { width: 32px; }
    .ulm-close { width: 32px; background: none; border: none; color: var(--text); display: flex; align-items: center; justify-content: center; }
    .ulm-search { margin: 10px 16px; display: flex; align-items: center; gap: 8px; background: var(--bg3); border-radius: 8px; padding: 0 10px; color: var(--text-muted); }
    .ulm-search input { flex: 1; background: none; border: none; outline: none; color: var(--text); font-size: 14px; padding: 8px 0; min-width: 0; }
    .ulm-list { flex: 1; overflow-y: auto; padding: 4px 0 12px; }
    .ulm-empty { text-align: center; color: var(--text-muted); padding: 32px 16px; font-size: 14px; }
    .ulm-row { display: flex; align-items: center; gap: 12px; padding: 8px 16px; }
    .ulm-user { flex: 1; display: flex; align-items: center; gap: 12px; min-width: 0; }
    .ulm-avatar { width: 44px; height: 44px; border-radius: 50%; background: var(--bg3); overflow: hidden; display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0; }
    .ulm-avatar img { width: 100%; height: 100%; object-fit: cover; }
    .ulm-names { display: flex; flex-direction: column; min-width: 0; }
    .ulm-username { font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ulm-lock { font-size: 13px; color: var(--text-muted); }
    .ulm-display { color: var(--text-muted); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ulm-btn { background: var(--bg3); color: var(--text); border: none; border-radius: 8px; padding: 7px 14px; font-size: 13px; font-weight: 600; flex-shrink: 0; }
    .ulm-btn.primary { background: #0095f6; color: #fff; }
    .ulm-btn:disabled { opacity: .5; }
    @media (max-width: 600px) {
      .ulm-overlay { align-items: flex-end; }
      .ulm-sheet { width: 100%; max-width: 100%; height: 85vh; border-radius: 16px 16px 0 0; border-bottom: none; }
    }
  `]
})
export class UserListModalComponent implements OnInit, OnDestroy {
  @Input() username = '';
  @Input() kind: 'followers' | 'following' = 'followers';
  /** Viewer owns this profile (enables Remove on followers). */
  @Input() isOwner = false;
  @Output() closed = new EventEmitter<void>();
  /** Emitted when the viewer's follow graph changed (counts may need refresh). */
  @Output() changed = new EventEmitter<void>();

  users: ListUser[] = [];
  q = '';
  loading = true;
  error = '';
  busy: Record<string, boolean> = {};
  search$ = new Subject<string>();
  private sub?: Subscription;

  constructor(private accounts: AccountsService) {}

  get title(): string { return this.kind === 'followers' ? 'Followers' : 'Following'; }

  ngOnInit(): void {
    this.sub = this.search$.pipe(
      debounceTime(250),
      switchMap(q => this.fetch(q))
    ).subscribe();
    this.fetch('').subscribe();
  }

  ngOnDestroy(): void { this.sub?.unsubscribe(); }

  private fetch(q: string) {
    this.loading = true;
    const req = this.kind === 'followers'
      ? this.accounts.followers(this.username, q)
      : this.accounts.following(this.username, q);
    return req.pipe(
      catchError(e => {
        this.error = e?.status === 403 ? 'This account is private.' : 'Could not load the list.';
        return of(null);
      }),
      switchMap(list => {
        this.loading = false;
        if (list) { this.users = list; this.error = ''; }
        return of(list);
      })
    );
  }

  toggleFollow(u: ListUser): void {
    if (u.followStatus === 'following' && u.isPrivate &&
        !confirm(`Unfollow ${u.username}? You'll have to request to follow again.`)) return;
    this.busy[u.username] = true;
    this.accounts.toggleFollow(u.username).subscribe({
      next: r => { u.followStatus = r.followStatus; this.busy[u.username] = false; this.changed.emit(); },
      error: () => { this.busy[u.username] = false; }
    });
  }

  removeFollower(u: ListUser): void {
    if (!confirm(`Remove ${u.username} from your followers? They won't be notified.`)) return;
    this.busy[u.username] = true;
    this.accounts.removeFollower(u.username).subscribe({
      next: () => {
        this.users = this.users.filter(x => x.username !== u.username);
        this.busy[u.username] = false;
        this.changed.emit();
      },
      error: () => { this.busy[u.username] = false; }
    });
  }
}
