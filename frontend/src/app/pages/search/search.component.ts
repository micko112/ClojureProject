import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { User } from '../../models/user.model';
import { Subject } from 'rxjs';
import { takeUntil, debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';

@Component({
  selector: 'app-search',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './search.component.html',
  styleUrls: ['./search.component.css']
})
export class SearchComponent implements OnInit, OnDestroy {
  query = '';
  results: User[] = [];
  loading = false;
  searched = false;
  followingSet = new Set<string>();
  me = '';
  private destroy$ = new Subject<void>();
  private search$ = new Subject<string>();

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.me = this.auth.currentUser()?.username || '';

    // Load who I follow
    if (this.me) {
      this.api.getFollowing(this.me).subscribe({
        next: following => following.forEach(u => this.followingSet.add(u)),
        error: () => {}
      });
    }

    // Reactive search with debounce
    this.search$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(q => {
        this.loading = true;
        return this.api.searchUsers(q);
      }),
      takeUntil(this.destroy$)
    ).subscribe({
      next: results => {
        this.results = results;
        this.loading = false;
        this.searched = true;
      },
      error: () => { this.loading = false; this.searched = true; }
    });

    // Pick up ?q= from URL
    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe(params => {
      const q = params.get('q') || '';
      this.query = q;
      if (q.trim()) this.search$.next(q.trim());
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onInput(): void {
    const q = this.query.trim();
    this.router.navigate([], { queryParams: { q }, replaceUrl: true });
    if (q) this.search$.next(q);
    else { this.results = []; this.searched = false; }
  }

  toggleFollow(user: User): void {
    if (user.username === this.me) return;
    this.api.toggleFollow(user.username).subscribe({
      next: res => {
        if (res.action === 'followed') this.followingSet.add(user.username);
        else this.followingSet.delete(user.username);
      },
      error: () => {}
    });
  }

  isFollowing(username: string): boolean {
    return this.followingSet.has(username);
  }

  avatarColor(username: string): string {
    const colors = ['#1a1a1a','#222222','#2a2a2a','#1f1f1f','#252525','#181818','#202020','#1c1c1c'];
    let hash = 0;
    for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }
}
