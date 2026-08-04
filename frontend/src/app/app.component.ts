import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastComponent } from './components/toast/toast.component';
import { CookieConsentComponent } from './components/cookie-consent/cookie-consent.component';

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
export class AppComponent {}
