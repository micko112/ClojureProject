import { Component, EventEmitter, HostListener, Input, OnDestroy, Output } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { MediaCarouselComponent } from '../media-carousel/media-carousel.component';
import { CaptionComponent } from '../caption/caption.component';
import { PostActionsComponent, likePost } from './post-actions.component';
import { ShareSheetComponent } from '../share-sheet/share-sheet.component';
import { PostEditComponent } from './post-edit.component';
import { PostService } from '../../services/post.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { Post } from '../../models/post.model';
import { Media } from '../../models/media.model';
import { copyPostLink, initials, postMedia, timeAgo, timeAgoLong } from './post-utils';

/** Instagram feed post card. */
@Component({
  selector: 'app-post-card',
  standalone: true,
  imports: [RouterModule, MediaCarouselComponent, CaptionComponent, PostActionsComponent, ShareSheetComponent, PostEditComponent],
  templateUrl: './post-card.component.html',
  styleUrls: ['./post-card.component.css']
})
export class PostCardComponent implements OnDestroy {
  @Input({ required: true }) post!: Post;
  @Input() focused = false;
  /** Open the post with comments (modal on the feed). */
  @Output() open = new EventEmitter<Post>();
  /** Post deleted or archived — remove it from the list. */
  @Output() removed = new EventEmitter<Post>();

  menuOpen = false;
  shareOpen = false;
  editOpen = false;
  burst = false;
  private lastTap = 0;
  private burstTimer: any;

  initials = initials;
  timeAgo = timeAgo;
  timeAgoLong = timeAgoLong;

  constructor(private posts: PostService, private auth: AuthService, private toast: ToastService, private router: Router) {}

  ngOnDestroy(): void { clearTimeout(this.burstTimer); }

  get media(): Media[] { return postMedia(this.post); }
  get isOwner(): boolean { return this.auth.currentUser()?.username === this.post.author?.username; }
  get name(): string { return this.post.author?.username || ''; }

  /** Double tap (touch or mouse) likes with a heart burst; never un-likes. */
  onTap(): void {
    const now = Date.now();
    if (now - this.lastTap < 320) {
      this.lastTap = 0;
      this.doubleTapLike();
    } else {
      this.lastTap = now;
    }
  }

  doubleTapLike(): void {
    likePost(this.posts, this.post, true);
    this.burst = false;
    clearTimeout(this.burstTimer);
    setTimeout(() => {
      this.burst = true;
      this.burstTimer = setTimeout(() => { this.burst = false; }, 900);
    });
  }

  @HostListener('document:click')
  closeMenu(): void { this.menuOpen = false; }

  toggleMenu(e: Event): void { e.stopPropagation(); this.menuOpen = !this.menuOpen; }

  copyLink(): void { this.menuOpen = false; copyPostLink(this.post, this.toast); }
  goToPost(): void { this.menuOpen = false; this.router.navigate(['/post', this.post.id]); }
  openShare(): void { this.menuOpen = false; this.shareOpen = true; }
  openEdit(): void { this.menuOpen = false; this.editOpen = true; }
  onEdited(p: Post): void { Object.assign(this.post, p); }

  archive(): void {
    this.menuOpen = false;
    this.posts.toggleArchive(this.post.id).subscribe({
      next: r => {
        this.post.archived = r.archived;
        if (r.archived) {
          this.toast.success('Post archived — only you can see it now');
          this.removed.emit(this.post);
        }
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
