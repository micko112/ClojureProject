import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { RouterModule } from '@angular/router';
import { CaptionSegment, captionSegments } from '../post-card/post-utils';

/**
 * Caption / comment text with clickable #hashtags and @mentions, an optional
 * bold author prefix, and Instagram-style "… more" truncation.
 */
@Component({
  selector: 'app-caption',
  standalone: true,
  imports: [RouterModule],
  template: `
    @if (author) {
      <a class="cap-author" [routerLink]="['/profile', author]" (click)="navigate.emit()">{{ authorLabel || author }}</a>{{ ' ' }}
    }
    @for (s of segments; track $index) {
      @switch (s.kind) {
        @case ('tag') { <a class="cap-link" [routerLink]="['/explore/tags', s.value.toLowerCase()]" (click)="navigate.emit()">#{{ s.value }}</a> }
        @case ('mention') { <a class="cap-link" [routerLink]="['/profile', s.value]" (click)="navigate.emit()">&#64;{{ s.value }}</a> }
        @default { <span>{{ s.value }}</span> }
      }
    }
    @if (truncated) {
      <button type="button" class="cap-more" (click)="expand($event)">… more</button>
    }
  `,
  styles: [`
    :host { display: block; white-space: pre-line; word-break: break-word; line-height: 1.45; }
    .cap-author { font-weight: 600; color: var(--text); }
    .cap-link { color: #4f8ff7; }
    :host-context([data-theme="light"]) .cap-link { color: #00376b; }
    .cap-more { background: none; border: none; color: var(--text-muted); padding: 0; font-size: inherit; }
  `]
})
export class CaptionComponent implements OnChanges {
  @Input() text: string | null | undefined = '';
  @Input() author?: string;
  @Input() authorLabel?: string;
  /** Max characters before "more" (0 = never truncate). */
  @Input() limit = 0;
  @Output() navigate = new EventEmitter<void>();

  segments: CaptionSegment[] = [];
  truncated = false;
  private expanded = false;

  ngOnChanges(): void { this.build(); }

  expand(e: Event): void {
    e.stopPropagation();
    this.expanded = true;
    this.build();
  }

  private build(): void {
    let t = this.text || '';
    this.truncated = false;
    if (!this.expanded && this.limit > 0) {
      const lines = t.split('\n');
      if (t.length > this.limit || lines.length > 3) {
        t = lines.slice(0, 3).join('\n').slice(0, this.limit).trimEnd();
        this.truncated = true;
      }
    }
    this.segments = captionSegments(t);
  }
}
