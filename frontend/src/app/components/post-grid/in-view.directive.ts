import { Directive, ElementRef, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';

/** Emits `inView` whenever the element scrolls into view (infinite-scroll sentinel). */
@Directive({ selector: '[appInView]', standalone: true })
export class InViewDirective implements OnInit, OnDestroy {
  @Input() inViewMargin = '600px';
  @Output() inView = new EventEmitter<void>();
  private io?: IntersectionObserver;

  constructor(private el: ElementRef<HTMLElement>) {}

  ngOnInit(): void {
    if (typeof IntersectionObserver === 'undefined') return;
    this.io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) this.inView.emit();
    }, { rootMargin: this.inViewMargin });
    this.io.observe(this.el.nativeElement);
  }

  ngOnDestroy(): void { this.io?.disconnect(); }
}
