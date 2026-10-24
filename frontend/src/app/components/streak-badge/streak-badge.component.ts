import { Component, Injectable, Input, OnInit, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';

export interface StreakInfo {
  current: number;
  longest?: number;
  postedToday?: boolean;
}

/**
 * Shared cache for GET /api/me/streak (built by the posts agent).
 * Accepts several response shapes; any error (404 while the endpoint does not
 * exist yet) simply hides the badge.
 */
@Injectable({ providedIn: 'root' })
export class StreakStore {
  private http = inject(HttpClient);
  readonly streak = signal<StreakInfo | null>(null);
  private lastLoad = 0;

  load(force = false): void {
    if (!force && Date.now() - this.lastLoad < 60_000) return;
    this.lastLoad = Date.now();
    this.http.get<any>('/api/me/streak').subscribe({
      next: r => this.streak.set(StreakStore.parse(r)),
      error: () => this.streak.set(null)
    });
  }

  static parse(r: any): StreakInfo | null {
    if (r == null) return null;
    if (typeof r === 'number') return { current: r };
    const current = Number(r.current ?? r.currentStreak ?? r.streak ?? r.days ?? r.count);
    if (!Number.isFinite(current)) return null;
    return {
      current,
      longest: r.longest ?? r.longestStreak ?? r.best,
      postedToday: r.postedToday ?? r.today ?? r.posted_today
    };
  }
}

@Component({
  selector: 'app-streak-badge',
  standalone: true,
  template: `
    @if (visible()) {
      <span class="streak" [class.compact]="compact" [class.pending]="pending()"
            role="img" [attr.aria-label]="label()" [attr.title]="label()">
        <svg class="flame" viewBox="0 0 24 24" aria-hidden="true">
          <defs>
            <linearGradient [attr.id]="gid" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stop-color="#d6267f"/>
              <stop offset="0.5" stop-color="#ff7a2f"/>
              <stop offset="1" stop-color="#ffc046"/>
            </linearGradient>
          </defs>
          <path [attr.fill]="'url(#' + gid + ')'" d="M13.5 1.6c.4 2.6-.6 4.4-2 6-1.4 1.6-3 3-3 5.5 0 .8.2 1.5.5 2.1-1.6-.6-2.6-2.1-2.8-3.8C4.6 13.1 4 14.8 4 16.6 4 20.1 7.6 23 12 23s8-2.9 8-6.6c0-5.4-4.1-8.4-6.5-14.8zM12 21c-1.9 0-3.4-1.3-3.4-3 0-2.1 2-3.2 2.8-5.2 1.6 1.5 4 3.1 4 5.2 0 1.7-1.5 3-3.4 3z"/>
        </svg>
        <span class="num">{{ value() }}</span>
      </span>
    }
  `,
  styles: [`
    :host { display: inline-flex; }
    .streak {
      display: inline-flex; align-items: center; gap: 2px;
      padding: 2px 0;
      color: var(--text);
      font-size: 13px; font-weight: 600; line-height: 1;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .streak.compact { padding: 0; background: none; font-size: 11px; }
    .flame { width: 16px; height: 16px; flex-shrink: 0; }
    .compact .flame { width: 14px; height: 14px; }
    /* Not posted yet today: softly faded, never alarming */
    .pending .flame { opacity: 0.55; filter: saturate(0.6); }
  `]
})
export class StreakBadgeComponent implements OnInit {
  /** Optional explicit value (e.g. on someone else's profile). Omit to show my own streak. */
  @Input() set count(v: number | null | undefined) { this.explicit.set(v ?? null); }
  /** Smaller variant without background pill. */
  @Input() compact = false;
  /** Show the badge even when the streak is 0. */
  @Input() showZero = false;

  private static seq = 0;
  readonly gid = `bbFlame${++StreakBadgeComponent.seq}`;
  private store = inject(StreakStore);
  private explicit = signal<number | null>(null);

  readonly value = computed(() => this.explicit() ?? this.store.streak()?.current ?? 0);
  readonly pending = computed(() => this.explicit() == null && this.store.streak()?.postedToday === false);
  readonly visible = computed(() => {
    if (this.explicit() == null && !this.store.streak()) return false;
    return this.value() > 0 || this.showZero;
  });
  readonly label = computed(() => {
    const n = this.value();
    const days = `${n}-day progress streak`;
    return this.pending() ? `${days}. Post today to keep it going.` : days;
  });

  ngOnInit(): void {
    if (this.explicit() == null) this.store.load();
  }
}
