import { Component, OnInit, OnDestroy, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { LiveInfo, LiveService } from '../../services/live.service';
import { RealtimeService } from '../../services/realtime.service';

@Component({
  selector: 'app-stories-bar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './stories-bar.component.html',
  styleUrls: ['./stories-bar.component.css']
})
export class StoriesBarComponent implements OnInit, OnDestroy {
  @Output() openViewer = new EventEmitter<{ groups: any[]; index: number }>();

  groups: any[] = [];
  showCreate = false;
  storyText = '';
  storyBgColor = '#1a1a2e';
  storyFile: File | null = null;
  storyPreview: string | null = null;
  previewIsVideo = false;
  creating = false;

  readonly bgColors = [
    '#1a1a2e', '#0f3460', '#533483', '#e94560',
    '#ee5a24', '#f9ca24', '#6ab04c', '#22a6b3', '#be2edd'
  ];

  // Live videos (shown first with a red LIVE ring) — realtime area
  lives: LiveInfo[] = [];
  private liveService = inject(LiveService);
  private realtime = inject(RealtimeService);
  private router = inject(Router);
  private liveSubs: Subscription[] = [];

  constructor(private api: ApiService, public auth: AuthService) {}

  ngOnInit(): void {
    this.load();
    this.loadLives();
    this.liveSubs.push(
      this.realtime.on('live:started').subscribe(() => this.loadLives()),
      this.realtime.on('live:ended').subscribe(() => this.loadLives())
    );
  }

  ngOnDestroy(): void { this.liveSubs.forEach(s => s.unsubscribe()); }

  loadLives(): void {
    this.liveService.active().subscribe({ next: l => { this.lives = l; }, error: () => {} });
  }

  openLive(live: LiveInfo): void {
    const mine = live.host.username === this.auth.currentUser()?.username;
    this.router.navigate(mine ? ['/live'] : ['/live', live.id]);
  }

  goLive(): void {
    this.cancelCreate();
    this.router.navigate(['/live']);
  }

  load(): void {
    this.api.getStories().subscribe({ next: g => { this.groups = g; }, error: () => {} });
  }

  get myGroup(): any { return this.groups.find(g => g.isMe); }

  openMyStory(): void {
    if (this.myGroup?.stories?.length > 0) {
      const idx = this.groups.indexOf(this.myGroup);
      this.openViewer.emit({ groups: this.groups, index: idx });
    } else {
      this.showCreate = true;
    }
  }

  openGroup(group: any): void {
    const idx = this.groups.indexOf(group);
    this.openViewer.emit({ groups: this.groups, index: idx });
  }

  addToMyStory(): void { this.showCreate = true; }

  onFileChange(e: Event): void {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    this.storyFile = f;
    this.previewIsVideo = f.type.startsWith('video');
    const reader = new FileReader();
    reader.onload = ev => { this.storyPreview = ev.target?.result as string; };
    reader.readAsDataURL(f);
  }

  createStory(): void {
    if (this.creating) return;
    if (!this.storyText.trim() && !this.storyFile) return;
    this.creating = true;

    const doCreate = (mediaUrl?: string, mediaType?: string) => {
      this.api.createStory({
        text: this.storyText || undefined,
        bgColor: this.storyBgColor,
        mediaUrl,
        mediaType
      }).subscribe({
        next: () => {
          this.cancelCreate();
          this.creating = false;
          this.load();
        },
        error: () => { this.creating = false; }
      });
    };

    if (this.storyFile) {
      this.api.uploadFile(this.storyFile).subscribe({
        next: r => {
          const mt = this.storyFile!.type.startsWith('video') ? 'video' : 'image';
          doCreate(r.url, mt);
        },
        error: () => { this.creating = false; }
      });
    } else {
      doCreate();
    }
  }

  cancelCreate(): void {
    this.showCreate = false;
    this.storyText = '';
    this.storyBgColor = '#1a1a2e';
    this.storyFile = null;
    this.storyPreview = null;
    this.previewIsVideo = false;
  }

  initials(g: any): string {
    return (g?.displayName || g?.username || '?').charAt(0).toUpperCase();
  }
}
