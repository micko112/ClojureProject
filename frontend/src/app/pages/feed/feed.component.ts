import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { StoriesBarComponent } from '../../components/stories-bar/stories-bar.component';
import { StoryViewerComponent } from '../../components/story-viewer/story-viewer.component';
import { PostModalComponent } from '../../components/post-modal/post-modal.component';

@Component({
  selector: 'app-feed',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, StoriesBarComponent, StoryViewerComponent, PostModalComponent],
  templateUrl: './feed.component.html',
  styleUrls: ['./feed.component.css']
})
export class FeedComponent implements OnInit {
  viewerGroups: any[] | null = null;
  viewerStartIndex = 0;

  openStoryViewer(e: { groups: any[]; index: number }): void {
    this.viewerGroups = e.groups;
    this.viewerStartIndex = e.index;
  }

  closeStoryViewer(): void { this.viewerGroups = null; }

  activePost: any = null;
  openPost(post: any): void { this.activePost = post; }
  closePost(): void { this.activePost = null; }
  posts: any[] = [];
  loading = true;
  trending: any[] = [];
  expandedComments: Set<string> = new Set();
  comments: Record<string, any[]> = {};
  newComment: Record<string, string> = {};

  constructor(private api: ApiService, public auth: AuthService) {}

  ngOnInit(): void {
    this.loadFeed();
    this.loadTrending();
  }

  loadFeed(): void {
    this.api.getFeed().subscribe({
      next: p => { this.posts = p; this.loading = false; },
      error: () => { this.loading = false; }
    });
  }

  loadTrending(): void {
    this.api.getTrending().subscribe({
      next: t => { this.trending = t; },
      error: () => {}
    });
  }

  like(post: any): void {
    this.api.likePost(post.id).subscribe({
      next: r => { post.likes = r.likes; post.liked = r.liked; },
      error: () => {}
    });
  }

  toggleComments(post: any): void {
    const id = post.id;
    if (this.expandedComments.has(id)) {
      this.expandedComments.delete(id);
    } else {
      this.expandedComments.add(id);
      if (!this.comments[id]) this.loadComments(id);
    }
  }

  loadComments(postId: string): void {
    this.api.getComments(postId).subscribe({
      next: c => { this.comments[postId] = c; },
      error: () => {}
    });
  }

  addComment(post: any): void {
    const content = (this.newComment[post.id] || '').trim();
    if (!content) return;
    this.api.createComment(post.id, content).subscribe({
      next: () => {
        this.newComment[post.id] = '';
        this.loadComments(post.id);
      },
      error: () => {}
    });
  }

  deleteComment(postId: string, commentId: string): void {
    this.api.deleteComment(commentId).subscribe(() => this.loadComments(postId));
  }

  isExpanded(postId: string): boolean {
    return this.expandedComments.has(postId);
  }

  isVideo(url: string): boolean {
    return url ? /\.(mp4|webm|mov)$/i.test(url) : false;
  }

  timeAgo(dateStr: string): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) +
           ' · ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  me(): string { return this.auth.currentUser()?.username || ''; }

  initials(user: any): string {
    return (user?.displayName || user?.username || '?').charAt(0).toUpperCase();
  }
}
