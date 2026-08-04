import { Component, signal } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-cookie-consent',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './cookie-consent.component.html',
  styleUrls: ['./cookie-consent.component.css']
})
export class CookieConsentComponent {
  visible = signal(!localStorage.getItem('cookie-consent'));

  accept(): void {
    localStorage.setItem('cookie-consent', 'accepted');
    this.visible.set(false);
  }
}
