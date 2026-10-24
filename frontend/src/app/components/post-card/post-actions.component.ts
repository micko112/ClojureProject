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
        <button type="button" class="pa-btn" [class.liked]="post.liked" aria-label="Like"
                (pointerdown)="pressStart($event)" (pointerup)="pressEnd()" (pointerleave)="pressEnd()"
                (contextmenu)="$event.preventDefault()" (click)="likeClick()">
          <span class="material-icons">{{ post.liked ? 'favorite' : 'favorite_border' }}</span>
        </button>
      </div>
      @if (!post.commentsOff) {
        <button type="button" class="pa-btn" aria-label="Comment" (click)="comment.emit()">
          <span class="material-icons flip">chat_bubble_outline</span>
        </button>
      }
      <button type="button" class="pa-btn" aria-label="Share" (click)="share.emit()">
        <span class="material-icons send">send</span>
      </button>
      @if (post.myReaction) {
        <span class="pa-mine" title="Your reaction">{{ post.myReaction }}</span>
      }
      <span class="pa-spacer"></span>
      <button type="button" class="pa-btn" [attr.aria-label]="post.saved ? 'Remove from saved' : 'Save'" (click)="save()">
        <span class="material-icons">{{ post.saved ? 'bookmark' : 'bookmark_border' }}</span>
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
        @else { <span class="pa-first">Be the first to cheer this on</span> }
        @if (post.hideLikes) { <span class="pa-hidden">· only you can see this</span> }
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .pa-row { display: flex; align-items: center; gap: 2px; margin-left: -8px; }
    .pa-btn { background: none; border: none; color: var(--text); padding: 8px; border-radius: 50%;
              display: flex; align-items: center; touch-action: manipulation; -webkit-touch-callout: none; user-select: none; }
    .pa-btn .material-icons { font-size: 26px; transition: transform .12s; }
    .pa-btn:hover .material-icons { opacity: .6; }
    .pa-btn:active .material-icons { transform: scale(.85); }
    .pa-btn.liked { color: #ff3040; }
    .pa-btn.liked .material-icons { animation: pop .35s ease; }
    .pa-btn .flip { transform: scaleX(-1); }
    .pa-btn .send { transform: rotate(-20deg) translateY(-2px); font-size: 24px; }
    .pa-spacer { flex: 1; }
    .pa-mine { font-size: 18px; margin-left: 4px; }
    .pa-like-wrap { position: relative; }
    .pa-picker { position: absolute; bottom: 100%; left: 0; display: flex; gap: 2px; padding: 6px 8px;
                 background: var(--bg2); border: 1px solid var(--border); border-radius: 28px; z-index: 20;
                 box-shadow: 0 6px 24px rgba(0,0,0,.35); animation: rise .18s ease; }
    .pa-emoji { background: none; border: none; font-size: 26px; padding: 2px 4px; border-radius: 50%;
                transition: transform .12s; line-height: 1.1; }
    .pa-emoji:hover { transform: scale(1.3) translateY(-3px); }
    .pa-emoji.mine { background: var(--bg3); }
    .pa-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 2px 0 6px; }
    .pa-chip { background: var(--bg3); border: 1px solid var(--border); color: var(--text); border-radius: 14px;
               padding: 2px 9px; font-size: 13px; }
    .pa-chip.mine { border-color: #4f8ff7; background: rgba(79,143,247,.12); }
    .pa-likes { font-size: 14px; margin-bottom: 4px; }
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
