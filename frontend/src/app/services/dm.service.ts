import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface DmUser {
  username: string;
  displayName?: string;
  profilePic?: string;
  online?: boolean;
  lastActive?: string;
}

export interface DmReaction { username: string; emoji: string; }

export interface DmPostPreview {
  id: string;
  caption?: string;
  author?: DmUser;
  thumbnailUrl?: string;
  mediaType?: string;
  unavailable?: boolean;
}

export interface DmMessage {
  id: string;
  conversationId?: string;
  sender: DmUser;
  content?: string;
  mediaUrl?: string;
  mediaType?: string;
  createdAt: string;
  reactions?: DmReaction[];
  readBy?: string[];
  replyTo?: { id: string; sender?: DmUser; content?: string; mediaType?: string };
  postId?: string;
  post?: DmPostPreview;
}

export interface DmConversation {
  id: string;
  other: DmUser;
  lastMessage?: string;
  last?: { id: string; content?: string; mediaType?: string; mine?: boolean; createdAt?: string };
  lastMessageAt?: string;
  updatedAt?: string;
  seenBy: string[];
  isRequest: boolean;
  pending: boolean;
  unreadCount: number;
}

export interface SendMessageBody {
  to?: string;
  conversationId?: string;
  content?: string;
  mediaUrl?: string;
  mediaType?: string;
  replyToId?: string;
  postId?: string;
}

/** HTTP client for the DM endpoints in web.dm. OWNER: realtime agent. */
@Injectable({ providedIn: 'root' })
export class DmService {
  private http = inject(HttpClient);

  conversations(folder: 'primary' | 'requests' = 'primary'): Observable<DmConversation[]> {
    return this.http.get<DmConversation[]>('/api/conversations', { params: { folder } });
  }
  conversation(id: string): Observable<DmConversation> {
    return this.http.get<DmConversation>(`/api/conversations/${id}`);
  }
  messages(convId: string, opts: { before?: string; limit?: number } = {}): Observable<DmMessage[]> {
    let params = new HttpParams();
    if (opts.before) params = params.set('before', opts.before);
    if (opts.limit) params = params.set('limit', String(opts.limit));
    return this.http.get<DmMessage[]>(`/api/conversations/${convId}/messages`, { params });
  }
  send(body: SendMessageBody): Observable<DmMessage> {
    return this.http.post<DmMessage>('/api/messages', body);
  }
  markRead(convId: string): Observable<any> {
    return this.http.post(`/api/conversations/${convId}/read`, {});
  }
  accept(convId: string): Observable<DmConversation> {
    return this.http.post<DmConversation>(`/api/conversations/${convId}/accept`, {});
  }
  decline(convId: string): Observable<any> {
    return this.http.post(`/api/conversations/${convId}/decline`, {});
  }
  react(messageId: string, emoji: string): Observable<{ reactions: DmReaction[] }> {
    return this.http.post<{ reactions: DmReaction[] }>(`/api/messages/${messageId}/react`, { emoji });
  }
  unsend(messageId: string): Observable<any> {
    return this.http.delete(`/api/messages/${messageId}`);
  }
  sharePost(postId: string, to: string[], content?: string): Observable<{ sent: number; conversations: string[] }> {
    return this.http.post<{ sent: number; conversations: string[] }>('/api/messages/share', { postId, to, content });
  }
  unread(): Observable<{ count: number; requests: number }> {
    return this.http.get<{ count: number; requests: number }>('/api/messages/unread');
  }
  uploadFile(file: File): Observable<{ url: string }> {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.post<{ url: string }>('/api/upload', fd);
  }
}
