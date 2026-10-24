import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { PostViewComponent } from '../../components/post-view/post-view.component';
import { PostService } from '../../services/post.service';
import { Post } from '../../models/post.model';

@Component({
  selector: 'app-post-detail',
  standalone: true,
  imports: [RouterModule, PostViewComponent],
  templateUrl: './post-detail.component.html',
  styleUrls: ['./post-detail.component.css']
})
export class PostDetailComponent implements OnInit {
  post: Post | null = null;
  loading = true;

  constructor(private route: ActivatedRoute, private router: Router, private posts: PostService) {}

  ngOnInit(): void {
    this.route.paramMap.subscribe(pm => {
      const id = pm.get('id') || '';
      this.loading = true;
      this.post = null;
      this.posts.get(id).subscribe({
        next: p => { this.post = p; this.loading = false; },
        error: () => { this.loading = false; }
      });
    });
  }

  onRemoved(p: Post): void {
    this.router.navigate(['/profile', p.author?.username || '']);
  }
}
