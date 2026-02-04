import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut, updateProfile, User } from 'firebase/auth';
import { auth, db, ADMIN_EMAILS } from './firebase';
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

export async function signIn(email: string, password: string) {
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

export function isAdmin(email?: string | null) {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.trim().toLowerCase());
}
