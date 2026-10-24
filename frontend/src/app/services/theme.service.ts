import { Injectable, signal } from '@angular/core';

export type Theme = 'light' | 'dark';

const KEY = 'bb-theme';
const THEME_COLORS: Record<Theme, string> = { dark: '#000000', light: '#ffffff' };

/**
 * Appearance. Black (dark) is the default for everyone, regardless of the OS
 * setting; light is used only after the user picks it (Settings -> Theme or
 * More -> Switch appearance). The choice is stored in localStorage('bb-theme').
 * index.html applies the same rule before first paint so there is no flash.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<Theme>(this.resolve());

  constructor() {
    this.apply();
  }

  get isDark(): boolean { return this.theme() === 'dark'; }

  toggle(): void { this.set(this.isDark ? 'light' : 'dark'); }

  set(t: Theme): void {
    try { localStorage.setItem(KEY, t); } catch {}
    this.theme.set(t);
    this.apply();
  }

  private resolve(): Theme {
    let v: string | null = null;
    try { v = localStorage.getItem(KEY); } catch {}
    return v === 'light' ? 'light' : 'dark';
  }

  private apply(): void {
    const t = this.theme();
    document.documentElement.setAttribute('data-theme', t);
    document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', THEME_COLORS[t]));
  }
}
