import { Injectable, signal } from '@angular/core';

/**
 * Opens/closes the "create post" composer from anywhere (sidebar, bottom tab,
 * empty states, onboarding). The media agent's composer component reads
 * `isOpen` and calls `close()` when done.
 */
@Injectable({ providedIn: 'root' })
export class ComposerService {
  private readonly _isOpen = signal(false);
  readonly isOpen = this._isOpen.asReadonly();

  open(): void { this._isOpen.set(true); }
  close(): void { this._isOpen.set(false); }
}
