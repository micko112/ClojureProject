import { Component, EventEmitter, Input, OnDestroy, Output } from '@angular/core';
import { PostService } from '../../services/post.service';
import { Post, REACTION_EMOJIS } from '../../models/post.model';
import { compact, likeCountOf } from './post-utils';

/** Optimistic like toggle (or force-like for double tap). */
export function likePost(svc: PostService, post: Post, onlyLike = false): void {
  if (onlyLike && post.liked) return;
  const was = !!post.liked;
  const before = likeCountOf(post);
  post.liked = !was;
  if (post.likeCount != null) post.likeCount = before + (was ? -1 : 1);
  svc.like(post.id).subscribe({
    next: r => {
      post.liked = r.liked;
      post.likes = r.likes;
      if (post.likeCount != null) post.likeCount = r.likeCount;
    },
    error: () => { post.liked = was; if (post.likeCount != null) post.likeCount = before; }
  });
}

export function savePost(svc: PostService, post: Post): void {
  const was = !!post.saved;
  post.saved = !was;
  svc.save(post.id, !was).subscribe({ error: () => { post.saved = was; } });
}

/**
 * Like / reactions / comment / share / save row, reaction chips and the like
 * count line. Long-press (touch) or hover (desktop) the heart for supportive
 * reactions.
 */
@Component({
  selector: 'app-post-actions',
  standalone: true,
  template: `
    <div class="pa-row">
      <div class="pa-like-wrap" (mouseenter)="hoverIn()" (mouseleave)="hoverOut()">
        @if (pickerOpen) {
          <div class="pa-picker" role="menu" aria-label="Reactions">
            @for (e of emojis; track e) {
              <button type="button" class="pa-emoji" [class.mine]="post.myReaction === e" (click)="react(e)" [attr.aria-label]="'React ' + e">{{ e }}</button>
            }
          </div>
        }
        <button type="button" class="pa-btn" [class.liked]="post.liked" [attr.aria-label]="post.liked ? 'Unlike' : 'Like'"
                (pointerdown)="pressStart($event)" (pointerup)="pressEnd()" (pointerleave)="pressEnd()"
                (contextmenu)="$event.preventDefault()" (click)="likeClick()">
          <svg class="pa-ico" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M16.8 3.5c-2 0-3.6 1.1-4.8 2.8-1.2-1.7-2.8-2.8-4.8-2.8A5.3 5.3 0 0 0 2 9c0 3.2 2.5 5.8 5.3 8.3 1.4 1.2 2.9 2.4 4.2 3.5a.8.8 0 0 0 1 0c1.3-1.1 2.8-2.3 4.2-3.5C19.5 14.8 22 12.2 22 9a5.3 5.3 0 0 0-5.2-5.5Z"
                  [attr.fill]="post.liked ? 'currentColor' : 'none'"/>
          </svg>
        </button>
      </div>
      @if (!post.commentsOff) {
        <button type="button" class="pa-btn" aria-label="Comment" (click)="comment.emit()">
          <svg class="pa-ico" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20.7 16.6A9.5 9.5 0 1 0 17 20.3L21.5 21.5Z"/>
          </svg>
        </button>
      }
      <button type="button" class="pa-btn" aria-label="Share" (click)="share.emit()">
        <svg class="pa-ico" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M21.5 2.5 10.6 13.4M21.5 2.5 14.6 21.2l-4-7.8-7.9-4.2Z"/>
        </svg>
      </button>
      @if (post.myReaction) {
        <span class="pa-mine" title="Your reaction">{{ post.myReaction }}</span>
      }
      <span class="pa-spacer"></span>
      <button type="button" class="pa-btn" [attr.aria-label]="post.saved ? 'Remove from saved' : 'Save'" (click)="save()">
        <svg class="pa-ico" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M19.5 21.5 12 14.6l-7.5 6.9V3.5a1 1 0 0 1 1-1h13a1 1 0 0 1 1 1Z" [attr.fill]="post.saved ? 'currentColor' : 'none'"/>
        </svg>
      </button>
    </div>
    @if (reactionList.length) {
      <div class="pa-chips">
        @for (r of reactionList; track r.emoji) {
          <button type="button" class="pa-chip" [class.mine]="post.myReaction === r.emoji" (click)="react(r.emoji)">{{ r.emoji }} {{ r.count }}</button>
        }
      </div>
    }
    @if (showLikes) {
      <div class="pa-likes">
        @if (likes > 0) { <strong>{{ compact(likes) }} {{ likes === 1 ? 'like' : 'likes' }}</strong> }
        @else if (!reactionList.length) { <span class="pa-first">Be the first to cheer this on</span> }
        @if (post.hideLikes) { <span class="pa-hidden">· only you can see this</span> }
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .pa-row { display: flex; align-items: center; height: 46px; margin-left: -8px; margin-right: -8px; }
    .pa-btn { background: none; border: none; color: var(--text); padding: 8px; display: flex; align-items: center;
              touch-action: manipulation; -webkit-touch-callout: none; user-select: none; }
    .pa-ico { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linejoin: round;
              stroke-linecap: round; transition: transform .12s; display: block; }
    .pa-btn:hover { color: var(--text-muted); }
    .pa-btn:active .pa-ico { transform: scale(.85); }
    .pa-btn.liked, .pa-btn.liked:hover { color: var(--like); }
    .pa-btn.liked .pa-ico { animation: pop .35s ease; }
    .pa-spacer { flex: 1; }
    .pa-mine { font-size: 16px; margin-left: 6px; }
    .pa-like-wrap { position: relative; }
    .pa-picker { position: absolute; bottom: 100%; left: 0; display: flex; gap: 2px; padding: 6px 8px;
                 background: var(--modal-bg); border-radius: 28px; z-index: 20;
                 box-shadow: var(--shadow-lg); animation: rise .18s ease; }
    .pa-emoji { background: none; border: none; font-size: 26px; padding: 2px 4px; border-radius: 50%;
                transition: transform .12s; line-height: 1.1; }
    .pa-emoji:hover { transform: scale(1.3) translateY(-3px); }
    .pa-emoji.mine { background: var(--surface2); }
    .pa-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 8px; }
    .pa-chip { background: none; border: 1px solid var(--border-mid); color: var(--text); border-radius: 999px;
               padding: 2px 8px; font-size: 12px; line-height: 18px; }
    .pa-chip:hover { background: var(--hover-bg); }
    .pa-chip.mine { border-color: var(--text-muted); font-weight: 600; }
    .pa-likes { font-size: 14px; line-height: 18px; margin-bottom: 8px; }
    .pa-likes strong { font-weight: 600; }
    .pa-first { color: var(--text-muted); }
    .pa-hidden { color: var(--text-muted); font-size: 12px; }
    @keyframes pop { 0% { transform: scale(1); } 40% { transform: scale(1.25); } 100% { transform: scale(1); } }
    @keyframes rise { from { opacity: 0; transform: translateY(6px) scale(.95); } to { opacity: 1; transform: none; } }
  `]
})
export class PostActionsComponent implements OnDestroy {
  @Input({ required: true }) post!: Post;
  @Input() isOwner = false;
  @Output() comment = new EventEmitter<void>();
  @Output() share = new EventEmitter<void>();

  emojis = REACTION_EMOJIS;
  pickerOpen = false;
  compact = compact;
  private pressTimer: any;
  private hoverTimer: any;
  private longPressed = false;

  constructor(private posts: PostService) {}

  ngOnDestroy(): void { clearTimeout(this.pressTimer); clearTimeout(this.hoverTimer); }

  get showLikes(): boolean { return !this.post.hideLikes || this.isOwner; }
  get likes(): number { return likeCountOf(this.post); }
  get reactionList(): { emoji: string; count: number }[] {
    const r = this.post.reactions || {};
    return Object.keys(r).filter(k => r[k] > 0).map(k => ({ emoji: k, count: r[k] }))
      .sort((a, b) => b.count - a.count);
  }

  pressStart(e: PointerEvent): void {
    this.longPressed = false;
    if (e.pointerType === 'mouse') return;
    clearTimeout(this.pressTimer);
    this.pressTimer = setTimeout(() => { this.longPressed = true; this.pickerOpen = true; }, 450);
  }
  pressEnd(): void { clearTimeout(this.pressTimer); }

  hoverIn(): void {
    clearTimeout(this.hoverTimer);
    if (!matchMedia('(hover: hover)').matches) return;
    this.hoverTimer = setTimeout(() => { this.pickerOpen = true; }, 550);
  }
  hoverOut(): void {
    clearTimeout(this.hoverTimer);
    this.hoverTimer = setTimeout(() => { this.pickerOpen = false; }, 250);
  }

  likeClick(): void {
    if (this.longPressed) { this.longPressed = false; return; }
    this.pickerOpen = false;
    likePost(this.posts, this.post);
  }

  save(): void { savePost(this.posts, this.post); }

  react(emoji: string): void {
    this.pickerOpen = false;
    const prev = { reactions: { ...(this.post.reactions || {}) }, myReaction: this.post.myReaction };
    const r = { ...(this.post.reactions || {}) };
    if (prev.myReaction) r[prev.myReaction] = Math.max(0, (r[prev.myReaction] || 1) - 1);
    const removing = prev.myReaction === emoji;
    if (!removing) r[emoji] = (r[emoji] || 0) + 1;
    this.post.reactions = r;
    this.post.myReaction = removing ? null : emoji;
    this.posts.react(this.post.id, emoji).subscribe({
      next: res => { this.post.reactions = res.reactions; this.post.myReaction = res.myReaction; },
      error: () => { this.post.reactions = prev.reactions; this.post.myReaction = prev.myReaction; }
    });
  }
}
