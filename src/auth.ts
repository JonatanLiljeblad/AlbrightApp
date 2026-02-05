import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  User,
} from 'firebase/auth';
import { Platform } from 'react-native';
import { auth, db, ADMIN_EMAILS, OWNER_EMAILS } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

export function watchAuth(cb: (u: User | null) => void) {
  return onAuthStateChanged(auth, cb);
}

export async function isAllowedEmail(email: string) {
  const key = email.trim().toLowerCase();
  try {
    const snap = await getDoc(doc(db, 'allowedEmails', key));
    return snap.exists();
  } catch {
    // If rules don't allow reading allowlist pre-auth, we treat as not allowed.
    return false;
  }
}

export async function requestAccess(name: string, email: string) {
  const key = email.trim().toLowerCase();
  await setDoc(
    doc(db, 'accessRequests', key),
    { name: name.trim(), email: key, status: 'pending', createdAt: Date.now() },
    { merge: true }
  );
}

async function applySignInPersistence(remember: boolean) {
  try {
    if (Platform.OS === 'web') {
      const { setPersistence, browserLocalPersistence, browserSessionPersistence } = require('firebase/auth');
      await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
      return;
    }

    const { setPersistence, inMemoryPersistence, getReactNativePersistence } = require('@firebase/auth');
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    await setPersistence(auth, remember ? getReactNativePersistence(AsyncStorage) : inMemoryPersistence);
  } catch {
    // If persistence isn't supported for some reason, we still allow sign-in.
  }
}

export async function signIn(email: string, password: string, remember: boolean) {
  await applySignInPersistence(remember);
  return signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
}

export async function signUpAllowed(name: string, email: string, password: string) {
  const e = email.trim().toLowerCase();
  const cred = await createUserWithEmailAndPassword(auth, e, password);
  await updateProfile(cred.user, { displayName: name.trim() });
  return cred;
}

export async function signOutUser() {
  return signOut(auth);
}

export function isOwner(email?: string | null) {
  if (!email) return false;
  return OWNER_EMAILS.includes(email.trim().toLowerCase());
}

export function isAdmin(email?: string | null) {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  return isOwner(e) || ADMIN_EMAILS.includes(e);
}
