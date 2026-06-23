import React, { useEffect, useState } from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { completeGoogleRedirectSignIn, authPersistenceReady } from './services/firebase';
import { roleMeetsMinimum } from './lib/authRoles';
import type { UserRole } from './types';
import { AnimatePresence } from 'motion/react';

import Login from './views/Login';
import Dashboard from './views/Dashboard';
import EventDetail from './views/EventDetail';
import DatabaseManagement from './views/DatabaseManagement';
import AttendanceSheet from './views/AttendanceSheet';
import History from './views/History';
import DevoteeProfile from './views/DevoteeProfile';
import PublicAttendance from './views/PublicAttendance';

const AuthLoadingScreen = () => (
  <div className="h-screen w-screen flex flex-col items-center justify-center bg-cream">
    <div className="w-16 h-16 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mb-8" />
    <div className="flex flex-col items-center gap-3">
      <p className="text-[10px] font-black text-stone-800 uppercase tracking-[0.4em] animate-pulse">Syncing Soul</p>
      <p className="text-xs font-medium text-stone-400 italic font-serif">Verifying presence at the temple...</p>
    </div>
  </div>
);

const ProtectedRoute: React.FC<{
  children: React.ReactNode;
  minRole?: UserRole;
}> = ({ children, minRole = 'USER' }) => {
  const { user, profile, loading, profileError } = useAuth();

  if (loading) return <AuthLoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (!profile) {
    return (
      <div className="h-screen flex flex-col items-center justify-center p-6 text-center bg-cream">
        <p className="text-stone-700 font-medium mb-2">Unable to verify your account</p>
        <p className="text-sm text-stone-500 mb-6">{profileError || 'Profile not found. Contact your administrator.'}</p>
        <a href="/#/login" className="text-primary font-bold text-sm">Return to Login</a>
      </div>
    );
  }
  if (!roleMeetsMinimum(profile.role as UserRole, minRole as UserRole)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

const AppContent = () => {
  return (
    <Router>
      <AnimatePresence mode="wait">
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/events/:id"
            element={
              <ProtectedRoute>
                <EventDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/database"
            element={
              <ProtectedRoute minRole="OWNER">
                <DatabaseManagement />
              </ProtectedRoute>
            }
          />
          <Route
            path="/attendance"
            element={
              <ProtectedRoute minRole="OWNER">
                <AttendanceSheet />
              </ProtectedRoute>
            }
          />
          <Route
            path="/history"
            element={
              <ProtectedRoute minRole="OWNER">
                <History />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile/:id"
            element={
              <ProtectedRoute>
                <DevoteeProfile />
              </ProtectedRoute>
            }
          />
          <Route path="/public-attendance/:id" element={<PublicAttendance />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AnimatePresence>
    </Router>
  );
};

export default function App() {
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
  let cancelled = false;

  (async () => {
    try {
      await authPersistenceReady;

      const alreadyPending = sessionStorage.getItem('expectedLoginRole') === 'owner';
      const looksLikeRedirectReturn =
        window.location.search.includes('__firebase_request_key') ||
        window.location.hash.includes('__firebase_request_key') ||
        alreadyPending;

      if (looksLikeRedirectReturn) {
        sessionStorage.setItem('expectedLoginRole', 'owner');
      }

      const user = await completeGoogleRedirectSignIn();
      if (user) {
        sessionStorage.setItem('expectedLoginRole', 'owner');
        console.log('[APP] Google redirect sign-in completed for:', user.email);
      }
    } catch (error) {
      console.error('Redirect sign-in check failed:', error);
    } finally {
      if (!cancelled) setAuthReady(true);
    }
  })();

  return () => {
    cancelled = true;
  };
}, []);

  if (!authReady) return <AuthLoadingScreen />;

  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
