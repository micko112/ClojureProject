import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { ReelViewerComponent } from '../../components/reel-viewer/reel-viewer.component';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, ReelViewerComponent],
  templateUrl: './profile.component.html',
  styleUrls: ['./profile.component.css']
})
export class ProfileComponent implements OnInit {
  profile: any = null;
  activities: any[] = [];
  badges: any[] = [];
  userPosts: any[] = [];
  savedPosts: any[] = [];
  loading = true;
  postsLoading = false;
  savedLoading = false;
  isFollowing = false;
  followLoading = false;
  isMe = false;

  activeTab: 'posts' | 'saved' = 'posts';

  // Reel viewer
  reelOpen = false;
  reelPosts: any[] = [];
  reelStartIndex = 0;

  showEdit = false;
  editName = '';
  editBio = '';
  editWebsite = '';
  editPicUrl = '';
  saving = false;

  constructor(
    private api: ApiService,
    public auth: AuthService,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.route.params.subscribe(p => this.loadProfile(p['username']));
  }

  loadProfile(username: string): void {
    this.loading = true;
    this.activeTab = 'posts';
    this.api.getProfile(username).subscribe({
      next: p => {
        this.profile = p;
        this.loading = false;
        this.isMe = p.username === this.auth.currentUser()?.username;
        this.isFollowing = p.isFollowing || false;
        this.activities = p.activities || [];
        this.badges = p.badges || [];
        this.loadUserPosts(username);
      },
      error: () => { this.loading = false; }
    });
    this.api.getBadges(username).subscribe({
      next: b => { this.badges = b; },
      error: () => {}
    });
  }

  loadUserPosts(username: string): void {
    this.postsLoading = true;
    this.api.getUserPosts(username).subscribe({
      next: posts => { this.userPosts = posts; this.postsLoading = false; },
      error: () => { this.postsLoading = false; }
    });
  }

  setTab(tab: 'posts' | 'saved'): void {
    this.activeTab = tab;
    if (tab === 'saved' && this.savedPosts.length === 0 && !this.savedLoading) {
      this.savedLoading = true;
      this.api.getSavedPosts().subscribe({
        next: posts => { this.savedPosts = posts; this.savedLoading = false; },
        error: () => { this.savedLoading = false; }
      });
    }
  }

  openReel(post: any, allPosts: any[]): void {
    const others = allPosts.filter(p => p.id !== post.id);
    this.reelPosts = [post, ...others];
    this.reelStartIndex = 0;
    this.reelOpen = true;
  }

  closeReel(): void { this.reelOpen = false; }

  onReelSaved(ev: { id: string; saved: boolean }): void {
    const inPosts = this.userPosts.find(p => p.id === ev.id);
    if (inPosts) inPosts.saved = ev.saved;
    const inSaved = this.savedPosts.find(p => p.id === ev.id);
    if (inSaved) inSaved.saved = ev.saved;
    if (!ev.saved) this.savedPosts = this.savedPosts.filter(p => p.id !== ev.id);
  }

  toggleFollow(): void {
    if (this.followLoading) return;
    this.followLoading = true;
    this.api.toggleFollow(this.profile.username).subscribe({
      next: r => {
        this.isFollowing = r.action === 'followed';
        if (this.isFollowing) this.profile.followersCount = (this.profile.followersCount || 0) + 1;
        else this.profile.followersCount = Math.max(0, (this.profile.followersCount || 1) - 1);
        this.followLoading = false;
      },
      error: () => { this.followLoading = false; }
    });
  }

  openEdit(): void {
    this.editName = this.profile.displayName || '';
    this.editBio = this.profile.bio || '';
    this.editWebsite = this.profile.website || '';
    this.editPicUrl = this.profile.profilePic || '';
    this.showEdit = true;
  }

  saveEdit(): void {
    if (this.saving) return;
    this.saving = true;
    this.api.updateProfile({
      displayName: this.editName,
      bio: this.editBio,
      website: this.editWebsite,
      profilePic: this.editPicUrl
    }).subscribe({
      next: () => {
        this.saving = false;
        this.showEdit = false;
        this.loadProfile(this.profile.username);
        this.auth.refresh();
      },
      error: () => { this.saving = false; }
    });
  }

  isVideo(url: string): boolean {
    return url ? /\.(mp4|webm|mov)$/i.test(url) : false;
  }

  initials(): string {
    return (this.profile?.displayName || this.profile?.username || '?').charAt(0).toUpperCase();
  }

  messageUser(): void {
    window.location.href = `/chat?with=${this.profile.username}`;
  }
}
