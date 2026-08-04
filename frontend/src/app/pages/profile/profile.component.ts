import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './profile.component.html',
  styleUrls: ['./profile.component.css']
})
export class ProfileComponent implements OnInit {
  profile: any = null;
  activities: any[] = [];
  badges: any[] = [];
  loading = true;
  isFollowing = false;
  followLoading = false;
  isMe = false;

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
    this.api.getProfile(username).subscribe({
      next: p => {
        this.profile = p;
        this.loading = false;
        this.isMe = p.username === this.auth.currentUser()?.username;
        this.isFollowing = p.isFollowing || false;
        this.activities = p.activities || [];
        this.badges = p.badges || [];
      },
      error: () => { this.loading = false; }
    });
    this.api.getBadges(username).subscribe({
      next: b => { this.badges = b; },
      error: () => {}
    });
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

  initials(): string {
    return (this.profile?.displayName || this.profile?.username || '?').charAt(0).toUpperCase();
  }

  messageUser(): void {
    window.location.href = `/chat?with=${this.profile.username}`;
  }
}
