import { Subscription } from 'rxjs';
import { RealtimeService } from '../../services/realtime.service';

/**
 * Video transport for Live. Today: WebRTC *mesh* — the broadcaster's browser
 * holds one RTCPeerConnection per viewer and the server only relays
 * signaling (`live:signal`) over the WebSocket. Fine for small audiences
 * (the backend caps viewers, see web.live/max-mesh-viewers).
 *
 * SFU seam: to scale, implement these two interfaces with an SFU client
 * (e.g. livekit-client: connect with a token from a future
 * `POST /api/live/:id/token`, publish/subscribe tracks) and pick it in
 * `createBroadcaster` / `createViewer` based on `IceConfig.transport`.
 * Comments, hearts, viewer counts and start/end are transport-independent.
 */
export interface LiveBroadcastTransport {
  start(stream: MediaStream): void;
  /** Swap camera/mic without renegotiating (e.g. flip camera). */
  replaceStream(stream: MediaStream): void;
  stop(): void;
}

export interface LiveViewerTransport {
  start(onStream: (stream: MediaStream) => void, onState?: (state: string) => void): void;
  /** Ask the broadcaster for a fresh connection (after a socket reconnect). */
  rejoin(): void;
  stop(): void;
}

export function createBroadcaster(transport: string, rt: RealtimeService, liveId: string, iceServers: RTCIceServer[]): LiveBroadcastTransport {
  // only 'mesh' exists today; an SFU implementation plugs in here
  return new MeshBroadcaster(rt, liveId, iceServers);
}

export function createViewer(transport: string, rt: RealtimeService, liveId: string, hostUsername: string, iceServers: RTCIceServer[]): LiveViewerTransport {
  return new MeshViewer(rt, liveId, hostUsername, iceServers);
}

interface Peer { pc: RTCPeerConnection; chain: Promise<unknown>; }

class MeshBroadcaster implements LiveBroadcastTransport {
  private peers = new Map<string, Peer>();
  private subs: Subscription[] = [];
  private stream: MediaStream | null = null;

  constructor(private rt: RealtimeService, private liveId: string, private iceServers: RTCIceServer[]) {}

  start(stream: MediaStream): void {
    this.stream = stream;
    const mine = (e: any) => String(e.liveId) === this.liveId;
    this.subs.push(
      this.rt.on('live:viewer-joined').subscribe(e => { if (mine(e)) this.connect(e['viewer']?.username); }),
      this.rt.on('live:viewer-left').subscribe(e => { if (mine(e)) this.drop(e['viewer']?.username); }),
      this.rt.on('live:signal').subscribe(e => { if (mine(e)) this.onSignal(e['from'], e['data']); })
    );
  }

  private signal(to: string, data: any): void {
    this.rt.send({ type: 'live:signal', liveId: this.liveId, to, data });
  }

  private connect(viewer?: string): void {
    if (!viewer || !this.stream) return;
    this.drop(viewer);
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const peer: Peer = { pc, chain: Promise.resolve() };
    this.peers.set(viewer, peer);
    this.stream.getTracks().forEach(t => pc.addTrack(t, this.stream!));
    pc.onicecandidate = e => { if (e.candidate) this.signal(viewer, { candidate: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        if (this.peers.get(viewer)?.pc === pc) this.drop(viewer);
      }
    };
    peer.chain = peer.chain.then(async () => {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.signal(viewer, { sdp: pc.localDescription!.toJSON() });
    }).catch(() => this.drop(viewer));
  }

  private onSignal(from: string, data: any): void {
    const peer = this.peers.get(from);
    if (!peer || !data) return;
    // serialise per peer so ICE candidates never race the remote description
    peer.chain = peer.chain.then(async () => {
      if (data.sdp) await peer.pc.setRemoteDescription(data.sdp);
      else if (data.candidate) await peer.pc.addIceCandidate(data.candidate).catch(() => {});
    }).catch(() => {});
  }

  private drop(viewer?: string): void {
    if (!viewer) return;
    const p = this.peers.get(viewer);
    if (p) { this.peers.delete(viewer); try { p.pc.close(); } catch { /* ignore */ } }
  }

  replaceStream(stream: MediaStream): void {
    this.stream = stream;
    this.peers.forEach(({ pc }) => {
      pc.getSenders().forEach(sender => {
        const track = stream.getTracks().find(t => t.kind === sender.track?.kind);
        if (track) sender.replaceTrack(track).catch(() => {});
      });
    });
  }

  stop(): void {
    this.subs.forEach(s => s.unsubscribe());
    this.subs = [];
    Array.from(this.peers.keys()).forEach(v => this.drop(v));
    this.stream = null;
  }
}

class MeshViewer implements LiveViewerTransport {
  private pc: RTCPeerConnection | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private subs: Subscription[] = [];
  private onStream: (s: MediaStream) => void = () => {};
  private onState: (s: string) => void = () => {};

  constructor(private rt: RealtimeService, private liveId: string, private host: string, private iceServers: RTCIceServer[]) {}

  start(onStream: (stream: MediaStream) => void, onState?: (state: string) => void): void {
    this.onStream = onStream;
    if (onState) this.onState = onState;
    this.subs.push(this.rt.on('live:signal').subscribe(e => {
      if (String(e['liveId']) === this.liveId && e['from'] === this.host) {
        const data = e['data'];
        this.chain = this.chain.then(() => this.handle(data)).catch(() => {});
      }
    }));
    this.rejoin();
  }

  rejoin(): void {
    this.rt.send({ type: 'live:join', liveId: this.liveId });
  }

  private async handle(data: any): Promise<void> {
    if (!data) return;
    if (data.sdp && data.sdp.type === 'offer') {
      try { this.pc?.close(); } catch { /* ignore */ }
      const pc = new RTCPeerConnection({ iceServers: this.iceServers });
      this.pc = pc;
      pc.ontrack = e => { if (e.streams[0]) this.onStream(e.streams[0]); };
      pc.onicecandidate = e => {
        if (e.candidate) this.rt.send({ type: 'live:signal', liveId: this.liveId, to: this.host, data: { candidate: e.candidate.toJSON() } });
      };
      pc.onconnectionstatechange = () => this.onState(pc.connectionState);
      await pc.setRemoteDescription(data.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.rt.send({ type: 'live:signal', liveId: this.liveId, to: this.host, data: { sdp: pc.localDescription!.toJSON() } });
    } else if (data.candidate && this.pc) {
      await this.pc.addIceCandidate(data.candidate).catch(() => {});
    }
  }

  stop(): void {
    this.rt.send({ type: 'live:leave', liveId: this.liveId });
    this.subs.forEach(s => s.unsubscribe());
    this.subs = [];
    try { this.pc?.close(); } catch { /* ignore */ }
    this.pc = null;
  }
}
