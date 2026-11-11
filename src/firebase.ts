import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  confirmPasswordReset,
  verifyPasswordResetCode,
  applyActionCode,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { UserAccount } from './utils/systemRules';

const app = initializeApp(firebaseConfig);
const firestoreDbId =
  (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId ||
  'ai-studio-lkimlamdrivehthn-354e9e56-085d-409f-ac41-ea1e21a489e8';
export const db = getFirestore(app, firestoreDbId);
export const auth = getAuth(app);

export const SCOPES = ['https://www.googleapis.com/auth/drive'];

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });
SCOPES.forEach((scope) => googleProvider.addScope(scope));

// In-memory OAuth access token cache (never stored in localStorage/sessionStorage)
let cachedAccessToken: string | null = null;
let cachedRelayEmail: string | null = null;

onAuthStateChanged(auth, (user) => {
  if (!user) {
    cachedAccessToken = null;
    cachedRelayEmail = null;
  }
});

export function getGoogleDriveAccessToken(): string | null {
  return cachedAccessToken;
}

export function getConnectedRelayEmail(): string | null {
  return cachedRelayEmail;
}


export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Validate connection to Firestore on boot
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

/**
 * Syncs a Google-authenticated user with Firestore `/users/{uid}` and returns a normalized UserAccount.
 */
export async function syncGoogleUserWithFirestore(
  fbUser: User,
  defaultSignupCredits: number
): Promise<UserAccount> {
  const cleanUid = fbUser.uid.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
  const path = `users/${cleanUid}`;
  const userRef = doc(db, 'users', cleanUid);

  const email = (fbUser.email || `${cleanUid}@gmail.com`).slice(0, 120);
  const rawName =
    fbUser.displayName || email.split('@')[0] || `user_${cleanUid.slice(0, 6)}`;
  const username = rawName.slice(0, 64).length >= 2 ? rawName.slice(0, 64) : `user_${cleanUid.slice(0, 6)}`;
  const isRuntimeAdmin = email.toLowerCase() === 'lekimlam2707@gmail.com';

  try {
    const existingSnap = await getDoc(userRef);
    if (existingSnap.exists()) {
      const data = existingSnap.data();
      return {
        id: cleanUid,
        username: String(data.username || username),
        email: String(data.email || email),
        role: isRuntimeAdmin ? 'admin' : (data.role as 'user' | 'vip' | 'admin') || 'user',
        credits: Number(data.credits ?? defaultSignupCredits),
        balanceVnd: Number(data.balanceVnd ?? 0),
        totalDepositedVnd: Number(data.totalDepositedVnd ?? 0),
        totalDownloadedFiles: Number(data.totalDownloadedFiles ?? 0),
        status: (data.status as 'active' | 'banned') || 'active',
        emailVerified: true,
        authProvider: 'google',
        createdAt: new Date().toISOString(),
      };
    }

    const initialCredits = isRuntimeAdmin ? 9999 : Math.min(10, Math.max(0, defaultSignupCredits));
    const initialRole = isRuntimeAdmin ? 'admin' : 'user';

    await setDoc(userRef, {
      uid: cleanUid,
      username,
      email,
      role: initialRole,
      credits: initialCredits,
      balanceVnd: 0,
      totalDepositedVnd: 0,
      totalDownloadedFiles: 0,
      status: 'active',
      emailVerified: true,
      authProvider: 'google',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return {
      id: cleanUid,
      username,
      email,
      role: initialRole,
      credits: initialCredits,
      balanceVnd: 0,
      totalDepositedVnd: 0,
      totalDownloadedFiles: 0,
      status: 'active',
      emailVerified: true,
      authProvider: 'google',
      createdAt: new Date().toISOString(),
    };
  } catch (error) {
    try {
      handleFirestoreError(error, OperationType.WRITE, path);
    } catch {
      // Fall back to local/backend profile if Firestore write is restricted
    }
    return {
      id: cleanUid,
      username,
      email,
      role: isRuntimeAdmin ? 'admin' : 'user',
      credits: isRuntimeAdmin ? 9999 : defaultSignupCredits,
      balanceVnd: 0,
      totalDepositedVnd: 0,
      totalDownloadedFiles: 0,
      status: 'active',
      emailVerified: true,
      authProvider: 'google',
      createdAt: new Date().toISOString(),
    };
  }
}

export async function registerRelayTokenWithServer(
  accessToken: string,
  email?: string | null
): Promise<{ connected: boolean; relayEmail?: string; error?: string }> {
  try {
    const res = await fetch('/api/drive-relay/connect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ email: email || undefined }),
    });
    const data = await res.json();
    if (res.ok && data.connected) {
      cachedRelayEmail = data.relayEmail || email || null;
      return { connected: true, relayEmail: cachedRelayEmail || undefined };
    }
    return { connected: false, error: data.error || 'Không thể kết nối Drive Trung Gian' };
  } catch (err) {
    return {
      connected: false,
      error: err instanceof Error ? err.message : 'Lỗi kết nối máy chủ Drive Trung Gian',
    };
  }
}

export async function connectGoogleDriveRelay(): Promise<{
  connected: boolean;
  accessToken?: string;
  relayEmail?: string;
  error?: string;
}> {
  try {
    const relayProvider = new GoogleAuthProvider();
    relayProvider.setCustomParameters({ prompt: 'consent select_account' });
    SCOPES.forEach((scope) => relayProvider.addScope(scope));

    const result = await signInWithPopup(auth, relayProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const token = credential?.accessToken || null;
    if (!token) {
      return {
        connected: false,
        error: 'Không nhận được quyền truy cập Google Drive từ tài khoản này.',
      };
    }
    cachedAccessToken = token;
    cachedRelayEmail = result.user.email || null;
    const serverReg = await registerRelayTokenWithServer(token, result.user.email);
    return {
      connected: true,
      accessToken: token,
      relayEmail: serverReg.relayEmail || result.user.email || 'Google Drive Relay',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { connected: false, error: msg };
  }
}

export async function signInWithGooglePopup(
  defaultSignupCredits: number
): Promise<UserAccount> {
  const result = await signInWithPopup(auth, googleProvider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (credential?.accessToken) {
    cachedAccessToken = credential.accessToken;
    cachedRelayEmail = result.user.email || null;
    void registerRelayTokenWithServer(credential.accessToken, result.user.email);
  }
  return syncGoogleUserWithFirestore(result.user, defaultSignupCredits);
}

/**
 * Registers or signs in a user with Firebase Email/Password Auth and triggers Google's
 * built-in verification email to that user's Gmail address.
 */
export async function sendFirebaseVerificationEmailToUser(
  email: string,
  password: string
): Promise<{ sent: boolean; error?: string }> {
  try {
    const cred = await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
    await sendEmailVerification(cred.user);
    return { sent: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('auth/email-already-in-use')) {
      try {
        const cred = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
        if (!cred.user.emailVerified) {
          await sendEmailVerification(cred.user);
          return { sent: true };
        }
      } catch {
        // ignore
      }
    }
    return { sent: false, error: msg };
  }
}

/**
 * Sends a real password recovery email from Firebase Authentication to any user's Gmail inbox.
 * If the email is not yet registered in Firebase Auth, provisions it first so the email is always delivered.
 */
export async function sendFirebasePasswordResetToUser(
  email: string
): Promise<{ sent: boolean; error?: string }> {
  const cleanEmail = email.trim().toLowerCase();
  try {
    // Ensure account exists in Firebase Auth so sendPasswordResetEmail always delivers to Gmail
    try {
      await createUserWithEmailAndPassword(auth, cleanEmail, `Tmp_${Date.now()}_Lkld!`);
    } catch {
      // Account already exists in Firebase Auth — proceed to send reset email
    }
    await sendPasswordResetEmail(auth, cleanEmail);
    return { sent: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { sent: false, error: msg };
  }
}

/**
 * Extracts `oobCode` from either a full Firebase action URL or a raw oobCode string.
 */
export function extractFirebaseOobCode(rawInput: string): string {
  const trimmed = rawInput.trim();
  if (!trimmed) return '';
  const match = trimmed.match(/[?&]oobCode=([^&\s]+)/i);
  if (match && match[1]) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }
  return trimmed;
}

/**
 * Resets password in Firebase using the link or oobCode from the user's Gmail inbox.
 */
export async function confirmFirebaseResetWithCodeOrLink(
  rawCodeOrUrl: string,
  newPassword: string
): Promise<{ ok: boolean; email?: string; error?: string }> {
  const oobCode = extractFirebaseOobCode(rawCodeOrUrl);
  if (!oobCode || oobCode.length < 10) {
    return { ok: false, error: 'Đường dẫn hoặc mã xác thực không hợp lệ' };
  }
  try {
    const verifiedEmail = await verifyPasswordResetCode(auth, oobCode);
    await confirmPasswordReset(auth, oobCode, newPassword);
    return { ok: true, email: verifiedEmail };
  } catch {
    try {
      await applyActionCode(auth, oobCode);
      return { ok: true };
    } catch (err2: unknown) {
      const msg = err2 instanceof Error ? err2.message : String(err2);
      return { ok: false, error: msg };
    }
  }
}

/**
 * Applies email verification oobCode or link from the user's Gmail inbox.
 */
export async function applyFirebaseVerifyWithCodeOrLink(
  rawCodeOrUrl: string
): Promise<{ ok: boolean }> {
  const oobCode = extractFirebaseOobCode(rawCodeOrUrl);
  if (!oobCode || oobCode.length < 10) return { ok: false };
  try {
    await applyActionCode(auth, oobCode);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * Checks whether the user has clicked the verification link sent to their Gmail by Firebase Auth.
 */
export async function checkFirebaseEmailVerified(
  email: string,
  password?: string
): Promise<{ verified: boolean }> {
  try {
    if (auth.currentUser && auth.currentUser.email?.toLowerCase() === email.trim().toLowerCase()) {
      await auth.currentUser.reload();
      if (auth.currentUser.emailVerified) {
        return { verified: true };
      }
    }
    if (password) {
      const cred = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
      await cred.user.reload();
      return { verified: Boolean(cred.user.emailVerified) };
    }
    return { verified: false };
  } catch {
    return { verified: false };
  }
}

/**
 * Verifies email + password against Firebase Auth (e.g. after user resets password via Gmail link).
 */
export async function verifyFirebaseEmailPasswordLogin(
  email: string,
  password: string
): Promise<{ ok: boolean; emailVerified: boolean }> {
  try {
    const cred = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
    await cred.user.reload();
    return { ok: true, emailVerified: Boolean(cred.user.emailVerified) };
  } catch {
    return { ok: false, emailVerified: false };
  }
}

export {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  onAuthStateChanged,
};



