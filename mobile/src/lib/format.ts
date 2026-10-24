/** "1,234" — Instagram shows exact like counts with separators. */
export function formatNumber(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** "12.3K", "4.5M" — for follower counts and tight spaces. */
export function formatCompact(n: number): string {
  if (n < 10_000) return formatNumber(n);
  if (n < 1_000_000) return `${trim1(n / 1000)}K`;
  return `${trim1(n / 1_000_000)}M`;
}

function trim1(x: number): string {
  return x.toFixed(1).replace(/\.0$/, '');
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * Instagram post time: "Just now", "5 minutes ago", "3 hours ago",
 * "2 days ago", then "October 3" (+ year if not this year).
 */
export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'Just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} ${m === 1 ? 'minute' : 'minutes'} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ${h === 1 ? 'hour' : 'hours'} ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} ${d === 1 ? 'day' : 'days'} ago`;
  const date = new Date(t);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return `${MONTHS[date.getMonth()]} ${date.getDate()}${sameYear ? '' : `, ${date.getFullYear()}`}`;
}

/** Compact: "5m", "3h", "2d", "4w" (comments, notifications, DMs). */
export function timeAgoShort(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  const w = Math.floor(d / 7);
  if (w < 52) return `${w}w`;
  return `${Math.floor(d / 365)}y`;
}

/** "running" / "cold-shower" → "Running" / "Cold shower" */
export function activityLabel(tag: string | null | undefined): string {
  if (!tag) return '';
  const s = tag.replace(/[-_]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
