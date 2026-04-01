import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { ApiService } from '../../services/api.service';
import { User } from '../../models/user.model';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent implements OnInit {
  tab: 'signin' | 'register' = 'signin';
  users: User[] = [];
  newUsername = '';
  error = '';
  success = '';
  loading = false;
  registering = false;

  constructor(private auth: AuthService, private api: ApiService) {}

  ngOnInit(): void {
    this.api.getUsers().subscribe({
      next: users => this.users = users.sort((a, b) => b.xp - a.xp),
      error: () => {}
    });
  }

  login(username: string): void {
    this.loading = true;
    this.error = '';
    this.auth.login(username).subscribe({
      error: err => {
        this.error = err?.error?.error || 'Login failed';
        this.loading = false;
      }
    });
  }

  register(): void {
    const username = this.newUsername.trim();
    if (!username) return;
    this.registering = true;
    this.error = '';
    this.api.createUser(username).subscribe({
      next: () => {
        this.success = `Account created! Signing in as ${username}...`;
        this.registering = false;
        setTimeout(() => this.login(username), 600);
      },
      error: err => {
        this.error = err?.error?.error || 'Registration failed';
        this.registering = false;
      }
    });
  }

  avatarColor(username: string): string {
    const colors = ['#7c6aff','#3b82f6','#22c55e','#f59e0b','#ef4444','#a855f7','#f97316','#10b981'];
    let hash = 0;
    for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }
}
