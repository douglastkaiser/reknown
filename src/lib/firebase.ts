import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyAkakQndmD5eoxZBibN3FZUHfGpCgx1tO4',
  authDomain: 'reknown.firebaseapp.com',
  projectId: 'reknown',
  storageBucket: 'reknown.firebasestorage.app',
  messagingSenderId: '445725114126',
  appId: '1:445725114126:web:145509480ec54b2c4de15f',
  measurementId: 'G-5G2CZFW2FG',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
