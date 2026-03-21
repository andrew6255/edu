import { db } from './firebase';
import {
  doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, deleteDoc, arrayUnion, arrayRemove
} from 'firebase/firestore';

export interface ClassData {
  id: string;
  name: string;
  teacherId: string;
  teacherName: string;
  subject: string;
  code: string;
  studentIds: string[];
  createdAt: string;
  description?: string;
  organisationId?: string;
}

function generateCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export async function createClass(teacherId: string, teacherName: string, data: {
  name: string; subject: string; description?: string; organisationId?: string;
}): Promise<ClassData> {
  const id = `class_${Date.now()}`;
  const classData: ClassData = {
    id, teacherId, teacherName,
    name: data.name, subject: data.subject,
    description: data.description || '',
    code: generateCode(),
    studentIds: [],
    createdAt: new Date().toISOString(),
    ...(data.organisationId ? { organisationId: data.organisationId } : {})
  };
  await setDoc(doc(db, 'classes', id), classData);
  return classData;
}

export async function getClassById(classId: string): Promise<ClassData | null> {
  const snap = await getDoc(doc(db, 'classes', classId));
  if (!snap.exists()) return null;
  return snap.data() as ClassData;
}

export async function getClassesByTeacher(teacherId: string): Promise<ClassData[]> {
  const q = query(collection(db, 'classes'), where('teacherId', '==', teacherId));
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data() as ClassData);
}

export async function getAllClasses(): Promise<ClassData[]> {
  const snap = await getDocs(collection(db, 'classes'));
  return snap.docs.map(d => d.data() as ClassData);
}

export async function getClassesByOrgId(orgId: string): Promise<ClassData[]> {
  const q = query(collection(db, 'classes'), where('organisationId', '==', orgId));
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data() as ClassData);
}

export async function joinClassByCode(uid: string, code: string): Promise<ClassData | null> {
  const q = query(collection(db, 'classes'), where('code', '==', code.toUpperCase()));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const classDoc = snap.docs[0];
  const classData = classDoc.data() as ClassData;
  await updateDoc(doc(db, 'classes', classDoc.id), {
    studentIds: arrayUnion(uid)
  });
  const userUpdates: Record<string, unknown> = { classId: classDoc.id };
  if (classData.organisationId) {
    userUpdates.organisationId = classData.organisationId;
  }
  await updateDoc(doc(db, 'users', uid), userUpdates);
  return classData;
}

export async function removeStudentFromClass(classId: string, studentId: string): Promise<void> {
  await updateDoc(doc(db, 'classes', classId), {
    studentIds: arrayRemove(studentId)
  });
  await updateDoc(doc(db, 'users', studentId), { classId: null });
}

export async function deleteClass(classId: string): Promise<void> {
  await deleteDoc(doc(db, 'classes', classId));
}

export async function updateClass(classId: string, updates: Partial<ClassData>): Promise<void> {
  await updateDoc(doc(db, 'classes', classId), updates as Record<string, unknown>);
}
