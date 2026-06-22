import { FirebaseError } from 'firebase/app';

export function getAuthErrorMessage(error: unknown): string {
  const code = error instanceof FirebaseError ? error.code : '';
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
    return 'Invalid User ID or Password. Ask your temple admin if you need an account.';
  }
  if (code === 'auth/too-many-requests') {
    return 'Too many failed attempts. Please wait a few minutes and try again.';
  }
  if (code === 'auth/operation-not-allowed') {
    return 'Email/password sign-in is not enabled in Firebase. Enable it in Firebase Console > Authentication > Sign-in method.';
  }
  if (code === 'auth/unauthorized-domain') {
    return 'This website URL is not authorized in Firebase. Add "localhost" under Authentication > Settings > Authorized domains.';
  }
  if (code === 'auth/popup-blocked' || code === 'auth/popup-closed-by-user') {
    return 'Popup blocked by your browser! Please allow popups for this website in your browser settings, then tap "Sign in with Google" again.';
  }
  if (code === 'auth/invalid-api-key' || lower.includes('api key')) {
    return 'Firebase API key is missing or invalid. Copy firebase-applet-config.json values into your local .env file.';
  }
  if (lower.includes('requested action is invalid') || lower.includes('400') || lower.includes('malformed')) {
    return 'Google sign-in failed. Open http://localhost:3000 and add "localhost" in Firebase > Authentication > Authorized domains.';
  }
  if (lower.includes('500') && lower.includes('error')) {
    return 'Google servers returned a temporary error. Please use email & password login below, or try Google sign-in again in a few minutes.';
  }

  return message || 'Sign-in failed. Please try again.';
}

export function shouldUseGoogleRedirect(error: unknown): boolean {
  if (!(error instanceof FirebaseError)) {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    return message.includes('requested action is invalid');
  }

  return [
    'auth/popup-blocked',
    'auth/popup-closed-by-user',
    'auth/cancelled-popup-request',
    'auth/unauthorized-domain',
  ].includes(error.code);
}

export function isLocalDevHost(): boolean {
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

export function isUnsupportedAuthHost(): boolean {
  return /^\d+\.\d+\.\d+\.\d+$/.test(window.location.hostname);
}
