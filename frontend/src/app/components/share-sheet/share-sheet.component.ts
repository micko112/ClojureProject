import { Component, EventEmitter, Input, OnInit, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { DmService, DmUser } from '../../services/dm.service';
import { ToastService } from '../../services/toast.service';

/**
 * "Send to" sheet: share a post into one or more DMs.
 *
 *   <app-share-sheet [postId]="post.id" (closed)="showShare = false" />
 *
 * Emits `closed` with the number of people it was sent to (0 when dismissed).
 * OWNER: realtime agent.
 */
@Component({
  selector: 'app-share-sheet',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="ss-backdrop" (click)="close(0)">
      <div class="ss-sheet" (click)="$event.stopPropagation()" role="dialog" aria-label="Share">
        <div class="ss-grabber"></div>
        <header class="ss-head">
          <span></span>
          <h3>Share</h3>
          <button class="ss-icon" (click)="close(0)" aria-label="Close"><span class="material-icons">close</span></button>
        </header>
        <div class="ss-search">
          <span class="material-icons">search</span>
          <input [(ngModel)]="query" (ngModelChange)="onSearch()" placeholder="Search" />
        </div>
        <div class="ss-grid">
          @if (!people.length) {
            <p class="ss-empty">{{ query ? 'No people found' : 'Search for people to send this post to' }}</p>
          }
          @for (u of people; track u.username) {
            <button class="ss-person" [class.on]="isSelected(u)" (click)="toggle(u)">
              <div class="ss-avatar">
                @if (u.profilePic) { <img [src]="u.profilePic" alt="" /> } @else { <span>{{ initial(u) }}</span> }
                @if (isSelected(u)) { <i class="ss-check material-icons">check</i> }
              </div>
              <span class="ss-name">{{ u.displayName || u.username }}</span>
            </button>
          }
        </div>
        @if (selected.length) {
          <div class="ss-footer">
            <input class="ss-msg" [(ngModel)]="message" placeholder="Write a message…" maxlength="500" />
            <button class="ss-send" (click)="send()" [disabled]="sending">
              {{ sending ? 'Sending…' : (selected.length > 1 ? 'Send separately' : 'Send') }}
            </button>
          </div>
        } @else {
          <div class="ss-footer ss-actions">
            <button class="ss-action" (click)="copyLink()"><span class="material-icons">link</span><small>Copy link</small></button>
            @if (canNativeShare) {
              <button class="ss-action" (click)="nativeShare()"><span class="material-icons">ios_share</span><small>Share to…</small></button>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .ss-backdrop { position: fixed; inset: 0; background: var(--overlay); z-index: 9500; display: flex; align-items: center; justify-content: center; }
    .ss-sheet { width: min(420px, 100vw); max-height: min(560px, 90dvh); background: var(--modal-bg); border-radius: 12px; display: flex; flex-direction: column; overflow: hidden; animation: ss-in .2s ease; }
    @keyframes ss-in { from { transform: translateY(24px); opacity: 0; } }
    .ss-grabber { display: none; width: 40px; height: 4px; border-radius: 2px; background: var(--border-mid); margin: 8px auto 0; }
    .ss-head { display: grid; grid-template-columns: 40px 1fr 40px; align-items: center; padding: 2px 8px; min-height: 44px; border-bottom: 1px solid var(--modal-sep); }
    .ss-head h3 { text-align: center; font-size: 16px; font-weight: 700; }
    .ss-icon { background: none; border: none; color: var(--text); cursor: pointer; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; }
    .ss-search { display: flex; align-items: center; gap: 8px; margin: 0; padding: 4px 16px; border-bottom: 1px solid var(--modal-sep); }
    .ss-search .material-icons { color: var(--text-muted); font-size: 20px; }
    .ss-search input { flex: 1; background: none; border: none; outline: none; color: var(--text); padding: 8px 0; font-size: 14px; font-family: inherit; }
    .ss-search input::placeholder { color: var(--text-muted); }
    .ss-grid { flex: 1; overflow-y: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); gap: 8px; padding: 12px 12px 12px; min-height: 160px; align-content: start; }
    .ss-empty { grid-column: 1 / -1; text-align: center; color: var(--text-muted); font-size: 13px; padding: 32px 0; }
    .ss-person { background: none; border: none; display: flex; flex-direction: column; align-items: center; gap: 6px; cursor: pointer; padding: 6px 2px; color: var(--text); font-family: inherit; }
    .ss-avatar { position: relative; width: 64px; height: 64px; border-radius: 50%; background: var(--surface2); display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 22px; }
    .ss-avatar img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }
    .ss-check { position: absolute; right: -2px; bottom: -2px; width: 22px; height: 22px; border-radius: 50%; background: var(--brand-solid); color: #fff; font-size: 16px; display: flex; align-items: center; justify-content: center; border: 2px solid var(--modal-bg); }
    .ss-person.on .ss-avatar img, .ss-person.on .ss-avatar span { opacity: .75; }
    .ss-name { font-size: 12px; max-width: 84px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ss-footer { border-top: 1px solid var(--modal-sep); padding: 10px 14px calc(10px + env(safe-area-inset-bottom, 0px)); display: flex; flex-direction: column; gap: 8px; }
    .ss-msg { background: none; border: none; outline: none; color: var(--text); font-size: 14px; padding: 6px 2px; font-family: inherit; }
    .ss-send { background: var(--brand-solid); color: #fff; border: none; border-radius: 8px; height: 44px; font-weight: 600; font-size: 14px; cursor: pointer; font-family: inherit; }
    .ss-send:hover:not(:disabled) { background: var(--brand-solid-hover); }
    .ss-send:disabled { opacity: .4; }
    .ss-actions { flex-direction: row; gap: 18px; }
    .ss-action { background: none; border: none; color: var(--text); display: flex; flex-direction: column; align-items: center; gap: 4px; cursor: pointer; font-family: inherit; }
    .ss-action .material-icons { width: 48px; height: 48px; border-radius: 50%; background: var(--surface2); display: flex; align-items: center; justify-content: center; font-size: 22px; }
    .ss-action small { font-size: 12px; color: var(--text); }
    @media (max-width: 768px) {
      .ss-backdrop { align-items: flex-end; }
      .ss-sheet { border-radius: 12px 12px 0 0; max-height: 85dvh; }
      .ss-grabber { display: block; }
    }
  `]
})
export class ShareSheetComponent implements OnInit {
  @Input({ required: true }) postId!: string;
  @Output() closed = new EventEmitter<number>();

  private dm = inject(DmService);
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private toast = inject(ToastService);

  query = '';
  message = '';
  sending = false;
  recent: DmUser[] = [];
  people: DmUser[] = [];
  selected: DmUser[] = [];
  readonly canNativeShare = typeof navigator !== 'undefined' && !!(navigator as any).share;
  private searchTimer: any;

  ngOnInit(): void {
    this.dm.conversations('primary').subscribe({
      next: convs => {
        this.recent = convs.map(c => c.other).filter(Boolean).slice(0, 24);
        if (!this.query) this.people = this.recent;
      },
      error: () => {}
    });
  }

  onSearch(): void {
    clearTimeout(this.searchTimer);
    const q = this.query.trim();
    if (!q) { this.people = this.recent; return; }
    this.searchTimer = setTimeout(() => {
      this.api.searchUsers(q).subscribe({
        next: r => {
          const me = this.auth.currentUser()?.username;
          this.people = (r as DmUser[]).filter(u => u.username !== me);
        },
        error: () => {}
      });
    }, 220);
  }

  isSelected(u: DmUser): boolean { return this.selected.some(s => s.username === u.username); }

  toggle(u: DmUser): void {
    this.selected = this.isSelected(u)
      ? this.selected.filter(s => s.username !== u.username)
      : [...this.selected, u];
  }

  send(): void {
    if (!this.selected.length || this.sending) return;
    this.sending = true;
    this.dm.sharePost(this.postId, this.selected.map(s => s.username), this.message.trim() || undefined).subscribe({
      next: r => {
        this.sending = false;
        this.toast.success(r.sent === 1 ? 'Sent' : `Sent to ${r.sent} people`);
        this.close(r.sent);
      },
      error: () => { this.sending = false; this.toast.error('Could not send'); }
    });
  }

  postUrl(): string { return `${location.origin}/post/${this.postId}`; }

  copyLink(): void {
    navigator.clipboard?.writeText(this.postUrl()).then(
      () => this.toast.success('Link copied'),
      () => this.toast.error('Could not copy link'));
  }

  nativeShare(): void {
    (navigator as any).share?.({ url: this.postUrl() }).catch(() => {});
  }

  close(sent: number): void { this.closed.emit(sent); }

  initial(u: DmUser): string { return (u.displayName || u.username || '?').charAt(0).toUpperCase(); }
}
