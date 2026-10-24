import { Injectable } from '@angular/core';
import { Observable, Subject, filter } from 'rxjs';

export interface RealtimeEvent { type: string; [k: string]: any; }

// WebSocket client. OWNER: realtime agent. Other features subscribe via on().
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private events$ = new Subject<RealtimeEvent>();

  on<T extends RealtimeEvent = RealtimeEvent>(type: string): Observable<T> {
    return this.events$.pipe(filter((e): e is T => e.type === type));
  }

  send(_event: RealtimeEvent): void {}
}
