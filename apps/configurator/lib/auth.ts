/**
 * Sign-in with Firebase Auth (email + password, or Google), then a session
 * cookie from our own API. Firebase's compat SDK is loaded from Google's CDN
 * only when the sign-in screen needs it, so the editor never carries it.
 */
import { api, type User } from './api';
import { FIREBASE_CONFIG } from './firebaseConfig';

const SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';

/** The small part of the compat SDK this page uses. */
export interface FirebaseUser {
  email: string | null;
  getIdToken(force?: boolean): Promise<string>;
  sendEmailVerification(): Promise<void>;
}
interface Credential { user: FirebaseUser }
export interface FirebaseAuth {
  currentUser: FirebaseUser | null;
  signInWithEmailAndPassword(email: string, password: string): Promise<Credential>;
  createUserWithEmailAndPassword(email: string, password: string): Promise<Credential>;
  signInWithPopup(provider: unknown): Promise<Credential>;
  sendPasswordResetEmail(email: string): Promise<void>;
  signOut(): Promise<void>;
}
interface FirebaseCompat {
  apps: unknown[];
  initializeApp(config: object): unknown;
  auth: (() => FirebaseAuth) & { GoogleAuthProvider: new () => { setCustomParameters(p: object): void } };
}
declare global {
  interface Window { firebase?: FirebaseCompat }
}

let loading: Promise<FirebaseAuth> | null = null;

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the sign-in library. Check your connection.'));
    document.head.appendChild(s);
  });
}

export function ensureFirebase(): Promise<FirebaseAuth> {
  loading ??= (async () => {
    if (!window.firebase) {
      await loadScript(`${SDK}firebase-app-compat.js`);
      await loadScript(`${SDK}firebase-auth-compat.js`);
    }
    const fb = window.firebase!;
    if (!fb.apps.length) fb.initializeApp(FIREBASE_CONFIG);
    return fb.auth();
  })().catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

const MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'Wrong email or password.',
  'auth/wrong-password': 'Wrong email or password.',
  'auth/user-not-found': 'Wrong email or password.',
  'auth/invalid-email': 'That email address doesn’t look right.',
  'auth/missing-password': 'Please enter your password.',
  'auth/weak-password': 'Choose a password with at least 8 characters.',
  'auth/email-already-in-use': 'There is already an account with that email. Sign in instead, or reset the password.',
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
  'auth/network-request-failed': 'Could not reach the sign-in service. Check your connection.',
  'auth/popup-closed-by-user': 'The Google sign-in window was closed before finishing.',
  'auth/cancelled-popup-request': 'The Google sign-in window was closed before finishing.',
  'auth/popup-blocked': 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.',
  'auth/unauthorized-domain': 'This site isn’t authorised for sign-in yet (add it under Firebase → Authentication → Settings → Authorized domains).',
  'auth/operation-not-allowed': 'This sign-in method isn’t enabled in Firebase yet.',
};

/** A sentence for a Firebase (or any) error. */
export function friendly(e: unknown): string {
  const err = e as { code?: string; message?: string } | null;
  if (err?.code && MESSAGES[err.code]) return MESSAGES[err.code];
  return err?.message || 'Something went wrong. Please try again.';
}

/** Exchange a fresh Firebase sign-in for our session cookie. */
export async function establishSession(user: FirebaseUser): Promise<User> {
  const idToken = await user.getIdToken(true);
  const res = await api<{ user: User }>('POST', '/api/auth/session', { idToken });
  return res.user;
}

export async function signInWithPassword(email: string, password: string): Promise<User> {
  const auth = await ensureFirebase();
  const cred = await auth.signInWithEmailAndPassword(email, password);
  return establishSession(cred.user);
}

export async function createAccount(email: string, password: string): Promise<User> {
  const auth = await ensureFirebase();
  const cred = await auth.createUserWithEmailAndPassword(email, password);
  cred.user.sendEmailVerification().catch(() => { /* the gallery banner offers a resend */ });
  return establishSession(cred.user);
}

export async function signInWithGoogle(): Promise<User> {
  const auth = await ensureFirebase();
  const provider = new window.firebase!.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const cred = await auth.signInWithPopup(provider);
  return establishSession(cred.user);
}

export async function sendPasswordReset(email: string): Promise<void> {
  const auth = await ensureFirebase();
  await auth.sendPasswordResetEmail(email);
}

/** Resend the verification email; needs the Firebase session, which lives only in the tab that signed in. */
export async function resendVerification(): Promise<void> {
  const auth = await ensureFirebase();
  const user = auth.currentUser;
  if (!user) throw new Error('Please sign out and sign in again, then resend the verification email.');
  await user.sendEmailVerification();
}

export async function signOutEverywhere(): Promise<void> {
  await api('DELETE', '/api/auth/session').catch(() => { /* the cookie may already be gone */ });
  if (window.firebase?.apps.length) await window.firebase.auth().signOut().catch(() => {});
}
