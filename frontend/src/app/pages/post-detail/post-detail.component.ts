import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { Post } from '../../models/post.model';

@Component({
  selector: 'app-post-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './post-detail.component.html',
  styleUrls: ['./post-detail.component.css']
})
export class PostDetailComponent implements OnInit {
  post: Post | null = null;
  comments: any[] = [];
  loading = true;
  commentInput = '';
  commentSubmitting = false;

  constructor(
    private route: ActivatedRoute,
    private api: ApiService,
    public auth: AuthService
  ) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id') || '';
    this.api.getPost(id).subscribe({
      next: p => {
        this.post = p;
        this.loading = false;
        this.loadComments(id);
      },
      error: () => { this.loading = false; }
    });
  }

  loadComments(id: string): void {
    this.api.getComments(id).subscribe({
      next: c => this.comments = c,
      error: () => {}
    });
  }

  toggleLike(): void {
    if (!this.post) return;
    const me = this.auth.currentUser()?.username;
    if (!me) return;
    this.api.togglePostLike(this.post.id).subscribe({
      next: res => {
        if (!this.post) return;
        if (res.action === 'added') this.post.likes = [...this.post.likes, me];
        else this.post.likes = this.post.likes.filter(u => u !== me);
      }
    });
  }

  iLiked(): boolean {
    const me = this.auth.currentUser()?.username;
    return !!me && !!this.post && this.post.likes.includes(me);
  }

  addComment(): void {
    const content = this.commentInput.trim();
    if (!content || this.commentSubmitting || !this.post) return;
    this.commentSubmitting = true;
    this.api.addComment(this.post.id, content).subscribe({
      next: () => {
        this.commentInput = '';
        this.commentSubmitting = false;
        this.loadComments(String(this.post!.id));
      },
      error: () => { this.commentSubmitting = false; }
    });
  }

  deleteComment(commentId: string): void {
    if (!this.post) return;
    this.api.deleteComment(commentId).subscribe({
      next: () => { this.comments = this.comments.filter(c => c.id !== commentId); },
      error: () => {}
    });
  }

  avatarColor(username: string): string {
    const colors = ['#1a1a1a','#222222','#2a2a2a','#1f1f1f','#252525','#181818','#202020','#1c1c1c'];
    let hash = 0;
    for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }

  timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return days === 1 ? 'yesterday' : `${days}d ago`;
  }

  isMedia(url: string): boolean { return !!url; }
  isVideo(url: string): boolean { return /\.(mp4|webm|mov)$/i.test(url); }
}
