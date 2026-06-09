import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { db } from '../services/firebase';
import { collection, query, where, onSnapshot, doc, getDoc, getDocs, runTransaction, increment } from 'firebase/firestore';
import { getFirestoreErrorMessage } from '../lib/firestoreErrors';
import { Devotee, Event, UserProfile } from '../types';
import { 
  Check, 
  Calendar,
  Lock,
  UserCheck,
  User,
  Phone,
  Users,
  ChevronDown,
  CheckCircle2,
  Download,
  Clock,
  Printer,
  ArrowRight
} from 'lucide-react';
import { cn, normalizePhoneNumber } from '../lib/utils';
import { toPng } from 'html-to-image';

export default function PublicAttendance() {
  const { id } = useParams<{ id: string }>();
  const [event, setEvent] = useState<Event | null>(null);
  const [template, setTemplate] = useState<any>(null);
  const [templeUsers, setTempleUsers] = useState<UserProfile[]>([]);
  const [mentors, setMentors] = useState<UserProfile[]>([]);
  const [form, setForm] = useState<Record<string, string>>({
    name: '',
    contact: '',
    facilitatorId: '',
    age: '',
    dob: '',
    address: '',
    gender: '',
    institute: '',
    mentor: '',
    chanting: '0'
  });
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [passData, setPassData] = useState<any>(null);
  const passRef = useRef<HTMLDivElement>(null);
  const [showFullFormOverride, setShowFullFormOverride] = useState(false);
  const [hasLocalStorageData, setHasLocalStorageData] = useState(false);

  const downloadPass = async () => {
    if (passRef.current === null) return;
    try {
      const dataUrl = await toPng(passRef.current, { cacheBust: true });
      const link = document.createElement('a');
      link.download = `ISKCON_Pass_${form.name.replace(/\s+/g, '_')}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Failed to download pass', err);
    }
  };

  useEffect(() => {
    if (!id) return;

    const unsubEvent = onSnapshot(doc(db, 'events', id), async (snap) => {
      if (snap.exists()) {
        const eventData = { id: snap.id, ...snap.data() } as Event;
        setEvent(eventData);

        // Fetch Template if exists
        if (eventData.templateId) {
          const tSnap = await getDoc(doc(db, 'templates', eventData.templateId));
          if (tSnap.exists()) {
            setTemplate(tSnap.data());
          }
        }

        // Use the templeId from the event to fetch registered users
        if (eventData.templeId) {
          const qUsers = query(collection(db, 'users'), where('templeId', '==', eventData.templeId));
          const userSnap = await getDocs(qUsers);
          const rawUsers = userSnap.docs.map(d => ({ uid: d.id, ...d.data() } as UserProfile));
          
          // Deduplicate users by UID and then by case-insensitive name
          const uniqueUsers: UserProfile[] = [];
          const seenNames = new Set();
          
          rawUsers.forEach(u => {
            if (u.isDeleted) return;
            const nameKey = (u.displayName || u.email || '').toLowerCase().trim();
            if (!seenNames.has(nameKey)) {
              seenNames.add(nameKey);
              uniqueUsers.push(u);
            }
          });
          
          const users = uniqueUsers;
          
          setTempleUsers(users.filter(u => u.role !== 'MENTOR'));
          setMentors(users.filter(u => u.role === 'MENTOR'));
        }
      }
      setLoading(false);
    }, (err) => {
      console.error("Event error:", err);
      setLoading(false);
    });

    return () => unsubEvent();
  }, [id]);

  // Load from localStorage on mount
  useEffect(() => {
    const savedData = localStorage.getItem('iskcon_devotee_data');
    if (savedData) {
      try {
        const parsed = JSON.parse(savedData);
        setForm(prev => ({ ...prev, ...parsed }));
        if (parsed.name && parsed.contact) {
          setHasLocalStorageData(true);
        }
      } catch (e) {
        console.error("Error parsing saved data", e);
      }
    }
  }, []);

  // Auto-fill logic
  useEffect(() => {
    const contact = normalizePhoneNumber(form.contact.trim());
    if (contact.length < 10) return; // Wait for full number

    if (!event?.templeId) return;

    const timeout = setTimeout(async () => {
      const q = query(
        collection(db, 'devotees'),
        where('contact', '==', contact),
        where('templeId', '==', event.templeId)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        const found = snap.docs[0].data();
        const updatedForm = {
          ...form,
          ...found,
          contact: form.contact // Keep current contact string
        };
        setForm(updatedForm);
        
        // Also update local storage to keep it in sync for this device
        const { facilitatorId: _, ...toSave } = updatedForm as any;
        localStorage.setItem('iskcon_devotee_data', JSON.stringify(toSave));
        setHasLocalStorageData(true);
      }
    }, 800); // 800ms debounce

    return () => clearTimeout(timeout);
  }, [form.contact, event?.templeId]);

  const isQuickEntryEligible = useMemo(() => {
    if (!hasLocalStorageData || !form.name || !form.contact) return false;
    if (showFullFormOverride) return false;
    return true;
  }, [form.name, form.contact, showFullFormOverride, hasLocalStorageData]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!event) return;
    
    if (!(event as any).isAttendanceOpen) {
      alert("Attendance is currently closed for this event.");
      return;
    }

    if (submitting) return;
    
    setSubmitting(true);
    try {
      const normalizedContact = normalizePhoneNumber(form.contact.trim());
      const facilitatorName =
        templeUsers.find(u => u.uid === form.facilitatorId)?.displayName || form.facilitator || 'Self';

      const devoteeData = {
        name: form.name.trim(),
        contact: normalizedContact,
        age: form.age || '',
        dob: form.dob || '',
        address: form.address || '',
        gender: form.gender || '',
        institute: form.institute || '',
        mentor: form.mentor || '',
        chanting: form.chanting || '0',
        facilitatorId: form.facilitatorId || '',
        facilitatorName,
        templeId: event.templeId,
        updatedAt: new Date().toISOString(),
      };

      const qDevotee = query(
        collection(db, 'devotees'),
        where('contact', '==', normalizedContact),
        where('templeId', '==', event.templeId)
      );
      const devoteeSnap = await getDocs(qDevotee);
      const existingDevoteeId = devoteeSnap.empty ? null : devoteeSnap.docs[0].id;

      const devoteeId = await runTransaction(db, async (transaction) => {
        const eventRef = doc(db, 'events', id!);
        const eventSnap = await transaction.get(eventRef);
        if (!eventSnap.exists() || !eventSnap.data()?.isAttendanceOpen) {
          throw new Error('CLOSED');
        }

        const resolvedDevoteeId = existingDevoteeId ?? doc(collection(db, 'devotees')).id;
        const devoteeRef = doc(db, 'devotees', resolvedDevoteeId);
        const attRef = doc(db, `events/${id}/attendance`, resolvedDevoteeId);

        const attSnap = await transaction.get(attRef);
        if (attSnap.exists() && attSnap.data()?.present) {
          throw new Error('DUPLICATE');
        }

        const writePayload = {
          ...devoteeData,
          _attendanceEventId: id,
        };

        if (existingDevoteeId) {
          const updates: Record<string, unknown> = { ...writePayload };
          if (!attSnap.exists()) {
            updates.attendanceCount = increment(1);
          }
          transaction.update(devoteeRef, updates);
        } else {
          transaction.set(devoteeRef, {
            ...writePayload,
            attendanceCount: 1,
            createdAt: new Date().toISOString(),
          });
        }

        transaction.set(attRef, {
          ...devoteeData,
          devoteeId: resolvedDevoteeId,
          present: true,
          markedAt: new Date().toISOString(),
          markedBy: 'DYNAMIC_FORM_SUBMISSION',
        });

        return resolvedDevoteeId;
      });

      const { facilitatorId: _, ...toSave } = devoteeData;
      localStorage.setItem('iskcon_devotee_data', JSON.stringify(toSave));

      setPassData({
        ...devoteeData,
        facilitatorName,
        generationTime: new Date(),
        devoteeId,
      });
      setSubmitted(true);
    } catch (error: unknown) {
      console.error(error);
      const msg = error instanceof Error ? error.message : '';
      if (msg === 'DUPLICATE') {
        alert('You have already marked attendance for this event.');
      } else if (msg === 'CLOSED') {
        alert('Attendance is currently closed for this event.');
      } else {
        alert(`Submission failed: ${getFirestoreErrorMessage(error)}`);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return (
    <div className="h-screen w-screen flex items-center justify-center bg-cream">
      <div className="animate-spin rounded-full h-12 w-12 border-4 border-orange-500 border-t-transparent"></div>
    </div>
  );

  // Check if archived (static history)
  const isNow = new Date();
  const eventDate = event ? new Date(event.date) : new Date();
  const diffHours = (isNow.getTime() - eventDate.getTime()) / (1000 * 60 * 60);
  const isArchived = (event as any)?.isDeleted || (!(event as any)?.isAttendanceOpen && diffHours > 24);

  if (!event || isArchived) return (
    <div className="h-screen flex flex-col items-center justify-center bg-cream p-6 text-center">
      <div className="w-24 h-24 bg-stone-50 rounded-[2.5rem] flex items-center justify-center mb-8 text-stone-200 border border-stone-100 shadow-inner">
        <Lock size={48} />
      </div>
      <h1 className="text-4xl font-serif font-black text-stone-800 mb-3 tracking-tight">{isArchived ? "Session Concluded" : "Attendance Closed"}</h1>
      <p className="text-stone-400 max-w-sm italic leading-relaxed text-sm">
        {isArchived 
          ? "This event has already been recorded and secured in the temple archives." 
          : "The attendance window for this session has been closed by the temple authorities."}
      </p>
    </div>
  );

  if (submitted) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-cream p-6 text-center animate-in fade-in duration-700">
      <div className="max-w-md w-full space-y-8 mb-10">
        <div className="flex flex-col items-center gap-2 mb-4">
          <div className="w-16 h-16 bg-orange-50 rounded-full flex items-center justify-center text-orange-500 shadow-lg shadow-orange-100">
            <CheckCircle2 size={32} />
          </div>
          <h1 className="text-3xl font-serif font-black text-stone-800 tracking-tight">Registration Complete!</h1>
        </div>

        {/* Beautiful Entry Pass */}
        <div className="relative group perspective-1000">
          <div 
            ref={passRef}
            className="bg-white border-[12px] border-orange-100 rounded-[2.5rem] p-8 shadow-[0_32px_64px_-16px_rgba(249,115,22,0.15)] relative overflow-hidden text-left"
          >
            {/* Indian Art Background Pattern (Simplified) */}
            <div className="absolute inset-0 opacity-[0.03] pointer-events-none select-none overflow-hidden">
               <div className="absolute -top-24 -right-24 w-96 h-96 border-[40px] border-orange-500 rounded-full" />
               <div className="absolute -bottom-24 -left-24 w-96 h-96 border-[40px] border-orange-500 rounded-full" />
               <div className="absolute inset-0 flex items-center justify-center">
                 <div className="w-full h-full rotate-45 border-[1px] border-orange-900 border-dashed scale-150" />
               </div>
            </div>

            <div className="relative z-10 space-y-6">
              <div className="text-center border-b-2 border-stone-100 pb-6 mb-6">
                <h2 className="text-[10px] font-black tracking-[0.5em] text-orange-500 uppercase mb-2">Hare Krishna</h2>
                <h3 className="text-4xl font-serif font-black text-stone-800 tracking-tighter">ISKCON UJJAIN</h3>
              </div>

              <div className="space-y-1">
                <p className="text-[9px] font-black text-stone-400 uppercase tracking-widest leading-none">Entry Validation Time</p>
                <div className="text-2xl font-black text-stone-800 tracking-tight leading-tight">
                  {passData?.generationTime?.toLocaleDateString(undefined, {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric'
                  })}
                  <span className="block text-orange-500 font-serif italic text-xl mt-0.5">
                    {passData?.generationTime?.toLocaleTimeString(undefined, { 
                      hour: '2-digit', 
                      minute: '2-digit' 
                    })}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6 pt-4 border-t-2 border-stone-50">
                <div className="space-y-1">
                  <p className="text-[8px] font-black text-stone-400 uppercase tracking-widest">Devotee Name</p>
                  <p className="text-lg font-bold text-stone-800 leading-tight">{passData?.name}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[8px] font-black text-stone-400 uppercase tracking-widest">Contact No.</p>
                  <p className="text-lg font-bold text-stone-800 leading-tight font-mono">{passData?.contact}</p>
                </div>
                <div className="space-y-1 col-span-2">
                  <p className="text-[8px] font-black text-stone-400 uppercase tracking-widest">Assigned Facilitator</p>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full" />
                    <p className="text-lg font-bold text-stone-800 leading-tight">{passData?.facilitatorName}</p>
                  </div>
                </div>
              </div>

              <div className="pt-8 flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-[8px] font-black text-stone-300 uppercase tracking-[0.3em]">Event ID</p>
                  <p className="text-[10px] font-mono text-stone-300">#{id?.slice(-8).toUpperCase()}</p>
                </div>
                <div className="w-12 h-12 bg-stone-50 rounded-xl border border-stone-100 flex items-center justify-center opacity-50">
                   <Clock size={20} className="text-stone-300" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <button 
            onClick={downloadPass}
            className="w-full flex items-center justify-center gap-3 py-5 bg-orange-500 text-white rounded-2xl font-black uppercase tracking-[0.2em] text-[10px] shadow-xl shadow-orange-100 hover:scale-[1.02] transition-all active:scale-95"
          >
            <Download size={16} /> Download Entry Pass
          </button>
          
          <button 
            onClick={() => {
              setSubmitted(false);
              setForm(prev => ({
                ...prev,
                name: '',
                contact: '',
                facilitatorId: ''
              }));
            }}
            className="w-full py-5 bg-stone-100 text-stone-600 rounded-2xl font-black uppercase tracking-[0.2em] text-[10px] transition-all active:scale-95 border border-stone-200"
          >
            Submit Another Entry
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-cream px-4 py-12 md:py-20 font-sans">
      <div className="max-w-xl mx-auto space-y-12">
        <header className="text-center space-y-4">
          <div className="inline-flex items-center gap-3 px-6 py-2 bg-orange-50 text-orange-600 rounded-full text-[10px] font-black uppercase tracking-[0.3em] border border-orange-100 mb-4">
            <div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse" /> Digital Calling Form
          </div>
          <h1 className="text-5xl font-serif font-black text-stone-800 tracking-tighter leading-tight">{event.title}</h1>
          <p className="text-stone-400 font-bold flex items-center justify-center gap-3 text-sm">
            <Calendar size={18} className="text-orange-500" />
            {new Date(event.date).toLocaleDateString(undefined, { dateStyle: 'full' })}
          </p>
        </header>

        <div className="bg-white border border-stone-100 rounded-[3rem] p-10 shadow-2xl shadow-stone-200/50 relative overflow-hidden">
          {isQuickEntryEligible ? (
             <div className="space-y-6 relative z-10">
               <div className="flex items-center justify-between mb-2">
                 <h2 className="text-xl font-black text-stone-800">Saved Devotees</h2>
                 <button 
                   onClick={() => {
                     localStorage.removeItem('iskcon_devotee_data');
                     setForm({
                       name: '', contact: '', facilitatorId: '', age: '', dob: '',
                       address: '', gender: '', institute: '', mentor: '', chanting: '0'
                     });
                     setHasLocalStorageData(false);
                   }}
                   className="text-[10px] uppercase font-black tracking-widest text-red-400 hover:text-red-500 transition-colors"
                 >
                   Clear
                 </button>
               </div>
               
               <div 
                 onClick={() => handleSubmit()}
                 className={`border ${submitting ? 'border-orange-100 opacity-70 scale-[0.98]' : 'border-orange-200 hover:shadow-orange-100 hover:shadow-lg cursor-pointer'} bg-white rounded-[2rem] p-6 flex items-center justify-between transition-all`}
               >
                 <div>
                   <h3 className="text-2xl font-black text-stone-800 tracking-tight">{form.name}</h3>
                   {form.mentor && <p className="text-sm font-medium text-stone-500 mt-1">Linked: {form.mentor}</p>}
                 </div>
                 <div className="w-12 h-12 bg-orange-50 text-orange-500 rounded-full flex items-center justify-center shrink-0">
                   {submitting ? (
                      <div className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
                   ) : (
                      <ArrowRight size={24} />
                   )}
                 </div>
               </div>

               <button 
                 onClick={() => setShowFullFormOverride(true)}
                 disabled={submitting}
                 className="mt-6 w-full py-5 bg-orange-50 hover:bg-orange-100 text-orange-800 font-black tracking-widest text-[10px] uppercase rounded-[1.5rem] transition-colors"
               >
                 + नया पास बनाएँ (New Entry)
               </button>
             </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-8 relative z-10">
              <div className="space-y-6">
                {/* Primary Identifier */}
                <div className="space-y-3">
                  <label className="text-[10px] font-black text-stone-400 uppercase tracking-[0.4em] px-1 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Phone size={14} className="text-orange-500" /> Active Contact
                  </div>
                  {form.name && (
                    <button 
                      type="button"
                      onClick={() => {
                        localStorage.removeItem('iskcon_devotee_data');
                        setForm({
                          name: '', contact: '', facilitatorId: '', age: '', dob: '',
                          address: '', gender: '', institute: '', mentor: '', chanting: '0'
                        });
                      }}
                      className="text-[9px] text-orange-500 font-black tracking-widest hover:underline"
                    >
                      (NOT {form.name.split(' ')[0]}? SWITCH)
                    </button>
                  )}
                </label>
                <div className="relative group">
                  <input 
                    type="tel" required
                    placeholder="+91 98765-43210"
                    className={cn(
                      "w-full px-6 py-5 rounded-[1.5rem] border outline-none transition-all shadow-inner font-bold text-stone-700",
                      form.name ? "bg-emerald-50/30 border-emerald-100 text-emerald-800" : "bg-stone-50/30 border-stone-100 focus:bg-white focus:border-orange-200"
                    )}
                    value={form.contact}
                    onChange={e => setForm({...form, contact: e.target.value})}
                  />
                  {form.name && (
                    <div className="absolute right-6 top-1/2 -translate-y-1/2 flex items-center gap-2">
                       <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                       <span className="text-[9px] font-black text-emerald-600 uppercase tracking-widest">Profile Identified</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-[10px] font-black text-stone-400 uppercase tracking-[0.4em] px-1 flex items-center gap-3">
                  <User size={14} className="text-orange-500" /> Full Name
                </label>
                <input 
                  type="text" required
                  placeholder="e.g. Rahul Arya"
                  className="w-full px-6 py-5 rounded-[1.5rem] border border-stone-100 bg-stone-50/30 focus:bg-white focus:border-orange-200 outline-none transition-all shadow-inner font-bold text-stone-700"
                  value={form.name}
                  onChange={e => setForm({...form, name: e.target.value})}
                />
              </div>

              {/* Dynamic Fields from Template */}
              {template?.fields.filter((f: string) => f !== 'name' && f !== 'contact').map((field: string) => {
                switch(field) {
                  case 'age':
                    return (
                      <div key={field} className="space-y-3">
                        <label className="text-[10px] font-black text-stone-400 uppercase tracking-[0.4em] px-1 flex items-center gap-3">
                          <Calendar size={14} className="text-orange-500" /> Current Age
                        </label>
                        <input 
                          type="number"
                          placeholder="e.g. 25"
                          className="w-full px-6 py-5 rounded-[1.5rem] border border-stone-100 bg-stone-50/30 focus:bg-white focus:border-orange-200 outline-none transition-all shadow-inner font-bold text-stone-700"
                          value={form.age || ''}
                          onChange={e => setForm({...form, age: e.target.value})}
                        />
                      </div>
                    );
                  case 'dob':
                    return (
                      <div key={field} className="space-y-3">
                        <label className="text-[10px] font-black text-stone-400 uppercase tracking-[0.4em] px-1 flex items-center gap-3">
                          <Calendar size={14} className="text-orange-500" /> Date of Birth
                        </label>
                        <input 
                          type="date"
                          className="w-full px-6 py-5 rounded-[1.5rem] border border-stone-100 bg-stone-50/30 focus:bg-white focus:border-orange-200 outline-none transition-all shadow-inner font-bold text-stone-700"
                          value={form.dob || ''}
                          onChange={e => setForm({...form, dob: e.target.value})}
                        />
                      </div>
                    );
                  case 'address':
                    return (
                      <div key={field} className="space-y-3">
                        <label className="text-[10px] font-black text-stone-400 uppercase tracking-[0.4em] px-1 flex items-center gap-3">
                          <CheckCircle2 size={14} className="text-orange-500" /> Full Address
                        </label>
                        <textarea 
                          rows={2}
                          placeholder="Complete Postal Address"
                          className="w-full px-6 py-5 rounded-[1.5rem] border border-stone-100 bg-stone-50/30 focus:bg-white focus:border-orange-200 outline-none transition-all shadow-inner font-bold text-stone-700 resize-none"
                          value={form.address || ''}
                          onChange={e => setForm({...form, address: e.target.value})}
                        />
                      </div>
                    );
                  case 'institute':
                    return (
                      <div key={field} className="space-y-3">
                        <label className="text-[10px] font-black text-stone-400 uppercase tracking-[0.4em] px-1 flex items-center gap-3">
                          <CheckCircle2 size={14} className="text-orange-500" /> Institute / Company
                        </label>
                        <input 
                          type="text"
                          placeholder="e.g. DTU, Google, etc."
                          className="w-full px-6 py-5 rounded-[1.5rem] border border-stone-100 bg-stone-50/30 focus:bg-white focus:border-orange-200 outline-none transition-all shadow-inner font-bold text-stone-700"
                          value={form.institute || ''}
                          onChange={e => setForm({...form, institute: e.target.value})}
                        />
                      </div>
                    );
                  case 'gender':
                    return (
                      <div key={field} className="space-y-3">
                        <label className="text-[10px] font-black text-stone-400 uppercase tracking-[0.4em] px-1 flex items-center gap-3">
                          <User size={14} className="text-orange-500" /> Gender
                        </label>
                        <div className="grid grid-cols-3 gap-3">
                          {['Male', 'Female', 'Other'].map(g => (
                            <button
                              key={g}
                              type="button"
                              onClick={() => setForm({...form, gender: g})}
                              className={cn(
                                "py-4 rounded-2xl border font-bold text-xs transition-all",
                                form.gender === g ? "bg-stone-900 text-white border-stone-900" : "bg-stone-50 border-stone-100 text-stone-400"
                              )}
                            >
                              {g}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  case 'mentor':
                    return (
                      <div key={field} className="space-y-3">
                        <label className="text-[10px] font-black text-stone-400 uppercase tracking-[0.4em] px-1 flex items-center gap-3">
                          <UserCheck size={14} className="text-orange-500" /> Mentor Name
                        </label>
                        <div className="relative">
                          <select 
                            className="w-full px-6 py-5 rounded-[1.5rem] border border-stone-100 bg-stone-50/30 focus:bg-white focus:border-orange-200 outline-none transition-all shadow-inner font-bold text-stone-700 appearance-none"
                            value={form.mentor || ''}
                            onChange={e => setForm({...form, mentor: e.target.value})}
                          >
                            <option value="">Select Mentor</option>
                            {mentors.map(m => (
                              <option key={m.uid} value={m.displayName || ''}>{m.displayName}</option>
                            ))}
                          </select>
                          <ChevronDown className="absolute right-6 top-1/2 -translate-y-1/2 text-stone-300 pointer-events-none" size={20} />
                        </div>
                      </div>
                    );
                  case 'facilitator':
                    return (
                      <div key={field} className="space-y-3">
                        <label className="text-[10px] font-black text-stone-400 uppercase tracking-[0.4em] px-1 flex items-center gap-3">
                          <Users size={14} className="text-orange-500" /> Assigned Facilitator
                        </label>
                        <div className="relative">
                          <select 
                            className="w-full px-6 py-5 rounded-[1.5rem] border border-stone-100 bg-stone-50/30 focus:bg-white focus:border-orange-200 outline-none transition-all shadow-inner font-bold text-stone-700 appearance-none"
                            value={form.facilitatorId || ''}
                            onChange={e => setForm({...form, facilitatorId: e.target.value})}
                          >
                            <option value="">Select Facilitator</option>
                            {templeUsers.map(u => (
                              <option key={u.uid} value={u.uid}>{u.displayName}</option>
                            ))}
                          </select>
                          <ChevronDown className="absolute right-6 top-1/2 -translate-y-1/2 text-stone-300 pointer-events-none" size={20} />
                        </div>
                      </div>
                    );
                  case 'chanting':
                    return (
                      <div key={field} className="space-y-3">
                        <label className="text-[10px] font-black text-stone-400 uppercase tracking-[0.4em] px-1 flex items-center gap-3">
                          <Check size={14} className="text-orange-500" /> Chanting (Rounds)
                        </label>
                        <div className="flex items-center gap-2">
                          {[0, 1, 4, 8, 12, 16].map(num => (
                            <button
                              key={num}
                              type="button"
                              onClick={() => setForm({...form, chanting: num.toString()})}
                              className={cn(
                                "flex-1 py-4 rounded-xl border font-bold text-xs transition-all",
                                form.chanting === num.toString() ? "bg-orange-500 text-white border-orange-500 shadow-lg" : "bg-stone-50 border-stone-100 text-stone-400"
                              )}
                            >
                              {num === 16 ? '16+' : num}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  default:
                    return null;
                }
              })}
            </div>

            <button 
              type="submit" 
              disabled={submitting}
              className="w-full flex items-center justify-center gap-4 py-6 bg-gradient-to-r from-orange-400 to-orange-500 text-white rounded-[1.5rem] font-black text-xs uppercase tracking-[0.3em] hover:scale-[1.02] active:scale-95 transition-all shadow-2xl shadow-orange-100 disabled:opacity-70 disabled:hover:scale-100"
            >
              {submitting ? "Processing..." : "Submit Attendance"}
            </button>
          </form>
          )}
        </div>

        <footer className="text-center space-y-8">
          <div className="max-w-xs mx-auto p-6 border border-stone-100 rounded-[2.5rem] bg-white shadow-sm">
             <p className="italic text-[10px] leading-relaxed text-stone-400 font-medium">
              Your details are securely recorded in the temple database for future outreach and seva updates.
             </p>
          </div>
          <div className="space-y-2">
            <p className="text-[10px] font-black text-stone-300 uppercase tracking-[0.4em]">© {new Date().getFullYear()} ISKCON SEVA MANAGEMENT</p>
            <p className="text-[9px] text-stone-200 italic">Hare Krishna Hare Krishna Krishna Krishna Hare Hare</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
