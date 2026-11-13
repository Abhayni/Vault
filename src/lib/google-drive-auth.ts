import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const SCOPES = ['https://www.googleapis.com/auth/drive.file'] as const;

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

// In-memory cache ONLY (never stored in localStorage or sessionStorage)
let isSigningIn = false;
let cachedAccessToken: string | null = null;

export const initGoogleDriveAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onSignedOut?: () => void,
) => {
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        onAuthSuccess?.(user, cachedAccessToken);
      }
    } else {
      cachedAccessToken = null;
      if (!isSigningIn) {
        onSignedOut?.();
      }
    }
  });
};

function buildDriveProvider(): GoogleAuthProvider {
  const driveProvider = new GoogleAuthProvider();
  for (const scope of SCOPES) {
    driveProvider.addScope(scope);
  }
  driveProvider.setCustomParameters({
    include_granted_scopes: 'true',
    prompt: 'select_account consent',
  });
  return driveProvider;
}

function formatFirebaseDriveError(err: unknown): Error {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code || '')
      : '';
  const rawMessage = err instanceof Error ? err.message : 'Unable to connect Google Drive.';

  switch (code) {
    case 'auth/popup-blocked':
      return new Error(
        'Sign-in popup was blocked by your browser. Allow popups for this site or open MOD VAULT in a full browser tab.',
      );
    case 'auth/popup-closed-by-user':
      return new Error('Google sign-in popup was closed before completing authorization.');
    case 'auth/cancelled-popup-request':
      return new Error('Sign-in was interrupted by another sign-in request. Please click once and try again.');
    case 'auth/unauthorized-domain':
      return new Error(
        `Domain "${typeof window !== 'undefined' ? window.location.hostname : 'current'}" is not authorized in Firebase Auth.`,
      );
    case 'auth/operation-not-allowed':
      return new Error('Google sign-in provider is not enabled in Firebase Authentication.');
    case 'auth/network-request-failed':
      return new Error('Network error while contacting Google sign-in servers. Check your connection and retry.');
    case 'auth/internal-error':
      return new Error(
        'Browser blocked third-party sign-in storage inside the embedded preview. Open the Shared App URL in a new tab and try again.',
      );
    default:
      return new Error(code ? `${rawMessage} (${code})` : rawMessage);
  }
}

export const connectGoogleDrive = async (): Promise<{
  user: User;
  accessToken: string;
}> => {
  try {
    isSigningIn = true;
    const driveProvider = buildDriveProvider();
    const result = await signInWithPopup(auth, driveProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const fallbackOAuthToken = (
      result as unknown as { _tokenResponse?: { oauthAccessToken?: string } }
    )._tokenResponse?.oauthAccessToken;
    const rawToken = (credential?.accessToken || fallbackOAuthToken || '').trim();

    if (!rawToken) {
      throw new Error(
        'Google account selected, but Firebase Auth did not return a Google Drive OAuth access token. Approve Google Drive access on the consent screen and try again.',
      );
    }

    cachedAccessToken = rawToken;
    return { user: result.user, accessToken: rawToken };
  } catch (err) {
    throw formatFirebaseDriveError(err);
  } finally {
    isSigningIn = false;
  }
};

export const getGoogleDriveAccessToken = (): string | null => {
  return cachedAccessToken;
};

export const invalidateGoogleDriveToken = (): void => {
  cachedAccessToken = null;
};

export const disconnectGoogleDrive = async (): Promise<void> => {
  cachedAccessToken = null;
  await auth.signOut();
};
