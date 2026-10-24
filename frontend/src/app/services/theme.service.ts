import { Injectable, signal } from '@angular/core';

export type Theme = 'light' | 'dark';

const KEY = 'bb-theme';
const THEME_COLORS: Record<Theme, string> = { dark: '#0a0a0a', light: '#ffffff' };

/**
 * Appearance. Follows prefers-color-scheme until the user picks a theme;
 * the choice is stored in localStorage('bb-theme'). index.html applies the
 * same rule before first paint so there is no flash.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly media = window.matchMedia?.('(prefers-color-scheme: light)');
  readonly theme = signal<Theme>(this.resolve());

  constructor() {
    this.apply();
    this.media?.addEventListener?.('change', () => {
      if (!this.storedChoice()) { this.theme.set(this.resolve()); this.apply(); }
    });
  }

  get isDark(): boolean { return this.theme() === 'dark'; }

  toggle(): void { this.set(this.isDark ? 'light' : 'dark'); }

  set(t: Theme): void {
    try { localStorage.setItem(KEY, t); } catch {}
    this.theme.set(t);
    this.apply();
  }

  private storedChoice(): Theme | null {
    let v: string | null = null;
    try { v = localStorage.getItem(KEY); } catch {}
    return v === 'light' || v === 'dark' ? v : null;
  }

  private resolve(): Theme {
    return this.storedChoice() ?? (this.media?.matches ? 'light' : 'dark');
  }

  private apply(): void {
    const t = this.theme();
    document.documentElement.setAttribute('data-theme', t);
    document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', THEME_COLORS[t]));
  }
}
