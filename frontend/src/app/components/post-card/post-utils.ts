import { Media } from '../../models/media.model';
import { Post } from '../../models/post.model';
import { ToastService } from '../../services/toast.service';

/** Instagram-style short relative time: "now", "5m", "3h", "2d", "4w", "Oct 12". */
export function timeAgo(dateStr?: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  if (s < 7 * 86400) return Math.floor(s / 86400) + 'd';
  if (s < 30 * 86400) return Math.floor(s / (7 * 86400)) + 'w';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** Longer form for under the actions row: "3 hours ago". */
export function timeAgoLong(dateStr?: string | null): string {
  if (!dateStr) return '';
  const s = Math.max(0, (Date.now() - new Date(dateStr).getTime()) / 1000);
  const unit = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'} ago`;
  if (s < 60) return 'just now';
  if (s < 3600) return unit(Math.floor(s / 60), 'minute');
  if (s < 86400) return unit(Math.floor(s / 3600), 'hour');
  if (s < 7 * 86400) return unit(Math.floor(s / 86400), 'day');
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function initials(u?: { displayName?: string; username?: string } | null): string {
  return (u?.displayName || u?.username || '?').charAt(0).toUpperCase();
}

const VIDEO_RE = /\.(mp4|webm|mov|m4v)(\?.*)?$/i;

const EMPTY: Media[] = [];
const legacyCache = new WeakMap<Post, { url: string; media: Media[] }>();

/** Media array of a post, falling back to legacy mediaUrl. Returns stable references (safe in templates). */
export function postMedia(post?: Post | null): Media[] {
  if (!post) return EMPTY;
  if (post.media?.length) return post.media;
  const url = post.mediaUrl;
  if (!url) return EMPTY;
  const hit = legacyCache.get(post);
  if (hit && hit.url === url) return hit.media;
  const media: Media[] = [{ id: 'legacy-' + post.id, type: VIDEO_RE.test(url) ? 'video' : 'image', url }];
  legacyCache.set(post, { url, media });
  return media;
}

/** Smallest rendition suitable for a grid thumbnail. */
export function thumbUrl(m?: Media | null): string {
  if (!m) return '';
  if (m.type === 'video') return m.posterUrl || '';
  const v = m.variants?.find(x => x.w >= 320) || m.variants?.[m.variants.length - 1];
  return v?.url || m.url;
}

/** Width / height of the first media, clamped like Instagram (4:5 … 1.91:1). */
export function aspectOf(m?: Media | null): number {
  if (!m?.width || !m?.height) return 1;
  return Math.min(1.91, Math.max(0.8, m.width / m.height));
}

export function likeCountOf(post: Post): number {
  if (post.likeCount != null) return post.likeCount;
  return Array.isArray(post.likes) ? post.likes.length : 0;
}

export function compact(n: number): string {
  if (n < 10_000) return n.toLocaleString('en-US');
  if (n < 1_000_000) return (n / 1000).toFixed(n < 100_000 ? 1 : 0).replace(/\.0$/, '') + 'K';
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
}

export interface CaptionSegment { kind: 'text' | 'tag' | 'mention'; value: string; }

// Same rules as the backend parser (web.posts/parse-hashtags, parse-mentions).
const TOKEN_RE = /(?<![\p{L}\p{N}_&#])#([\p{L}\p{N}_]{1,64})|(?<![\p{L}\p{N}_.@])@([A-Za-z0-9_.]{1,30})/gu;

export function captionSegments(text: string): CaptionSegment[] {
  const out: CaptionSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    const start = m.index ?? 0;
    if (start > last) out.push({ kind: 'text', value: text.slice(last, start) });
    if (m[1]) {
      out.push({ kind: 'tag', value: m[1] });
      last = start + m[0].length;
    } else {
      const name = m[2].replace(/\.+$/, '');
      out.push({ kind: 'mention', value: name });
      last = start + 1 + name.length;
    }
  }
  if (last < text.length) out.push({ kind: 'text', value: text.slice(last) });
  return out;
}

export function postLink(post: Post): string {
  return `${location.origin}/post/${post.id}`;
}

export function copyPostLink(post: Post, toast: ToastService): void {
  const url = postLink(post);
  const done = () => toast.success('Link copied');
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done, () => toast.info(url));
  else toast.info(url);
}
