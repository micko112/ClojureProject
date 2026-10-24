import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { ActivitySuggestion } from '../models/media.model';
import { MediaService, loadImage } from './media.service';

/** Longest side of the preview sent for classification (the model looks at 224 px). */
const PREVIEW_SIDE = 512;

/**
 * Activity suggestions ("Looks like: Running 87%") for photos the user has
 * picked but not uploaded yet. The composer only uploads on Share, so it
 * sends a small JPEG preview to POST /api/vision/classify, which stores
 * nothing. Never rejects: any problem (no ML service, slow network, image
 * the browser can't decode) simply means no suggestions.
 */
@Injectable({ providedIn: 'root' })
export class VisionService {
  constructor(private http: HttpClient, private media: MediaService) {}

  async suggest(source: Blob, timeoutMs = 8000): Promise<ActivitySuggestion[]> {
    try {
      const img = await loadImage(source);
      const preview = await this.media.renderToJpeg(
        img, { sx: 0, sy: 0, sw: img.naturalWidth, sh: img.naturalHeight }, PREVIEW_SIDE, 0.85);
      const fd = new FormData();
      fd.append('file', preview, 'preview.jpg');
      const res = await firstValueFrom(
        this.http.post<{ suggestions?: ActivitySuggestion[] }>('/api/vision/classify', fd).pipe(timeout(timeoutMs)));
      return Array.isArray(res?.suggestions) ? res.suggestions.filter(s => s && s.activity) : [];
    } catch {
      return [];
    }
  }
}
