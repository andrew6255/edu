import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyBaNWmSxGWq3q3G7qm78Aj-npdGTaAy3tM",
  authDomain: "logiclords-mvp.firebaseapp.com",
  projectId: "logiclords-mvp"
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const db = getFirestore(app);
export const auth = getAuth(app);
export default app;
