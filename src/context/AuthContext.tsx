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
            const expectedMode = sessionStorage.getItem(PENDING_LOGIN_MODE_KEY) as LoginMode | null;
            const isOwnerBootstrap =
              isGoogleSignIn &&
              (expectedMode === 'owner' ||
                (!!ownerEmail && firebaseUser.email?.toLowerCase() === ownerEmail));

            if (isOwnerBootstrap) {
              sessionStorage.removeItem(PENDING_LOGIN_MODE_KEY);
              const newProfile: UserProfile = {
                uid: firebaseUser.uid,
                displayName: firebaseUser.displayName || 'Owner',
                email: firebaseUser.email || '',
                role: 'OWNER',
                templeId: firebaseUser.uid,
              };
              try {
                await setDoc(profileRef, {
                  ...newProfile,
                  isDeleted: false,
                });
                // ← Profile now exists in Firestore, onSnapshot will fire again
                // Set profile immediately to prevent race condition
                setProfile(newProfile);
                setLoading(false);
              } catch (error) {
                console.error('Owner profile bootstrap failed:', error);
                setProfile(null);
                setProfileError('Could not initialize owner portal. Please check Firestore permissions.');
                setLoading(false);
              }
              // ← DO NOT return - let onSnapshot re-fire to load complete profile from Firestore
              return;
            }
            const newProfile: UserProfile = {
             uid: firebaseUser.uid,
             displayName: firebaseUser.displayName || firebaseUser.email || 'User',
             email: firebaseUser.email || '',
             role: 'USER',
             templeId: firebaseUser.uid,
            };

            try {
              await setDoc(profileRef, { ...newProfile, isDeleted: false });
              setProfile(newProfile);
              setLoading(false);
            } catch (error) {
              console.error('User profile creation failed:', error);
              setProfile(null);
              setProfileError('Could not create user profile. Please check Firestore permissions or try again.');
              setLoading(false);
            }
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
            try {
              await setDoc(
                profileRef,
                { role: roleToSet, templeId: templeIdToSet, isDeleted: false },
                { merge: true }
              );
              setLoading(false);
            } catch (error) {
              console.error('Profile update failed:', error);
              setProfile(null);
              setProfileError('Could not update profile. Please check Firestore permissions or try again.');
              setLoading(false);
            }
            return;
          }

          const fullProfile = {
            uid: firebaseUser.uid,
            ...data,
            role: roleToSet,
            templeId: templeIdToSet,
          } as UserProfile;

          // Clear any pending login mode, but allow the user to proceed
          // Role validation happens at route protection level (ProtectedRoute)
          sessionStorage.removeItem(PENDING_LOGIN_MODE_KEY);

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
