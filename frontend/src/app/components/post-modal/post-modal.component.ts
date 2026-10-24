import { Component, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { PostViewComponent } from '../post-view/post-view.component';
import { PostService } from '../../services/post.service';
import { Post } from '../../models/post.model';

/**
 * Instagram-style post overlay: media left, comments right on desktop,
 * stacked on phones. Pass `initialPost` to render instantly (the same object
 * is mutated, so likes/saves stay in sync with the list that opened it).
 */
@Component({
  selector: 'app-post-modal',
  standalone: true,
  imports: [PostViewComponent],
  templateUrl: './post-modal.component.html',
  styleUrls: ['./post-modal.component.css']
})
export class PostModalComponent implements OnInit, OnDestroy {
  @Input() postId!: string;
  @Input() initialPost: Post | null = null;
  @Output() closed = new EventEmitter<void>();
  /** Deleted or archived from inside the modal. */
  @Output() removed = new EventEmitter<Post>();

  post: Post | null = null;
  loading = true;
  failed = false;

  constructor(private posts: PostService) {}

  ngOnInit(): void {
    document.body.style.overflow = 'hidden';
    if (this.initialPost) {
      this.post = this.initialPost;
      this.loading = false;
      return;
    }
    this.posts.get(this.postId).subscribe({
      next: p => { this.post = p; this.loading = false; },
      error: () => { this.loading = false; this.failed = true; }
    });
  }

  ngOnDestroy(): void { document.body.style.overflow = ''; }

  @HostListener('document:keydown.escape')
  close(): void { this.closed.emit(); }

  onRemoved(p: Post): void { this.removed.emit(p); this.close(); }
}
