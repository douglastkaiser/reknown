import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  enableIndexedDbPersistence,
  getFirestore,
} from 'firebase/firestore';

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

// Best-effort Firestore offline cache. Fails when multiple tabs are open
// without tab synchronization or in environments without IDB (SSR, private
// browsing in some browsers). We ignore the failure — the app already has
// its own IDB layer; cloud sync will simply require a network connection.
if (typeof window !== 'undefined') {
  enableIndexedDbPersistence(db, { forceOwnership: false }).catch((err) => {
    if (err?.code === 'failed-precondition' || err?.code === 'unimplemented') {
      // Expected in multi-tab or unsupported environments.
      return;
    }
    console.warn('[firebase] offline persistence unavailable', err);
  });
}

// Opt-in Firestore emulator for local development. Enable with
// `VITE_USE_FIRESTORE_EMULATOR=1 npm run dev` and run
// `firebase emulators:start --only firestore`.
if (import.meta.env.VITE_USE_FIRESTORE_EMULATOR === '1') {
  connectFirestoreEmulator(db, 'localhost', 8080);
}
