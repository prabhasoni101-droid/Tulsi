import React, { useState, useEffect } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  signInWithGoogle,
  loginWithEmailOrUserId,
  loginOwnerWithTestCredentials,
  getAuthErrorMessage,
  isOwnerTestLoginEnabled,
} from '../services/firebase';
import type { LoginMode } from '../lib/authRoles';
import { isUnsupportedAuthHost } from '../lib/authErrors';

const PENDING_LOGIN_MODE_KEY = 'expectedLoginRole';
import { motion, AnimatePresence } from 'motion/react';
import { User, Shield, Crown, Lock, ChevronRight, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { cn } from '../lib/utils';

const Login = () => {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<LoginMode>('user');
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [hostWarning, setHostWarning] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isUnsupportedAuthHost()) {
      setHostWarning(
        'For Google sign-in, open http://localhost:3000 — not a LAN IP like 192.168.x.x.'
      );
    }
  }, []);

  if (loading || (user && !profile)) return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-50 font-sans text-primary">
       <div className="text-4xl font-bold animate-pulse">Radhe Radhe...</div>
       <p className="mt-4 text-slate-400">Loading your profile</p>
    </div>
  );
  if (user && profile) return <Navigate to="/" replace />;

  const handleGoogleLogin = async () => {
    setError('');
    setIsSubmitting(true);
    try {
      sessionStorage.setItem(PENDING_LOGIN_MODE_KEY, 'owner');
      await signInWithGoogle();
      // ← DO NOT navigate here! 
      // Let onAuthStateChanged fire and load profile,
      // then the component will auto-redirect via line 44
    } catch (err) {
      const message = getAuthErrorMessage(err);
      if (message !== 'REDIRECT_IN_PROGRESS') {
        setError(message);
      }
      setIsSubmitting(false);
    }
  };

  const handleOwnerTestLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      sessionStorage.setItem(PENDING_LOGIN_MODE_KEY, 'owner');
      await loginOwnerWithTestCredentials();
      // ← DO NOT navigate here! 
      // Let onAuthStateChanged fire and load profile
    } catch (err) {
      setError(getAuthErrorMessage(err));
      setIsSubmitting(false);
    }
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      sessionStorage.setItem(PENDING_LOGIN_MODE_KEY, mode);
      await loginWithEmailOrUserId(userId, password);
      // ← DO NOT navigate here! 
      // Let onAuthStateChanged fire and load profile
    } catch (err) {
      setError(getAuthErrorMessage(err));
      setIsSubmitting(false);
    }
  };

  const tabs = [
    { id: 'user', label: 'User', icon: User },
    { id: 'mentor', label: 'Mentor', icon: Shield },
    { id: 'owner', label: 'Owner', icon: Crown },
  ];

  return (
    <div 
      className="min-h-screen flex items-center justify-center p-4 bg-slate-50"
      style={{
        backgroundImage: 'linear-gradient(135deg, rgba(234, 88, 12, 0.85) 0%, rgba(30, 41, 59, 0.95) 50%, rgba(15, 23, 42, 1) 100%)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat'
      }}
    >
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-[450px] bg-white rounded-[32px] p-10 card-shadow border border-slate-100 flex flex-col items-center text-center space-y-8"
      >
        <div className="space-y-1 flex flex-col items-center">
          <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="ISKCON Logo" className="h-16 mb-2" />
          <h1 className="text-4xl font-bold tracking-tight text-slate-900">KrishnaSeva</h1>
          <p className="text-xs text-primary uppercase tracking-widest font-bold">Devotee Management</p>
        </div>

        {hostWarning && (
          <div className="w-full bg-amber-50 text-amber-800 text-xs py-3 px-4 rounded-xl border border-amber-100 text-left">
            {hostWarning}
          </div>
        )}

        <div className="flex w-full bg-slate-50 p-1 rounded-2xl border border-slate-100">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setMode(tab.id as LoginMode);
                setError('');
              }}
              className={cn(
                "flex-1 flex flex-col items-center gap-1 py-3 rounded-xl transition-all duration-300 relative overflow-hidden",
                mode === tab.id ? "bg-white shadow-sm text-slate-800" : "text-slate-400 hover:text-slate-600"
              )}
            >
              <tab.icon size={16} />
              <span className="text-[10px] uppercase font-bold tracking-wider">{tab.label}</span>
              {mode === tab.id && <motion.div layoutId="tab-underline" className="absolute bottom-0 left-0 w-full h-1 bg-primary" />}
            </button>
          ))}
        </div>

        <div className="w-full">
          <AnimatePresence mode="wait">
            {mode === 'owner' ? (
              <motion.div
                key="owner-google"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="space-y-6"
              >
                <div className="bg-amber-50 p-6 rounded-2xl border border-amber-100 text-left space-y-2">
                  <h3 className="text-amber-800 font-bold flex items-center gap-2">
                    <Crown size={18} /> Owner Access
                  </h3>
                  <p className="text-xs text-amber-700 leading-relaxed">
                    Sign in with your Google account. You will see all Google accounts saved on this device — pick the one you use for temple management.
                  </p>
                </div>

                {error && (
                  <div className="bg-red-50 text-red-600 text-xs py-2 px-3 rounded-lg flex items-start gap-2 text-left">
                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  disabled={isSubmitting}
                  className="w-full btn-primary py-4 gap-3 bg-white text-slate-700 border-2 border-slate-200 hover:bg-slate-50 shadow-lg"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  {isSubmitting ? 'Opening Google...' : 'Sign in with Google'}
                </button>

                <p className="text-[10px] text-slate-400 leading-relaxed">
                  Allow popups for this site if the account picker does not appear.
                </p>

                {isOwnerTestLoginEnabled && (
                  <>
                    <div className="flex items-center gap-3 py-1">
                      <div className="flex-1 h-px bg-slate-100" />
                      <span className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">CI / test login</span>
                      <div className="flex-1 h-px bg-slate-100" />
                    </div>
                    <form onSubmit={handleOwnerTestLogin} className="space-y-3 text-left">
                      <p className="text-[10px] text-slate-500">
                        Automated testing only (enabled via VITE_ENABLE_TEST_LOGIN).
                      </p>
                      <button
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full btn-secondary py-3 text-sm"
                      >
                        Sign in as Owner (test credentials)
                      </button>
                    </form>
                  </>
                )}
              </motion.div>
            ) : (
              <motion.form
                key={`${mode}-form`}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                onSubmit={handlePasswordLogin}
                className="space-y-4"
              >
                <div className="space-y-4 text-left">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase ml-2 tracking-widest">Username / ID</label>
                    <div className="relative">
                      <User size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" />
                      <input
                        type="text"
                        required
                        placeholder="e.g. sevak123"
                        className="w-full pl-11 pr-4 py-3.5 rounded-2xl bg-slate-50 border border-slate-100 focus:bg-white focus:border-primary focus:ring-4 ring-primary/5 outline-none transition-all text-sm font-medium"
                        value={userId}
                        onChange={e => setUserId(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase ml-2 tracking-widest">Password</label>
                    <div className="relative">
                      <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        placeholder="Password"
                        className="w-full pl-11 pr-11 py-3.5 rounded-2xl bg-slate-50 border border-slate-100 focus:bg-white focus:border-primary focus:ring-4 ring-primary/5 outline-none transition-all text-sm font-medium"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none focus:text-primary transition-colors"
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>
                </div>

                {error && (
                  <div className="bg-red-50 text-red-600 text-xs py-2 px-3 rounded-lg flex items-start gap-2 text-left">
                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full btn-primary py-4 gap-3"
                >
                  Sign in as {mode === 'user' ? 'User' : 'Mentor'}
                  <ChevronRight size={18} />
                </button>
              </motion.form>
            )}
          </AnimatePresence>
        </div>

        <p className="text-[10px] text-slate-400 font-medium">
          Hare Krishna, Hare Krishna, Krishna Krishna, Hare Hare<br/>
          Hare Rama, Hare Rama, Rama Rama, Hare Hare
        </p>
      </motion.div>
    </div>
  );
};

export default Login;
