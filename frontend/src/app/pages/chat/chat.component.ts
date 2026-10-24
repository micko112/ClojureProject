import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewChecked, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { RealtimeService, RealtimeEvent } from '../../services/realtime.service';
import { BadgesService } from '../../services/badges.service';
import { ToastService } from '../../services/toast.service';
import { DmService, DmConversation, DmMessage, DmUser } from '../../services/dm.service';

type Folder = 'primary' | 'requests';

/** Thread being viewed; `draft` when no conversation exists yet. */
interface ActiveThread extends DmConversation { draft?: boolean; }

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.css']
})
export class ChatComponent implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild('msgEnd') msgEnd!: ElementRef;
  @ViewChild('messagesArea') messagesArea!: ElementRef<HTMLElement>;
  @ViewChild('composer') composer!: ElementRef<HTMLTextAreaElement>;

  private api = inject(ApiService);
  private dm = inject(DmService);
  private rt = inject(RealtimeService);
  private badges = inject(BadgesService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  auth = inject(AuthService);

  readonly quickReactions = ['❤️', '😂', '😮', '😢', '🔥', '👏'];

  folder: Folder = 'primary';
  conversations: DmConversation[] = [];
  requests: DmConversation[] = [];
  listLoaded = false;

  active: ActiveThread | null = null;
  messages: DmMessage[] = [];
  messagesLoading = false;
  hasOlder = false;
  loadingOlder = false;

  newMessage = '';
  sending = false;
  replyTo: DmMessage | null = null;
  actionMsg: DmMessage | null = null;
  heartBurstId: string | null = null;

  /** conversationId -> username typing (cleared after a few seconds). */
  typing: Record<string, string> = {};
  private typingTimers: Record<string, any> = {};
  private lastTypingSent = 0;
  private stopTypingTimer: any;

  showNewChat = false;
  newChatQuery = '';
  searchResults: DmUser[] = [];
  private searchTimer: any;

  selectedImage: File | null = null;
  imagePreviewUrl: string | null = null;
  uploadingMedia = false;

  isRecording = false;
  recordingSeconds = 0;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: BlobPart[] = [];
  private recordingTimer: any;

  private subs: Subscription[] = [];
  private fallbackTimer: any;
  private shouldScroll = false;
  private lastTap: { id: string; t: number } | null = null;
  private pressTimer: any;
  private static readonly PAGE = 50;

  get me(): string | undefined { return this.auth.currentUser()?.username; }
  get list(): DmConversation[] { return this.folder === 'primary' ? this.conversations : this.requests; }

  ngOnInit(): void {
    this.loadLists();
    this.subs.push(
      this.route.queryParams.subscribe(p => {
        if (p['c']) this.openById(p['c']);
        else if (p['with']) this.openWith(p['with']);
        else this.closeThread();
      }),
      this.rt.on('message').subscribe(e => this.onMessageEvent(e)),
      this.rt.on('message:unsent').subscribe(e => this.onUnsent(e)),
      this.rt.on('message:reaction').subscribe(e => this.onReaction(e)),
      this.rt.on('seen').subscribe(e => this.onSeen(e)),
      this.rt.on('typing').subscribe(e => this.onTyping(e)),
      this.rt.on('presence').subscribe(e => this.onPresence(e)),
      this.rt.on('conversation:accepted').subscribe(() => this.loadLists()),
      this.rt.on('open').subscribe(e => { if (e['reconnect']) this.resync(); })
    );
    // Safety net while the socket is down: poll slowly.
    this.fallbackTimer = setInterval(() => { if (!this.rt.connected()) this.resync(); }, 10000);
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
    clearInterval(this.fallbackTimer);
    clearInterval(this.recordingTimer);
    clearTimeout(this.stopTypingTimer);
    Object.values(this.typingTimers).forEach(t => clearTimeout(t));
    if (this.isRecording) this.mediaRecorder?.stop();
    this.sendTyping(false);
    this.badges.activeConversationId.set(null);
  }

  ngAfterViewChecked(): void {
    if (this.shouldScroll) {
      this.shouldScroll = false;
      try { this.msgEnd?.nativeElement?.scrollIntoView({ block: 'end' }); } catch { /* ignore */ }
    }
  }

  // ===== lists =====

  loadLists(): void {
    this.dm.conversations('primary').subscribe({
      next: r => { this.conversations = r; this.listLoaded = true; this.syncActiveFromList(); },
      error: () => { this.listLoaded = true; }
    });
    this.dm.conversations('requests').subscribe({ next: r => this.requests = r, error: () => {} });
  }

  setFolder(f: Folder): void { this.folder = f; }

  private syncActiveFromList(): void {
    if (!this.active || this.active.draft) return;
    const fresh = [...this.conversations, ...this.requests].find(c => c.id === this.active!.id);
    if (fresh) this.active = { ...this.active, ...fresh };
  }

  private upsertConversation(c: DmConversation): void {
    const target = c.isRequest ? 'requests' : 'conversations';
    const other = c.isRequest ? 'conversations' : 'requests';
    this[other] = this[other].filter(x => x.id !== c.id);
    this[target] = [c, ...this[target].filter(x => x.id !== c.id)];
  }

  private resync(): void {
    this.loadLists();
    if (this.active && !this.active.draft) this.reloadMessages();
  }

  // ===== opening threads =====

  open(c: DmConversation): void {
    this.router.navigate([], { relativeTo: this.route, queryParams: { c: c.id } });
  }

  backToList(): void {
    this.router.navigate([], { relativeTo: this.route, queryParams: {} });
  }

  private closeThread(): void {
    this.sendTyping(false);
    this.active = null;
    this.messages = [];
    this.replyTo = null;
    this.actionMsg = null;
    this.badges.activeConversationId.set(null);
  }

  private openById(id: string): void {
    if (this.active?.id === id && !this.active.draft) return;
    const known = [...this.conversations, ...this.requests].find(c => c.id === id);
    if (known) { this.showThread(known); return; }
    this.dm.conversation(id).subscribe({
      next: c => this.showThread(c),
      error: () => { this.toast.error('Conversation not found'); this.backToList(); }
    });
  }

  private openWith(username: string): void {
    if (username === this.me) return;
    this.dm.conversations('primary').subscribe({
      next: list => {
        this.conversations = list;
        const existing = [...list, ...this.requests].find(c => c.other?.username === username);
        if (existing) { this.router.navigate([], { relativeTo: this.route, queryParams: { c: existing.id }, replaceUrl: true }); return; }
        this.api.getProfile(username).subscribe({
          next: (p: any) => {
            const u = p?.user || p;
            this.closeThread();
            this.active = {
              id: '', draft: true, seenBy: [], isRequest: false, pending: false, unreadCount: 0,
              other: { username, displayName: u?.displayName, profilePic: u?.profilePic }
            };
          },
          error: () => this.toast.error('User not found')
        });
      }
    });
  }

  private showThread(c: DmConversation): void {
    this.sendTyping(false);
    this.active = c;
    this.replyTo = null;
    this.actionMsg = null;
    this.messages = [];
    this.badges.activeConversationId.set(c.id);
    if (c.isRequest) this.folder = 'requests';
    this.reloadMessages(true);
  }

  private reloadMessages(initial = false): void {
    const conv = this.active;
    if (!conv || conv.draft) return;
    if (initial) this.messagesLoading = true;
    this.dm.messages(conv.id, { limit: ChatComponent.PAGE }).subscribe({
      next: msgs => {
        if (this.active?.id !== conv.id) return;
        const grew = msgs.length !== this.messages.length || msgs.at(-1)?.id !== this.messages.at(-1)?.id;
        this.messages = msgs;
        this.hasOlder = msgs.length >= ChatComponent.PAGE;
        this.messagesLoading = false;
        if (initial || grew) this.shouldScroll = true;
        this.markReadIfVisible();
      },
      error: () => { this.messagesLoading = false; }
    });
  }

  loadOlder(): void {
    if (!this.active || this.active.draft || this.loadingOlder || !this.messages.length) return;
    this.loadingOlder = true;
    const area = this.messagesArea?.nativeElement;
    const prevHeight = area?.scrollHeight ?? 0;
    this.dm.messages(this.active.id, { before: this.messages[0].id, limit: ChatComponent.PAGE }).subscribe({
      next: older => {
        this.messages = [...older, ...this.messages];
        this.hasOlder = older.length >= ChatComponent.PAGE;
        this.loadingOlder = false;
        setTimeout(() => { if (area) area.scrollTop = area.scrollHeight - prevHeight; });
      },
      error: () => { this.loadingOlder = false; }
    });
  }

  private markReadIfVisible(): void {
    const c = this.active;
    if (!c || c.draft || document.visibilityState !== 'visible') return;
    const unread = this.messages.some(m => m.sender?.username !== this.me && !(m.readBy || []).includes(this.me!));
    if (!unread && !c.unreadCount) return;
    this.dm.markRead(c.id).subscribe({
      next: () => {
        this.messages = this.messages.map(m => (m.readBy || []).includes(this.me!) ? m : { ...m, readBy: [...(m.readBy || []), this.me!] });
        const clear = (l: DmConversation[]) => l.map(x => x.id === c.id ? { ...x, unreadCount: 0 } : x);
        this.conversations = clear(this.conversations);
        this.requests = clear(this.requests);
        this.badges.refreshMessagesSoon();
      },
      error: () => {}
    });
  }

  // ===== realtime events =====

  private onMessageEvent(e: RealtimeEvent): void {
    const conv: DmConversation | undefined = e['conversation'];
    const msg: DmMessage = e['message'];
    if (conv) this.upsertConversation(conv);
    if (this.active?.draft && conv && conv.other?.username === this.active.other.username) {
      this.router.navigate([], { relativeTo: this.route, queryParams: { c: conv.id }, replaceUrl: true });
      return;
    }
    if (this.active && this.active.id === e['conversationId']) {
      if (conv) this.active = { ...this.active, ...conv };
      if (!this.messages.some(m => m.id === msg.id)) {
        this.messages = [...this.messages, msg];
        this.shouldScroll = true;
      }
      if (msg.sender?.username !== this.me) {
        this.clearTyping(e['conversationId']);
        this.markReadIfVisible();
      }
    }
  }

  private onUnsent(e: RealtimeEvent): void {
    if (e['conversation']) {
      const c: DmConversation = e['conversation'];
      const patch = (l: DmConversation[]) => l.map(x => x.id === c.id ? c : x);
      this.conversations = patch(this.conversations);
      this.requests = patch(this.requests);
    }
    if (this.active?.id === e['conversationId']) {
      this.messages = this.messages.filter(m => m.id !== e['messageId']);
      if (this.replyTo?.id === e['messageId']) this.replyTo = null;
    }
  }

  private onReaction(e: RealtimeEvent): void {
    if (this.active?.id !== e['conversationId']) return;
    this.messages = this.messages.map(m => m.id === e['messageId'] ? { ...m, reactions: e['reactions'] } : m);
  }

  private onSeen(e: RealtimeEvent): void {
    const by: string = e['by'];
    const addSeen = (c: DmConversation) => c.id === e['conversationId'] && c.last?.mine
      ? { ...c, seenBy: Array.from(new Set([...(c.seenBy || []), by])) } : c;
    this.conversations = this.conversations.map(addSeen);
    this.requests = this.requests.map(addSeen);
    if (this.active?.id === e['conversationId']) {
      this.active = addSeen(this.active!) as ActiveThread;
      this.messages = this.messages.map(m => (m.readBy || []).includes(by) ? m : { ...m, readBy: [...(m.readBy || []), by] });
    }
  }

  private onTyping(e: RealtimeEvent): void {
    const cid = e['conversationId'];
    if (!cid) return;
    if (e['typing']) {
      this.typing = { ...this.typing, [cid]: e['username'] };
      clearTimeout(this.typingTimers[cid]);
      this.typingTimers[cid] = setTimeout(() => this.clearTyping(cid), 6000);
      if (this.active?.id === cid) this.shouldScroll = this.isNearBottom();
    } else {
      this.clearTyping(cid);
    }
  }

  private clearTyping(cid: string): void {
    if (!this.typing[cid]) return;
    const { [cid]: _, ...rest } = this.typing;
    this.typing = rest;
  }

  private onPresence(e: RealtimeEvent): void {
    const patch = (c: DmConversation) => c.other?.username === e['username']
      ? { ...c, other: { ...c.other, online: e['online'], lastActive: e['lastActive'] } } : c;
    this.conversations = this.conversations.map(patch);
    this.requests = this.requests.map(patch);
    if (this.active) this.active = patch(this.active) as ActiveThread;
  }

  private isNearBottom(): boolean {
    const a = this.messagesArea?.nativeElement;
    return !a || a.scrollHeight - a.scrollTop - a.clientHeight < 120;
  }

  // ===== typing =====

  onComposerInput(): void {
    if (!this.active || this.active.draft) return;
    const now = Date.now();
    if (this.newMessage.trim() && now - this.lastTypingSent > 3000) {
      this.lastTypingSent = now;
      this.rt.send({ type: 'typing', conversationId: this.active.id, typing: true });
    }
    clearTimeout(this.stopTypingTimer);
    this.stopTypingTimer = setTimeout(() => this.sendTyping(false), 4000);
  }

  private sendTyping(on: boolean): void {
    clearTimeout(this.stopTypingTimer);
    if (!on && this.lastTypingSent && this.active && !this.active.draft) {
      this.rt.send({ type: 'typing', conversationId: this.active.id, typing: false });
    }
    if (!on) this.lastTypingSent = 0;
  }

  // ===== sending =====

  onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); }
    if (e.key === 'Escape' && this.replyTo) { this.replyTo = null; }
  }

  send(): void {
    const content = this.newMessage.trim();
    if ((!content && !this.selectedImage) || this.sending || !this.active) return;
    this.sending = true;
    if (this.selectedImage) {
      const file = this.selectedImage;
      const mediaType = file.type.startsWith('video/') ? 'video' : 'image';
      this.uploadingMedia = true;
      this.dm.uploadFile(file).subscribe({
        next: res => { this.uploadingMedia = false; this.post({ content, mediaUrl: res.url, mediaType }); },
        error: () => { this.sending = false; this.uploadingMedia = false; this.toast.error('Upload failed'); }
      });
    } else {
      this.post({ content });
    }
  }

  private post(body: { content?: string; mediaUrl?: string; mediaType?: string }): void {
    const conv = this.active!;
    const target = conv.draft ? { to: conv.other.username } : { conversationId: conv.id };
    this.sendTyping(false);
    this.dm.send({ ...target, ...body, replyToId: this.replyTo?.id }).subscribe({
      next: msg => {
        this.sending = false;
        this.newMessage = '';
        this.replyTo = null;
        this.selectedImage = null;
        this.imagePreviewUrl = null;
        if (conv.draft && msg.conversationId) {
          this.loadLists();
          this.router.navigate([], { relativeTo: this.route, queryParams: { c: msg.conversationId }, replaceUrl: true });
          return;
        }
        if (this.active?.id === conv.id && !this.messages.some(m => m.id === msg.id)) {
          this.messages = [...this.messages, msg];
        }
        this.shouldScroll = true;
        // accepting a request by replying moves it to Primary
        if (conv.isRequest) { this.active = { ...conv, isRequest: false }; this.folder = 'primary'; this.loadLists(); }
        setTimeout(() => this.composer?.nativeElement?.focus());
      },
      error: err => {
        this.sending = false;
        this.toast.error(err?.error?.error || 'Message not sent');
      }
    });
  }

  // ===== message actions =====

  onBubbleTap(m: DmMessage): void {
    const now = Date.now();
    if (this.lastTap && this.lastTap.id === m.id && now - this.lastTap.t < 320) {
      this.lastTap = null;
      this.doubleTapHeart(m);
    } else {
      this.lastTap = { id: m.id, t: now };
    }
  }

  private doubleTapHeart(m: DmMessage): void {
    this.heartBurstId = m.id;
    setTimeout(() => { if (this.heartBurstId === m.id) this.heartBurstId = null; }, 800);
    if (this.myReaction(m) === '❤️') return;
    this.react(m, '❤️');
  }

  onPressStart(m: DmMessage): void {
    clearTimeout(this.pressTimer);
    this.pressTimer = setTimeout(() => { this.actionMsg = m; navigator.vibrate?.(10); }, 450);
  }
  onPressEnd(): void { clearTimeout(this.pressTimer); }

  openActions(m: DmMessage, e?: Event): void {
    e?.preventDefault();
    e?.stopPropagation();
    this.actionMsg = m;
  }
  closeActions(): void { this.actionMsg = null; }

  myReaction(m: DmMessage): string | undefined {
    return m.reactions?.find(r => r.username === this.me)?.emoji;
  }

  react(m: DmMessage, emoji: string): void {
    this.actionMsg = null;
    const mine = this.myReaction(m);
    // optimistic
    const others = (m.reactions || []).filter(r => r.username !== this.me);
    const next = mine === emoji ? others : [...others, { username: this.me!, emoji }];
    this.messages = this.messages.map(x => x.id === m.id ? { ...x, reactions: next } : x);
    this.dm.react(m.id, emoji).subscribe({
      next: r => this.messages = this.messages.map(x => x.id === m.id ? { ...x, reactions: r.reactions } : x),
      error: () => this.toast.error('Could not react')
    });
  }

  reactionSummary(m: DmMessage): { emoji: string; count: number }[] {
    const map = new Map<string, number>();
    (m.reactions || []).forEach(r => map.set(r.emoji, (map.get(r.emoji) || 0) + 1));
    return Array.from(map, ([emoji, count]) => ({ emoji, count }));
  }

  startReply(m: DmMessage): void {
    this.actionMsg = null;
    this.replyTo = m;
    setTimeout(() => this.composer?.nativeElement?.focus());
  }

  unsend(m: DmMessage): void {
    this.actionMsg = null;
    if (!confirm('Unsend this message? It will be removed for everyone.')) return;
    this.dm.unsend(m.id).subscribe({
      next: () => this.messages = this.messages.filter(x => x.id !== m.id),
      error: () => this.toast.error('Could not unsend')
    });
  }

  copyText(m: DmMessage): void {
    this.actionMsg = null;
    if (m.content) navigator.clipboard?.writeText(m.content).then(() => this.toast.success('Copied'), () => {});
  }

  scrollToMessage(id: string): void {
    const el = document.getElementById('msg-' + id);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.classList.add('flash');
    setTimeout(() => el?.classList.remove('flash'), 1200);
  }

  // ===== requests =====

  accept(): void {
    if (!this.active) return;
    this.dm.accept(this.active.id).subscribe({
      next: c => { this.active = { ...this.active!, ...c, isRequest: false }; this.folder = 'primary'; this.loadLists(); this.badges.refreshMessagesSoon(); },
      error: () => this.toast.error('Could not accept')
    });
  }

  decline(): void {
    if (!this.active) return;
    const id = this.active.id;
    this.dm.decline(id).subscribe({
      next: () => { this.requests = this.requests.filter(r => r.id !== id); this.backToList(); this.badges.refreshMessagesSoon(); },
      error: () => this.toast.error('Could not decline')
    });
  }

  // ===== new chat =====

  toggleNewChat(): void {
    this.showNewChat = !this.showNewChat;
    this.newChatQuery = '';
    this.searchResults = [];
  }

  onNewChatInput(): void {
    clearTimeout(this.searchTimer);
    const q = this.newChatQuery.trim();
    if (!q) { this.searchResults = []; return; }
    this.searchTimer = setTimeout(() => {
      this.api.searchUsers(q).subscribe({
        next: r => { this.searchResults = (r as DmUser[]).filter(u => u.username !== this.me); },
        error: () => {}
      });
    }, 250);
  }

  selectUser(user: DmUser): void {
    this.showNewChat = false;
    this.newChatQuery = '';
    this.searchResults = [];
    this.router.navigate([], { relativeTo: this.route, queryParams: { with: user.username } });
  }

  // ===== media =====

  onImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    this.selectedImage = input.files[0];
    const reader = new FileReader();
    reader.onload = e => { this.imagePreviewUrl = e.target?.result as string; };
    reader.readAsDataURL(this.selectedImage);
    input.value = '';
  }

  removeImagePreview(): void { this.selectedImage = null; this.imagePreviewUrl = null; }

  async toggleVoiceRecording(): Promise<void> {
    if (this.isRecording) this.stopVoiceRecording(); else await this.startVoiceRecording();
  }

  private async startVoiceRecording(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) { this.toast.error('Your browser does not support audio recording.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioChunks = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
      this.mediaRecorder = new MediaRecorder(stream, { mimeType });
      this.mediaRecorder.ondataavailable = e => { if (e.data.size > 0) this.audioChunks.push(e.data); };
      this.mediaRecorder.onstop = () => { stream.getTracks().forEach(t => t.stop()); this.sendVoiceMessage(); };
      this.mediaRecorder.start();
      this.isRecording = true;
      this.recordingSeconds = 0;
      this.recordingTimer = setInterval(() => { this.recordingSeconds++; }, 1000);
    } catch {
      this.toast.error('Microphone access denied. Check your browser permissions.');
    }
  }

  private stopVoiceRecording(): void {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      this.isRecording = false;
      clearInterval(this.recordingTimer);
    }
  }

  cancelVoiceRecording(): void {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.onstop = null;
      this.mediaRecorder.stop();
      this.mediaRecorder.stream.getTracks().forEach(t => t.stop());
      this.isRecording = false;
      clearInterval(this.recordingTimer);
      this.audioChunks = [];
    }
  }

  private sendVoiceMessage(): void {
    if (!this.active || !this.audioChunks.length) return;
    const mimeType = (this.audioChunks[0] as Blob).type || 'audio/webm';
    const ext = mimeType.includes('ogg') ? 'ogg' : 'webm';
    const file = new File([new Blob(this.audioChunks, { type: mimeType })], `voice_${Date.now()}.${ext}`, { type: mimeType });
    this.sending = true;
    this.dm.uploadFile(file).subscribe({
      next: res => this.post({ content: '', mediaUrl: res.url, mediaType: 'audio' }),
      error: () => { this.sending = false; this.toast.error('Upload failed'); }
    });
  }

  formatRecordingTime(): string {
    const m = Math.floor(this.recordingSeconds / 60);
    const s = this.recordingSeconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // ===== view helpers =====

  isMine(m: DmMessage): boolean { return m.sender?.username === this.me; }

  /** Up to 3 emoji and nothing else -> rendered big without a bubble. */
  isEmojiOnly(m: DmMessage): boolean {
    const c = m.content?.trim();
    if (!c || m.mediaType || m.post || c.length > 12) return false;
    return /^(\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️){1,12}$/u.test(c)
      && !/[0-9#*]/.test(c) && Array.from(c.replace(/[‍️]/g, '')).length <= 6;
  }

  /** Show the sender avatar only on the last bubble of a run. */
  isRunEnd(i: number): boolean {
    const m = this.messages[i], n = this.messages[i + 1];
    return !n || n.sender?.username !== m.sender?.username || this.gapMinutes(m, n) > 10;
  }

  showTimeSeparator(i: number): boolean {
    if (i === 0) return true;
    return this.gapMinutes(this.messages[i - 1], this.messages[i]) > 30;
  }

  private gapMinutes(a: DmMessage, b: DmMessage): number {
    return (new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) / 60000;
  }

  separatorLabel(dateStr: string): string {
    const d = new Date(dateStr);
    const now = new Date();
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === now.toDateString()) return `Today ${time}`;
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return `Yesterday ${time}`;
    if (now.getTime() - d.getTime() < 6 * 86400000) return `${d.toLocaleDateString([], { weekday: 'long' })} ${time}`;
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' })} ${time}`;
  }

  /** "Seen" / "Sent" under my last message. */
  receiptFor(i: number): string | null {
    if (!this.active || i !== this.messages.length - 1) return null;
    const m = this.messages[i];
    if (!this.isMine(m)) return null;
    const other = this.active.other?.username;
    if ((m.readBy || []).includes(other) || (this.active.seenBy || []).includes(other)) return 'Seen';
    return 'Sent';
  }

  statusLine(u: DmUser | undefined): string {
    if (!u) return '';
    if (u.online) return 'Active now';
    if (!u.lastActive) return '';
    const mins = (Date.now() - new Date(u.lastActive).getTime()) / 60000;
    if (mins < 1) return 'Active just now';
    if (mins < 60) return `Active ${Math.floor(mins)}m ago`;
    if (mins < 1440) return `Active ${Math.floor(mins / 60)}h ago`;
    if (mins < 7 * 1440) return `Active ${Math.floor(mins / 1440)}d ago`;
    return '';
  }

  convPreview(c: DmConversation): string {
    if (this.typing[c.id]) return 'typing…';
    const text = c.last?.content || c.lastMessage;
    if (!text) return c.isRequest ? 'Wants to send you a message' : 'Say hi 👋';
    if (c.last?.mine) {
      if (c.seenBy?.length) return 'Seen';
      return `You: ${text}`;
    }
    return text;
  }

  timeAgo(dateStr?: string): string {
    if (!dateStr) return '';
    const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
    if (diff < 60) return 'now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h';
    if (diff < 7 * 86400) return Math.floor(diff / 86400) + 'd';
    return Math.floor(diff / (7 * 86400)) + 'w';
  }

  replySnippet(m: DmMessage['replyTo'] | DmMessage | null): string {
    if (!m) return '';
    const anyM = m as any;
    if (anyM.content) return anyM.content;
    if (anyM.postId) return 'Shared a post';
    if (anyM.mediaType === 'image') return 'Photo';
    if (anyM.mediaType === 'video') return 'Video';
    if (anyM.mediaType === 'audio') return 'Voice message';
    return 'Message';
  }

  replyAuthor(m: DmMessage): string {
    const r = m.replyTo;
    if (!r) return '';
    const mine = this.isMine(m);
    const toSelf = r.sender?.username === m.sender?.username;
    if (mine) return toSelf ? 'You replied to yourself' : `You replied to ${r.sender?.displayName || r.sender?.username}`;
    return toSelf ? 'Replied to themselves' : 'Replied to you';
  }

  avatar(user: any): string { return user?.profilePic || ''; }
  initials(user: any): string { return (user?.displayName || user?.username || '?').charAt(0).toUpperCase(); }
  trackId(_: number, x: { id: string }): string { return x.id; }
}
