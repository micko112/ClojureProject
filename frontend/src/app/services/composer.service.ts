import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { Post } from '../models/post.model';

export interface ComposerOpenOptions {
  /** Why it was opened, e.g. 'streak-banner' (analytics / copy tweaks). */
  source?: string;
}

/**
 * Global bridge to the post composer. Anyone can call `open()`; the composer
 * (built by the media area, mounted by the layout) subscribes to `open$`.
 * After a successful post the composer calls `posted(post)` so the feed can
 * prepend it and refresh the streak banner.
 */
@Injectable({ providedIn: 'root' })
export class ComposerService {
  private openSub = new Subject<ComposerOpenOptions>();
  private postedSub = new Subject<Post>();

  readonly open$: Observable<ComposerOpenOptions> = this.openSub.asObservable();
  readonly posted$: Observable<Post> = this.postedSub.asObservable();

  open(opts: ComposerOpenOptions = {}): void { this.openSub.next(opts); }
  posted(post: Post): void { this.postedSub.next(post); }
}
