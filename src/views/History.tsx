import React, { useState, useEffect } from 'react';
import { db } from '../services/firebase';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  doc, 
  updateDoc, 
  deleteDoc, 
  writeBatch,
  getDocs,
  serverTimestamp
} from 'firebase/firestore';
import { Event, Devotee, UserProfile } from '../types';
import Layout from '../components/Layout';
import { motion, AnimatePresence } from 'motion/react';
import { 
  History as HistoryIcon, 
  Trash2, 
  RotateCcw, 
  Calendar, 
  Users, 
  AlertTriangle,
  Clock
} from 'lucide-react';
import { cn, normalizePhoneNumber } from '../lib/utils';
import { useAuth } from '../context/AuthContext';
import { SearchInput } from '../components/SearchInput';

export default function History() {
  const [activeTab, setActiveTab] = useState<'events' | 'devotees' | 'staff' | 'profileActivity'>('events');
  const [deletedEvents, setDeletedEvents] = useState<Event[]>([]);
  const [deletedDevotees, setDeletedDevotees] = useState<Devotee[]>([]);
  const [deletedStaff, setDeletedStaff] = useState<UserProfile[]>([]);
  const [deletedProfileActivities, setDeletedProfileActivities] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedPA, setExpandedPA] = useState<Record<string, boolean>>({});
  const { profile } = useAuth();

  const getHighlightClass = (devotee: Devotee) => {
    const name = devotee.name || (devotee as any).Name || '';
    const contact = devotee.contact || (devotee as any)['Contact No.'] || '';
    
    if (!name || !contact) return 'bg-white border-stone-100';
    
    const c = normalizePhoneNumber(contact);
    const n = name.trim().toLowerCase();
    
    const nameCount = deletedDevotees.filter(d => {
      const dName = (d.name || (d as any).Name || '').trim().toLowerCase();
      return dName === n;
    }).length;
    
    const contactCount = deletedDevotees.filter(d => {
      const dContact = normalizePhoneNumber(d.contact || (d as any)['Contact No.'] || '');
      return dContact === c;
    }).length;
    
    const bothCount = deletedDevotees.filter(d => {
      const dName = (d.name || (d as any).Name || '').trim().toLowerCase();
      const dContact = normalizePhoneNumber(d.contact || (d as any)['Contact No.'] || '');
      return dName === n && dContact === c;
    }).length;

    if (bothCount > 1) return 'bg-red-50 border-red-200';
    if (contactCount > 1) return 'bg-emerald-50 border-emerald-200';
    if (nameCount > 1) return 'bg-sky-50 border-sky-200';
    
    return 'bg-white border-stone-100';
  };
  
  // Dialog state
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

  const togglePA = (id: string) => {
    setExpandedPA(prev => ({ ...prev, [id]: !prev[id] }));
  };

  useEffect(() => {
    if (!profile?.templeId) return;

    // Fetch deleted events
    const unsubE = onSnapshot(collection(db, 'events'), (snap) => {
      setDeletedEvents(snap.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as Event))
        .filter(e => e.templeId === profile.templeId && e.isDeleted && !(e as any).isArchived)
      );
    });

    // Fetch deleted devotees
    const unsubD = onSnapshot(collection(db, 'devotees'), (snap) => {
      setDeletedDevotees(snap.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as Devotee))
        .filter(d => d.templeId === profile.templeId && d.isDeleted)
      );
    });

    // Fetch deleted staff
    const unsubS = onSnapshot(collection(db, 'users'), (snap) => {
      setDeletedStaff(snap.docs
        .map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile))
        .filter(u => u.templeId === profile.templeId && u.isDeleted)
      );
    });

    // Fetch deleted profile activities from callingHistory
    const unsubPA = onSnapshot(collection(db, 'callingHistory'), (snap) => {
      setDeletedProfileActivities(snap.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter((pa: any) => pa.isDeleted && (pa.templeId === profile.templeId || !pa.templeId))
      );
    });

    return () => {
      unsubE();
      unsubD();
      unsubS();
      unsubPA();
    };
  }, [profile?.templeId]);

  // Auto-cleanup logic: run on mount
  useEffect(() => {
    const runCleanup = async () => {
      if (!profile?.templeId) return;
      
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const batch = writeBatch(db);
      let count = 0;

      // Check events
      const eventsSnap = await getDocs(collection(db, 'events'));
      eventsSnap.forEach(snap => {
        const data = snap.data();
        if (data.templeId === profile.templeId && data.isDeleted && data.deletedAt && !data.isArchived) {
          const deletedDate = data.deletedAt.toDate ? data.deletedAt.toDate() : new Date(data.deletedAt);
          if (deletedDate < thirtyDaysAgo) {
            batch.update(snap.ref, { isArchived: true });
            count++;
          }
        }
      });

      // Check devotees
      const devoteesSnap = await getDocs(collection(db, 'devotees'));
      devoteesSnap.forEach(snap => {
        const data = snap.data();
        if (data.templeId === profile.templeId && data.isDeleted && data.deletedAt) {
          const deletedDate = data.deletedAt.toDate ? data.deletedAt.toDate() : new Date(data.deletedAt);
          if (deletedDate < thirtyDaysAgo) {
            batch.delete(snap.ref);
            count++;
          }
        }
      });

      // Check users/staff
      const usersSnap = await getDocs(collection(db, 'users'));
      usersSnap.forEach(snap => {
        const data = snap.data();
        if (data.templeId === profile.templeId && data.isDeleted && data.deletedAt) {
          const deletedDate = data.deletedAt.toDate ? data.deletedAt.toDate() : new Date(data.deletedAt);
          if (deletedDate < thirtyDaysAgo) {
            batch.delete(snap.ref);
            count++;
          }
        }
      });

      // Check callingHistory / profile activities
      const historySnap = await getDocs(collection(db, 'callingHistory'));
      historySnap.forEach(snap => {
        const data = snap.data();
        if (data.isDeleted && data.deletedAt) {
          const deletedDate = data.deletedAt.toDate ? data.deletedAt.toDate() : new Date(data.deletedAt);
          if (deletedDate < thirtyDaysAgo) {
            batch.delete(snap.ref);
            count++;
          }
        }
      });

      if (count > 0) {
        await batch.commit();
        console.log(`Auto-cleanup permanently deleted ${count} records older than 30 days.`);
      }
    };

    runCleanup();
  }, [profile?.templeId]);

  const handleRestoreEvent = async (id: string) => {
    await updateDoc(doc(db, 'events', id), {
      isDeleted: false,
      deletedAt: null
    });
  };

  const handleRestoreDevotee = async (id: string) => {
    await updateDoc(doc(db, 'devotees', id), {
      isDeleted: false,
      deletedAt: null
    });
  };

  const handleRestoreStaff = async (id: string) => {
    await updateDoc(doc(db, 'users', id), {
      isDeleted: false,
      deletedAt: null
    });
  };

  const handleRestoreProfileActivity = async (id: string) => {
    await updateDoc(doc(db, 'callingHistory', id), {
      isDeleted: false,
      deletedAt: null
    });
  };

  const handleClearAll = async () => {
    const currentList = 
      activeTab === 'events' ? filteredEvents : 
      activeTab === 'devotees' ? filteredDevotees : 
      activeTab === 'staff' ? filteredStaff : 
      filteredProfileActivities;

    if (currentList.length === 0) return;

    const typeLabel = 
      activeTab === 'events' ? 'Events' : 
      activeTab === 'devotees' ? 'Devotees' : 
      activeTab === 'staff' ? 'Personals' : 
      'Profile Activities';

    openConfirm(
      "Clear All History", 
      `Are you sure you want to permanently delete all ${currentList.length} ${typeLabel}? This cannot be undone.`, 
      async () => {
        const batch = writeBatch(db);
        for (const item of currentList) {
          const id = (item as any).id || (item as any).uid;
          const collectionName = 
            activeTab === 'events' ? 'events' : 
            activeTab === 'devotees' ? 'devotees' : 
            activeTab === 'staff' ? 'users' : 
            'callingHistory';
          
          if (collectionName === 'events') {
            batch.update(doc(db, 'events', id), { isArchived: true });
          } else {
            batch.delete(doc(db, collectionName, id));
          }
        }
        await batch.commit();
      }
    );
  };

  const handlePermanentDelete = async (type: 'event' | 'devotee' | 'user', id: string) => {
    openConfirm(
      "Permanent Deletion", 
      "This action is irreversible. Records will be lost forever.", 
      async () => {
        if (type === 'event') {
          await updateDoc(doc(db, 'events', id), { isArchived: true });
        } else {
          await deleteDoc(doc(db, type === 'devotee' ? 'devotees' : 'users', id));
        }
      }
    );
  };

  const handlePermanentDeleteProfileActivity = async (id: string) => {
    openConfirm(
      "Permanent Deletion", 
      "This action is irreversible. Records will be lost forever.", 
      async () => {
        await deleteDoc(doc(db, 'callingHistory', id));
      }
    );
  };

  const handleWipeEverything = async () => {
    const total = deletedEvents.length + deletedDevotees.length + deletedStaff.length + deletedProfileActivities.length;
    if (total === 0) return;

    openConfirm(
      "Wipe All Archives",
      `Are you sure you want to permanently delete ALL ${total} records across ALL categories? This action is absolutely irreversible.`,
      async () => {
        const batch = writeBatch(db);
        
        for (const e of deletedEvents) {
          batch.update(doc(db, 'events', e.id!), { isArchived: true });
        }
        deletedDevotees.forEach(d => batch.delete(doc(db, 'devotees', d.id!)));
        deletedStaff.forEach(s => batch.delete(doc(db, 'users', s.uid)));
        deletedProfileActivities.forEach(pa => batch.delete(doc(db, 'callingHistory', pa.id)));

        await batch.commit();
      }
    );
  };

  const filteredEvents = deletedEvents.filter(e => 
    (e.title || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
    (e.description || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredDevotees = deletedDevotees.filter(d => 
    (d.name || (d as any).Name || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
    (d.contact || (d as any)['Contact No.'] || '').includes(searchTerm)
  );

  const filteredStaff = deletedStaff.filter(s => 
    (s.displayName || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
    (s.email || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredProfileActivities = deletedProfileActivities.filter(pa => 
    (pa.eventName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (pa.assignments || []).some((ass: any) => 
      (ass.devoteeName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (ass.devoteeContact || '').includes(searchTerm)
    )
  );

  const getDaysLeft = (deletedAt?: any) => {
    if (!deletedAt) return 30;
    const delDate = deletedAt?.seconds ? new Date(deletedAt.seconds * 1000) : new Date(deletedAt);
    const now = new Date();
    const diffTime = now.getTime() - delDate.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return Math.max(0, 30 - diffDays);
  };

  return (
    <Layout>
      <div className="space-y-10">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <HistoryIcon className="text-orange-500" size={20} />
              <span className="text-[10px] font-black text-orange-500 uppercase tracking-[0.4em]">Seva Archives</span>
            </div>
            <h1 className="text-5xl font-serif font-black text-stone-800 tracking-tight">Records History</h1>
            <p className="text-stone-400 font-medium text-lg mt-3 italic">Deleted items are kept here for 30 days before permanent removal.</p>
          </div>

          <div className="flex items-center gap-2 bg-white rounded-2xl p-1.5 border border-stone-100 shadow-sm overflow-x-auto max-w-full">
            <button 
              onClick={() => setActiveTab('events')}
              className={cn(
                "px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shrink-0",
                activeTab === 'events' ? "bg-orange-500 text-white shadow-lg shadow-orange-200" : "text-stone-400 hover:text-stone-600"
              )}
            >
              Events ({deletedEvents.length})
            </button>
            <button 
              onClick={() => setActiveTab('devotees')}
              className={cn(
                "px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shrink-0",
                activeTab === 'devotees' ? "bg-orange-500 text-white shadow-lg shadow-orange-200" : "text-stone-400 hover:text-stone-600"
              )}
            >
              Devotees ({deletedDevotees.length})
            </button>
            <button 
              onClick={() => setActiveTab('staff')}
              className={cn(
                "px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shrink-0",
                activeTab === 'staff' ? "bg-orange-500 text-white shadow-lg shadow-orange-200" : "text-stone-400 hover:text-stone-600"
              )}
            >
              Personals ({deletedStaff.length})
            </button>
            <button 
              onClick={() => setActiveTab('profileActivity')}
              className={cn(
                "px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shrink-0",
                activeTab === 'profileActivity' ? "bg-orange-500 text-white shadow-lg shadow-orange-200" : "text-stone-400 hover:text-stone-600"
              )}
            >
              Profile Activity ({deletedProfileActivities.length})
            </button>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-6 items-center">
          <SearchInput 
            className="flex-1"
            placeholder={
              activeTab === 'events' ? "Search deleted events..." : 
              activeTab === 'devotees' ? "Search deleted devotees..." : 
              activeTab === 'staff' ? "Search deleted personals..." : 
              "Search profile activity..."
            }
            value={searchTerm}
            onChange={setSearchTerm}
          />
          
          {(deletedEvents.length + deletedDevotees.length + deletedStaff.length + deletedProfileActivities.length) > 0 && (
            <div className="flex items-center gap-3 w-full lg:w-auto justify-end">
              <button
                onClick={handleClearAll}
                className="px-6 py-3 bg-red-50 text-red-500 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-red-500 hover:text-white transition-all flex items-center gap-2 border border-red-100 shadow-sm"
              >
                <Trash2 size={14} /> Clear {
                  activeTab === 'events' ? 'Events' : 
                  activeTab === 'devotees' ? 'Devotees' : 
                  activeTab === 'staff' ? 'Personals' : 
                  'Activities'
                }
              </button>
              <button
                onClick={handleWipeEverything}
                className="px-6 py-3 bg-stone-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-red-600 transition-all flex items-center gap-2 shadow-xl shadow-stone-200"
              >
                <AlertTriangle size={14} /> Wipe All Archives
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          <AnimatePresence mode="popLayout">
            {activeTab === 'events' ? (
              filteredEvents.map(event => (
                <motion.div 
                  key={event.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="bg-white rounded-[2rem] border border-stone-100 shadow-xl shadow-stone-200/40 overflow-hidden flex flex-col group relative"
                >
                  <div className="absolute top-4 right-4 bg-orange-50 px-3 py-1.5 rounded-full border border-orange-100 z-10">
                    <span className="text-[9px] font-black text-orange-600 uppercase tracking-widest flex items-center gap-2">
                       <Clock size={10} /> {getDaysLeft(event.deletedAt)} DAYS LEFT
                    </span>
                  </div>

                  <div className="h-40 bg-stone-50 overflow-hidden">
                    {event.mediaUrl ? (
                      <img src={event.mediaUrl} alt="" className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-500" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-stone-200">
                        <Calendar size={48} />
                      </div>
                    )}
                  </div>
                  
                  <div className="p-6 space-y-4 flex-1 flex flex-col">
                    <div>
                      <h3 className="text-xl font-serif font-bold text-stone-800 line-clamp-1">{event.title}</h3>
                      <p className="text-xs text-stone-400 font-bold uppercase tracking-widest mt-1">
                        Deleted: {(() => {
                          const dAt = event.deletedAt;
                          if (dAt === null || dAt === undefined) return 'N/A';
                          
                          const timestamp = dAt as any;
                          if (typeof timestamp === 'object' && timestamp !== null && 'seconds' in timestamp) {
                            return new Date(timestamp.seconds * 1000).toLocaleDateString();
                          }
                          
                          try {
                            return new Date(dAt as any).toLocaleDateString();
                          } catch (e) {
                            return 'Invalid Date';
                          }
                        })()}
                      </p>
                    </div>

                    <p className="text-sm text-stone-500 italic line-clamp-2 flex-1">
                      {event.description || 'No description provided.'}
                    </p>

                    <div className="pt-4 border-t border-stone-50 grid grid-cols-2 gap-3">
                      <button 
                        onClick={() => handleRestoreEvent(event.id!)}
                        className="flex items-center justify-center gap-2 px-4 py-3 bg-stone-50 text-stone-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-orange-50 hover:text-orange-500 transition-all border border-stone-100"
                      >
                        <RotateCcw size={14} /> Restore
                      </button>
                      <button 
                        onClick={() => handlePermanentDelete('event', event.id!)}
                        className="flex items-center justify-center gap-2 px-4 py-3 bg-red-50 text-red-500 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-red-500 hover:text-white transition-all border border-red-100"
                      >
                        <Trash2 size={14} /> Wipe
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))
            ) : activeTab === 'devotees' ? (
              filteredDevotees.map(devotee => (
                <motion.div 
                  key={devotee.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className={cn("p-6 rounded-[2rem] border shadow-xl shadow-stone-200/40 flex flex-col gap-4 group relative overflow-hidden transition-colors", getHighlightClass(devotee))}
                >
                  <div className="absolute top-0 right-0 p-4">
                     <div className="bg-orange-50 px-3 py-1 rounded-full border border-orange-100">
                        <p className="text-[8px] font-black text-orange-500 uppercase tracking-widest">{getDaysLeft(devotee.deletedAt)}d left</p>
                     </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 bg-stone-50 text-stone-200 rounded-2xl flex items-center justify-center text-xl font-serif font-black shadow-inner grayscale">
                      {devotee.name ? devotee.name[0] : 'D'}
                    </div>
                    <div>
                      <h3 className="text-lg font-serif font-bold text-stone-800 tracking-tight">{devotee.name}</h3>
                      <p className="text-xs text-stone-400 font-bold tracking-widest uppercase">{devotee.contact}</p>
                    </div>
                  </div>

                  <div className="bg-stone-50/50 p-4 rounded-2xl border border-stone-100 space-y-2">
                    <div className="flex justify-between text-[9px] uppercase tracking-widest font-black">
                      <span className="text-stone-300">Mentor</span>
                      <span className="text-stone-500">{devotee.mentor || 'None'}</span>
                    </div>
                    <div className="flex justify-between text-[9px] uppercase tracking-widest font-black">
                      <span className="text-stone-300">Chanting</span>
                      <span className="text-stone-500">{devotee.chanting || '0'} Rounds</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mt-2">
                    <button 
                      onClick={() => handleRestoreDevotee(devotee.id!)}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-3 bg-stone-50 text-stone-600 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-orange-50 hover:text-orange-500 transition-all border border-stone-100"
                    >
                      <RotateCcw size={12} /> Restore
                    </button>
                    <button 
                      onClick={() => handlePermanentDelete('devotee', devotee.id!)}
                      className="flex items-center justify-center p-3 bg-red-50 text-red-500 rounded-xl hover:bg-red-500 hover:text-white transition-all border border-red-100"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </motion.div>
              ))
            ) : activeTab === 'staff' ? (
              filteredStaff.map(staff => (
                <motion.div 
                  key={staff.uid}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="bg-white p-6 rounded-[2rem] border border-stone-100 shadow-xl shadow-stone-200/40 flex flex-col gap-4 group relative overflow-hidden"
                >
                  <div className="absolute top-0 right-0 p-4">
                     <div className="bg-orange-50 px-3 py-1 rounded-full border border-orange-100">
                        <p className="text-[8px] font-black text-orange-500 uppercase tracking-widest">{getDaysLeft(staff.deletedAt)}d left</p>
                     </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 bg-stone-50 text-stone-200 rounded-2xl flex items-center justify-center text-xl font-serif font-black shadow-inner grayscale">
                      {staff.displayName?.[0] || 'U'}
                    </div>
                    <div>
                      <h3 className="text-lg font-serif font-bold text-stone-800 tracking-tight">{staff.displayName}</h3>
                      <p className="text-xs text-stone-400 font-bold tracking-widest uppercase">{staff.role}</p>
                    </div>
                  </div>

                  <div className="bg-stone-50/50 p-4 rounded-2xl border border-stone-100 space-y-2">
                    <p className="text-[9px] font-black text-stone-400 uppercase tracking-widest">Email</p>
                    <p className="text-xs font-bold text-stone-800">{staff.email}</p>
                  </div>

                  <div className="flex items-center gap-2 mt-2">
                    <button 
                      onClick={() => handleRestoreStaff(staff.uid)}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-3 bg-stone-50 text-stone-600 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-orange-50 hover:text-orange-500 transition-all border border-stone-100"
                    >
                      <RotateCcw size={12} /> Restore
                    </button>
                    <button 
                      onClick={() => handlePermanentDelete('user', staff.uid)}
                      className="flex items-center justify-center p-3 bg-red-50 text-red-500 rounded-xl hover:bg-red-500 hover:text-white transition-all border border-red-100"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </motion.div>
              ))
            ) : (
              filteredProfileActivities.map(pa => (
                <motion.div 
                  key={pa.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="bg-white rounded-[2rem] border border-stone-100 shadow-xl shadow-stone-200/40 overflow-hidden flex flex-col group relative"
                >
                  <div className="absolute top-4 right-4 bg-orange-50 px-3 py-1.5 rounded-full border border-orange-100 z-10">
                    <span className="text-[9px] font-black text-orange-600 uppercase tracking-widest flex items-center gap-2">
                       <Clock size={10} /> {getDaysLeft(pa.deletedAt)} DAYS LEFT
                    </span>
                  </div>

                  <div className="p-6 space-y-4 flex-1 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center gap-4">
                        <div className="w-14 h-14 bg-stone-50 text-stone-200 rounded-2xl flex items-center justify-center text-xl font-serif font-black shadow-inner grayscale">
                          <Calendar size={24} className="text-orange-500" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="text-lg font-serif font-bold text-stone-800 tracking-tight line-clamp-1">{pa.eventName}</h3>
                          <p className="text-xs text-stone-400 font-bold uppercase tracking-widest mt-1">
                            Event Date: {pa.eventDate ? new Date(pa.eventDate).toLocaleDateString() : 'N/A'}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 bg-stone-50/50 p-4 rounded-2xl border border-stone-100 space-y-2">
                        <div className="flex justify-between text-[9px] uppercase tracking-widest font-black text-stone-400">
                          <span>Submitted At</span>
                          <span className="text-stone-600">
                            {pa.submittedAt ? new Date(pa.submittedAt).toLocaleDateString() : 'N/A'}
                          </span>
                        </div>
                        <div className="flex justify-between text-[9px] uppercase tracking-widest font-black text-stone-400">
                          <span>Records Count</span>
                          <span className="text-stone-600 font-bold">{(pa.assignments || []).length}</span>
                        </div>
                      </div>

                      <div className="mt-4">
                        <button
                          onClick={() => togglePA(pa.id)}
                          className="w-full flex items-center justify-between py-2 text-[10px] font-black uppercase tracking-widest text-stone-400 hover:text-orange-500 transition-colors"
                        >
                          <span>View Assignments ({ (pa.assignments || []).length })</span>
                          <span className="text-[10px] font-black text-orange-500">{expandedPA[pa.id] ? 'COLLAPSE' : 'EXPAND'}</span>
                        </button>

                        {expandedPA[pa.id] && (
                          <div className="mt-3 space-y-2 max-h-40 overflow-y-auto custom-scrollbar pr-1 pt-1">
                            {(pa.assignments || []).map((ass: any, idx: number) => (
                              <div key={idx} className="p-3 bg-stone-50 rounded-xl border border-stone-100 text-xs flex justify-between items-center">
                                <div className="min-w-0 flex-1 pr-2">
                                  <p className="font-bold text-stone-700 font-serif truncate">{ass.devoteeName}</p>
                                  <p className="text-[10px] text-stone-400 font-sans truncate">{ass.devoteeContact}</p>
                                </div>
                                <span className={cn(
                                  "text-[9px] font-black uppercase tracking-wide px-2 py-0.5 rounded shrink-0",
                                  ass.response === 'COMING' ? "bg-emerald-50 text-emerald-600 border border-emerald-100" :
                                  ass.response === 'NOT_COMING' ? "bg-rose-50 text-rose-600 border border-rose-100" : "bg-stone-100 text-stone-600"
                                )}>
                                  {ass.response || 'NONE'}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="pt-4 border-t border-stone-50 grid grid-cols-2 gap-3">
                      <button 
                        onClick={() => handleRestoreProfileActivity(pa.id)}
                        className="flex items-center justify-center gap-2 px-4 py-3 bg-stone-50 text-stone-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-orange-50 hover:text-orange-500 transition-all border border-stone-100"
                      >
                        <RotateCcw size={14} /> Restore
                      </button>
                      <button 
                        onClick={() => handlePermanentDeleteProfileActivity(pa.id)}
                        className="flex items-center justify-center gap-2 px-4 py-3 bg-red-50 text-red-500 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-red-500 hover:text-white transition-all border border-red-100"
                      >
                        <Trash2 size={14} /> Wipe
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))
            )}
          </AnimatePresence>

          {(
            activeTab === 'events' ? filteredEvents.length : 
            activeTab === 'devotees' ? filteredDevotees.length : 
            activeTab === 'staff' ? filteredStaff.length : 
            filteredProfileActivities.length
          ) === 0 && (
            <div className="col-span-full py-24 text-center space-y-4">
              <div className="w-20 h-20 bg-stone-50 rounded-full flex items-center justify-center mx-auto text-stone-200">
                <HistoryIcon size={40} />
              </div>
              <div>
                <p className="text-stone-400 font-serif text-xl italic font-bold">Archives are empty</p>
                <p className="text-stone-300 text-xs font-black uppercase tracking-widest mt-1">Nothing found in the archives for now</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {dialog.isOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white p-10 rounded-[2.5rem] shadow-2xl w-full max-w-sm border border-stone-100 text-center"
          >
            <div className="w-16 h-16 bg-red-50 text-red-500 rounded-3xl flex items-center justify-center mx-auto mb-6">
              <AlertTriangle size={36} />
            </div>
            <h3 className="text-2xl font-bold font-serif text-stone-800 mb-2">{dialog.title}</h3>
            <p className="text-stone-500 mb-8 leading-relaxed italic">{dialog.message}</p>
            <div className="grid grid-cols-2 gap-3">
              <button 
                onClick={dialog.onCancel} 
                className="px-6 py-4 bg-stone-100 hover:bg-stone-200 rounded-2xl font-bold text-stone-600 transition-colors uppercase tracking-widest text-[10px]"
              >
                Cancel
              </button>
              <button 
                onClick={dialog.onConfirm}
                className="px-6 py-4 bg-red-500 hover:bg-red-600 text-white rounded-2xl font-black uppercase tracking-widest shadow-lg shadow-red-200 transition-all hover:scale-[1.02] text-[10px]"
              >
                Delete Forever
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </Layout>
  );
}
