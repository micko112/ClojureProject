import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './toast.component.html',
  styleUrls: ['./toast.component.css']
})
export class ToastComponent {
  toast = inject(ToastService);

  iconFor(type: string): string {
    if (type === 'success') return 'check_circle';
    if (type === 'error') return 'error';
    return 'info';
  }
}
