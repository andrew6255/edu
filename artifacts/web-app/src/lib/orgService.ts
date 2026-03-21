import { db } from './firebase';
import {
  doc, getDoc, setDoc, updateDoc, collection, getDocs, deleteDoc, arrayUnion, arrayRemove, query, where
} from 'firebase/firestore';

export interface OrgData {
  id: string;
  name: string;
  type: 'school' | 'university' | 'other';
  country?: string;
  adminIds: string[];
  createdAt: string;
  joinCode: string;
}

function generateCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export async function createOrg(data: Omit<OrgData, 'id' | 'joinCode' | 'createdAt'>): Promise<OrgData> {
  const id = `org_${Date.now()}`;
  const org: OrgData = {
    id, joinCode: generateCode(), createdAt: new Date().toISOString(), adminIds: [],
    ...data
  };
  await setDoc(doc(db, 'organisations', id), org);
  return org;
}

export async function getAllOrgs(): Promise<OrgData[]> {
  const snap = await getDocs(collection(db, 'organisations'));
  return snap.docs.map(d => d.data() as OrgData);
}

export async function getOrgById(orgId: string): Promise<OrgData | null> {
  const snap = await getDoc(doc(db, 'organisations', orgId));
  if (!snap.exists()) return null;
  return snap.data() as OrgData;
}

export async function updateOrg(orgId: string, updates: Partial<OrgData>): Promise<void> {
  await updateDoc(doc(db, 'organisations', orgId), updates as Record<string, unknown>);
}

export async function deleteOrg(orgId: string): Promise<void> {
  await deleteDoc(doc(db, 'organisations', orgId));
}

export async function addAdminToOrg(orgId: string, adminUid: string): Promise<void> {
  await updateDoc(doc(db, 'organisations', orgId), { adminIds: arrayUnion(adminUid) });
}

export async function removeAdminFromOrg(orgId: string, adminUid: string): Promise<void> {
  await updateDoc(doc(db, 'organisations', orgId), { adminIds: arrayRemove(adminUid) });
}

export async function getOrgsByAdmin(adminUid: string): Promise<OrgData[]> {
  const q = query(collection(db, 'organisations'), where('adminIds', 'array-contains', adminUid));
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data() as OrgData);
}
