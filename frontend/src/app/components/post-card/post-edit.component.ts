import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PostService } from '../../services/post.service';
import { ToastService } from '../../services/toast.service';
import { Post, PostAudience } from '../../models/post.model';

/** Owner-only edit dialog: caption, audience, hide likes, comments off. */
@Component({
  selector: 'app-post-edit',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="pe-overlay" (click)="closed.emit()">
      <form class="pe-box" (click)="$event.stopPropagation()" (ngSubmit)="save()">
        <div class="pe-head">
          <button type="button" class="pe-link" (click)="closed.emit()">Cancel</button>
          <span>Edit info</span>
          <button type="submit" class="pe-link pe-done" [disabled]="saving">{{ saving ? 'Saving…' : 'Done' }}</button>
        </div>
        <textarea name="caption" [(ngModel)]="caption" rows="5" maxlength="2200" placeholder="Write a caption…"></textarea>
        <label class="pe-row">
          <span>Audience</span>
          <select name="audience" [(ngModel)]="audience">
            <option value="public">Everyone</option>
            <option value="followers">Followers</option>
            <option value="close-friends">Close friends</option>
          </select>
        </label>
        <label class="pe-row"><span>Hide like count</span><input type="checkbox" name="hideLikes" [(ngModel)]="hideLikes" /></label>
        <label class="pe-row"><span>Turn off commenting</span><input type="checkbox" name="commentsOff" [(ngModel)]="commentsOff" /></label>
      </form>
    </div>
  `,
  styles: [`
    .pe-overlay { position: fixed; inset: 0; background: var(--overlay); z-index: 6000; display: flex;
                  align-items: center; justify-content: center; }
    .pe-box { background: var(--modal-bg); border-radius: 12px;
              width: min(480px, calc(100vw - 24px)); display: flex; flex-direction: column; overflow: hidden; }
    .pe-head { display: flex; align-items: center; justify-content: space-between; padding: 0 16px; min-height: 44px;
               border-bottom: 1px solid var(--modal-sep); font-weight: 600; font-size: 16px; }
    .pe-link { background: none; border: none; color: var(--text); font-size: 14px; }
    .pe-done { color: var(--link); font-weight: 600; }
    textarea { background: transparent; color: var(--text); border: none; border-bottom: 1px solid var(--modal-sep);
               padding: 14px 16px; font-size: 14px; resize: vertical; outline: none; font-family: inherit; }
    .pe-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px;
              border-bottom: 1px solid var(--modal-sep); font-size: 14px; }
    .pe-row:last-child { border-bottom: none; }
    select { background: var(--input-bg); color: var(--text); border: 1px solid var(--input-border); border-radius: 8px; padding: 6px 8px; font: inherit; }
    input[type=checkbox] { width: 18px; height: 18px; accent-color: var(--brand-solid); }
  `]
})
export class PostEditComponent implements OnInit {
  @Input({ required: true }) post!: Post;
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<Post>();

  caption = '';
  audience: PostAudience = 'public';
  hideLikes = false;
  commentsOff = false;
  saving = false;

  constructor(private posts: PostService, private toast: ToastService) {}

  ngOnInit(): void {
    this.caption = this.post.caption || '';
    this.audience = this.post.audience || 'public';
    this.hideLikes = !!this.post.hideLikes;
    this.commentsOff = !!this.post.commentsOff;
  }

  save(): void {
    if (this.saving) return;
    this.saving = true;
    this.posts.update(this.post.id, {
      caption: this.caption, audience: this.audience, hideLikes: this.hideLikes, commentsOff: this.commentsOff
    }).subscribe({
      next: p => { this.saving = false; this.saved.emit(p); this.closed.emit(); },
      error: () => { this.saving = false; this.toast.error('Could not save changes'); }
    });
  }
}
