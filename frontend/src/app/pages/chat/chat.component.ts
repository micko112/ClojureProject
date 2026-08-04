import { Component, OnInit, OnDestroy, signal, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.css']
})
export class ChatComponent implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild('msgEnd') msgEnd!: ElementRef;
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  conversations: any[] = [];
  activeConv: any = null;
  messages: any[] = [];
  newMessage = '';
  sending = false;
  loading = false;
  messagesLoading = false;

  newChatUsername = '';
  showNewChat = false;
  searchResults: any[] = [];

  selectedImage: File | null = null;
  imagePreviewUrl: string | null = null;
  uploadingMedia = false;

  isRecording = false;
  recordingSeconds = 0;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: BlobPart[] = [];
  private recordingTimer: any;

  private searchTimer: any;
  private pollTimer: any;
  private shouldScroll = false;

  constructor(
    private api: ApiService,
    public auth: AuthService,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.loadConversations();
    this.pollTimer = setInterval(() => this.pollMessages(), 3000);
    this.route.queryParams.subscribe(p => {
      if (p['with']) this.startConvoWith(p['with']);
    });
  }

  ngOnDestroy(): void {
    clearInterval(this.pollTimer);
    clearInterval(this.recordingTimer);
    if (this.isRecording) this.mediaRecorder?.stop();
  }

  ngAfterViewChecked(): void {
    if (this.shouldScroll) {
      this.scrollToBottom();
      this.shouldScroll = false;
    }
  }

  private scrollToBottom(): void {
    try { this.msgEnd?.nativeElement?.scrollIntoView({ behavior: 'smooth' }); } catch (_) {}
  }

  loadConversations(): void {
    this.api.getConversations().subscribe({
      next: r => { this.conversations = r; },
      error: () => {}
    });
  }

  openConversation(conv: any): void {
    this.activeConv = conv;
    this.messagesLoading = true;
    this.showNewChat = false;
    this.api.getMessages(conv.id).subscribe({
      next: msgs => {
        this.messages = msgs;
        this.messagesLoading = false;
        this.shouldScroll = true;
        this.api.markConversationRead(conv.id).subscribe(() => {});
      },
      error: () => { this.messagesLoading = false; }
    });
  }

  private pollMessages(): void {
    if (!this.activeConv) return;
    this.api.getMessages(this.activeConv.id).subscribe({
      next: msgs => {
        if (msgs.length !== this.messages.length) {
          this.messages = msgs;
          this.shouldScroll = true;
          this.api.markConversationRead(this.activeConv.id).subscribe(() => {});
        }
      },
      error: () => {}
    });
    this.loadConversations();
  }

  private refreshMessages(): void {
    if (!this.activeConv) return;
    this.api.getMessages(this.activeConv.id).subscribe({
      next: msgs => { this.messages = msgs; this.shouldScroll = true; },
      error: () => {}
    });
    this.loadConversations();
  }

  send(): void {
    const content = this.newMessage.trim();
    if ((!content && !this.selectedImage) || this.sending || !this.activeConv) return;
    this.sending = true;
    const otherUsername = this.activeConv.other.username;

    if (this.selectedImage) {
      this.uploadingMedia = true;
      const fileToUpload = this.selectedImage;
      const mediaType = fileToUpload.type.startsWith('video/') ? 'video' : 'image';
      this.api.uploadFile(fileToUpload).subscribe({
        next: res => {
          this.uploadingMedia = false;
          this.api.sendMessage(otherUsername, content, res.url, mediaType).subscribe({
            next: () => {
              this.newMessage = '';
              this.selectedImage = null;
              this.imagePreviewUrl = null;
              this.sending = false;
              this.refreshMessages();
            },
            error: () => { this.sending = false; this.uploadingMedia = false; }
          });
        },
        error: () => { this.sending = false; this.uploadingMedia = false; }
      });
    } else {
      this.api.sendMessage(otherUsername, content).subscribe({
        next: () => {
          this.newMessage = '';
          this.sending = false;
          this.refreshMessages();
        },
        error: () => { this.sending = false; }
      });
    }
  }

  onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); }
  }

  onImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    this.selectedImage = input.files[0];
    const reader = new FileReader();
    reader.onload = e => { this.imagePreviewUrl = e.target?.result as string; };
    reader.readAsDataURL(this.selectedImage);
    input.value = '';
  }

  removeImagePreview(): void {
    this.selectedImage = null;
    this.imagePreviewUrl = null;
  }

  async toggleVoiceRecording(): Promise<void> {
    if (this.isRecording) {
      this.stopVoiceRecording();
    } else {
      await this.startVoiceRecording();
    }
  }

  private async startVoiceRecording(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      alert('Vaš pretraživač ne podržava snimanje zvuka.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioChunks = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
      this.mediaRecorder = new MediaRecorder(stream, { mimeType });
      this.mediaRecorder.ondataavailable = e => {
        if (e.data.size > 0) this.audioChunks.push(e.data);
      };
      this.mediaRecorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        this.sendVoiceMessage();
      };
      this.mediaRecorder.start();
      this.isRecording = true;
      this.recordingSeconds = 0;
      this.recordingTimer = setInterval(() => { this.recordingSeconds++; }, 1000);
    } catch {
      alert('Nije moguće pristupiti mikrofonu. Provjeri dozvole u pretraživaču.');
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
      this.isRecording = false;
      clearInterval(this.recordingTimer);
      this.audioChunks = [];
    }
  }

  private sendVoiceMessage(): void {
    if (!this.activeConv || !this.audioChunks.length) return;
    const mimeType = this.audioChunks[0] instanceof Blob
      ? (this.audioChunks[0] as Blob).type || 'audio/webm'
      : 'audio/webm';
    const ext = mimeType.includes('ogg') ? 'ogg' : 'webm';
    const blob = new Blob(this.audioChunks, { type: mimeType });
    const file = new File([blob], `voice_${Date.now()}.${ext}`, { type: mimeType });
    this.sending = true;
    this.api.uploadFile(file).subscribe({
      next: res => {
        const otherUsername = this.activeConv!.other.username;
        this.api.sendMessage(otherUsername, '', res.url, 'audio').subscribe({
          next: () => { this.sending = false; this.refreshMessages(); },
          error: () => { this.sending = false; }
        });
      },
      error: () => { this.sending = false; }
    });
  }

  formatRecordingTime(): string {
    const m = Math.floor(this.recordingSeconds / 60);
    const s = this.recordingSeconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  startConvoWith(username: string): void {
    this.api.getConversations().subscribe({
      next: convs => {
        this.conversations = convs;
        const existing = convs.find((c: any) => c.other?.username === username);
        if (existing) { this.openConversation(existing); return; }
        this.api.sendMessage(username, 'Hi!').subscribe({
          next: () => {
            this.api.getConversations().subscribe({
              next: c2 => {
                this.conversations = c2;
                const conv = c2.find((c: any) => c.other?.username === username);
                if (conv) this.openConversation(conv);
              },
              error: () => {}
            });
          },
          error: () => {}
        });
      },
      error: () => {}
    });
  }

  onNewChatInput(): void {
    clearTimeout(this.searchTimer);
    const q = this.newChatUsername.trim();
    if (!q) { this.searchResults = []; return; }
    this.searchTimer = setTimeout(() => {
      this.api.searchUsers(q).subscribe({
        next: r => { this.searchResults = r.filter(u => u.username !== this.auth.currentUser()?.username); },
        error: () => {}
      });
    }, 250);
  }

  selectUser(user: any): void {
    this.newChatUsername = '';
    this.searchResults = [];
    this.showNewChat = false;
    this.startConvoWith(user.username);
  }

  isMine(msg: any): boolean {
    return msg.sender?.username === this.auth.currentUser()?.username;
  }

  isImage(msg: any): boolean {
    return msg.mediaType === 'image';
  }

  isAudio(msg: any): boolean {
    return msg.mediaType === 'audio';
  }

  isVideo(msg: any): boolean {
    return msg.mediaType === 'video';
  }

  openMedia(url: string): void {
    window.open(url, '_blank');
  }

  convPreview(conv: any): string {
    const last = conv.lastMessage;
    if (!last) return 'No messages yet';
    if (last.mediaType === 'image') return '[Photo]';
    if (last.mediaType === 'audio') return '[Voice message]';
    if (last.mediaType === 'video') return '[Video]';
    return last.content || 'No messages yet';
  }

  timeAgo(dateStr: string): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  avatar(user: any): string {
    return user?.profilePic || user?.profile_pic || '';
  }

  initials(user: any): string {
    const name = user?.displayName || user?.username || '?';
    return name.charAt(0).toUpperCase();
  }
}
