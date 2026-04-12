import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyBaNWmSxGWq3q3G7qm78Aj-npdGTaAy3tM",
  authDomain: "logiclords-mvp.firebaseapp.com",
  projectId: "logiclords-mvp",
  storageBucket: "logiclords-mvp.appspot.com",
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const db = getFirestore(app);
export const storage = getStorage(app);
export default app;
