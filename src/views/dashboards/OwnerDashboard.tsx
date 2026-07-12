import React, { useState, useEffect } from 'react';
import { db } from '../../services/firebase';
import { 
  collection, 
  query, 
  where,
  orderBy, 
  onSnapshot, 
  addDoc, 
  serverTimestamp, 
  updateDoc, 
  doc, 
  setDoc,
  deleteDoc,
  getDocs,
  writeBatch
} from 'firebase/firestore';
import { Event, UserProfile } from '../../types';
import {
  getEventVisibilityDefaults,
  softDeleteEventAndRevokeVisibility,
} from '../../services/eventVisibility';
import { motion } from 'motion/react';
import { 
  Plus, 
  Check,
  Calendar, 
  Users, 
  Eye, 
  EyeOff, 
  Shield, 
  Trash2,
  TrendingUp,
  Award,
  Clock
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { registerSevak, generateSecurePassword } from '../../services/firebase';
import { cn, normalizePhoneNumber, sanitizeMobileInput, isValidMobileNumber } from '../../lib/utils';
import { getFirestoreErrorMessage } from '../../lib/firestoreErrors';
import { uploadEventImage } from '../../lib/storage';

const OwnerDashboard = () => {
  const [events, setEvents] = useState<Event[]>([]);
  const [activeTab, setActiveTab] = useState<'events' | 'personnel'>('events');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [registrationMode, setRegistrationMode] = useState<'USER' | 'MENTOR'>('USER');
  const [regForm, setRegForm] = useState({ name: '', contact: '' });
  const [generatedCreds, setGeneratedCreds] = useState<{ id: string, pass: string } | null>(null);
  const [showPasswordMap, setShowPasswordMap] = useState<Record<string, boolean>>({});
  const [newEvent, setNewEvent] = useState({ title: '', date: '', description: '', mediaUrl: '' });
  const [templates, setTemplates] = useState<any[]>([]);
  const [creationStep, setCreationStep] = useState(1);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [importEventId, setImportEventId] = useState<string | null>(null);
  const [deletedEvents, setDeletedEvents] = useState<Event[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [allDevotees, setAllDevotees] = useState<any[]>([]);
  const navigate = useNavigate();
  const { profile } = useAuth();

  // Dialog state for confirmations
  const [dialog, setDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
    onCancel: () => {}
  });

  const openConfirm = (title: string, message: string, onConfirm: () => void) => {
    setDialog({
      isOpen: true,
      title,
      message,
      onConfirm: () => {
        setDialog(prev => ({ ...prev, isOpen: false }));
        onConfirm();
      },
      onCancel: () => setDialog(prev => ({ ...prev, isOpen: false }))
    });
  };

  useEffect(() => {
    if (!profile?.templeId) return;

    const templeId = profile.templeId;

    const qE = query(
      collection(db, 'events'),
      where('templeId', '==', templeId),
      orderBy('date', 'desc')
    );
    const unsubE = onSnapshot(qE, (snapshot) => {
      const all = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Event));
      setEvents(all.filter(e => !e.isDeleted));
      // Events permanently removed from the History tab are marked isArchived
      // (see History.tsx handlePermanentDelete) rather than hard-deleted, so we
      // must exclude them here too — otherwise they keep showing up forever in
      // the "Import Calling List" picker even after being permanently deleted.
      setDeletedEvents(all.filter(e => e.isDeleted && !(e as any).isArchived));
    });

    const qU = query(collection(db, 'users'), where('templeId', '==', templeId));
    const unsubU = onSnapshot(qU, (snapshot) => {
      setUsers(
        snapshot.docs
          .map(d => ({ uid: d.id, ...d.data() } as UserProfile))
          .filter(u => !u.isDeleted)
      );
    });

    const qD = query(collection(db, 'devotees'), where('templeId', '==', templeId));
    const unsubD = onSnapshot(qD, (snapshot) => {
      setAllDevotees(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    const qT = query(collection(db, 'templates'), where('templeId', '==', templeId));
    const unsubT = onSnapshot(qT, (snap) => {
      setTemplates(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    return () => {
      unsubE();
      unsubU();
      unsubD();
      unsubT();
    };
  }, [profile?.templeId]);

  const handleUpdateRole = async (userId: string, newRole: string) => {
    await updateDoc(doc(db, 'users', userId), { role: newRole });
  };

  const handleRegisterSevak = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regForm.name || !regForm.contact) return;

    if (!isValidMobileNumber(regForm.contact)) {
      alert("Please enter a valid 10-digit mobile number.");
      return;
    }
    
    setIsRegistering(true);
    try {
      const normalizedContact = normalizePhoneNumber(regForm.contact);
      
      // 1. Generate unique ID (name + 3 random digits)
      const uniqueId = `${regForm.name.toLowerCase().replace(/\s/g, '')}${Math.floor(100 + Math.random() * 900)}`;
      const password = generateSecurePassword();

      const userCred = await registerSevak(uniqueId, password);

      await setDoc(doc(db, 'users', userCred.user.uid), {
        displayName: regForm.name.trim(),
        contact: normalizedContact,
        role: registrationMode,
        email: userCred.user.email,
        username: uniqueId,
        password: password, // Store hashed password in production
        templeId: profile?.templeId || profile?.uid,
        isDeleted: false,
        createdAt: serverTimestamp()
      });

      setGeneratedCreds({ id: uniqueId, pass: password });
      setRegForm({ name: '', contact: '' });
    } catch (err: unknown) {
      alert(`Registration failed: ${getFirestoreErrorMessage(err)}`);
    } finally {
      setIsRegistering(false);
    }
  };

  const resizeImage = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 800;
          let width = img.width;
          let height = img.height;
          
          if (width > MAX_WIDTH) {
            height = Math.round((height * MAX_WIDTH) / width);
            width = MAX_WIDTH;
          }
          
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    });
  };

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) { // 2MB limit before resize to avoid huge browser mem spikes
        alert("Image is too large. Please select a smaller photo.");
        return;
      }
      const base64 = await resizeImage(file);
      setNewEvent({...newEvent, mediaUrl: base64});
    }
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEvent.title || !newEvent.date) return;

    const templeId = profile?.templeId || profile?.uid;
    if (!templeId) return;

    try {
      let mediaUrl = newEvent.mediaUrl;
      if (mediaUrl.startsWith('data:')) {
        mediaUrl = await uploadEventImage(templeId, mediaUrl);
      }

      await addDoc(collection(db, 'events'), {
        title: newEvent.title,
        date: newEvent.date,
        description: newEvent.description,
        mediaUrl,
        ...getEventVisibilityDefaults(),
        templeId,
        createdBy: profile?.uid,
        isDeleted: false,
        createdAt: serverTimestamp(),
      });
      setIsModalOpen(false);
      setNewEvent({ title: '', date: '', description: '', mediaUrl: '' });
    } catch (error) {
      console.error(error);
      alert(getFirestoreErrorMessage(error));
    }
  };

  return (
    <div className="space-y-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
        <div>
          <h2 className="text-4xl font-serif font-bold text-iskcon-gold tracking-tight border-b-2 border-iskcon-gold inline-block pb-1">Owner Control Panel</h2>
          <p className="text-stone-500 mt-3 text-lg font-medium">Manage events, assignments, and temple growth.</p>
        </div>
        
        <div className="flex items-center gap-2 bg-white/80 p-1.5 rounded-2xl shadow-sm border border-stone-100 backdrop-blur-sm">
          <button 
            onClick={() => setActiveTab('events')}
            className={cn(
              "px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all", 
              activeTab === 'events' ? "bg-orange-500 text-white shadow-lg shadow-orange-200" : "text-stone-400 hover:bg-stone-50 hover:text-stone-600"
            )}
          >
            Manage Events
          </button>
          <button 
            onClick={() => setActiveTab('personnel')}
            className={cn(
              "px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all", 
              activeTab === 'personnel' ? "bg-orange-500 text-white shadow-lg shadow-orange-200" : "text-stone-400 hover:bg-stone-50 hover:text-stone-600"
            )}
          >
            Personnel
          </button>
        </div>
      </div>

      {activeTab === 'events' ? (
        <div className="space-y-10">
          <div className="flex justify-end">
            <button 
              onClick={() => setIsModalOpen(true)}
              className="px-8 py-4 bg-gradient-to-r from-orange-400 to-orange-500 text-white rounded-2xl font-black uppercase tracking-[0.2em] text-[11px] flex items-center justify-center gap-2 shadow-2xl shadow-orange-200 hover:scale-105 transition-all active:scale-95"
            >
              <Plus size={18} />
              New Event
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
            {events.map((event) => (
              <motion.div 
                key={event.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-[2.5rem] overflow-hidden flex flex-col group border border-stone-100 shadow-xl shadow-stone-200/40 hover:shadow-2xl hover:shadow-orange-100 transition-all cursor-pointer relative"
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('.delete-btn')) return;
                  navigate(`/events/${event.id}`);
                }}
              >
                <div className="absolute top-6 right-6 z-10 delete-btn opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      openConfirm('Delete Event', 'Are you sure you want to remove this event?', async () => {
                        await softDeleteEventAndRevokeVisibility(event.id!, profile?.uid ?? null);
                      });
                    }}
                    className="p-3 bg-white/90 hover:bg-red-50 text-red-500 rounded-2xl shadow-xl backdrop-blur-sm transition-colors border border-red-50"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>

                <div className="w-full h-64 overflow-hidden relative">
                  {event.mediaUrl ? (
                    <img src={event.mediaUrl} alt={event.title} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-1000" />
                  ) : (
                    <div className="w-full h-full bg-stone-50 flex items-center justify-center text-stone-200">
                      <Calendar size={64} />
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/20 to-transparent pointer-events-none" />
                </div>

                <div className="p-8 space-y-6">
                  <div className="flex justify-between items-start gap-4">
                    <h3 className="text-2xl font-serif font-bold text-stone-800 line-clamp-2 leading-tight flex-1">{event.title}</h3>
                    {event.isPublic ? (
                      <span className="bg-emerald-50 text-emerald-600 text-[10px] uppercase font-black tracking-widest px-3 py-1.5 rounded-full flex items-center gap-2 border border-emerald-100 shadow-sm">
                        <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" /> Live
                      </span>
                    ) : (
                      <span className="bg-stone-100 text-stone-400 text-[10px] uppercase font-black tracking-widest px-3 py-1.5 rounded-full flex items-center gap-2 border border-stone-200 shadow-sm">
                         Internal
                      </span>
                    )}
                  </div>
                  
                  <div className="space-y-4">
                    <p className="flex items-center gap-3 text-sm font-bold text-orange-500 bg-orange-50/50 w-fit px-3 py-2 rounded-xl">
                      <Calendar size={16} /> 
                      {new Date(event.date).toLocaleDateString(undefined, { dateStyle: 'medium' })}
                    </p>
                    <p className="text-stone-500 italic leading-relaxed line-clamp-3">
                       {event.description || 'A very holy day of lord krishna on the land of devotion.'}
                    </p>
                  </div>

                  <div className="pt-6 border-t border-stone-50 flex justify-between items-center text-[11px] font-black uppercase tracking-[0.2em] text-stone-400">
                    <span className="flex items-center gap-2 group-hover:text-orange-500 transition-colors">
                      <Eye size={16} /> View Details
                    </span>
                    <span className="text-orange-500 border-b border-white hover:border-orange-500 transition-all">Click to Manage →</span>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

      ) : (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-[2.5rem] w-full p-0 flex flex-col md:flex-row overflow-hidden shadow-2xl shadow-stone-200/40 border border-stone-100 min-h-[600px]"
        >
          {/* Left Column: List */}
          <div className="flex-1 p-10 overflow-y-auto space-y-8">
            <div className="flex justify-between items-center border-b border-stone-50 pb-6">
               <h2 className="text-3xl font-serif font-black text-stone-800 tracking-tight">Authorized Personnel</h2>
               <div className="flex items-center gap-2 px-4 py-2 bg-stone-50 rounded-full border border-stone-100">
                 <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                 <span className="text-[10px] font-black text-stone-500 uppercase tracking-widest">Active Staff: {users.length}</span>
               </div>
            </div>
            <div className="space-y-6">
              {users.filter(u => u.role === 'OWNER').map(u => (
                <div key={u.uid} className="flex flex-col md:flex-row md:items-center justify-between p-7 bg-white rounded-[2rem] border border-stone-200 shadow-sm gap-8 transition-all group overflow-hidden relative">
                  <div className="flex-1 relative z-10 text-center md:text-left">
                    <div className="flex flex-col md:flex-row items-center gap-6">
                      <div className="w-16 h-16 bg-stone-900 text-white rounded-[1.25rem] flex items-center justify-center font-serif text-3xl font-black shadow-inner">
                        {u.displayName?.[0] || 'O'}
                      </div>
                      <div>
                        <p className="font-black text-stone-800 text-xl leading-tight font-serif italic mb-1">{u.displayName}</p>
                        <p className="text-xs text-stone-400 font-bold tracking-wide uppercase">{u.email}</p>
                      </div>
                    </div>
                  </div>
                  <div className="bg-stone-50/50 p-6 rounded-[1.5rem] border border-stone-100 min-w-[240px] relative z-10">
                     <p className="text-[9px] font-black text-stone-400 uppercase tracking-[0.3em] mb-4 text-center px-1">Login Credentials</p>
                     <div className="space-y-2">
                       <div className="flex justify-between items-center bg-white p-3 rounded-xl border border-stone-50 shadow-sm">
                         <span className="text-[9px] font-black text-stone-300 uppercase tracking-widest">ID</span>
                         <span className="text-sm font-mono font-bold text-stone-700 select-all tracking-tight">{(u as any).username || 'N/A'}</span>
                       </div>
                       <p className="text-[10px] text-stone-400 text-center italic px-1">
                         Password is never stored. Use Google sign-in or reset via admin.
                       </p>
                     </div>
                     {!(u as any).username && (
                        <p className="text-[9px] text-orange-400 mt-3 italic text-center font-bold px-1 uppercase tracking-widest">External Provider Access</p>
                     )}
                  </div>
                </div>
              ))}
              {users.filter(u => u.role !== 'OWNER').map(u => (
                <div key={u.uid} className="flex flex-col md:flex-row md:items-center justify-between p-7 bg-white rounded-[2rem] border border-stone-100 gap-8 hover:shadow-xl hover:shadow-orange-50 hover:border-orange-100 transition-all group overflow-hidden relative">
                  <div className="flex-1 relative z-10 text-center md:text-left">
                    <div className="flex flex-col md:flex-row items-center gap-6">
                      <div className="w-16 h-16 bg-stone-50 text-stone-300 rounded-[1.25rem] flex items-center justify-center font-serif text-3xl font-black group-hover:bg-orange-50 group-hover:text-orange-500 transition-colors shadow-inner">
                        {u.displayName?.[0] || 'U'}
                      </div>
                      <div>
                        <p className="font-black text-stone-800 text-xl leading-tight font-serif italic mb-1">{u.displayName}</p>
                        <p className="text-xs text-stone-400 font-bold tracking-wide uppercase">{u.email}</p>
                      </div>
                    </div>
                    <div className="flex justify-center md:justify-start gap-2 mt-6">
                      {['USER', 'MENTOR', 'OWNER'].map(role => (
                        <button 
                          key={role}
                          onClick={() => handleUpdateRole(u.uid, role)}
                          className={cn(
                            "px-4 py-2 rounded-xl text-[9px] font-black transition-all uppercase tracking-[0.2em] border",
                            u.role === role 
                              ? "bg-stone-900 text-white border-stone-900 shadow-lg" 
                              : "bg-white text-stone-400 border-stone-100 hover:border-stone-200 hover:text-stone-600"
                          )}
                        >
                          {role}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="bg-stone-50/50 p-6 rounded-[1.5rem] border border-stone-100 min-w-[240px] relative z-10">
                     <p className="text-[9px] font-black text-stone-400 uppercase tracking-[0.3em] mb-4 text-center px-1">Login Credentials</p>
                     <div className="space-y-2">
                       <div className="flex justify-between items-center bg-white p-3 rounded-xl border border-stone-50 shadow-sm">
                         <span className="text-[9px] font-black text-stone-300 uppercase tracking-widest">ID</span>
                         <span className="text-sm font-mono font-bold text-stone-700 select-all tracking-tight">{(u as any).username || 'N/A'}</span>
                       </div>
                       {(u as any).password ? (
                         <div className="flex justify-between items-center bg-white p-3 rounded-xl border border-stone-50 shadow-sm">
                           <span className="text-[9px] font-black text-stone-300 uppercase tracking-widest">Pass</span>
                           <div className="flex items-center gap-2">
                             <span className="text-sm font-mono font-bold text-stone-700 select-all tracking-tight">
                               {showPasswordMap[u.uid] ? (u as any).password : '••••••••'}
                             </span>
                             <button
                               onClick={() => setShowPasswordMap(prev => ({ ...prev, [u.uid]: !prev[u.uid] }))}
                               className="text-stone-400 hover:text-orange-500 transition-colors p-1 rounded-lg hover:bg-orange-50"
                               title={showPasswordMap[u.uid] ? 'Hide password' : 'Show password'}
                             >
                               {showPasswordMap[u.uid] ? <EyeOff size={14} /> : <Eye size={14} />}
                             </button>
                           </div>
                         </div>
                       ) : (
                         <p className="text-[10px] text-stone-400 text-center italic px-1">
                           Password not stored for this account.
                         </p>
                       )}
                     </div>
                     {!(u as any).username && (
                        <p className="text-[9px] text-orange-400 mt-3 italic text-center font-bold px-1 uppercase tracking-widest">External Provider Access</p>
                     )}
                     <button
                       onClick={() => {
                         openConfirm('Remove Member', 'De-authorizing this user will revoke all temple management access. Confirm removal?', async () => {
                           try {
                             await updateDoc(doc(db, 'users', u.uid), {
                               isDeleted: true,
                               deletedAt: serverTimestamp()
                             });
                           } catch (error: any) {
                             console.error(error);
                             alert("Failed to remove user: " + error.message);
                           }
                         });
                       }}
                       className="mt-6 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-white text-red-500 hover:bg-red-50 text-[10px] font-black uppercase tracking-widest transition-all border border-red-50 shadow-sm"
                     >
                       <Trash2 size={14} /> Remove Access
                     </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right Column: Registration */}
          <div className="w-full md:w-96 bg-white p-8 border-l border-stone-100 space-y-8">
            <div>
               <h3 className="text-xl font-serif font-bold text-stone-800 tracking-tight">Add Staff Member</h3>
               <p className="text-stone-500 text-xs mt-1">Register a new mentor or user for this temple.</p>
            </div>

            {generatedCreds ? (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-orange-50/50 p-6 rounded-3xl border border-orange-100 text-center space-y-4 shadow-sm"
              >
                <div className="w-14 h-14 bg-white text-orange-500 rounded-2xl flex items-center justify-center mx-auto mb-2 shadow-sm border border-orange-100">
                  <Shield size={28} />
                </div>
                <div>
                  <p className="text-xs font-black text-orange-500 uppercase tracking-widest">Credentials Generated</p>
                  <p className="text-stone-500 text-[10px] mt-1 italic">Provide these to the staff member</p>
                </div>
                <div className="space-y-2 text-left">
                  <div className="bg-white p-3 rounded-xl border border-stone-100 shadow-sm">
                    <p className="text-[10px] text-stone-400 uppercase font-black tracking-widest mb-1">User ID</p>
                    <p className="font-mono text-lg font-bold select-all text-stone-800">{generatedCreds.id}</p>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-stone-100 shadow-sm">
                    <p className="text-[10px] text-stone-400 uppercase font-black tracking-widest mb-1">Password</p>
                    <p className="font-mono text-lg font-bold select-all text-stone-800">{generatedCreds.pass}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setGeneratedCreds(null)}
                  className="w-full bg-orange-500 text-white py-3.5 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-orange-600 transition-all shadow-lg shadow-orange-100"
                >
                  Register Another
                </button>
              </motion.div>
            ) : (
              <form onSubmit={handleRegisterSevak} className="space-y-6">
                <div className="flex bg-stone-100 p-1.5 rounded-2xl border border-stone-100">
                  <button 
                    type="button"
                    onClick={() => setRegistrationMode('USER')}
                    className={cn(
                      "flex-1 py-3 rounded-xl text-[10px] font-black transition-all uppercase tracking-widest", 
                      registrationMode === 'USER' ? "bg-white text-orange-500 shadow-sm" : "text-stone-400 hover:text-stone-600"
                    )}
                  >
                    User
                  </button>
                  <button 
                    type="button"
                    onClick={() => setRegistrationMode('MENTOR')}
                    className={cn(
                      "flex-1 py-3 rounded-xl text-[10px] font-black transition-all uppercase tracking-widest", 
                      registrationMode === 'MENTOR' ? "bg-white text-orange-500 shadow-sm" : "text-stone-400 hover:text-stone-600"
                    )}
                  >
                    Mentor
                  </button>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-stone-400 uppercase tracking-widest px-1">Full Name</label>
                  <input 
                    type="text" required
                    placeholder="e.g. Rahul Arya"
                    className="w-full px-4 py-4 rounded-2xl border border-stone-200 bg-white focus:border-orange-500 focus:ring-4 ring-orange-50 outline-none text-sm font-medium transition-all"
                    value={regForm.name}
                    onChange={e => setRegForm({...regForm, name: e.target.value})}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-stone-400 uppercase tracking-widest px-1">Contact Number</label>
                  <input 
                    type="tel" required
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="e.g. 9876543210"
                    className="w-full px-4 py-4 rounded-2xl border border-stone-200 bg-white focus:border-orange-500 focus:ring-4 ring-orange-50 outline-none text-sm font-medium transition-all"
                    value={regForm.contact}
                    onChange={e => setRegForm({...regForm, contact: sanitizeMobileInput(e.target.value)})}
                  />
                </div>

                <button 
                  type="submit" 
                  disabled={isRegistering}
                  className="w-full bg-orange-500 text-white py-4 rounded-2xl text-[11px] font-black uppercase tracking-widest shadow-xl shadow-orange-100 hover:bg-orange-600 transition-all disabled:opacity-50"
                >
                  {isRegistering ? 'Processing...' : `Register ${registrationMode === 'USER' ? 'User' : 'Mentor'}`}
                </button>
              </form>
            )}
          </div>

        </motion.div>
      )}

      {/* Create Event Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-[3rem] w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
          >
            <div className="p-10 pb-6 border-b border-stone-100">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-4">
                  <span className="w-10 h-10 bg-orange-500 rounded-full flex items-center justify-center text-white font-black text-xs">
                    {creationStep}
                  </span>
                  <h2 className="text-3xl font-serif font-black text-stone-800 tracking-tight">
                    {creationStep === 1 ? "Event Profile" : creationStep === 2 ? "Connect Form" : "Import Calling List"}
                  </h2>
                </div>
                <button 
                  onClick={() => {
                    setIsModalOpen(false);
                    setCreationStep(1);
                    setSelectedTemplateId(null);
                  }}
                >
                  <Plus className="rotate-45 text-stone-400 hover:text-orange-500 transition-colors" size={32} />
                </button>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto px-10 py-6 custom-scrollbar">
              {creationStep === 1 ? (
                <form 
                  id="event-profile-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setCreationStep(2);
                  }} 
                  className="space-y-8"
                >
                  <div className="space-y-6">
                    <div className="space-y-3">
                      <label className="text-[10px] font-black text-stone-400 uppercase tracking-[0.4em] px-1">Sacred Title</label>
                      <input 
                        type="text" required
                        className="w-full px-6 py-4 rounded-[1.5rem] border border-stone-100 bg-stone-50/30 focus:bg-white focus:border-orange-200 outline-none transition-all shadow-inner font-bold text-stone-800"
                        value={newEvent.title}
                        onChange={e => setNewEvent({...newEvent, title: e.target.value})}
                        placeholder="e.g. Sunday Love Feast"
                      />
                    </div>
                    <div className="space-y-3">
                      <label className="text-[10px] font-black text-stone-400 uppercase tracking-[0.4em] px-1">Temporal Date</label>
                      <input 
                        type="date" required
                        className="w-full px-6 py-4 rounded-[1.5rem] border border-stone-100 bg-stone-50/30 focus:bg-white focus:border-orange-200 outline-none transition-all shadow-inner font-bold text-stone-800"
                        value={newEvent.date}
                        onChange={e => setNewEvent({...newEvent, date: e.target.value})}
                      />
                    </div>
                    <div className="space-y-3">
                      <label className="text-[10px] font-black text-stone-400 uppercase tracking-[0.4em] px-1">Description</label>
                      <textarea 
                        rows={3}
                        className="w-full px-6 py-4 rounded-[1.5rem] border border-stone-100 bg-stone-50/30 focus:bg-white focus:border-orange-200 outline-none transition-all shadow-inner font-bold text-stone-800 resize-none"
                        value={newEvent.description}
                        onChange={e => setNewEvent({...newEvent, description: e.target.value})}
                        placeholder="Share the significance..."
                      />
                    </div>
                    <div className="space-y-3">
                      <label className="text-[10px] font-black text-stone-400 uppercase tracking-[0.4em] px-1">Visual Banner</label>
                      <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-stone-100 border-dashed rounded-[2rem] hover:border-orange-200 transition-colors bg-stone-50/20">
                        <div className="space-y-1 text-center">
                          {newEvent.mediaUrl ? (
                            <div className="relative group inline-block">
                              <img src={newEvent.mediaUrl} alt="Preview" className="h-32 w-48 object-cover rounded-2xl shadow-xl border-4 border-white" />
                              <button 
                                type="button"
                                onClick={() => setNewEvent({...newEvent, mediaUrl: ''})}
                                className="absolute -top-3 -right-3 bg-red-500 text-white rounded-full p-2 shadow-lg hover:scale-110 transition-transform"
                              >
                                <Plus className="rotate-45" size={16} />
                              </button>
                            </div>
                          ) : (
                            <div className="py-4">
                              <div className="flex text-sm text-stone-600 justify-center mb-2">
                                <label className="relative cursor-pointer bg-white px-4 py-2 rounded-xl border border-stone-100 font-bold text-orange-500 hover:text-orange-600 focus-within:outline-none transition-all shadow-sm">
                                  <span>Select Photo</span>
                                  <input 
                                    type="file" accept="image/*" className="sr-only"
                                    onChange={handleImageChange}
                                  />
                                </label>
                              </div>
                              <p className="text-[10px] text-stone-400 font-black uppercase tracking-widest">PNG, JPG up to 2MB</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </form>
              ) : creationStep === 2 ? (
                <div className="space-y-8 animate-in slide-in-from-right-4 duration-500">
                  <div className="space-y-4">
                    <p className="text-sm text-stone-500 font-medium italic">Select an attendance template for this event:</p>
                    <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                      {templates.map(t => (
                        <div 
                          key={t.id}
                          onClick={() => setSelectedTemplateId(t.id)}
                          className={cn(
                            "group p-6 rounded-[1.5rem] border transition-all cursor-pointer flex items-center justify-between",
                            selectedTemplateId === t.id ? "bg-orange-50 border-orange-200 ring-2 ring-orange-500" : "bg-white border-stone-100 hover:border-orange-200"
                          )}
                        >
                          <div>
                            <h4 className="font-bold text-stone-800 font-serif">{t.name}</h4>
                            <p className="text-[10px] text-stone-400 font-bold uppercase tracking-widest mt-1 italic">
                              {t.fields.map((fId: string) => fId.charAt(0).toUpperCase() + fId.slice(1)).join(', ')}
                            </p>
                          </div>
                          <div className={cn(
                            "w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all",
                            selectedTemplateId === t.id ? "border-orange-500 bg-orange-500 text-white" : "border-stone-100"
                          )}>
                            {selectedTemplateId === t.id ? <Check size={14} strokeWidth={4} /> : <div className="w-2 h-2 bg-stone-50 rounded-full group-hover:bg-orange-200" />}
                          </div>
                        </div>
                      ))}
                      {templates.length === 0 && (
                        <div className="py-10 text-center border-2 border-dashed border-stone-100 rounded-[2rem]">
                          <p className="text-stone-400 italic text-sm">No templates configured yet.</p>
                          <button 
                            onClick={() => {
                              navigate('/attendance');
                              setIsModalOpen(false);
                            }}
                            className="text-orange-500 font-black uppercase text-[10px] tracking-widest mt-2 hover:underline"
                          >
                            Go to Form Designer →
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-8 animate-in slide-in-from-right-4 duration-500">
                  <div className="space-y-4">
                    <p className="text-sm text-stone-500 font-medium italic">Optionally import a calling list from a deleted event:</p>
                    <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                      {deletedEvents.length > 0 ? (
                        deletedEvents.map(e => (
                          <div 
                            key={e.id}
                            onClick={() => setImportEventId(importEventId === e.id ? null : e.id!)}
                            className={cn(
                              "p-5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between",
                              importEventId === e.id ? "bg-blue-50 border-blue-200 ring-2 ring-blue-500" : "bg-white border-stone-100 hover:border-blue-200"
                            )}
                          >
                            <div className="flex items-center gap-4">
                               <div className="w-10 h-10 bg-stone-50 rounded-xl flex items-center justify-center text-stone-300">
                                  <Clock size={18} />
                               </div>
                               <div>
                                  <h4 className="font-bold text-stone-800 text-sm">{e.title}</h4>
                                  <p className="text-[10px] text-stone-400 font-bold uppercase tracking-widest leading-none mt-1">
                                    {new Date(e.date).toLocaleDateString()}
                                  </p>
                               </div>
                            </div>
                            <div className={cn(
                              "w-5 h-5 rounded-full border-2 flex items-center justify-center",
                              importEventId === e.id ? "border-blue-500 bg-blue-500 text-white" : "border-stone-100"
                            )}>
                              {importEventId === e.id && <Check size={12} strokeWidth={4} />}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="py-10 text-center border-2 border-dashed border-stone-100 rounded-[2rem]">
                          <p className="text-stone-400 italic text-sm">No deleted events found for import.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="pt-6 border-t border-stone-100">
              {creationStep === 1 ? (
                <button 
                  form="event-profile-form"
                  type="submit" 
                  className="w-full bg-stone-900 text-white py-6 rounded-[1.5rem] font-black uppercase tracking-[0.3em] text-xs shadow-2xl shadow-stone-200 hover:bg-black transition-all active:scale-[0.98]"
                >
                  Next Step →
                </button>
              ) : creationStep === 2 ? (
                 <button 
                   onClick={() => setCreationStep(3)}
                   className="w-full bg-stone-900 text-white py-6 rounded-[1.5rem] font-black uppercase tracking-[0.3em] text-xs shadow-2xl shadow-stone-200 hover:bg-black transition-all active:scale-[0.98]"
                 >
                   Next: Import List →
                 </button>
              ) : (
                <div className="flex flex-col gap-3">
                  <button 
                    onClick={async () => {
                      if (!newEvent.title || !newEvent.date) return;
                      try {
                        const eventDoc = await addDoc(collection(db, 'events'), {
                          ...newEvent,
                          ...getEventVisibilityDefaults(),
                          templateId: selectedTemplateId,
                          templeId: profile?.templeId || profile?.uid,
                          createdBy: profile?.uid,
                          isDeleted: false,
                          createdAt: serverTimestamp(),
                          originalEventId: importEventId
                        });

                        // If import requested, copy assignments
                        if (importEventId) {
                          const assignmentsSnap = await getDocs(collection(db, 'events', importEventId, 'assignments'));
                          if (!assignmentsSnap.empty) {
                            const batch = writeBatch(db);
                            assignmentsSnap.forEach(snap => {
                              const data = snap.data();
                              const newAssignmentRef = doc(collection(db, 'events', eventDoc.id, 'assignments'));
                              batch.set(newAssignmentRef, {
                                ...data,
                                status: 'PENDING',
                                response: 'NONE',
                                responseText: '',
                                updatedAt: new Date().toISOString()
                              });
                            });
                            await batch.commit();
                          }
                        }

                        setIsModalOpen(false);
                        setCreationStep(1);
                        setSelectedTemplateId(null);
                        setImportEventId(null);
                        setNewEvent({ title: '', date: '', description: '', mediaUrl: '' });
                      } catch (error) {
                        console.error(error);
                      }
                    }}
                    className="w-full bg-stone-900 text-white py-6 rounded-[1.5rem] font-black uppercase tracking-[0.3em] text-xs transition-all active:scale-[0.98] shadow-2xl shadow-stone-200 hover:bg-black"
                  >
                    {importEventId ? "Import & Produce" : "Finalize Event"}
                  </button>
                  <button 
                    onClick={() => setCreationStep(2)}
                    className="w-full py-4 text-stone-400 font-black uppercase tracking-widest text-[10px] hover:text-stone-600 transition-colors"
                  >
                    ← Back to Template
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}

      {dialog.isOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-stone-900/40 backdrop-blur-sm p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white p-8 rounded-3xl shadow-2xl w-full max-w-sm border border-stone-100 text-center"
          >
            <div className="w-16 h-16 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <Trash2 size={32} />
            </div>
            <h3 className="text-2xl font-bold font-serif text-stone-800 mb-2">{dialog.title}</h3>
            <p className="text-stone-500 mb-8 leading-relaxed italic">{dialog.message}</p>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={dialog.onCancel} className="px-6 py-3 bg-stone-100 hover:bg-stone-200 rounded-2xl font-bold text-stone-600 transition-colors">
                Cancel
              </button>
              <button 
                onClick={dialog.onConfirm}
                className="px-6 py-3 bg-red-500 hover:bg-red-600 text-white rounded-2xl font-black uppercase tracking-widest shadow-lg shadow-red-200 transition-all hover:scale-[1.02]"
              >
                Delete
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default OwnerDashboard;
