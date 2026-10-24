import { Component, ElementRef, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { LiveInfo, LiveService } from '../../services/live.service';
import { RealtimeService } from '../../services/realtime.service';
import { LiveRoom } from './live-room';
import { LiveViewerTransport, createViewer } from './live-transport';

type Phase = 'loading' | 'connecting' | 'playing' | 'ended' | 'error';

@Component({
  selector: 'app-watch-live',
  standalone: true,
  imports: [FormsModule, RouterModule],
  templateUrl: './watch-live.component.html',
  styleUrls: ['./live-shared.css']
})
export class WatchLiveComponent implements OnInit, OnDestroy {
  @ViewChild('video') video!: ElementRef<HTMLVideoElement>;

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private live = inject(LiveService);
  private rt = inject(RealtimeService);
  auth = inject(AuthService);

  phase: Phase = 'loading';
  info: LiveInfo | null = null;
  room: LiveRoom | null = null;
  errorText = '';
  muted = true;
  commentText = '';

  private transport: LiveViewerTransport | null = null;
  private subs: Subscription[] = [];
  private lastTap = 0;

  ngOnInit(): void {
    this.subs.push(this.route.paramMap.subscribe(p => this.load(p.get('id')!)));
  }

  ngOnDestroy(): void { this.teardown(); }

  private load(id: string): void {
    this.teardown();
    this.phase = 'loading';
    this.live.get(id).subscribe({
      next: info => {
        this.info = info;
        if (info.host.username === this.auth.currentUser()?.username && info.status === 'active') {
          this.router.navigate(['/live'], { replaceUrl: true });
          return;
        }
        if (info.status !== 'active') { this.phase = 'ended'; return; }
        this.room = new LiveRoom(this.rt, info.id, this.auth.currentUser()?.username, () => this.onEnded());
        this.room.comments = info.comments || [];
        this.room.setViewers(info.viewerCount);
        this.room.heartCount = info.hearts;
        this.room.start();
        this.phase = 'connecting';
        this.live.iceConfig().subscribe({
          next: cfg => this.connect(cfg.transport, cfg.iceServers),
          error: () => this.connect('mesh', [{ urls: 'stun:stun.l.google.com:19302' }])
        });
      },
      error: err => {
        this.phase = 'error';
        this.errorText = err?.status === 403 ? "You can't watch this live video." : 'This live video is unavailable.';
      }
    });
  }

  private connect(transport: string, iceServers: RTCIceServer[]): void {
    if (!this.info) return;
    this.transport = createViewer(transport, this.rt, this.info.id, this.info.host.username, iceServers);
    this.transport.start(stream => {
      const v = this.video?.nativeElement;
      if (v) { v.srcObject = stream; v.muted = this.muted; v.play().catch(() => {}); }
      this.phase = 'playing';
    }, state => {
      if (state === 'failed' && this.phase !== 'ended') this.phase = 'connecting';
    });
    // rejoin after the socket reconnects so the host renegotiates
    this.subs.push(this.rt.on('open').subscribe(e => { if (e['reconnect']) this.transport?.rejoin(); }));
  }

  private onEnded(): void {
    this.phase = 'ended';
    this.transport?.stop();
    this.transport = null;
  }

  private teardown(): void {
    this.transport?.stop();
    this.transport = null;
    this.room?.stop();
    this.room = null;
    this.subs.slice(1).forEach(s => s.unsubscribe());
    this.subs = this.subs.slice(0, 1);
  }

  toggleMute(): void {
    this.muted = !this.muted;
    const v = this.video?.nativeElement;
    if (v) { v.muted = this.muted; v.play().catch(() => {}); }
  }

  onVideoTap(): void {
    const now = Date.now();
    if (now - this.lastTap < 300) { this.heart(); this.lastTap = 0; }
    else { this.lastTap = now; if (this.muted) this.toggleMute(); }
  }

  heart(): void { this.room?.heart(); }

  sendComment(): void {
    this.room?.comment(this.commentText);
    this.commentText = '';
  }

  close(): void {
    if (history.length > 1) history.back(); else this.router.navigate(['/feed']);
  }

  initials(u: any): string { return (u?.displayName || u?.username || '?').charAt(0).toUpperCase(); }
}
