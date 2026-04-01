export interface RankInfo {
  name: string;
  icon: string;
  color: string;
  minXp: number;
  nextMinXp: number | null;
  progress: number; // 0-100 % to next rank
}

const RANKS = [
  { name: 'Iron',        icon: '⚙️',  color: '#6b7280', min: 0       },
  { name: 'Bronze',      icon: '🥉',  color: '#b45309', min: 1000    },
  { name: 'Silver',      icon: '🥈',  color: '#94a3b8', min: 5000    },
  { name: 'Gold',        icon: '🥇',  color: '#d97706', min: 12500   },
  { name: 'Platinum',    icon: '💎',  color: '#0891b2', min: 30000   },
  { name: 'Diamond',     icon: '💠',  color: '#6366f1', min: 60000   },
  { name: 'Master',      icon: '👑',  color: '#9333ea', min: 100000  },
  { name: 'Grandmaster', icon: '🏆',  color: '#dc2626', min: 200000  },
] as const;

export function getRank(xp: number): RankInfo {
  let idx = 0;
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (xp >= RANKS[i].min) { idx = i; break; }
  }
  const r = RANKS[idx];
  const next = RANKS[idx + 1] ?? null;
  const progress = next
    ? Math.min(100, ((xp - r.min) / (next.min - r.min)) * 100)
    : 100;
  return {
    name: r.name,
    icon: r.icon,
    color: r.color,
    minXp: r.min,
    nextMinXp: next?.min ?? null,
    progress,
  };
}
