import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { LiveInfo, LiveService } from '../../services/live.service';
import { RealtimeService } from '../../services/realtime.service';
import { ToastService } from '../../services/toast.service';
import { LiveRoom } from './live-room';
import { LiveBroadcastTransport, createBroadcaster } from './live-transport';

type Phase = 'setup' | 'starting' | 'live' | 'ended';

@Component({
  selector: 'app-go-live',
  standalone: true,
  imports: [FormsModule, RouterModule],
  templateUrl: './go-live.component.html',
  styleUrls: ['./live-shared.css']
})
export class GoLiveComponent implements OnInit, OnDestroy {
  @ViewChild('preview') preview!: ElementRef<HTMLVideoElement>;

  private live = inject(LiveService);
  private rt = inject(RealtimeService);
  private toast = inject(ToastService);
  private router = inject(Router);
  auth = inject(AuthService);

  phase: Phase = 'setup';
  title = '';
  permissionError = '';
  cameraReady = false;
  info: LiveInfo | null = null;
  room: LiveRoom | null = null;
  commentText = '';
  micOn = true;
  facing: 'user' | 'environment' = 'user';
  elapsed = 0;
  durationLabel = '';

  private stream: MediaStream | null = null;
  private transport: LiveBroadcastTransport | null = null;
  private clock: any;
  private subs: Subscription[] = [];

  async ngOnInit(): Promise<void> {
    await this.openCamera();
  }

  ngOnDestroy(): void {
    if (this.phase === 'live' && this.info) {
      this.live.end(this.info.id).subscribe({ error: () => {} });
    }
    this.teardown();
  }

  /** Best effort: end the live if the tab is closed while broadcasting. */
  @HostListener('window:pagehide')
  onPageHide(): void {
    if (this.phase === 'live' && this.info) navigator.sendBeacon?.(`/api/live/${this.info.id}/end`);
  }

  private async openCamera(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.permissionError = 'Your browser does not support camera access.';
      return;
    }
    try {
      const next = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: this.facing, width: { ideal: 720 }, height: { ideal: 1280 } },
        audio: { echoCancellation: true, noiseSuppression: true }
      });
      const old = this.stream;
      this.stream = next;
      next.getAudioTracks().forEach(t => t.enabled = this.micOn);
      this.attachPreview();
      this.transport?.replaceStream(next);
      old?.getTracks().forEach(t => t.stop());
      this.permissionError = '';
      this.cameraReady = true;
    } catch (e: any) {
      this.permissionError = e?.name === 'NotAllowedError'
        ? 'Allow camera and microphone access to go live.'
        : 'Could not start the camera.';
    }
  }

  private attachPreview(): void {
    setTimeout(() => {
      const v = this.preview?.nativeElement;
      if (v && this.stream) { v.srcObject = this.stream; v.muted = true; v.play().catch(() => {}); }
    });
  }

  retryCamera(): void { this.openCamera(); }

  async flipCamera(): Promise<void> {
    this.facing = this.facing === 'user' ? 'environment' : 'user';
    await this.openCamera();
  }

  toggleMic(): void {
    this.micOn = !this.micOn;
    this.stream?.getAudioTracks().forEach(t => t.enabled = this.micOn);
  }

  goLive(): void {
    if (!this.stream || this.phase !== 'setup') return;
    this.phase = 'starting';
    this.live.iceConfig().subscribe({
      next: cfg => {
        this.live.start(this.title.trim() || undefined).subscribe({
          next: info => {
            this.info = info;
            this.room = new LiveRoom(this.rt, info.id, this.auth.currentUser()?.username, () => this.onEndedRemotely());
            this.room.start();
            this.transport = createBroadcaster(cfg.transport, this.rt, info.id, cfg.iceServers);
            this.transport.start(this.stream!);
            this.phase = 'live';
            const started = Date.now();
            this.clock = setInterval(() => this.elapsed = Math.floor((Date.now() - started) / 1000), 1000);
            this.attachPreview();
          },
          error: () => { this.phase = 'setup'; this.toast.error('Could not start live video'); }
        });
      },
      error: () => { this.phase = 'setup'; this.toast.error('Could not start live video'); }
    });
  }

  endLive(): void {
    if (!this.info || this.phase !== 'live') return;
    if (!confirm('End your live video?')) return;
    this.live.end(this.info.id).subscribe({
      next: info => { this.info = info; this.finish(); },
      error: () => this.finish()
    });
  }

  private onEndedRemotely(): void {
    if (this.phase === 'live') this.finish();
  }

  private finish(): void {
    this.durationLabel = this.timeLabel(this.elapsed);
    this.phase = 'ended';
    this.teardown();
  }

  private teardown(): void {
    clearInterval(this.clock);
    this.transport?.stop();
    this.transport = null;
    this.room?.stop();
    this.subs.forEach(s => s.unsubscribe());
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
  }

  sendComment(): void {
    this.room?.comment(this.commentText);
    this.commentText = '';
  }

  close(): void { this.router.navigate(['/feed']); }

  timeLabel(s: number): string {
    const m = Math.floor(s / 60), sec = s % 60, h = Math.floor(m / 60);
    const mm = (h ? m % 60 : m).toString().padStart(h ? 2 : 1, '0');
    return `${h ? h + ':' : ''}${mm}:${sec.toString().padStart(2, '0')}`;
  }

  initials(u: any): string { return (u?.displayName || u?.username || '?').charAt(0).toUpperCase(); }
}
