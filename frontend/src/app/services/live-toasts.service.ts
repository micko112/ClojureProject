import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { BadgesService } from './badges.service';
import { RealtimeService } from './realtime.service';
import { ToastService } from './toast.service';

/**
 * In-app toasts for live notifications and incoming DMs.
 * Instantiated once from AppComponent. OWNER: realtime agent.
 */
@Injectable({ providedIn: 'root' })
export class LiveToastsService {
  private rt = inject(RealtimeService);
  private toast = inject(ToastService);
  private auth = inject(AuthService);
  private badges = inject(BadgesService);
  private router = inject(Router);

  constructor() {
    this.rt.on('notification').subscribe(e => {
      if (this.router.url.startsWith('/notifications')) return;
      const n = e['notification'];
      if (n?.message) this.toast.info(n.message);
    });

    this.rt.on('message').subscribe(e => {
      const msg = e['message'];
      const me = this.auth.currentUser()?.username;
      if (!msg || msg.sender?.username === me) return;
      const onChat = this.router.url.startsWith('/chat');
      if (onChat && this.badges.activeConversationId() === e['conversationId']) return;
      const who = msg.sender?.displayName || msg.sender?.username || 'Someone';
      if (e['conversation']?.isRequest) {
        if (!onChat) this.toast.info(`New message request from ${who}`);
        return;
      }
      const text = msg.content
        || (msg.postId ? 'sent you a post'
          : msg.mediaType === 'image' ? 'sent a photo'
          : msg.mediaType === 'video' ? 'sent a video'
          : msg.mediaType === 'audio' ? 'sent a voice message' : 'sent a message');
      this.toast.info(`${who}: ${text.length > 80 ? text.slice(0, 80) + '…' : text}`);
    });
  }
}
