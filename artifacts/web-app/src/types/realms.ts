export type RealmId = 'renaissance' | 'industrial' | 'space';

export type RealmMode = 'cozy' | 'scholar' | 'competitive';

export type UserRealmStateDoc = {
  id: 'global';
  selectedRealmId: RealmId;
  mode: RealmMode;
  updatedAt: string;
};
