import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-groups',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './groups.component.html',
  styleUrls: ['./groups.component.css']
})
export class GroupsComponent implements OnInit, OnDestroy {
  groups: any[] = [];
  loading = true;

  // Active group (detail view)
  activeGroup: any = null;
  groupMessages: any[] = [];
  newMessage = '';
  sending = false;
  msgsLoading = false;
  private pollTimer: any;

  // Create group modal
  createOpen = signal(false);
  gName = '';
  gDescription = '';
  gBannerUrl = '';
  gFile: File | null = null;
  gBannerPreview = '';
  creating = false;

  constructor(
    private api: ApiService,
    public auth: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.loadGroups();
    this.pollTimer = setInterval(() => this.pollGroupMessages(), 3000);
  }

  ngOnDestroy(): void {
    clearInterval(this.pollTimer);
  }

  loadGroups(): void {
    this.api.getGroups().subscribe({
      next: g => { this.groups = g; this.loading = false; },
      error: () => { this.loading = false; }
    });
  }

  openGroup(g: any): void {
    this.api.getGroup(g.id).subscribe({
      next: full => {
        this.activeGroup = full;
        this.loadMessages();
      },
      error: () => {}
    });
  }

  private loadMessages(): void {
    if (!this.activeGroup) return;
    this.msgsLoading = true;
    this.api.getGroupMessages(this.activeGroup.id).subscribe({
      next: msgs => { this.groupMessages = msgs; this.msgsLoading = false; },
      error: () => { this.msgsLoading = false; }
    });
  }

  private pollGroupMessages(): void {
    if (!this.activeGroup) return;
    this.api.getGroupMessages(this.activeGroup.id).subscribe({
      next: msgs => { this.groupMessages = msgs; },
      error: () => {}
    });
  }

  sendMessage(): void {
    const content = this.newMessage.trim();
    if (!content || this.sending || !this.activeGroup) return;
    this.sending = true;
    this.api.sendGroupMessage(this.activeGroup.id, content).subscribe({
      next: () => {
        this.newMessage = '';
        this.sending = false;
        this.loadMessages();
      },
      error: () => { this.sending = false; }
    });
  }

  onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendMessage(); }
  }

  toggleMembership(): void {
    if (!this.activeGroup) return;
    this.api.toggleGroupMembership(this.activeGroup.id).subscribe({
      next: r => {
        if (r.action === 'left') { this.activeGroup = null; this.loadGroups(); }
        else { this.loadGroups(); }
      },
      error: () => {}
    });
  }

  isMember(): boolean {
    const me = this.auth.currentUser()?.username;
    return this.activeGroup?.members?.some((m: any) => m.username === me) ?? false;
  }

  isCreator(): boolean {
    return this.activeGroup?.creator?.username === this.auth.currentUser()?.username;
  }

  openCreate(): void { this.createOpen.set(true); }
  closeCreate(): void {
    this.createOpen.set(false);
    this.gName = ''; this.gDescription = ''; this.gBannerUrl = '';
    this.gFile = null; this.gBannerPreview = '';
  }

  onBannerSelect(e: Event): void {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    this.gFile = f;
    const r = new FileReader();
    r.onload = ev => { this.gBannerPreview = ev.target?.result as string; };
    r.readAsDataURL(f);
  }

  createGroup(): void {
    if (!this.gName.trim() || this.creating) return;
    this.creating = true;
    const doCreate = (bannerUrl?: string) => {
      this.api.createGroup({ name: this.gName.trim(), description: this.gDescription, bannerUrl }).subscribe({
        next: () => {
          this.creating = false;
          this.closeCreate();
          this.loadGroups();
        },
        error: () => { this.creating = false; }
      });
    };
    if (this.gFile) {
      this.api.uploadFile(this.gFile).subscribe({
        next: r => doCreate(r.url),
        error: () => { this.creating = false; }
      });
    } else {
      doCreate(this.gBannerUrl || undefined);
    }
  }

  isMine(msg: any): boolean {
    return msg.sender?.username === this.auth.currentUser()?.username;
  }

  timeAgo(dateStr: string): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  avatar(u: any): string { return u?.profilePic || ''; }
  initials(u: any): string { return (u?.displayName || u?.username || '?').charAt(0).toUpperCase(); }
}
