import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { auth, db, ownerEmail } from '../services/firebase';
import { UserProfile, UserRole } from '../types';
import { PROFILE_SAFE_UPDATE_FIELDS, roleMatchesLoginMode, type LoginMode } from '../lib/authRoles';

const PENDING_LOGIN_MODE_KEY = 'expectedLoginRole';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  profileError: string | null;
  loading: boolean;
  isAdmin: boolean;
  isMentor: boolean;
  isOwner: boolean;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<UserProfile>) => Promise<void>;
  refreshProfile: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function pickSafeProfileUpdates(updates: Partial<UserProfile>): Partial<UserProfile> {
  const safe: Partial<UserProfile> = {};
  for (const key of PROFILE_SAFE_UPDATE_FIELDS) {
    if (key in updates && updates[key] !== undefined) {
      (safe as Record<string, unknown>)[key] = updates[key];
    }
  }
  return safe;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileVersion, setProfileVersion] = useState(0);

  const refreshProfile = () => setProfileVersion((v) => v + 1);

  const updateProfile = async (updates: Partial<UserProfile>) => {
    if (!profile?.uid) return;
    const safeUpdates = pickSafeProfileUpdates(updates);
    if (Object.keys(safeUpdates).length === 0) return;

    const profileRef = doc(db, 'users', profile.uid);
    await setDoc(profileRef, safeUpdates, { merge: true });
  };

  useEffect(() => {
    setPersistence(auth, browserLocalPersistence).catch(console.error);

    let profileUnsub: (() => void) | undefined;

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      profileUnsub?.();
      profileUnsub = undefined;

      if (!firebaseUser) {
        setUser(null);
        setProfile(null);
        setProfileError(null);
        setLoading(false);
        return;
      }

      setUser(firebaseUser);
      setLoading(true);
      setProfileError(null);

      const profileRef = doc(db, 'users', firebaseUser.uid);

      profileUnsub = onSnapshot(
        profileRef,
        async (profileSnap) => {
          if (!profileSnap.exists()) {
            const isGoogleSignIn = firebaseUser.providerData.some((p) => p.providerId === 'google.com');
            if (isGoogleSignIn && ownerEmail && firebaseUser.email?.toLowerCase() === ownerEmail) {
              const newProfile: UserProfile = {
                uid: firebaseUser.uid,
                displayName: firebaseUser.displayName || 'Owner',
                email: firebaseUser.email || '',
                role: 'OWNER',
                templeId: firebaseUser.uid,
              };
              await setDoc(profileRef, newProfile);
              return;
            }
            setProfile(null);
            setProfileError('No profile found for this account. Contact your temple administrator.');
            if (navigator.onLine) {
              await auth.signOut();
              setUser(null);
            }
            setLoading(false);
            return;
          }

          const data = profileSnap.data();

          if (data.isDeleted && !(ownerEmail && firebaseUser.email?.toLowerCase() === ownerEmail)) {
            setProfile(null);
            setProfileError('Your account is deactivated. Contact the temple administrator.');
            await auth.signOut();
            setUser(null);
            setLoading(false);
            return;
          }

          let roleToSet = data.role as UserRole;
          let templeIdToSet = data.templeId as string | undefined;
          let needsUpdate = false;

          if (ownerEmail && firebaseUser.email?.toLowerCase() === ownerEmail && roleToSet !== 'OWNER') {
            roleToSet = 'OWNER';
            needsUpdate = true;
          }
          if (roleToSet === 'OWNER' && !templeIdToSet) {
            templeIdToSet = firebaseUser.uid;
            needsUpdate = true;
          }
          if (data.isDeleted && ownerEmail && firebaseUser.email?.toLowerCase() === ownerEmail) {
            needsUpdate = true;
          }

          if (needsUpdate) {
            await setDoc(
              profileRef,
              { role: roleToSet, templeId: templeIdToSet, isDeleted: false },
              { merge: true }
            );
            return;
          }

          const fullProfile = {
            uid: firebaseUser.uid,
            ...data,
            role: roleToSet,
            templeId: templeIdToSet,
          } as UserProfile;

          const expectedMode = sessionStorage.getItem(PENDING_LOGIN_MODE_KEY) as LoginMode | null;
          if (expectedMode) {
            sessionStorage.removeItem(PENDING_LOGIN_MODE_KEY);
            if (!roleMatchesLoginMode(fullProfile.role, expectedMode)) {
              setProfile(null);
              setProfileError(
                `This account is registered as ${fullProfile.role}. Please use the correct login tab.`
              );
              await auth.signOut();
              setUser(null);
              setLoading(false);
              return;
            }
          }

          setProfile(fullProfile);
          setLoading(false);
        },
        (error) => {
          console.error('Profile stream error:', error);
          setProfile(null);
          setProfileError('Could not load your profile. Please try again.');
          setLoading(false);
        }
      );
    });

    return () => {
      profileUnsub?.();
      unsubscribe();
    };
  }, [profileVersion]);

  const signOut = async () => {
    setProfile(null);
    setProfileError(null);
    await auth.signOut();
  };

  const isOwner = profile?.role === 'OWNER';
  const isMentor = profile?.role === 'MENTOR' || isOwner;
  const isAdmin = isMentor;

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        profileError,
        loading,
        isAdmin,
        isMentor,
        isOwner,
        signOut,
        updateProfile,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
