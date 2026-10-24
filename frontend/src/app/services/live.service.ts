import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface LiveUser { username: string; displayName?: string; profilePic?: string; }

export interface LiveComment { id: string; user: LiveUser; text: string; createdAt: string; }

export interface LiveInfo {
  id: string;
  host: LiveUser;
  title?: string;
  status: 'active' | 'ended';
  startedAt: string;
  endedAt?: string;
  viewerCount: number;
  hearts: number;
  comments?: LiveComment[];
}

export interface IceConfig {
  iceServers: RTCIceServer[];
  /** 'mesh' today; an SFU transport (e.g. 'livekit') can be added later. */
  transport: string;
  maxViewers: number;
}

/** HTTP client for web.live. OWNER: realtime agent. */
@Injectable({ providedIn: 'root' })
export class LiveService {
  private http = inject(HttpClient);

  active(): Observable<LiveInfo[]> { return this.http.get<LiveInfo[]>('/api/live'); }
  get(id: string): Observable<LiveInfo> { return this.http.get<LiveInfo>(`/api/live/${id}`); }
  start(title?: string): Observable<LiveInfo> { return this.http.post<LiveInfo>('/api/live', { title }); }
  end(id: string): Observable<LiveInfo> { return this.http.post<LiveInfo>(`/api/live/${id}/end`, {}); }
  iceConfig(): Observable<IceConfig> { return this.http.get<IceConfig>('/api/live/ice-servers'); }
}
