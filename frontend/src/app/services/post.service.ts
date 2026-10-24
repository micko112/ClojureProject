import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  CommentPage, HashtagPage, Page, Post, PostComment, Streak, UpdatePostRequest
} from '../models/post.model';

/** Posts area endpoints (feed, explore, hashtags, comments, reactions, streaks). */
@Injectable({ providedIn: 'root' })
export class PostService {
  constructor(private http: HttpClient) {}

  private page(cursor?: string | null, limit?: number): HttpParams {
    let p = new HttpParams();
    if (cursor) p = p.set('cursor', cursor);
    if (limit) p = p.set('limit', limit);
    return p;
  }

  feed(cursor?: string | null, limit = 10): Observable<Page<Post>> {
    return this.http.get<Page<Post>>('/api/feed', { params: this.page(cursor, limit) });
  }
  explore(cursor?: string | null, limit = 24): Observable<Page<Post>> {
    return this.http.get<Page<Post>>('/api/explore', { params: this.page(cursor, limit) });
  }
  hashtag(tag: string, cursor?: string | null, limit = 24): Observable<HashtagPage> {
    return this.http.get<HashtagPage>(`/api/hashtags/${encodeURIComponent(tag)}`, { params: this.page(cursor, limit) });
  }
  searchHashtags(q: string): Observable<{ tag: string; count: number }[]> {
    return this.http.get<{ tag: string; count: number }[]>('/api/hashtags/search', { params: { q } });
  }
  userPosts(username: string, cursor?: string | null, limit = 12): Observable<Page<Post> & { private?: boolean }> {
    return this.http.get<Page<Post> & { private?: boolean }>(`/api/users/${username}/posts`, { params: this.page(cursor, limit) });
  }
  archived(cursor?: string | null): Observable<Page<Post>> {
    return this.http.get<Page<Post>>('/api/posts/archived', { params: this.page(cursor) });
  }

  get(id: string): Observable<Post> { return this.http.get<Post>(`/api/posts/${id}`); }
  update(id: string, body: UpdatePostRequest): Observable<Post> { return this.http.put<Post>(`/api/posts/${id}`, body); }
  remove(id: string): Observable<any> { return this.http.delete(`/api/posts/${id}`); }
  toggleArchive(id: string): Observable<{ archived: boolean }> {
    return this.http.post<{ archived: boolean }>(`/api/posts/${id}/archive`, {});
  }
  like(id: string): Observable<{ likes: string[]; liked: boolean; likeCount: number }> {
    return this.http.post<{ likes: string[]; liked: boolean; likeCount: number }>(`/api/posts/${id}/like`, {});
  }
  react(id: string, emoji: string): Observable<{ reactions: Record<string, number>; myReaction: string | null }> {
    return this.http.post<{ reactions: Record<string, number>; myReaction: string | null }>(`/api/posts/${id}/react`, { emoji });
  }
  save(id: string, saved: boolean): Observable<any> {
    return this.http.post(`/api/posts/${id}/${saved ? 'save' : 'unsave'}`, {});
  }

  comments(postId: string, cursor?: string | null, limit = 20): Observable<CommentPage> {
    return this.http.get<CommentPage>(`/api/posts/${postId}/comments`, { params: this.page(cursor, limit) });
  }
  addComment(postId: string, content: string, parentId?: string | null): Observable<PostComment> {
    return this.http.post<PostComment>(`/api/posts/${postId}/comments`, { content, parentId: parentId || undefined });
  }
  deleteComment(id: string): Observable<any> { return this.http.delete(`/api/comments/${id}`); }
  likeComment(id: string): Observable<{ liked: boolean; likeCount: number }> {
    return this.http.post<{ liked: boolean; likeCount: number }>(`/api/comments/${id}/like`, {});
  }

  myStreak(): Observable<Streak> { return this.http.get<Streak>('/api/me/streak'); }
  userStreak(username: string): Observable<Streak> { return this.http.get<Streak>(`/api/users/${username}/streak`); }
}
