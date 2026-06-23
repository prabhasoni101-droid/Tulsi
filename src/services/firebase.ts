import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  setPersistence,
  browserLocalPersistence,
  //browserPopupRedirectResolver,
  inMemoryPersistence,
  type User,
} from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import {
  initializeFirestore,
  doc,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import firebaseAppletConfig from '../../firebase-applet-config.json';
import { getAuthErrorMessage, isLocalDevHost, shouldUseGoogleRedirect } from '../lib/authErrors';
import { getFirestoreErrorMessage } from '../lib/firestoreErrors';

type FirebaseAppletConfig = {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
  firestoreDatabaseId?: string;
  databaseId?: string;
};

const appletConfig = firebaseAppletConfig as FirebaseAppletConfig;

function readConfigValue(envKey: string, appletKey: keyof FirebaseAppletConfig): string {
  const fromEnv = import.meta.env[envKey] as string | undefined;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  const fromApplet = appletConfig[appletKey];
  return typeof fromApplet === 'string' ? fromApplet.trim() : '';
}

function resolveAuthDomain(): string {
  const configuredDomain = readConfigValue('VITE_FIREBASE_AUTH_DOMAIN', 'authDomain');
  if (configuredDomain && !['localhost', '127.0.0.1'].includes(configuredDomain)) {
    return configuredDomain;
  }
  const appletDomain = typeof appletConfig.authDomain === 'string' ? appletConfig.authDomain.trim() : '';
  if (appletDomain && !['localhost', '127.0.0.1'].includes(appletDomain)) {
    return appletDomain;
  }
  const projectId = readConfigValue('VITE_FIREBASE_PROJECT_ID', 'projectId');
  return projectId ? `${projectId}.firebaseapp.com` : configuredDomain;
}

const resolvedFirebaseConfig = {
  apiKey: readConfigValue('VITE_FIREBASE_API_KEY', 'apiKey'),
  authDomain: resolveAuthDomain(),
  projectId: readConfigValue('VITE_FIREBASE_PROJECT_ID', 'projectId'),
  storageBucket: readConfigValue('VITE_FIREBASE_STORAGE_BUCKET', 'storageBucket'),
  messagingSenderId: readConfigValue('VITE_FIREBASE_MESSAGING_SENDER_ID', 'messagingSenderId'),
  appId: readConfigValue('VITE_FIREBASE_APP_ID', 'appId'),
  firestoreDatabaseId:
    readConfigValue('VITE_FIREBASE_DATABASE_ID', 'firestoreDatabaseId') ||
    readConfigValue('VITE_FIREBASE_DATABASE_ID', 'databaseId'),
};

export function assertFirebaseConfig(): void {
  const missing = Object.entries(resolvedFirebaseConfig)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(`Firebase config missing: ${missing.join(', ')}. Create .env.local from .env.example.`);
  }
}

assertFirebaseConfig();

const app = initializeApp(resolvedFirebaseConfig);

const firestoreSettings: Record<string, unknown> = { };
try {
  firestoreSettings.localCache = persistentLocalCache({ tabManager: persistentMultipleTabManager() });
} catch (e) {
  console.warn('Firestore offline persistence unavailable:', e);
}

export const db = initializeFirestore(app, firestoreSettings, resolvedFirebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const storage = getStorage(app);
auth.useDeviceLanguage();
export const authPersistenceReady = setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.error('[AUTH] persistence setup failed:', error);
});

export const ownerEmail = (import.meta.env.VITE_OWNER_EMAIL as string | undefined)?.trim().toLowerCase() || '';

/** CI/TestSprite: set VITE_ENABLE_TEST_LOGIN=true with owner test credentials in .env.local */
export const isOwnerTestLoginEnabled =
  import.meta.env.VITE_ENABLE_TEST_LOGIN === 'true' &&
  !!(import.meta.env.VITE_OWNER_TEST_EMAIL as string)?.trim() &&
  !!(import.meta.env.VITE_OWNER_TEST_PASSWORD as string)?.trim();

function createGoogleAuthProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  provider.addScope('profile');
  provider.addScope('email');
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
}

function shouldUseRedirectForGoogleAuth(): boolean {
  // BUGFIX: Never force redirect on GitHub Pages.
  // getRedirectResult() silently returns null on .github.io because the
  // redirect state in IndexedDB is lost when hosting domain differs from
  // authDomain. Popup avoids this entirely. If popup is blocked by browser,
  // the catch block in signInWithGoogle() auto-falls back to redirect.
  return false;
}

export async function signInWithGoogle(): Promise<User> {
  // NO await before signInWithPopup — mobile browsers require
  // signInWithPopup to be called directly in the user gesture stack.
  // Any await (even on a resolved promise) can break the popup on mobile.
  const provider = createGoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  return result.user;
}
export async function completeGoogleRedirectSignIn(): Promise<User | null> {
  const result = await getRedirectResult(auth);
  return result?.user ?? null;
}

export async function loginWithEmailOrUserId(identifier: string, password: string) {
  const trimmed = identifier.trim();
  if (!trimmed) throw new Error('Email or User ID is required.');
  const email = trimmed.includes('@') ? trimmed.toLowerCase() : `${trimmed.toLowerCase()}@iskcon.app`;
  return signInWithEmailAndPassword(auth, email, password);
}

export async function loginWithUserId(userId: string, password: string) {
  return loginWithEmailOrUserId(userId, password);
}

/** Owner password login for CI/automation when VITE_ENABLE_TEST_LOGIN=true */
export async function loginOwnerWithTestCredentials(): Promise<User> {
  if (!isOwnerTestLoginEnabled) {
    throw new Error('Owner test login is not enabled.');
  }
  const email = (import.meta.env.VITE_OWNER_TEST_EMAIL as string).trim().toLowerCase();
  const password = (import.meta.env.VITE_OWNER_TEST_PASSWORD as string).trim();
  return signInWithEmailAndPassword(auth, email, password).then((r) => r.user);
}

export function generateSecurePassword(length = 14): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);
  return Array.from(values, (v) => chars[v % chars.length]).join('');
}

export async function registerSevak(userId: string, password: string) {
  const email = `${userId.toLowerCase()}@iskcon.app`;
  const secondaryAppName = 'SecondaryAppForRegistration';
  let secondaryApp: FirebaseApp;
  const found = getApps().find((a) => a.name === secondaryAppName);
  secondaryApp = found ?? initializeApp(resolvedFirebaseConfig, secondaryAppName);
  const secondaryAuth = getAuth(secondaryApp);
  await setPersistence(secondaryAuth, inMemoryPersistence);
  const creds = await createUserWithEmailAndPassword(secondaryAuth, email, password);
  await secondaryAuth.signOut();
  return creds;
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: 'create' | 'update' | 'delete' | 'list' | 'get' | 'write';
  path: string | null;
}

export function handleFirestoreError(
  error: unknown,
  operation: FirestoreErrorInfo['operationType'],
  path: string | null = null
): never {
  console.error('Firestore Error:', { operation, path, error });
  throw new Error(getFirestoreErrorMessage(error));
}

export { getAuthErrorMessage };
