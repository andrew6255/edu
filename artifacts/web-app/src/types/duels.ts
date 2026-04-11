import type { RealmId } from '@/types/realms';

export type DuelStatus = 'active' | 'completed' | 'expired';

export type DuelPlayer = {
  uid: string;
  username: string;
};

export type DuelDoc = {
  id: string;
  code: string;
  seasonId: string;
  realmId: RealmId;
  createdAt: string;
  expiresAt: string;
  status: DuelStatus;

  participantUids: string[];

  host: DuelPlayer;
  guest?: DuelPlayer | null;

  hostScore: number;
  guestScore: number;

  completedAt?: string | null;
  rewardClaimedByUids?: string[];
};

export type UserDuelStateDoc = {
  id: 'global';
  activeDuelId?: string;
  recentDuelIds?: string[];
  lastScoreAtByDuelId?: Record<string, string>;
  updatedAt: string;
};
