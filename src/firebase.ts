import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, initializeFirestore, memoryLocalCache, setLogLevel } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

export const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

// Keep SDK-internal Firestore warnings quiet. App-level failures are logged explicitly where they occur.
setLogLevel('error');

export const auth = (() => {
  if (Platform.OS === 'web') return getAuth(app);

  // Use the React Native auth entrypoint so persistence works with AsyncStorage.
  const { initializeAuth, getReactNativePersistence } = require('@firebase/auth');
  return initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
})();

// Use memoryLocalCache to avoid BloomFilter warnings with persistent cache.
export const db = (() => {
  try {
    return initializeFirestore(app, { localCache: memoryLocalCache() });
  } catch (e) {
    console.warn('[firebase.db] Falling back to default Firestore init', e);
    return getFirestore(app);
  }
})();

export const ADMIN_EMAILS = (process.env.EXPO_PUBLIC_ADMIN_EMAILS ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export const OWNER_EMAILS = (process.env.EXPO_PUBLIC_OWNER_EMAILS ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
