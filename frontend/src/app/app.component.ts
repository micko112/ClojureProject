import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastComponent } from './components/toast/toast.component';
import { CookieConsentComponent } from './components/cookie-consent/cookie-consent.component';
import { RealtimeService } from './services/realtime.service';
import { BadgesService } from './services/badges.service';
import { LiveToastsService } from './services/live-toasts.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ToastComponent, CookieConsentComponent],
  template: `
    <router-outlet />
    <app-toast />
    <app-cookie-consent />
  `
})
export class AppComponent {
  // Eagerly start the realtime connection, badge counters and live toasts.
  private readonly realtime = inject(RealtimeService);
  private readonly badges = inject(BadgesService);
  private readonly liveToasts = inject(LiveToastsService);
}
