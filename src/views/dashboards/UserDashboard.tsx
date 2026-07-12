import React, { useState, useEffect } from 'react';
import { db } from '../../services/firebase';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, deleteDoc, doc, updateDoc, collectionGroup, getDocs, getDoc } from 'firebase/firestore';
import { Event, Devotee } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { motion } from 'motion/react';
import { Calendar, UserPlus, Phone, ChevronRight, CheckCircle2, ChevronDown, Plus, Heart, AlertTriangle, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn, normalizePhoneNumber, sanitizeMobileInput, isValidMobileNumber } from '../../lib/utils';
// NEW
import ContactLink from '../../components/ContactLink';
import { subscribeToVisibleEvents, subscribeToEvent } from '../../services/eventVisibility';
import { profile } from 'console';

const UserDashboard = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'events' | 'addDevotee' | 'facilitation' | 'history'>('events');

  // Verify access
  useEffect(() => {
    if (activeTab === 'addDevotee' && profile?.accessStatus?.addDevotee === false) setActiveTab('events');
    if (activeTab === 'facilitation' && profile?.accessStatus?.facilitation === false) setActiveTab('events');
    if (activeTab === 'history' && profile?.accessStatus?.history !== true) setActiveTab('events');
  }, [profile?.accessStatus, activeTab]);
  const [duplicateStatus, setDuplicateStatus] = useState<{ type: 'complete' | 'partial_name' | 'partial_contact', existingDevotee: Devotee } | null>(null);
  const [expandedHistory, setExpandedHistory] = useState<Record<string, boolean>>({});
  const [events, setEvents] = useState<Event[]>([]);
  const [callingHistory, setCallingHistory] = useState<any[]>([]);
  const [newDevotee, setNewDevotee] = useState<Partial<Devotee>>({ 
    name: '', 
    contact: '', 
    mentor: '', 
    chanting: '0',
    age: '',
    address: '',
    gender: 'MALE',
    institute: '',
    dob: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recentAdditions, setRecentAdditions] = useState<Devotee[]>([]);
  const [isFacilitationFormOpen, setIsFacilitationFormOpen] = useState(false);
  const [displayFacilitationLimit, setDisplayFacilitationLimit] = useState(10);
  const [confirmState, setConfirmState] = useState<{isOpen: boolean, title: string, content: string, action: () => void}>({
    isOpen: false, title: '', content: '', action: () => {}
  });

  const openConfirm = (title: string, content: string, action: () => void) => {
    setConfirmState({ isOpen: true, title, content, action });
  };
  const closeConfirm = () => setConfirmState(prev => ({ ...prev, isOpen: false }));

  const toggleHistory = (id: string) => {
    setExpandedHistory(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleDeleteHistory = async (id: string) => {
    openConfirm("Delete Record", "Are you sure you want to delete this calling history record?", async () => {
      try {
        await updateDoc(doc(db, 'callingHistory', id), {
          isDeleted: true,
          deletedAt: new Date().toISOString()
        });
      } catch (error) {
        console.error("Error deleting history:", error);
      }
      closeConfirm();
    });
  };

  const [pressTimer, setPressTimer] = useState<any>(null);

  const handlePressStart = (id: string) => {
    setPressTimer(setTimeout(() => {
      handleDeleteHistory(id);
    }, 800)); // 800ms long press
  };

  const handlePressEnd = () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      setPressTimer(null);
    }
  };

  useEffect(() => {
     if (!profile?.templeId) return;

    let unsubscribeE = () => {};
    let unsubscribeA = () => {};
  
    if (profile.role === 'OWNER' || profile.role === 'MENTOR') {
      unsubscribeE = onSnapshot(collection(db, 'events'), (snapshot) => {
        const allEvents = snapshot.docs
          .map(doc => ({ id: doc.id, ...doc.data() } as Event))
          .filter(e => e.templeId === profile.templeId && !e.isDeleted);
        setEvents(allEvents);
      });
    } else {
      let publicEvents: Event[] = [];
      let assignedEvents: Event[] = [];
      let isMounted = true;

      const publishEvents = () => {
        const visible = new Map<string, Event>();
        [...publicEvents, ...assignedEvents].forEach((event) => {
          if (event.id && event.templeId === profile.templeId && !event.isDeleted) {
            visible.set(event.id, event);
          }
        });
        setEvents(Array.from(visible.values()).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
      };

      // NEW
      unsubscribeE = subscribeToVisibleEvents(profile.templeId, (visibleEvents) => {
        publicEvents = visibleEvents;
        publishEvents();
      });

      const qAssignments = query(collectionGroup(db, 'assignments'), where('userId', '==', profile.uid));

      // Live per-event listeners keyed by eventId, so that a change to a single
      // event's isPublic/isDeleted flag is reflected the instant it happens —
      // not only whenever the assignments subcollection itself changes. The old
      // one-shot getDoc() approach cached a stale copy of each assigned event
      // and only refreshed it when an assignment doc changed, so toggling
      // "Internal Only" on/off could take a long time (or never) to show up.
      const eventDocUnsubs = new Map<string, () => void>();
      const assignedEventsMap = new Map<string, Event>();

      unsubscribeA = onSnapshot(qAssignments, (snapshot) => {
        const assignedIds = Array.from(new Set(
          snapshot.docs
            .map(doc => doc.data().eventId as string | undefined)
            .filter((eventId): eventId is string => !!eventId)
        ));

        // Stop watching events we're no longer assigned to
        for (const [eventId, unsub] of eventDocUnsubs.entries()) {
          if (!assignedIds.includes(eventId)) {
            unsub();
            eventDocUnsubs.delete(eventId);
            assignedEventsMap.delete(eventId);
          }
        }

        // Start watching any newly-assigned events live
        assignedIds.forEach((eventId) => {
         if (eventDocUnsubs.has(eventId)) return;

         const unsubDoc = subscribeToEvent(eventId, (ev) => {
           if (!isMounted) return;

           if (ev) {
           assignedEventsMap.set(eventId, ev);
           } else {
           assignedEventsMap.delete(eventId);
           } 

           assignedEvents = Array.from(assignedEventsMap.values()).filter(
             event => event.templeId === profile.templeId && !event.isDeleted
            );  

             publishEvents();
           });

  eventDocUnsubs.set(eventId, unsubDoc);
});

        assignedEvents = Array.from(assignedEventsMap.values()).filter(
          event => event.templeId === profile.templeId && !event.isDeleted
        );
        publishEvents();
      }, (err) => {
        console.error("Error fetching user assignments in dashboard:", err);
      });

      const originalUnsubE = unsubscribeE;
      const originalUnsubA = unsubscribeA;
      unsubscribeA = () => {
        isMounted = false;
        eventDocUnsubs.forEach(unsub => unsub());
        eventDocUnsubs.clear();
        originalUnsubA();
      };
      unsubscribeA = () => {
        isMounted = false;
        originalUnsubA();
      };
    }

    let unsubscribeD = () => {};
    let unsubscribeH = () => {};

    // Recent facilitation by this user
    if (profile?.uid) {
      const qD = query(collection(db, 'devotees'), where('facilitatorId', '==', profile.uid));
      unsubscribeD = onSnapshot(qD, (snapshot) => {
        setRecentAdditions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Devotee)));
      });

      const qH = query(collection(db, 'callingHistory'), where('userId', '==', profile.uid));
      unsubscribeH = onSnapshot(qH, (snapshot) => {
        const history = snapshot.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          .filter((h: any) => !h.isDeleted);
        history.sort((a: any, b: any) => new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime());
        setCallingHistory(history);
      });
    }

    return () => {
      unsubscribeE();
      unsubscribeA();
      unsubscribeD();
      unsubscribeH();
    };
  }, [profile]);

  const handleDeleteDevotee = async (id: string) => {
    openConfirm("Remove Devotee", "Are you sure you want to remove this devotee from your facilitation list?", async () => {
      try {
        await updateDoc(doc(db, 'devotees', id), {
          facilitatorId: "",
          facilitatorName: "",
          facilitator: "",
          facilitationResponse: "",
          updatedAt: serverTimestamp()
        });
        alert("Devotee removed from your facilitation list.");
      } catch (error) {
        console.error("Error removing devotee:", error);
        alert("Error removing devotee. Please try again.");
      }
      closeConfirm();
    });
  };

  const handleAddDevotee = async (e: React.FormEvent, isFacilitationAdd: boolean = false) => {
    e.preventDefault();
    if (!newDevotee.name || !newDevotee.contact) return;

    if (!isValidMobileNumber(newDevotee.contact)) {
      alert("Please enter a valid 10-digit mobile number.");
      return;
    }

    setIsSubmitting(true);
    setDuplicateStatus(null);
    
    try {
      // Duplicate Detection
      const devoteeName = newDevotee.name!.trim();
      const normalizedContact = normalizePhoneNumber(newDevotee.contact || '');
      
      const { getDocs, query, collection, where, or } = await import('firebase/firestore');
      
      // Check for matches in both 'name' and 'Name' fields, and 'contact' and 'Contact No.'
      const nameQuery = query(
        collection(db, 'devotees'), 
        where('templeId', '==', profile?.templeId),
        where('isDeleted', '==', false)
      );
      
      const snap = await getDocs(nameQuery);
      const allDevotees = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Devotee));

      let duplicateType: 'complete' | 'partial_name' | 'partial_contact' | null = null;
      let existingDevotee: Devotee | null = null;

      const nLow = devoteeName.toLowerCase();
      const cNorm = normalizedContact;

      for (const other of allDevotees) {
        const onLow = (other.name || (other as any).Name || '').trim().toLowerCase();
        const ocNorm = normalizePhoneNumber(other.contact || (other as any)['Contact No.'] || '');
        
        if (nLow === onLow && cNorm === ocNorm) {
          duplicateType = 'complete';
          existingDevotee = other;
          break;
        }
        if (cNorm === ocNorm && nLow !== onLow && cNorm !== '') {
          duplicateType = 'partial_contact';
          existingDevotee = other;
          break;
        }
        if (nLow === onLow && cNorm !== ocNorm && nLow !== '') {
          duplicateType = 'partial_name';
          existingDevotee = other;
          break;
        }
      }

      if (duplicateType) {
        setDuplicateStatus({ type: duplicateType, existingDevotee: existingDevotee! });
      }

      // The Facilitation form must NEVER create a brand-new devotee record —
      // creating devotees is exclusively the "Add Devotee" form's job. If the
      // devotee already exists (same name + contact), just attach the
      // existing record to this user's facilitation list. If it doesn't
      // exist yet, refuse and point the user to the correct form, instead of
      // silently creating a duplicate database entry.
      if (isFacilitationAdd) {
        if (duplicateType !== 'complete' || !existingDevotee) {
          alert(
            "This devotee isn't in the database yet. Please add them using the \"Add Devotee\" form first — " +
            "the Facilitation form can only add an existing devotee to your list."
          );
          setIsSubmitting(false);
          return;
        }

        if (existingDevotee.facilitatorId && existingDevotee.facilitatorId !== profile?.uid) {
          alert(`This devotee is already being facilitated by ${existingDevotee.facilitatorName || 'another sevak'}.`);
          setIsSubmitting(false);
          return;
        }

        if (existingDevotee.facilitatorId === profile?.uid) {
          alert('This devotee is already in your facilitation list.');
          setIsSubmitting(false);
          return;
        }

        await updateDoc(doc(db, 'devotees', existingDevotee.id!), {
          facilitatorId: profile?.uid,
          facilitatorName: profile?.displayName || 'Anonymous',
          isPrivate: true,
        });

        setNewDevotee({ name: '', contact: '', mentor: '', chanting: '0', age: '', address: '', gender: 'MALE', institute: '', dob: '' });
        alert('Existing devotee added to your facilitation list!');
        setActiveTab('facilitation');
        setIsSubmitting(false);
        return;
      }

      const devoteeData = {
        ...newDevotee,
        name: devoteeName,
        contact: normalizedContact,
        facilitatorId: '',
        facilitatorName: '',
        templeId: profile?.templeId,
        attendanceCount: 0,
        createdAt: serverTimestamp(),
        isPrivate: false,
        isDuplicate: !!duplicateType,
        duplicateType: duplicateType || null,
        duplicateCreatedAt: duplicateType === 'complete' ? new Date().toISOString() : null,
        duplicateHandled: false
      };

      await addDoc(collection(db, 'devotees'), devoteeData);
      
      setNewDevotee({ name: '', contact: '', mentor: '', chanting: '0', age: '', address: '', gender: 'MALE', institute: '', dob: '' });
      alert('Devotee added successfully!' + (duplicateType ? ` (${duplicateType} warning triggered)` : ''));
      setActiveTab('facilitation'); 
    } catch (error) {
      console.error(error);
      alert('Error adding devotee.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold font-serif text-stone-800 tracking-tight">Sevak Dashboard</h2>
          <p className="text-stone-500 mt-1">Manage events, facilitation, and history.</p>
        </div>
        <div className="flex gap-2 bg-white p-1 rounded-xl shadow-sm border border-stone-100 overflow-x-auto no-scrollbar">
          <button 
            onClick={() => setActiveTab('events')}
            className={cn(
              "px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap", 
              activeTab === 'events' ? "bg-stone-900 text-white shadow-sm" : "text-stone-500 hover:bg-stone-50"
            )}
          >
            Events
          </button>
          
          {(profile?.accessStatus?.addDevotee !== false) && (
            <button 
              onClick={() => setActiveTab('addDevotee')}
              className={cn(
                "px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap", 
                activeTab === 'addDevotee' ? "bg-stone-900 text-white shadow-sm" : "text-stone-500 hover:bg-stone-50"
              )}
            >
              Add Devotee
            </button>
          )}

          {(profile?.accessStatus?.facilitation !== false) && (
            <button 
              onClick={() => setActiveTab('facilitation')}
              className={cn(
                "px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap", 
                activeTab === 'facilitation' ? "bg-stone-900 text-white shadow-sm" : "text-stone-500 hover:bg-stone-50"
              )}
            >
              Facilitation
            </button>
          )}

          {(profile?.accessStatus?.history === true) && (
            <button 
              onClick={() => setActiveTab('history')}
              className={cn(
                "px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap", 
                activeTab === 'history' ? "bg-stone-900 text-white shadow-sm" : "text-stone-500 hover:bg-stone-50"
              )}
            >
              History
            </button>
          )}
        </div>
      </div>

      {activeTab === 'events' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {events.length === 0 ? (
            <div className="col-span-full py-24 text-center text-stone-400">
              <div className="w-20 h-20 bg-stone-50 rounded-full flex items-center justify-center mx-auto mb-6">
                <Calendar size={40} className="opacity-20" />
              </div>
              <p className="text-xl font-bold font-serif text-stone-800">No active events</p>
              <p className="text-sm text-stone-500 mt-2">Wait for assignments from the temple admin.</p>
            </div>
          ) : (
            events.map((event) => (
              <motion.div 
                key={event.id}
                whileHover={{ y: -5 }}
                className="bg-white rounded-3xl p-6 border border-stone-200 hover:border-saffron/30 hover:shadow-xl hover:shadow-stone-200/50 transition-all cursor-pointer group"
                onClick={() => navigate(`/events/${event.id}`)}
              >
                <div className="w-full h-44 overflow-hidden relative mb-6 -mt-1 -mx-1 rounded-2xl">
                  {event.mediaUrl ? (
                    <img src={event.mediaUrl} alt={event.title} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-1000" />
                  ) : (
                    <div className="w-full h-full bg-stone-50 flex items-center justify-center text-stone-200">
                      <Calendar size={48} />
                    </div>
                  )}
                  <div className="absolute top-4 right-4 z-10">
                    <div className="bg-white/90 backdrop-blur-sm p-2 rounded-xl border border-white shadow-sm text-saffron">
                      <ChevronRight size={18} />
                    </div>
                  </div>
                </div>
                <div className="space-y-1 relative">
                  <h3 className="text-xl font-bold font-serif text-stone-800 tracking-tight">{event.title}</h3>
                  <p className="text-sm text-stone-500">{new Date(event.date).toLocaleDateString(undefined, { dateStyle: 'long' })}</p>
                  <div className="absolute top-0 right-0 flex gap-2">
                    {event.isPublic ? (
                      <span className="text-[8px] bg-green-50 text-green-600 px-2 py-1 rounded-full font-black tracking-widest uppercase border border-green-100">Live</span>
                    ) : (
                      <span className="text-[8px] bg-stone-100 text-stone-400 px-2 py-1 rounded-full font-black tracking-widest uppercase border border-stone-200">Internal</span>
                    )}
                  </div>
                </div>
                <div className="pt-4 mt-4 border-t border-stone-100 flex items-center justify-between text-[10px] font-bold text-saffron uppercase tracking-widest">
                  <span>View My Assignment</span>
                  <span className="opacity-0 group-hover:opacity-100 transition-opacity">Open Seva →</span>
                </div>
              </motion.div>
            ))
          )}
        </div>
      )}

      {activeTab === 'addDevotee' && profile?.accessStatus?.addDevotee !== false && (
        <div className="max-w-4xl mx-auto space-y-8 pb-20">
          <div className="bg-white rounded-[2.5rem] p-10 border border-stone-200 shadow-xl shadow-stone-200/50 space-y-10 relative overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-6">
              <div className="bg-stone-900 p-4 text-white rounded-[1.5rem] shadow-xl shadow-stone-900/10">
                <UserPlus size={28} />
              </div>
              <div>
                <h3 className="text-3xl font-black font-serif text-stone-800 tracking-tight">Main Database Entry</h3>
                <div className="text-[10px] text-stone-500 font-black uppercase tracking-[0.2em] mt-1.5 flex items-center gap-2">
                  <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                  Primary Registration Form
                </div>
              </div>
            </div>

            {duplicateStatus && (
              <div className={cn(
                "p-6 rounded-2xl flex flex-col gap-3 animate-in fade-in slide-in-from-top-4 duration-500",
                duplicateStatus.type === 'complete' ? "bg-red-50 border border-red-100" : "bg-amber-50 border border-amber-100"
              )}>
                 <div className="flex items-center gap-3">
                   <AlertTriangle className={duplicateStatus.type === 'complete' ? "text-red-500" : "text-amber-500"} size={18} />
                   <p className={cn("text-xs font-black uppercase tracking-widest", duplicateStatus.type === 'complete' ? "text-red-600" : "text-amber-600")}>
                     {duplicateStatus.type === 'complete' ? 'COMPLETE DUPLICATE DETECTED' : 'PARTIAL DUPLICATE DETECTED'}
                   </p>
                 </div>
                 <p className="text-stone-600 text-[13px] font-medium font-serif leading-relaxed italic ml-8">
                   {duplicateStatus.type === 'complete' 
                    ? `Warning! A devotee with the same Name ("${duplicateStatus.existingDevotee.name}") and Contact ("${duplicateStatus.existingDevotee.contact}") already exists. The owner must resolve this within 24 hours.`
                    : duplicateStatus.type === 'partial_contact'
                    ? `Warning! Contact number ("${duplicateStatus.existingDevotee.contact}") matches "${duplicateStatus.existingDevotee.name}". Different names with same contact will trigger owner warning.`
                    : `Warning! Name ("${duplicateStatus.existingDevotee.name}") matches an existing record with a different contact number.`}
                 </p>
              </div>
            )}
            
            <form onSubmit={(e) => handleAddDevotee(e, false)} className="space-y-12">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-3">
                  <label className="text-[10px] font-black text-stone-400 uppercase tracking-[0.2em] pl-1">Full Name *</label>
                  <input 
                    required
                    type="text" 
                    placeholder="Rahul Sharma"
                    className="w-full bg-stone-50/50 border border-stone-200 px-6 py-5 rounded-2xl focus:border-stone-900/20 focus:bg-white outline-none transition-all font-serif font-bold text-lg text-stone-800 shadow-inner"
                    value={newDevotee.name || ''}
                    onChange={e => setNewDevotee({...newDevotee, name: e.target.value})}
                  />
                </div>
                <div className="space-y-3">
                  <label className="text-[10px] font-black text-stone-400 uppercase tracking-[0.2em] pl-1">Contact Number *</label>
                  <input 
                    required
                    type="tel" 
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="9876543210"
                    className="w-full bg-stone-50/50 border border-stone-200 px-6 py-5 rounded-2xl focus:border-stone-900/20 focus:bg-white outline-none transition-all font-serif font-bold text-lg text-stone-800 shadow-inner"
                    value={newDevotee.contact || ''}
                    onChange={e => setNewDevotee({...newDevotee, contact: sanitizeMobileInput(e.target.value)})}
                  />
                </div>
                <div className="space-y-3">
                  <label className="text-[10px] font-black text-stone-400 uppercase tracking-[0.2em] pl-1">Chanting Details</label>
                  <input 
                    type="text" 
                    placeholder="e.g. 16 rounds"
                    className="w-full bg-stone-50/50 border border-stone-100 px-6 py-4 rounded-2xl focus:border-stone-200 outline-none transition-all font-medium"
                    value={newDevotee.chanting || ''}
                    onChange={e => setNewDevotee({...newDevotee, chanting: e.target.value})}
                  />
                </div>
                <div className="space-y-3">
                  <label className="text-[10px] font-black text-stone-400 uppercase tracking-[0.2em] pl-1">Institute / Workplace</label>
                  <input 
                    type="text" 
                    placeholder="University or Company"
                    className="w-full bg-stone-50/50 border border-stone-100 px-6 py-4 rounded-2xl focus:border-stone-200 outline-none transition-all font-medium"
                    value={newDevotee.institute || ''}
                    onChange={e => setNewDevotee({...newDevotee, institute: e.target.value})}
                  />
                </div>
              </div>

              <div className="flex items-center gap-4 pt-4">
                <button 
                  type="submit" 
                  disabled={isSubmitting}
                  className="bg-stone-900 text-white rounded-2xl px-12 py-5 text-xs font-black uppercase tracking-[0.3em] shadow-2xl shadow-stone-900/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-3 disabled:opacity-50"
                >
                  {isSubmitting ? <span className="animate-spin text-lg">◌</span> : <Plus size={18} />}
                  {isSubmitting ? 'Processing...' : 'Register Devotee'}
                </button>
                <div className="flex-1 border-t border-stone-100" />
              </div>
            </form>
          </div>
        </div>
      )}

      {activeTab === 'facilitation' && profile?.accessStatus?.facilitation !== false && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-3xl p-8 border border-stone-200 shadow-sm space-y-8 transition-all">
              <button 
                onClick={() => setIsFacilitationFormOpen(!isFacilitationFormOpen)} 
                className="w-full flex items-center justify-between text-left group"
              >
                <div className="flex items-center gap-4">
                  <div className="bg-stone-100 p-3 text-stone-500 rounded-2xl shadow-sm group-hover:bg-saffron group-hover:text-white transition-colors"><UserPlus size={24} /></div>
                  <div>
                    <h3 className="text-2xl font-bold font-serif text-stone-800 tracking-tight">Add to My Facilitation</h3>
                    <p className="text-[10px] text-stone-500 mt-1 uppercase font-black tracking-widest italic">Registers locally to your list</p>
                  </div>
                </div>
                <ChevronDown size={20} className={cn("text-stone-400 transition-transform duration-300", isFacilitationFormOpen && "rotate-180")} />
              </button>
              
              <div className={cn("grid transition-all duration-300 ease-in-out", isFacilitationFormOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
                <div className="overflow-hidden space-y-8">
                  <form onSubmit={(e) => handleAddDevotee(e, true)} className="space-y-8 pt-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-stone-400 uppercase tracking-widest pl-1">Full Name *</label>
                    <input 
                      required
                      type="text" 
                      placeholder="e.g. Rahul Sharma"
                      className="w-full bg-stone-50 border border-stone-200 px-5 py-4 rounded-2xl focus:border-saffron outline-none transition-all font-medium"
                      value={newDevotee.name || ''}
                      onChange={e => setNewDevotee({...newDevotee, name: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-stone-400 uppercase tracking-widest pl-1">Contact Number *</label>
                    <input 
                      required
                      type="tel" 
                      inputMode="numeric"
                      maxLength={10}
                      placeholder="e.g. 9876543210"
                      className="w-full bg-stone-50 border border-stone-200 px-5 py-4 rounded-2xl focus:border-saffron outline-none transition-all font-medium"
                      value={newDevotee.contact || ''}
                      onChange={e => setNewDevotee({...newDevotee, contact: sanitizeMobileInput(e.target.value)})}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-stone-400 uppercase tracking-widest pl-1">Chanting Details</label>
                    <input 
                      type="text" 
                      placeholder="e.g. 16 rounds"
                      className="w-full bg-stone-50 border border-stone-200 px-5 py-4 rounded-2xl focus:border-saffron outline-none transition-all font-medium"
                      value={newDevotee.chanting || ''}
                      onChange={e => setNewDevotee({...newDevotee, chanting: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-stone-400 uppercase tracking-widest pl-1">Institute / Education</label>
                    <input 
                      type="text" 
                      placeholder="College or Office"
                      className="w-full bg-stone-50 border border-stone-200 px-5 py-4 rounded-2xl focus:border-saffron outline-none transition-all font-medium"
                      value={newDevotee.institute || ''}
                      onChange={e => setNewDevotee({...newDevotee, institute: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-stone-400 uppercase tracking-widest pl-1">Date of Birth</label>
                    <input 
                      type="date" 
                      className="w-full bg-stone-50 border border-stone-200 px-5 py-4 rounded-2xl focus:border-saffron outline-none transition-all font-medium"
                      value={newDevotee.dob || ''}
                      onChange={e => setNewDevotee({...newDevotee, dob: e.target.value})}
                    />
                  </div>

                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-stone-400 uppercase tracking-widest pl-1">Current Address</label>
                  <textarea 
                    placeholder="Full residential address..."
                    className="w-full bg-stone-50 border border-stone-200 px-5 py-4 rounded-2xl focus:border-saffron outline-none transition-all font-medium h-32 resize-none"
                    value={newDevotee.address || ''}
                    onChange={e => setNewDevotee({...newDevotee, address: e.target.value})}
                  />
                </div>

                <button 
                  type="submit" 
                  disabled={isSubmitting}
                  className="w-full bg-stone-100 hover:bg-stone-900 hover:text-white text-stone-500 rounded-3xl py-5 text-[10px] font-black uppercase tracking-[0.3em] transition-all flex items-center justify-center gap-2"
                >
                  {isSubmitting ? <span className="animate-spin text-xl">◌</span> : <Plus size={18} />}
                  {isSubmitting ? 'Saving...' : 'Add to Facilitation'}
                </button>
                  </form>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="flex items-center justify-between px-2">
              <div>
                <h3 className="text-xl font-bold font-serif text-stone-800 tracking-tight">Records</h3>
                <p className="text-[10px] text-stone-500 font-black uppercase tracking-widest mt-1">Facilitation List</p>
              </div>
              <Heart size={24} className="text-rose-400 opacity-20" />
            </div>

            <div 
              className="space-y-4 pr-2 max-h-[600px] overflow-y-auto no-scrollbar"
              onScroll={(e) => {
                const target = e.currentTarget;
                if (target.scrollHeight - target.scrollTop <= target.clientHeight + 50) {
                  setDisplayFacilitationLimit(prev => prev + 10);
                }
              }}
            >
              {recentAdditions.slice(0, displayFacilitationLimit).map((d) => {
                const hasUnresolvedConflict = d.duplicateType === 'complete' && !d.duplicateHandled;
                return (
                <div
                  key={d.id}
                  className={cn(
                    "bg-white border rounded-3xl p-6 shadow-sm space-y-5 transition-all group relative",
                    hasUnresolvedConflict ? "border-red-300 ring-1 ring-red-100" : "border-stone-200 hover:border-saffron/20"
                  )}
                >
                  {hasUnresolvedConflict && (
                    <div
                      title="Another sevak also added this devotee. Awaiting owner assignment."
                      className="absolute -top-2 -left-2 w-4 h-4 bg-red-500 rounded-full border-2 border-white shadow-sm animate-pulse"
                    />
                  )}
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col items-start gap-1">
                      <button 
                        onClick={() => !d.isPrivate && navigate(`/profile/${d.id}`)}
                        className={cn("text-left flex-col inline-flex items-start", d.isPrivate ? "cursor-default" : "cursor-pointer")}
                      >
                        <p className={cn("font-bold font-serif text-stone-800 text-lg leading-tight transition-colors", !d.isPrivate && "hover:text-saffron")}>
                          {d.name}
                          {d.isPrivate && <span className="ml-2 text-[8px] bg-stone-100 text-stone-400 px-1.5 py-0.5 rounded font-black tracking-widest uppercase align-middle">Facil-Only</span>}
                          {hasUnresolvedConflict && <span className="ml-2 text-[8px] bg-red-50 text-red-500 px-1.5 py-0.5 rounded font-black tracking-widest uppercase align-middle">Duplicate Conflict</span>}
                        </p>
                      </button>
                      <ContactLink contact={d.contact} className="text-xs text-stone-500 hover:text-saffron transition-colors cursor-pointer inline-flex">
                        {d.contact}
                      </ContactLink>
                    </div>
                    <div className="flex items-center gap-2">
                      <button 
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteDevotee(d.id!);
                        }}
                        className="p-2 text-stone-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                        title="Remove from list"
                      >
                        <Trash2 size={16} />
                      </button>
                      <div className={cn(
                        "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider",
                        d.facilitationResponse === 'Interested' ? "bg-emerald-50 text-emerald-600 border border-emerald-100" :
                        d.facilitationResponse === 'Not Interested' ? "bg-rose-50 text-rose-600 border border-rose-100" : "bg-stone-50 text-stone-400 border border-stone-100"
                      )}>
                        {d.facilitationResponse || 'Interested'}
                      </div>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-stone-400 uppercase tracking-widest px-1">Update Status</label>
                    <div className="relative">
                      <textarea 
                        id={`fac-note-${d.id}`}
                        placeholder="Add a progress note..."
                        className="w-full bg-stone-50 border border-stone-100 rounded-2xl p-4 text-sm outline-none focus:bg-white focus:border-saffron/30 transition-all h-28 resize-none pb-12 shadow-inner"
                      />
                      <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
                         <select 
                          id={`fac-stat-${d.id}`}
                          defaultValue={d.facilitationResponse || 'Interested'}
                          className="bg-white border border-stone-200 rounded-xl px-3 py-1.5 text-[10px] font-black text-stone-600 outline-none focus:border-saffron transition-all"
                        >
                          <option value="Interested">Interested</option>
                          <option value="Follow-up needed">Follow-up needed</option>
                          <option value="Already Joined">Already Joined</option>
                          <option value="Not Interested">Not Interested</option>
                        </select>
                        <button 
                          onClick={async () => {
                            const text = (document.getElementById(`fac-note-${d.id}`) as HTMLTextAreaElement).value;
                            const status = (document.getElementById(`fac-stat-${d.id}`) as HTMLSelectElement).value;
                            if (!text.trim()) {
                                alert("Please enter a note.");
                                return;
                            }
                            
                            const newNote = {
                                note: text,
                                date: new Date().toISOString(),
                                authorName: profile?.displayName || 'Anonymous',
                                authorId: profile?.uid || '',
                                status: status
                             };

                            const updatedNotes = [newNote, ...(d.facilitationNotes || [])];

                            await updateDoc(doc(db, 'devotees', d.id!), {
                              facilitationResponse: status,
                              facilitationResponseText: text, // Latest note for quick view
                              facilitationNotes: updatedNotes,
                              updatedAt: serverTimestamp()
                            });
                            (document.getElementById(`fac-note-${d.id}`) as HTMLTextAreaElement).value = '';
                          }}
                          className="bg-saffron text-white p-2 rounded-xl text-xs font-bold shadow-lg shadow-saffron/20 hover:bg-stone-900 transition-all"
                        >
                          <CheckCircle2 size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );})}
              {recentAdditions.length === 0 && (
                <div className="py-24 border-2 border-dashed border-stone-100 rounded-3xl flex flex-col items-center justify-center text-stone-300">
                  <Heart size={48} className="opacity-10 mb-4" />
                  <p className="text-sm font-medium italic">Your facilitation list is empty</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {activeTab === 'history' && profile?.accessStatus?.history === true && (
        <div className="space-y-6">
          {callingHistory.map(entry => (
            <div 
              key={entry.id} 
              className="bg-white border border-stone-200 rounded-3xl shadow-sm overflow-hidden transition-all hover:border-saffron/20"
              onMouseDown={() => handlePressStart(entry.id)}
              onMouseUp={handlePressEnd}
              onMouseLeave={handlePressEnd}
              onTouchStart={() => handlePressStart(entry.id)}
              onTouchEnd={handlePressEnd}
            >
              <button 
                onClick={() => toggleHistory(entry.id)}
                className="w-full flex items-center justify-between p-8 hover:bg-stone-50/50 transition-colors"
              >
                <div className="flex items-center gap-5 text-left">
                  <div className="p-4 bg-stone-100 rounded-2xl text-saffron">
                    <Calendar size={24} />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold font-serif text-stone-800 tracking-tight">{entry.eventName}</h3>
                    <p className="text-xs text-stone-400 font-black uppercase tracking-widest mt-1">{new Date(entry.eventDate).toLocaleDateString(undefined, { dateStyle: 'long' })}</p>
                  </div>
                </div>
                <div className="flex items-center gap-5">
                  <span className="hidden sm:inline-block text-[10px] font-black text-stone-500 uppercase tracking-widest bg-stone-100 px-3 py-1.5 rounded-xl border border-stone-200">
                    {entry.assignments.length} Records
                  </span>
                  {expandedHistory[entry.id] ? <ChevronDown className="text-stone-400" /> : <ChevronRight className="text-stone-400" />}
                </div>
              </button>

              {expandedHistory[entry.id] && (
                <div className="px-8 pb-8 pt-2 space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-4 border-t border-stone-100 mt-2 pt-8">
                    {entry.assignments.map((ass: any) => (
                      <div 
                        key={ass.id} 
                        className="flex items-center justify-between p-5 bg-stone-50/50 rounded-2xl border border-stone-100 cursor-pointer hover:border-saffron/20 hover:bg-white transition-all shadow-sm"
                        onClick={() => navigate(`/profile/${ass.devoteeId}`)}
                      >
                        <div>
                          <p className="font-bold font-serif text-stone-800 leading-tight">{ass.devoteeName}</p>
                          <p className="text-xs text-stone-400 mt-0.5">{ass.devoteeContact}</p>
                        </div>
                        <span className={cn(
                          "px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider",
                          ass.response === 'COMING' ? "bg-emerald-50 text-emerald-600 border border-emerald-100" :
                          ass.response === 'NOT_COMING' ? "bg-rose-50 text-rose-600 border border-rose-100" : "bg-stone-200 text-stone-600 border border-stone-300"
                        )}>
                          {ass.response.replace('_', ' ')}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between pt-4 border-t border-stone-100">
                    <p className="text-[10px] text-red-500 font-black uppercase tracking-widest italic">Long press to delete</p>
                    <p className="text-[10px] text-stone-300 font-medium">
                      Submitted: {new Date(entry.submittedAt).toLocaleString()}
                    </p>
                  </div>
                </div>
              )}
            </div>
          ))}
          {callingHistory.length === 0 && (
            <div className="py-24 text-center border-2 border-dashed border-stone-100 rounded-3xl">
              <p className="text-stone-400 font-medium italic">No calling history found</p>
            </div>
          )}
        </div>
      )}
      {/* Confirmation Dialog */}
      {confirmState.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm" onClick={closeConfirm} />
          <div className="relative bg-white rounded-[2rem] p-8 max-w-sm w-full shadow-2xl border border-stone-100 animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-xl font-black font-serif text-stone-800 mb-2">{confirmState.title}</h3>
            <p className="text-sm font-medium text-stone-500 mb-8">{confirmState.content}</p>
            <div className="flex items-center gap-3 w-full">
              <button 
                onClick={closeConfirm}
                className="flex-1 px-4 py-3 rounded-2xl text-xs font-black uppercase tracking-widest text-stone-500 bg-stone-50 hover:bg-stone-100 transition-all"
              >
                Cancel
              </button>
              <button 
                onClick={confirmState.action}
                className="flex-1 px-4 py-3 rounded-2xl text-xs font-black uppercase tracking-widest text-white bg-red-500 hover:bg-red-600 shadow-lg shadow-red-200 transition-all border border-red-500"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserDashboard;
