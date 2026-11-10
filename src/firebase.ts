import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
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
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

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
    // Format and log structured Firestore error info if permission denied, then fallback gracefully
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

export async function signInWithGooglePopup(
  defaultSignupCredits: number
): Promise<UserAccount> {
  const result = await signInWithPopup(auth, googleProvider);
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
 */
export async function sendFirebasePasswordResetToUser(
  email: string
): Promise<{ sent: boolean; error?: string }> {
  try {
    await sendPasswordResetEmail(auth, email.trim().toLowerCase());
    return { sent: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { sent: false, error: msg };
  }
}

export {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  onAuthStateChanged,
};

