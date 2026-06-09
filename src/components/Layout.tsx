import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { 
  BarChart3, 
  Users, 
  Calendar, 
  ShieldCheck, 
  ClipboardList, 
  LogOut,
  Menu,
  X,
  Database,
  History as HistoryIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

const getDriveImageUrl = (url: string) => {
  if (!url) return '';
  let fileId = '';
  if (url.includes('/file/d/')) {
    const match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) fileId = match[1];
  } else if (url.includes('id=')) {
    const match = url.match(/id=([a-zA-Z0-9_-]+)/);
    if (match && match[1]) fileId = match[1];
  }
  // drive.google.com/thumbnail is very robust for embedding shared images
  return fileId ? `https://drive.google.com/thumbnail?id=${fileId}&sz=w800` : url;
};

const PRABHUPADA_DRIVE_URL = "https://drive.google.com/file/d/17KB1frSXtI80lgu8qmF0tNfk3pPWbwBO/view?usp=sharing";

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { profile, signOut, isOwner, isMentor } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isMenuOpen, setIsMenuOpen] = React.useState(false);

  const menuItems = [
    { name: 'Dashboard', icon: BarChart3, path: '/', minRole: 'USER' },
    { name: 'Database', icon: Database, path: '/database', minRole: 'OWNER' },
    { name: 'Attendance', icon: ClipboardList, path: '/attendance', minRole: 'OWNER' },
    { name: 'History', icon: HistoryIcon, path: '/history', minRole: 'OWNER' },
  ];

  const handleLogout = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-cream flex flex-col md:flex-row font-sans">
      {/* Mobile Header */}
      <div className="md:hidden bg-white px-6 py-4 flex items-center justify-between sticky top-0 z-[60] border-b border-stone-100 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="Logo" className="w-8 h-8 object-contain" />
          <div className="flex flex-col">
            <span className="text-lg font-serif font-bold text-stone-800 tracking-tight leading-none">
              ISKCON<sup className="text-[10px] relative -top-[0.5em] ml-[1px]">®</sup>
            </span>
            <span className="text-[9px] font-bold uppercase tracking-[0.3em] text-stone-500 mt-1 leading-none">
              UJJAIN
            </span>
          </div>
        </div>
        <button onClick={() => setIsMenuOpen(!isMenuOpen)} className="text-stone-500 p-2 hover:bg-stone-50 rounded-lg transition-colors">
          {isMenuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Sidebar */}
      <AnimatePresence>
        {(isMenuOpen || true) && (
          <motion.div 
            initial={{ x: -280 }}
            animate={{ x: 0 }}
            className={cn(
              "fixed inset-y-0 left-0 z-50 w-72 bg-white border-r border-stone-100 flex-col md:relative md:flex transition-all duration-300",
              !isMenuOpen && "hidden md:flex"
            )}
          >
            {/* Sidebar Branding */}
            <div className="p-8 pb-4">
              <div className="flex items-center gap-4 mb-4">
                <img 
                  src={`${import.meta.env.BASE_URL}logo.svg`} 
                  alt="Logo" 
                  className="w-[73px] h-[73px] object-contain drop-shadow-sm transition-transform duration-300 hover:scale-105" 
                  referrerPolicy="no-referrer" 
                />
                <div className="flex flex-col pb-1">
                  <h1 className="text-3xl font-serif font-black text-stone-800 tracking-tighter leading-none">
                    ISKCON<sup className="text-[20px] font-bold leading-[0px] relative -top-[0.5em] ml-[1px]">®</sup>
                  </h1>
                  <span className="text-[12px] font-bold uppercase tracking-[0.4em] text-[#4a4a4a] mt-1.5 leading-none">
                    UJJAIN
                  </span>
                </div>
              </div>
              <div className="w-full h-[1px] bg-stone-100 mb-3" />
              <p className="text-[10px] text-stone-400 font-black uppercase tracking-[0.3em] px-1">
                Seva Management
              </p>
            </div>

            <nav className="flex-1 px-4 space-y-3 mt-8">
              {menuItems.map((item) => {
                if (item.minRole === 'OWNER' && !isOwner) return null;
                if (item.minRole === 'MENTOR' && !isMentor) return null;

                const isActive = location.pathname === item.path;
                return (
                  <button
                    key={item.name}
                    id={`nav-${item.name.toLowerCase()}`}
                    onClick={() => {
                      navigate(item.path);
                      setIsMenuOpen(false);
                    }}
                    className={cn(
                      "w-full flex items-center gap-4 px-6 py-4 rounded-2xl transition-all duration-300 text-base font-bold",
                      isActive 
                        ? "bg-gradient-to-r from-orange-400 to-orange-500 text-white shadow-lg shadow-orange-200" 
                        : "text-stone-500 hover:bg-stone-50 hover:text-orange-500"
                    )}
                  >
                    <item.icon size={22} className={cn("transition-colors", isActive ? "text-white" : "group-hover:text-orange-500")} />
                    <span>{item.name}</span>
                  </button>
                );
              })}
            </nav>

            {/* Bottom Profile Section */}
            <div className="p-6">
              <div className="px-6 py-5 flex items-center gap-4 bg-stone-50/50 rounded-[2.5rem] border border-stone-100 relative overflow-hidden group shadow-sm">
                 <div className="absolute inset-0 bg-stone-100/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                 <div className="relative z-10 min-w-0">
                    <p className="text-sm font-black text-stone-800 truncate mb-1 uppercase tracking-tight">
                      {profile?.displayName || profile?.email || 'Authorized Sevak'}
                    </p>
                    <p className="text-[9px] text-stone-400 font-bold uppercase tracking-widest flex items-center gap-2">
                       <ShieldCheck size={10} className="text-orange-500" />
                       {profile?.role === 'OWNER' ? 'Holy Administrator' : (profile?.role || 'Vaisnava')}
                    </p>
                 </div>
              </div>
              
              <button 
                onClick={handleLogout}
                className="mt-6 w-full flex items-center justify-center gap-3 py-3 text-stone-400 hover:text-red-500 transition-colors text-sm font-bold uppercase tracking-widest"
              >
                <LogOut size={16} />
                <span>Logout</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 overflow-x-hidden flex flex-col">
        {/* Top Header */}
        <div className="w-full max-w-7xl mx-auto px-6 pt-6 md:px-12 md:pt-12 flex justify-end items-center gap-4">
          <strong className="max-w-[200px] md:max-w-none text-right md:text-left text-stone-900 italic font-serif font-black text-[12px] md:text-[14px] tracking-wide bg-transparent">
            Founder Acarya: His Divine Grace A.C. Bhaktivedanta Swami Prabhupada
          </strong>
          <img 
            src={getDriveImageUrl(PRABHUPADA_DRIVE_URL)} 
            alt="Founder Acarya" 
            className="w-[100px] h-[90px] rounded-full border-2 border-[outset] border-orange-300 object-cover shadow-sm bg-white" 
            referrerPolicy="no-referrer"
          />
        </div>
        {/* Page Content */}
        <div className="p-6 md:px-12 md:py-8 max-w-7xl mx-auto w-full flex-1">
          {children}
        </div>
      </main>
    </div>
  );
};

export default Layout;

/**
 * @application ISKCON Seva Management App
 * @author MAHAKAL 
 * @development_year 2026
 * @description Global layout configuration and core UI structure.
 */

