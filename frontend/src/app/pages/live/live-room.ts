import { Subscription } from 'rxjs';
import { RealtimeService } from '../../services/realtime.service';
import { LiveComment } from '../../services/live.service';

export interface FloatingHeart { id: number; x: number; hue: number; }

/**
 * Transport-independent Live room state shared by the broadcaster and the
 * watch page: comments, hearts animation, viewer count and the ended flag.
 */
export class LiveRoom {
  comments: LiveComment[] = [];
  hearts: FloatingHeart[] = [];
  heartCount = 0;
  viewerCount = 0;
  peakViewers = 0;
  ended = false;
  error = '';
  private subs: Subscription[] = [];
  private heartSeq = 0;

  constructor(private rt: RealtimeService, readonly liveId: string, private me: string | undefined,
              private onEnded: () => void = () => {}) {}

  start(): void {
    const mine = (e: any) => String(e.liveId) === this.liveId;
    this.subs.push(
      this.rt.on('live:joined').subscribe(e => {
        if (!mine(e)) return;
        if (Array.isArray(e['comments'])) this.comments = e['comments'].slice(-30);
        if (e['live']) { this.setViewers(e['live'].viewerCount); this.heartCount = e['live'].hearts || 0; }
      }),
      this.rt.on('live:comment').subscribe(e => {
        if (!mine(e) || this.comments.some(c => c.id === e['comment']?.id)) return;
        this.comments = [...this.comments, e['comment']].slice(-30);
      }),
      this.rt.on('live:heart').subscribe(e => {
        if (!mine(e)) return;
        this.heartCount = e['hearts'] ?? this.heartCount + 1;
        if (e['from'] !== this.me) this.float();
      }),
      this.rt.on('live:viewers').subscribe(e => { if (mine(e)) this.setViewers(e['viewerCount']); }),
      this.rt.on('live:ended').subscribe(e => { if (mine(e)) { this.ended = true; this.onEnded(); } }),
      this.rt.on('live:error').subscribe(e => { if (mine(e)) this.error = e['error'] || 'Something went wrong'; })
    );
  }

  setViewers(n: number): void {
    this.viewerCount = n || 0;
    this.peakViewers = Math.max(this.peakViewers, this.viewerCount);
  }

  comment(text: string): void {
    const t = text.trim();
    if (t) this.rt.send({ type: 'live:comment', liveId: this.liveId, text: t });
  }

  heart(): void {
    this.rt.send({ type: 'live:heart', liveId: this.liveId });
    this.heartCount++;
    this.float();
  }

  /** Spawns a floating heart that removes itself after the animation. */
  float(): void {
    if (this.hearts.length > 24) return;
    const h: FloatingHeart = { id: ++this.heartSeq, x: Math.round(Math.random() * 40) - 20, hue: Math.round(Math.random() * 40) - 20 };
    this.hearts = [...this.hearts, h];
    setTimeout(() => { this.hearts = this.hearts.filter(x => x.id !== h.id); }, 2200);
  }

  stop(): void {
    this.subs.forEach(s => s.unsubscribe());
    this.subs = [];
  }
}
