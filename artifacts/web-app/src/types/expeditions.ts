import type { RealmId } from '@/types/realms';

export type ExpeditionStatus = 'active' | 'completed' | 'expired';

export type ExpeditionMember = {
  uid: string;
  username: string;
  joinedAt: string;
};

export type ExpeditionDoc = {
  id: string;
  code: string;
  realmId: RealmId;
  seasonId: string;
  createdAt: string;
  createdByUid: string;
  status: ExpeditionStatus;
  members: ExpeditionMember[];
  memberUids: string[];
  progress: number;
  target: number;
  completedAt?: string;
  rewardClaimedByUids?: string[];
};

export type UserExpeditionStateDoc = {
  id: 'global';
  activeExpeditionId?: string;
  updatedAt: string;
};
