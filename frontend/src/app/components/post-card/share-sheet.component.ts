import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { ApiService } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';
import { Post } from '../../models/post.model';
import { initials } from './post-utils';

export function postLink(post: Post): string {
  return `${location.origin}/post/${post.id}`;
}

export function copyPostLink(post: Post, toast: ToastService): void {
  const url = postLink(post);
  const done = () => toast.success('Link copied');
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done, () => toast.info(url));
  else toast.info(url);
}

/** "Share" bottom sheet: send the post to a DM conversation or copy its link. */
@Component({
  selector: 'app-share-sheet',
  standalone: true,
  template: `
    <div class="ss-overlay" (click)="closed.emit()">
      <div class="ss-sheet" (click)="$event.stopPropagation()" role="dialog" aria-label="Share">
        <div class="ss-head">
          <span>Share</span>
          <button type="button" (click)="closed.emit()" aria-label="Close"><span class="material-icons">close</span></button>
        </div>
        <div class="ss-list">
          @if (loading) { <div class="ss-empty">Loading…</div> }
          @else if (!conversations.length) { <div class="ss-empty">No conversations yet.</div> }
          @for (c of conversations; track c.id) {
            <button type="button" class="ss-item" (click)="send(c)" [disabled]="sent.has(c.id)">
              <span class="ss-av">
                @if (c.other?.profilePic) { <img [src]="c.other.profilePic" alt="" /> } @else { {{ initials(c.other) }} }
              </span>
              <span class="ss-name">{{ c.other?.displayName || c.other?.username }}</span>
              <span class="ss-send">{{ sent.has(c.id) ? 'Sent' : 'Send' }}</span>
            </button>
          }
        </div>
        <button type="button" class="ss-copy" (click)="copy()"><span class="material-icons">link</span> Copy link</button>
      </div>
    </div>
  `,
  styles: [`
    .ss-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.6); z-index: 6000; display: flex;
                  align-items: center; justify-content: center; }
    .ss-sheet { background: var(--bg2); border: 1px solid var(--border); border-radius: 12px; width: min(400px, calc(100vw - 32px));
                max-height: 70vh; display: flex; flex-direction: column; overflow: hidden; }
    .ss-head { display: flex; align-items: center; justify-content: center; position: relative; padding: 12px;
               font-weight: 600; border-bottom: 1px solid var(--border); }
    .ss-head button { position: absolute; right: 8px; background: none; border: none; color: var(--text); }
    .ss-list { overflow-y: auto; flex: 1; padding: 6px 0; }
    .ss-empty { padding: 24px; text-align: center; color: var(--text-muted); }
    .ss-item { display: flex; align-items: center; gap: 12px; width: 100%; padding: 8px 16px; background: none;
               border: none; color: var(--text); text-align: left; }
    .ss-item:hover { background: var(--bg3); }
    .ss-av { width: 40px; height: 40px; border-radius: 50%; background: var(--bg3); overflow: hidden; display: flex;
             align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0; }
    .ss-av img { width: 100%; height: 100%; object-fit: cover; }
    .ss-name { flex: 1; font-weight: 500; }
    .ss-send { font-size: 13px; font-weight: 600; color: #4f8ff7; }
    .ss-item:disabled .ss-send { color: var(--text-muted); }
    .ss-copy { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 14px; border: none;
               border-top: 1px solid var(--border); background: none; color: var(--text); font-weight: 600; }
    @media (max-width: 600px) {
      .ss-overlay { align-items: flex-end; }
      .ss-sheet { width: 100%; border-radius: 16px 16px 0 0; }
    }
  `]
})
export class ShareSheetComponent implements OnInit {
  @Input({ required: true }) post!: Post;
  @Output() closed = new EventEmitter<void>();

  conversations: any[] = [];
  loading = true;
  sent = new Set<string>();
  initials = initials;

  constructor(private api: ApiService, private toast: ToastService) {}

  ngOnInit(): void {
    this.api.getConversations().subscribe({
      next: c => { this.conversations = c; this.loading = false; },
      error: () => { this.loading = false; }
    });
  }

  send(conv: any): void {
    const text = `Post by @${this.post.author?.username}: ${postLink(this.post)}`;
    this.api.sendMessage(conv.other.username, text).subscribe({
      next: () => { this.sent.add(conv.id); },
      error: () => this.toast.error('Could not send')
    });
  }

  copy(): void { copyPostLink(this.post, this.toast); }
}
