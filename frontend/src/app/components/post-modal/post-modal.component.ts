import {
  Component, Input, Output, EventEmitter,
  OnInit, HostListener, ElementRef, ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-post-modal',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './post-modal.component.html',
  styleUrls: ['./post-modal.component.css']
})
export class PostModalComponent implements OnInit {
  @Input() postId!: string;
  @Input() initialPost: any = null;
  @Output() closed = new EventEmitter<void>();
  @ViewChild('commentInput') commentInputRef!: ElementRef<HTMLInputElement>;

  post: any = null;
  comments: any[] = [];
  loading = true;
  commentText = '';
  submitting = false;

  constructor(private api: ApiService, public auth: AuthService) {}

  ngOnInit(): void {
    if (this.initialPost) {
      this.post = { ...this.initialPost };
      this.loading = false;
      this.loadComments();
    } else {
      this.api.getPost(this.postId).subscribe({
        next: p => { this.post = p; this.loading = false; this.loadComments(); },
        error: () => { this.loading = false; }
      });
    }
  }

  loadComments(): void {
    this.api.getComments(this.post.id).subscribe({
      next: c => { this.comments = c; },
      error: () => {}
    });
  }

  like(): void {
    this.api.likePost(this.post.id).subscribe({
      next: r => { this.post.likes = r.likes; this.post.liked = r.liked; }
    });
  }

  addComment(): void {
    const content = this.commentText.trim();
    if (!content || this.submitting) return;
    this.submitting = true;
    this.api.createComment(this.post.id, content).subscribe({
      next: () => {
        this.commentText = '';
        this.submitting = false;
        this.loadComments();
      },
      error: () => { this.submitting = false; }
    });
  }

  deleteComment(id: string): void {
    this.api.deleteComment(id).subscribe(() => {
      this.comments = this.comments.filter(c => c.id !== id);
    });
  }

  @HostListener('document:keydown.escape')
  close(): void { this.closed.emit(); }

  isVideo(url: string): boolean {
    return url ? /\.(mp4|webm|mov)$/i.test(url) : false;
  }

  isMe(): boolean {
    return this.auth.currentUser()?.username === this.post?.author?.username;
  }

  iLiked(): boolean {
    const me = this.auth.currentUser()?.username;
    if (!me || !this.post?.likes) return false;
    return Array.isArray(this.post.likes)
      ? this.post.likes.includes(me)
      : false;
  }

  likeCount(): number {
    if (!this.post?.likes) return 0;
    return Array.isArray(this.post.likes) ? this.post.likes.length : 0;
  }

  timeAgo(dateStr: string): string {
    if (!dateStr) return '';
    const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  initials(u: any): string {
    return (u?.displayName || u?.username || '?').charAt(0).toUpperCase();
  }

  focusComment(): void {
    setTimeout(() => this.commentInputRef?.nativeElement?.focus(), 50);
  }
}
