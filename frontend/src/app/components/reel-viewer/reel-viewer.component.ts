import {
  Component, Input, Output, EventEmitter,
  OnInit, OnDestroy, HostListener, ElementRef, ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-reel-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './reel-viewer.component.html',
  styleUrls: ['./reel-viewer.component.css']
})
export class ReelViewerComponent implements OnInit, OnDestroy {
  @Input() posts: any[] = [];
  @Input() startIndex = 0;
  @Output() closed = new EventEmitter<void>();
  @Output() postSaved = new EventEmitter<{ id: string; saved: boolean }>();

  @ViewChild('commentsArea') commentsArea!: ElementRef;

  currentIndex = 0;
  comments: any[] = [];
  commentsLoading = false;
  newComment = '';
  submitting = false;
  showCommentsMobile = false;

  showShareModal = false;
  conversations: any[] = [];
  sharedTo: string | null = null;

  private touchStartX = 0;
  private touchStartY = 0;

  constructor(private api: ApiService, public auth: AuthService) {}

  ngOnInit(): void {
    this.currentIndex = this.startIndex;
    this.loadComments();
    this.api.getConversations().subscribe({ next: c => { this.conversations = c; }, error: () => {} });
    document.body.style.overflow = 'hidden';
  }

  ngOnDestroy(): void {
    document.body.style.overflow = '';
  }

  get post(): any { return this.posts[this.currentIndex]; }
  get hasPrev(): boolean { return this.currentIndex > 0; }
  get hasNext(): boolean { return this.currentIndex < this.posts.length - 1; }

  prev(): void {
    if (this.hasPrev) { this.currentIndex--; this.loadComments(); this.showCommentsMobile = false; }
  }

  next(): void {
    if (this.hasNext) { this.currentIndex++; this.loadComments(); this.showCommentsMobile = false; }
  }

  @HostListener('window:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') this.close();
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') this.prev();
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') this.next();
  }

  @HostListener('wheel', ['$event'])
  onWheel(e: WheelEvent): void {
    if (e.deltaY > 30) this.next();
    else if (e.deltaY < -30) this.prev();
  }

  onTouchStart(e: TouchEvent): void {
    this.touchStartX = e.touches[0].clientX;
    this.touchStartY = e.touches[0].clientY;
  }

  onTouchEnd(e: TouchEvent): void {
    const dx = e.changedTouches[0].clientX - this.touchStartX;
    const dy = e.changedTouches[0].clientY - this.touchStartY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
      if (dx < 0) this.next();
      else this.prev();
    } else if (Math.abs(dy) > 50 && Math.abs(dy) > Math.abs(dx)) {
      if (dy < 0) this.next();
      else this.prev();
    }
  }

  loadComments(): void {
    if (!this.post) return;
    this.comments = [];
    this.commentsLoading = true;
    this.api.getComments(this.post.id).subscribe({
      next: c => { this.comments = c; this.commentsLoading = false; },
      error: () => { this.commentsLoading = false; }
    });
  }

  like(): void {
    if (!this.post) return;
    this.api.likePost(this.post.id).subscribe({
      next: r => { this.post.likes = r.likes; this.post.liked = r.liked; }
    });
  }

  toggleSave(): void {
    if (!this.post) return;
    const wasSaved = this.post.saved;
    this.post.saved = !wasSaved;
    const call = wasSaved ? this.api.unsavePost(this.post.id) : this.api.savePost(this.post.id);
    call.subscribe({
      next: () => { this.postSaved.emit({ id: this.post.id, saved: this.post.saved }); },
      error: () => { this.post.saved = wasSaved; }
    });
  }

  sharePost(): void {
    this.sharedTo = null;
    this.showShareModal = true;
  }

  sendPostToConv(conv: any): void {
    if (!this.post) return;
    const text = `📤 Post by @${this.post.author?.username}: "${this.post.caption || ''}" — /post/${this.post.id}`;
    this.api.sendMessage(conv.other.username, text).subscribe({
      next: () => { this.sharedTo = conv.id; },
      error: () => {}
    });
  }

  addComment(): void {
    const content = this.newComment.trim();
    if (!content || this.submitting) return;
    this.submitting = true;
    this.api.createComment(this.post.id, content).subscribe({
      next: () => {
        this.newComment = '';
        this.submitting = false;
        this.post.commentCount = (this.post.commentCount || 0) + 1;
        this.loadComments();
      },
      error: () => { this.submitting = false; }
    });
  }

  deleteComment(commentId: string): void {
    this.api.deleteComment(commentId).subscribe(() => this.loadComments());
  }

  close(): void { this.closed.emit(); }

  isVideo(url: string): boolean {
    return url ? /\.(mp4|webm|mov)$/i.test(url) : false;
  }

  timeAgo(dateStr: string): string {
    if (!dateStr) return '';
    const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  initials(user: any): string {
    return (user?.displayName || user?.username || '?').charAt(0).toUpperCase();
  }

  me(): string { return this.auth.currentUser()?.username || ''; }
}
