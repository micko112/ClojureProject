import { Component, ElementRef, EventEmitter, HostListener, Input, OnInit, Output, ViewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MediaCarouselComponent } from '../media-carousel/media-carousel.component';
import { CaptionComponent } from '../caption/caption.component';
import { PostActionsComponent, likePost } from '../post-card/post-actions.component';
import { ShareSheetComponent, copyPostLink } from '../post-card/share-sheet.component';
import { PostEditComponent } from '../post-card/post-edit.component';
import { PostService } from '../../services/post.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { Post, PostComment } from '../../models/post.model';
import { Media } from '../../models/media.model';
import { aspectOf, initials, postMedia, timeAgo, timeAgoLong } from '../post-card/post-utils';

/**
 * Full post with threaded comments. Instagram desktop layout (media left,
 * comments right); stacked on phones. Used by the post modal and /post/:id.
 */
@Component({
  selector: 'app-post-view',
  standalone: true,
  imports: [NgTemplateOutlet, FormsModule, RouterModule, MediaCarouselComponent, CaptionComponent, PostActionsComponent,
            ShareSheetComponent, PostEditComponent],
  templateUrl: './post-view.component.html',
  styleUrls: ['./post-view.component.css']
})
export class PostViewComponent implements OnInit {
  @Input({ required: true }) post!: Post;
  @Input() inModal = false;
  /** A link inside was followed (modal should close). */
  @Output() navigate = new EventEmitter<void>();
  @Output() removed = new EventEmitter<Post>();
  @ViewChild('input') input?: ElementRef<HTMLInputElement>;

  comments: PostComment[] = [];
  nextCursor: string | null = null;
  loadingComments = true;
  loadingMore = false;
  expanded = new Set<string>();
  replyTo: PostComment | null = null;
  text = '';
  sending = false;
  menuOpen = false;
  shareOpen = false;
  editOpen = false;
  burst = false;
  private lastTap = 0;

  initials = initials;
  timeAgo = timeAgo;
  timeAgoLong = timeAgoLong;

  constructor(private posts: PostService, private auth: AuthService, private toast: ToastService) {}

  ngOnInit(): void { this.loadComments(); }

  get media(): Media[] { return postMedia(this.post); }
  get aspect(): number { return this.media.length ? aspectOf(this.media[0]) : 1; }
  get isOwner(): boolean { return this.auth.currentUser()?.username === this.post.author?.username; }
  get name(): string { return this.post.author?.username || ''; }

  loadComments(): void {
    this.loadingComments = true;
    this.posts.comments(this.post.id).subscribe({
      next: p => { this.comments = p.items; this.nextCursor = p.nextCursor || null; this.loadingComments = false; },
      error: () => { this.loadingComments = false; }
    });
  }

  loadMore(): void {
    if (!this.nextCursor || this.loadingMore) return;
    this.loadingMore = true;
    this.posts.comments(this.post.id, this.nextCursor).subscribe({
      next: p => {
        this.comments = [...this.comments, ...p.items];
        this.nextCursor = p.nextCursor || null;
        this.loadingMore = false;
      },
      error: () => { this.loadingMore = false; }
    });
  }

  onTap(): void {
    const now = Date.now();
    if (now - this.lastTap < 320) {
      this.lastTap = 0;
      likePost(this.posts, this.post, true);
      this.burst = false;
      setTimeout(() => { this.burst = true; setTimeout(() => this.burst = false, 900); });
    } else {
      this.lastTap = now;
    }
  }

  focusInput(): void { setTimeout(() => this.input?.nativeElement.focus(), 30); }

  reply(c: PostComment, parent?: PostComment): void {
    this.replyTo = parent || c;
    this.text = `@${c.author.username} `;
    this.focusInput();
  }

  cancelReply(): void { this.replyTo = null; this.text = ''; }

  toggleReplies(c: PostComment): void {
    if (this.expanded.has(c.id)) this.expanded.delete(c.id); else this.expanded.add(c.id);
  }

  send(): void {
    const content = this.text.trim();
    if (!content || this.sending) return;
    this.sending = true;
    const parent = this.replyTo;
    this.posts.addComment(this.post.id, content, parent?.id).subscribe({
      next: c => {
        if (parent) {
          parent.replies = [...(parent.replies || []), c];
          parent.replyCount = (parent.replyCount || 0) + 1;
          this.expanded.add(parent.id);
        } else {
          this.comments = [...this.comments, { ...c, replies: [], replyCount: 0 }];
        }
        this.post.commentCount = (this.post.commentCount || 0) + 1;
        this.text = '';
        this.replyTo = null;
        this.sending = false;
      },
      error: err => {
        this.sending = false;
        this.toast.error(err?.error?.error || 'Could not post comment');
      }
    });
  }

  likeComment(c: PostComment): void {
    const was = c.liked;
    c.liked = !was;
    c.likeCount += was ? -1 : 1;
    this.posts.likeComment(c.id).subscribe({
      next: r => { c.liked = r.liked; c.likeCount = r.likeCount; },
      error: () => { c.liked = was; c.likeCount += was ? 1 : -1; }
    });
  }

  deleteComment(c: PostComment, parent?: PostComment): void {
    if (!confirm('Delete this comment?')) return;
    this.posts.deleteComment(c.id).subscribe({
      next: () => {
        if (parent) {
          parent.replies = (parent.replies || []).filter(r => r.id !== c.id);
          parent.replyCount = Math.max(0, (parent.replyCount || 1) - 1);
          this.post.commentCount = Math.max(0, (this.post.commentCount || 1) - 1);
        } else {
          this.comments = this.comments.filter(x => x.id !== c.id);
          this.post.commentCount = Math.max(0, (this.post.commentCount || 0) - 1 - (c.replies?.length || 0));
        }
      },
      error: () => this.toast.error('Could not delete comment')
    });
  }

  @HostListener('document:click')
  closeMenu(): void { this.menuOpen = false; }
  toggleMenu(e: Event): void { e.stopPropagation(); this.menuOpen = !this.menuOpen; }
  copyLink(): void { this.menuOpen = false; copyPostLink(this.post, this.toast); }
  onEdited(p: Post): void { Object.assign(this.post, p); }

  archive(): void {
    this.menuOpen = false;
    this.posts.toggleArchive(this.post.id).subscribe({
      next: r => {
        this.post.archived = r.archived;
        this.toast.success(r.archived ? 'Post archived — only you can see it now' : 'Post is visible again');
        if (r.archived) this.removed.emit(this.post);
      },
      error: () => this.toast.error('Could not archive post')
    });
  }

  remove(): void {
    this.menuOpen = false;
    if (!confirm('Delete this post? This cannot be undone.')) return;
    this.posts.remove(this.post.id).subscribe({
      next: () => { this.toast.success('Post deleted'); this.removed.emit(this.post); },
      error: () => this.toast.error('Could not delete post')
    });
  }
}
