import { Component, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { RelationKind } from '../../services/accounts.service';
import { EditProfileSectionComponent } from './sections/edit-profile.section';
import { AccountSectionComponent } from './sections/account.section';
import { NotificationsSectionComponent, PrivacySectionComponent } from './sections/preferences.sections';
import { FollowRequestsSectionComponent, RelationsSectionComponent } from './sections/people.sections';
import { AboutSectionComponent, SecuritySectionComponent, ThemeSectionComponent } from './sections/misc.sections';

export interface SettingsNavItem {
  key: string;
  label: string;
  icon: string;
  group: string;
}

export const SETTINGS_SECTIONS: SettingsNavItem[] = [
  { key: 'edit-profile', label: 'Edit profile', icon: 'account_circle', group: 'How you use the app' },
  { key: 'notifications', label: 'Notifications', icon: 'notifications_none', group: 'How you use the app' },
  { key: 'privacy', label: 'Account privacy', icon: 'lock_outline', group: 'Who can see your content' },
  { key: 'follow-requests', label: 'Follow requests', icon: 'person_add_alt', group: 'Who can see your content' },
  { key: 'close-friends', label: 'Close friends', icon: 'stars', group: 'Who can see your content' },
  { key: 'blocked', label: 'Blocked', icon: 'block', group: 'Who can see your content' },
  { key: 'muted', label: 'Muted accounts', icon: 'notifications_off', group: 'How others can interact with you' },
  { key: 'restricted', label: 'Restricted accounts', icon: 'do_not_disturb_on', group: 'How others can interact with you' },
  { key: 'account', label: 'Account', icon: 'manage_accounts', group: 'Your account' },
  { key: 'security', label: 'Log out of all devices', icon: 'devices', group: 'Your account' },
  { key: 'theme', label: 'Theme', icon: 'dark_mode', group: 'Your app and media' },
  { key: 'about', label: 'About', icon: 'info_outline', group: 'More info and support' },
];

const RELATION_FOR: Record<string, RelationKind> = {
  'close-friends': 'close-friends',
  blocked: 'blocks',
  muted: 'mutes',
  restricted: 'restricts',
};

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    RouterModule,
    EditProfileSectionComponent, AccountSectionComponent, PrivacySectionComponent,
    NotificationsSectionComponent, RelationsSectionComponent, FollowRequestsSectionComponent,
    SecuritySectionComponent, ThemeSectionComponent, AboutSectionComponent,
  ],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.css']
})
export class SettingsComponent implements OnDestroy {
  sections = SETTINGS_SECTIONS;
  groups = [...new Set(SETTINGS_SECTIONS.map(s => s.group))];
  /** Section from the URL; null = list view on phones. */
  routeSection: string | null = null;
  private sub: Subscription;

  constructor(route: ActivatedRoute, private router: Router, public auth: AuthService) {
    this.auth.refresh(); // fresh settings + follow request count
    this.sub = route.paramMap.subscribe(p => {
      const s = p.get('section');
      this.routeSection = s && SETTINGS_SECTIONS.some(x => x.key === s) ? s : null;
      if (s && !this.routeSection) this.router.navigate(['/settings']);
    });
  }

  ngOnDestroy(): void { this.sub.unsubscribe(); }

  /** Section shown in the right panel (desktop defaults to Edit profile). */
  get section(): string { return this.routeSection || 'edit-profile'; }

  get relationKind(): RelationKind | null { return RELATION_FOR[this.section] || null; }

  get followRequestCount(): number { return this.auth.currentUser()?.settings?.followRequestCount || 0; }

  get currentLabel(): string { return this.sections.find(s => s.key === this.section)?.label || 'Settings'; }

  itemsIn(group: string): SettingsNavItem[] { return this.sections.filter(s => s.group === group); }

  back(): void {
    if (this.routeSection) this.router.navigate(['/settings']);
    else this.router.navigate(['/profile', this.auth.currentUser()?.username || '']);
  }

  logout(): void {
    this.auth.logout().subscribe(() => this.router.navigate(['/login']));
  }
}
