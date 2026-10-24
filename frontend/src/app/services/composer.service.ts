import { Injectable, signal } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { Post } from '../models/post.model';

export interface ComposerOpenOptions {
  /** Why it was opened, e.g. 'streak-banner' (analytics / copy tweaks). */
  source?: string;
}

/**
 * Global bridge to the post composer. Anyone can call `open()` (sidebar,
 * bottom tab, streak banner, onboarding); the layout mounts the composer while
 * `isOpen` is true. After a successful post the composer calls `posted(post)`
 * so the feed can prepend it and refresh the streak banner.
 */
@Injectable({ providedIn: 'root' })
export class ComposerService {
  private readonly _isOpen = signal(false);
  private openSub = new Subject<ComposerOpenOptions>();
  private postedSub = new Subject<Post>();

  readonly isOpen = this._isOpen.asReadonly();
  readonly open$: Observable<ComposerOpenOptions> = this.openSub.asObservable();
  readonly posted$: Observable<Post> = this.postedSub.asObservable();

  open(opts: ComposerOpenOptions = {}): void {
    this._isOpen.set(true);
    this.openSub.next(opts);
  }

  close(): void { this._isOpen.set(false); }

  posted(post: Post): void {
    this.postedSub.next(post);
    this.close();
  }
}
