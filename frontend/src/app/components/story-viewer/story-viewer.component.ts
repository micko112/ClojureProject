import {
  Component, Input, Output, EventEmitter,
  OnInit, OnDestroy, HostListener, ChangeDetectionStrategy, ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-story-viewer',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './story-viewer.component.html',
  styleUrls: ['./story-viewer.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StoryViewerComponent implements OnInit, OnDestroy {
  @Input() groups: any[] = [];
  @Input() startGroupIndex = 0;
  @Output() closed = new EventEmitter<void>();

  groupIdx = 0;
  storyIdx = 0;
  progress = 0;

  private progTimer: any;
  private readonly DURATION = 5000;
  private readonly TICK = 50;

  constructor(
    private api: ApiService,
    public auth: AuthService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.groupIdx = this.startGroupIndex;
    this.storyIdx = 0;
    this.startProgress();
    this.markViewed();
  }

  ngOnDestroy(): void { this.clearTimers(); }

  get group(): any { return this.groups[this.groupIdx]; }
  get story(): any { return this.group?.stories?.[this.storyIdx]; }
  get total(): number { return this.group?.stories?.length ?? 0; }

  startProgress(): void {
    this.clearTimers();
    this.progress = 0;
    const increment = 100 / (this.DURATION / this.TICK);
    this.progTimer = setInterval(() => {
      this.progress = Math.min(this.progress + increment, 100);
      if (this.progress >= 100) {
        clearInterval(this.progTimer);
        this.nextStory();
      }
      this.cdr.markForCheck();
    }, this.TICK);
  }

  clearTimers(): void { clearInterval(this.progTimer); }

  markViewed(): void {
    const s = this.story;
    if (!s || s.viewedByMe) return;
    s.viewedByMe = true;
    this.api.viewStory(s.id).subscribe();
    const g = this.group;
    g.hasUnviewed = g.stories.some((st: any) => !st.viewedByMe);
  }

  nextStory(): void {
    if (this.storyIdx < this.total - 1) {
      this.storyIdx++;
      this.startProgress();
      this.markViewed();
    } else {
      this.nextGroup();
    }
  }

  prevStory(): void {
    if (this.storyIdx > 0) {
      this.storyIdx--;
      this.startProgress();
      this.markViewed();
    } else {
      this.prevGroup();
    }
  }

  nextGroup(): void {
    if (this.groupIdx < this.groups.length - 1) {
      this.groupIdx++;
      this.storyIdx = 0;
      this.startProgress();
      this.markViewed();
    } else {
      this.close();
    }
  }

  prevGroup(): void {
    if (this.groupIdx > 0) {
      this.groupIdx--;
      this.storyIdx = 0;
      this.startProgress();
      this.markViewed();
    }
  }

  onTap(e: MouseEvent): void {
    if ((e.target as HTMLElement).closest('.story-header')) return;
    if (e.clientX < window.innerWidth * 0.35) this.prevStory();
    else this.nextStory();
  }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    if (e.key === 'ArrowRight') this.nextStory();
    else if (e.key === 'ArrowLeft') this.prevStory();
    else if (e.key === 'Escape') this.close();
  }

  close(): void { this.clearTimers(); this.closed.emit(); }

  isVideo(url: string): boolean {
    return url ? /\.(mp4|webm|mov)$/i.test(url) : false;
  }

  isMe(): boolean {
    return this.group?.username === this.auth.currentUser()?.username;
  }

  deleteStory(): void {
    const s = this.story;
    if (!s) return;
    this.api.deleteStory(s.id).subscribe(() => {
      this.group.stories.splice(this.storyIdx, 1);
      if (this.group.stories.length === 0) {
        this.groups.splice(this.groupIdx, 1);
        if (this.groups.length === 0) { this.close(); return; }
        if (this.groupIdx >= this.groups.length) this.groupIdx--;
        this.storyIdx = 0;
      } else {
        if (this.storyIdx >= this.group.stories.length) this.storyIdx--;
      }
      this.startProgress();
      this.cdr.markForCheck();
    });
  }

  timeAgo(dateStr: string): string {
    if (!dateStr) return '';
    const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    return Math.floor(diff / 3600) + 'h ago';
  }

  initials(g: any): string {
    return (g?.displayName || g?.username || '?').charAt(0).toUpperCase();
  }

  progressFor(i: number): number {
    if (i < this.storyIdx) return 100;
    if (i === this.storyIdx) return this.progress;
    return 0;
  }
}
