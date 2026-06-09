import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../services/firebase';
import { 
  doc, 
  getDoc, 
  collection, 
  query, 
  where, 
  onSnapshot,
  collectionGroup,
  getDocs,
  updateDoc,
  deleteDoc,
  deleteField,
  writeBatch
} from 'firebase/firestore';
import { Devotee, CallingAssignment, Event, UserProfile } from '../types';
import { 
  Phone, 
  User, 
  Calendar, 
  CheckCircle, 
  XCircle, 
  ChevronLeft,
  Share2,
  Clock,
  Heart,
  Edit2,
  Save,
  X,
  Users,
  Database,
  Trash2,
  Search
} from 'lucide-react';
import { cn } from '../lib/utils';
import ContactLink from '../components/ContactLink';
import { useAuth } from '../context/AuthContext';

export default function DevoteeProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, profile, isOwner, isMentor } = useAuth();
  const [devotee, setDevotee] = useState<Devotee | null>(null);
  const [assignments, setAssignments] = useState<CallingAssignment[]>([]);
  const [displayAssignmentsLimit, setDisplayAssignmentsLimit] = useState(3);
  const [displayNotesLimit, setDisplayNotesLimit] = useState(3);
  const [events, setEvents] = useState<Record<string, Event>>({});
  const [attendanceRecords, setAttendanceRecords] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Devotee>>({});
  const [templeUsers, setTempleUsers] = useState<UserProfile[]>([]);
  const [activitySearch, setActivitySearch] = useState('');
  const [engagementSearch, setEngagementSearch] = useState('');
  const [confirmState, setConfirmState] = useState<{isOpen: boolean, title: string, content: string, action: () => void}>({
    isOpen: false, title: '', content: '', action: () => {}
  });

  const openConfirm = (title: string, content: string, action: () => void) => {
    setConfirmState({ isOpen: true, title, content, action });
  };
  const closeConfirm = () => setConfirmState(prev => ({ ...prev, isOpen: false }));

  const canFullEdit = isOwner || isMentor || !!(devotee?.facilitatorId && profile?.uid && devotee.facilitatorId === profile.uid);
  const canAccessProfile =
    isOwner ||
    isMentor ||
    !!(devotee && profile && devotee.templeId === profile.templeId && (
      devotee.facilitatorId === profile.uid ||
      (profile.contact && devotee.contact === profile.contact)
    ));
  const canEdit = canFullEdit;

  useEffect(() => {
    if (!id) return;

    let unsubDevotee = () => {};
    let unsubAssignments = () => {};

    const fetchAll = async () => {
      setLoading(true);
      try {
        unsubDevotee = onSnapshot(doc(db, 'devotees', id), async (devDoc) => {
          if (devDoc.exists()) {
             const data = { id: devDoc.id, ...devDoc.data() } as Devotee;
             setDevotee(data);
             setEditForm(prev => {
                // Keep existing edits if any, otherwise populate
                return Object.keys(prev).length > 0 ? prev : data;
             });

             if (data.templeId) {
               const qU = query(collection(db, 'users'), where('templeId', '==', data.templeId));
               const uSnap = await getDocs(qU);
               setTempleUsers(
                uSnap.docs
                  .map(d => ({ uid: d.id, ...d.data() } as UserProfile))
                  .filter(u => !u.isDeleted)
              );
             }
          }
        });

        const qA = query(collectionGroup(db, 'assignments'), where('devoteeId', '==', id));
        unsubAssignments = onSnapshot(qA, async (assignSnap) => {
           const assignData = assignSnap.docs.map(d => ({ id: d.id, ...d.data() } as CallingAssignment));
           setAssignments(assignData);

           const eventIds = [...new Set(assignData.map(a => a.eventId))];
           const eventMap: Record<string, Event> = {};
           const attRecords: Record<string, boolean> = {};
           
           for (const eid of eventIds) {
             const eDoc = await getDoc(doc(db, 'events', eid));
             if (eDoc.exists()) {
               eventMap[eid] = { id: eDoc.id, ...eDoc.data() } as Event;
               const attDoc = await getDoc(doc(db, `events/${eid}/attendance`, id));
               attRecords[eid] = attDoc.exists() ? (attDoc.data() as any).present : false;
             }
           }
           setEvents(prev => ({...prev, ...eventMap}));
           setAttendanceRecords(prev => ({...prev, ...attRecords}));
        });
      } catch (error) {
        console.error("Error fetching devotee profile:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchAll();
    return () => {
      unsubDevotee();
      unsubAssignments();
    };
  }, [id]);

  const handleSave = async () => {
    if (!id || !editForm) return;
    try {
      const updateData: any = {
        ...editForm,
        updatedAt: new Date().toISOString()
      };
      
      // Sync legacy facilitator field if facilitatorName is changed
      if (editForm.facilitatorName !== undefined) {
        updateData.facilitator = editForm.facilitatorName;
      }
      
      await updateDoc(doc(db, 'devotees', id), updateData);
      setDevotee({ ...devotee, ...updateData } as Devotee);
      setIsEditing(false);
      alert("Profile updated successfully!");
    } catch (error) {
      console.error(error);
      alert("Failed to update profile.");
    }
  };

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({
        title: `${devotee?.name}'s Profile`,
        url: window.location.href
      });
    } else {
      navigator.clipboard.writeText(window.location.href);
      alert("Profile link copied to clipboard!");
    }
  };

  const clearFacilitationResponse = async () => {
    if (!id || !canEdit) return;
    openConfirm("Clear Response", "Are you sure you want to clear the facilitation response?", async () => {
      try {
        await updateDoc(doc(db, 'devotees', id), {
          facilitationResponse: deleteField(),
          facilitationResponseText: deleteField(),
          updatedAt: new Date().toISOString()
        });
        setDevotee(prev => prev ? { ...prev, facilitationResponse: undefined, facilitationResponseText: undefined } : null);
        if (isEditing) {
          setEditForm(prev => ({ ...prev, facilitationResponse: '', facilitationResponseText: '' }));
        }
      } catch (error) {
        console.error("Clear facilitation error:", error);
        alert("Failed to clear response.");
      }
      closeConfirm();
    });
  };

  const deleteFacilitationNote = async (noteToMatch: any) => {
    if (!id || !canEdit || !devotee.facilitationNotes) return;
    openConfirm("Delete Note", "Are you sure you want to delete this note?", async () => {
      try {
        const updatedNotes = [...devotee.facilitationNotes!];
        // Find exact note to delete
        const actualIndex = updatedNotes.findIndex(n => n.date === noteToMatch.date && n.note === noteToMatch.note);
        if (actualIndex > -1) {
          updatedNotes.splice(actualIndex, 1);
          await updateDoc(doc(db, 'devotees', id), {
            facilitationNotes: updatedNotes,
            updatedAt: new Date().toISOString()
          });
          setDevotee(prev => prev ? { ...prev, facilitationNotes: updatedNotes } : null);
        }
      } catch (error) {
        console.error("Delete note error:", error);
        alert("Failed to delete note.");
      }
      closeConfirm();
    });
  };

  const deleteAssignment = async (assignmentId: string) => {
    if (!canEdit) return;
    openConfirm("Remove Response", "Are you sure you want to remove this response from the log?", async () => {
      try {
        // Find which event this belongs to
        const assignment = assignments.find(a => a.id === assignmentId);
        if (!assignment) return;

        const batch = writeBatch(db);
        batch.delete(doc(db, `events/${assignment.eventId}/assignments`, assignmentId));
        
        // Also delete attendance record if it exists
        if (assignment.devoteeId) {
          batch.delete(doc(db, `events/${assignment.eventId}/attendance`, assignment.devoteeId));
        }
        
        await batch.commit();

        // No need to manually filter setAssignments, onSnapshot will handle it, 
        // but doing it for immediate UI feedback is good
        setAssignments(prev => prev.filter(a => a.id !== assignmentId));
      } catch (error) {
        console.error("Delete assignment error:", error);
        alert("Failed to remove response.");
      }
      closeConfirm();
    });
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>, type: 'notes' | 'assignments') => {
    const target = e.currentTarget;
    // Check if scrolled near bottom
    if (target.scrollHeight - Math.ceil(target.scrollTop) <= target.clientHeight + 100) {
      if (type === 'notes') {
        if (devotee?.facilitationNotes && displayNotesLimit < devotee.facilitationNotes.length) {
          setDisplayNotesLimit(prev => prev + 5);
        }
      } else {
        if (displayAssignmentsLimit < assignments.length) {
          setDisplayAssignmentsLimit(prev => prev + 5);
        }
      }
    }
  };

  const formatValue = (val: any): string => {
    if (val === null || val === undefined) return '';
    if (typeof val === 'object' && val.seconds !== undefined) {
      return new Date(val.seconds * 1000).toLocaleString(undefined, { 
        dateStyle: 'medium', 
        timeStyle: 'short' 
      });
    }
    if (val instanceof Date) return val.toLocaleString(undefined, { 
      dateStyle: 'medium', 
      timeStyle: 'short' 
    });
    // Check if it's a valid date string
    if (typeof val === 'string' && !isNaN(Date.parse(val)) && val.includes('-')) {
      return new Date(val).toLocaleString(undefined, { 
        dateStyle: 'medium', 
        timeStyle: 'short' 
      });
    }
    return String(val);
  };

  if (loading) return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-cream">
      <div className="w-16 h-16 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mb-8" />
      <div className="flex flex-col items-center gap-3">
        <p className="text-[10px] font-black text-stone-800 uppercase tracking-[0.4em] animate-pulse">Loading Identity</p>
        <p className="text-sm font-medium text-stone-400 italic">Verifying records across database...</p>
      </div>
    </div>
  );

  if (!devotee) return (
    <div className="h-screen flex flex-col items-center justify-center bg-cream p-6 text-center">
      <div className="w-24 h-24 bg-stone-100 rounded-[2.5rem] flex items-center justify-center mb-8">
        <XCircle size={48} className="text-stone-300" />
      </div>
      <h1 className="text-4xl text-stone-800 font-serif font-black tracking-tight mb-4">Profile Not Found</h1>
      <p className="text-stone-400 max-w-xs mb-10 leading-relaxed italic">The record you are looking for might have been moved or deleted.</p>
      <button onClick={() => navigate('/')} className="px-8 py-4 bg-orange-500 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-orange-200">Return to Base</button>
    </div>
  );

  if (!canAccessProfile) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-cream p-6 text-center">
        <div className="w-24 h-24 bg-stone-100 rounded-[2.5rem] flex items-center justify-center mb-8">
          <XCircle size={48} className="text-stone-300" />
        </div>
        <h1 className="text-3xl text-stone-800 font-serif font-black tracking-tight mb-4">Access Denied</h1>
        <p className="text-stone-400 max-w-sm mb-10 leading-relaxed italic">
          You do not have permission to view this devotee profile.
        </p>
        <button onClick={() => navigate('/')} className="px-8 py-4 bg-orange-500 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-orange-200">Return to Base</button>
      </div>
    );
  }

  const comingCount = assignments.filter(a => a.response === 'COMING').length;
  const notComingCount = assignments.filter(a => a.response === 'NOT_COMING').length;
  const maybeCount = assignments.filter(a => (a.response as any) === 'MAYBE').length;

  return (
    <div className="min-h-screen bg-cream pb-32 overflow-x-hidden font-sans">
      {/* Header / Identity Area */}
      <div className="bg-white border-b border-stone-100">
        <div className="max-w-5xl mx-auto px-8 py-12 md:py-20">
          <div className="flex items-center justify-between mb-16">
            <button onClick={() => navigate('/')} className="p-3.5 hover:bg-stone-50 rounded-2xl transition-all text-stone-400 active:scale-95 border border-transparent hover:border-stone-100 shadow-sm bg-white">
              <ChevronLeft size={28} />
            </button>
            <div className="flex items-center gap-4">
              {canEdit && (
                <button 
                  onClick={() => setIsEditing(!isEditing)} 
                  className={cn(
                    "flex items-center gap-3 px-8 py-4 rounded-2xl text-xs font-black uppercase tracking-widest transition-all active:scale-95 shadow-lg border",
                    isEditing ? "bg-white border-stone-100 text-stone-400" : "bg-gradient-to-r from-orange-400 to-orange-500 border-orange-400 text-white shadow-orange-200"
                  )}
                >
                  {isEditing ? <><X size={20} /> Cancel</> : <><Edit2 size={20} /> Modify Profile</>}
                </button>
              )}
              <button onClick={handleShare} className="bg-stone-800 text-white hover:bg-black p-4 rounded-2xl transition-all shadow-xl shadow-stone-200 active:scale-95">
                <Share2 size={24} />
              </button>
            </div>
          </div>

          <div className="flex flex-col md:flex-row items-center md:items-start gap-12">
            <div className="relative group">
              <div className="absolute inset-0 bg-orange-500/20 rounded-[3rem] blur-2xl group-hover:blur-3xl transition-all duration-700" />
              <div className="w-48 h-48 rounded-[3rem] bg-white border-[8px] border-white shadow-2xl flex items-center justify-center text-7xl font-black text-orange-500 relative z-10 select-none font-serif rotate-3 group-hover:rotate-0 transition-transform duration-500">
                {devotee.name[0]}
                <div className="absolute -bottom-2 -right-2 w-12 h-12 bg-gradient-to-br from-orange-400 to-orange-600 rounded-[1.25rem] border-4 border-white shadow-xl" />
              </div>
            </div>
            
            <div className="text-center md:text-left flex-1 space-y-8">
              {isEditing ? (
                <div className="space-y-8 w-full max-w-xl">
                  <div>
                    <span className="text-[10px] font-black text-orange-500 uppercase tracking-[0.4em] mb-3 block">Legitimate Identity</span>
                    {canFullEdit ? (
                      <input 
                        type="text" 
                        value={editForm.name} 
                        onChange={e => setEditForm({...editForm, name: e.target.value})}
                        className="text-5xl font-black text-stone-800 tracking-tighter bg-stone-50 border border-stone-100 rounded-[2rem] px-8 py-6 outline-none w-full focus:border-orange-200 focus:ring-8 focus:ring-orange-50 transition-all font-serif italic shadow-inner"
                        placeholder="Enter Full Name"
                      />
                    ) : (
                      <div className="text-5xl font-black text-stone-800 tracking-tighter bg-white rounded-[2rem] px-8 py-6 w-full font-serif italic border border-stone-100">
                        {editForm.name}
                      </div>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="space-y-3">
                       <span className="text-[10px] font-black text-stone-400 uppercase tracking-[0.4em] mb-3 block px-1">Direct Contact</span>
                       <div className="flex items-center gap-4 bg-stone-50/50 px-6 py-5 rounded-2xl border border-stone-100 focus-within:border-orange-200 transition-all shadow-inner group">
                         <Phone size={22} className="text-stone-300 group-focus-within:text-orange-500 transition-colors" />
                         {canFullEdit ? (
                           <input 
                             type="text" 
                             value={editForm.contact} 
                             onChange={e => setEditForm({...editForm, contact: e.target.value})}
                             className="bg-transparent outline-none text-stone-700 font-bold w-full text-base"
                           />
                         ) : (
                           <div className="text-stone-700 font-bold w-full text-base">{editForm.contact}</div>
                         )}
                       </div>
                    </div>
                    <div className="space-y-3">
                       <span className="text-[10px] font-black text-stone-400 uppercase tracking-[0.4em] mb-3 block px-1">Identified Gender</span>
                       <div className="flex items-center gap-4 bg-stone-50/50 px-6 py-5 rounded-2xl border border-stone-100 focus-within:border-orange-200 transition-all shadow-inner group">
                         <User size={22} className="text-stone-300 group-focus-within:text-orange-500 transition-colors" />
                         {canFullEdit ? (
                           <select 
                             value={editForm.gender || ''} 
                             onChange={e => setEditForm({...editForm, gender: e.target.value})}
                             className="bg-transparent outline-none text-stone-700 font-bold w-full text-base appearance-none"
                           >
                             <option value="">Select Gender</option>
                             <option value="Male">Male</option>
                             <option value="Female">Female</option>
                             <option value="Other">Other</option>
                           </select>
                         ) : (
                           <div className="text-stone-700 font-bold w-full text-base">{editForm.gender || 'Not specified'}</div>
                         )}
                       </div>
                    </div>
                    <div className="space-y-3">
                       <span className="text-[10px] font-black text-stone-400 uppercase tracking-[0.4em] mb-3 block px-1">Biological Age</span>
                       <div className="flex items-center gap-4 bg-stone-50/50 px-6 py-5 rounded-2xl border border-stone-100 focus-within:border-orange-200 transition-all shadow-inner group">
                         <Calendar size={22} className="text-stone-300 group-focus-within:text-orange-500 transition-colors" />
                         {canFullEdit ? (
                           <input 
                             type="text" 
                             value={editForm.age} 
                             onChange={e => setEditForm({...editForm, age: e.target.value})}
                             className="bg-transparent outline-none text-stone-700 font-bold w-full text-base"
                             placeholder="Years"
                           />
                         ) : (
                           <div className="text-stone-700 font-bold w-full text-base">{editForm.age || '--'} Years</div>
                         )}
                       </div>
                    </div>
                    <div className="space-y-3">
                       <span className="text-[10px] font-black text-stone-400 uppercase tracking-[0.4em] mb-3 block px-1">Date of Birth</span>
                       <div className="flex items-center gap-4 bg-stone-50/50 px-6 py-5 rounded-2xl border border-stone-100 focus-within:border-orange-200 transition-all shadow-inner group">
                         <Calendar size={22} className="text-stone-300 group-focus-within:text-orange-500 transition-colors" />
                         {canFullEdit ? (
                           <input 
                             type="date" 
                             value={editForm.dob || ''} 
                             onChange={e => setEditForm({...editForm, dob: e.target.value})}
                             className="bg-transparent outline-none text-stone-700 font-bold w-full text-base"
                           />
                         ) : (
                           <div className="text-stone-700 font-bold w-full text-base">{editForm.dob || 'Not specified'}</div>
                         )}
                       </div>
                    </div>
                    <div className="space-y-3 sm:col-span-2">
                       <span className="text-[10px] font-black text-stone-400 uppercase tracking-[0.4em] mb-3 block px-1">Full Postal Address</span>
                       <div className="flex items-start gap-4 bg-stone-50/50 px-6 py-5 rounded-2xl border border-stone-100 focus-within:border-orange-200 transition-all shadow-inner group">
                         <Database size={22} className="text-stone-300 group-focus-within:text-orange-500 transition-colors mt-1" />
                         {/* Address CAN be edited by everyone */}
                         <textarea 
                           value={editForm.address || ''} 
                           onChange={e => setEditForm({...editForm, address: e.target.value})}
                           className="bg-transparent outline-none text-stone-700 font-bold w-full text-base h-24 resize-none"
                           placeholder="Complete Address"
                         />
                       </div>
                    </div>
                    <div className="space-y-3 sm:col-span-2">
                       <span className="text-[10px] font-black text-stone-400 uppercase tracking-[0.4em] mb-3 block px-1">Institute / Company</span>
                       <div className="flex items-center gap-4 bg-stone-50/50 px-6 py-5 rounded-2xl border border-stone-100 focus-within:border-orange-200 transition-all shadow-inner group">
                         <Heart size={22} className="text-stone-300 group-focus-within:text-orange-500 transition-colors" />
                         {canFullEdit ? (
                           <input 
                             type="text" 
                             value={editForm.institute || ''} 
                             onChange={e => setEditForm({...editForm, institute: e.target.value})}
                             className="bg-transparent outline-none text-stone-700 font-bold w-full text-base"
                             placeholder="e.g. IIT Delhi, Google, etc."
                           />
                         ) : (
                           <div className="text-stone-700 font-bold w-full text-base">{editForm.institute || 'Not specified'}</div>
                         )}
                       </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-8">
                  <div>
                    <div className="flex items-center gap-3 mb-3 justify-center md:justify-start">
                      <div className="w-2.5 h-2.5 bg-orange-500 rounded-full animate-pulse" />
                      <span className="text-[10px] font-black text-orange-500 uppercase tracking-[0.4em]">Verified Member</span>
                    </div>
                    <h1 className="text-7xl font-black text-stone-800 tracking-tighter leading-none font-serif">{devotee.name}</h1>
                  </div>
                  
                  <div className="flex flex-wrap justify-center md:justify-start gap-4">
                    <ContactLink contact={devotee.contact || ''} className="flex items-center gap-4 text-stone-500 font-bold text-sm bg-stone-50 border border-stone-50 px-6 py-3.5 rounded-2xl shadow-sm hover:text-saffron hover:border-saffron/20 transition-all cursor-pointer">
                      <Phone size={18} className="text-orange-400" /> 
                      <span className="tabular-nums">{devotee.contact}</span>
                    </ContactLink>
                    {devotee.gender && (
                      <div className="flex items-center gap-4 text-stone-500 font-bold text-sm bg-stone-50 border border-stone-50 px-6 py-3.5 rounded-2xl shadow-sm">
                        <User size={18} className="text-orange-400" /> 
                        <span>{devotee.gender}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-4 text-stone-500 font-bold text-sm bg-stone-50 border border-stone-50 px-6 py-3.5 rounded-2xl shadow-sm">
                      <Clock size={18} className="text-orange-400" /> 
                      <span>Age: <span className="tabular-nums text-stone-800">{devotee.age || '--'}</span></span>
                    </div>
                    {devotee.dob && (
                      <div className="flex items-center gap-4 text-stone-500 font-bold text-sm bg-stone-50 border border-stone-50 px-6 py-3.5 rounded-2xl shadow-sm">
                        <Calendar size={18} className="text-orange-400" /> 
                        <span>DOB: <span className="tabular-nums text-stone-800">{devotee.dob}</span></span>
                      </div>
                    )}
                    {devotee.institute && (
                      <div className="flex items-center gap-4 text-stone-500 font-bold text-sm bg-stone-50 border border-stone-50 px-6 py-3.5 rounded-2xl shadow-sm">
                        <Heart size={18} className="text-orange-400" /> 
                        <span>{devotee.institute}</span>
                      </div>
                    )}
                    {devotee.address && (
                      <div className="w-full flex items-center gap-4 text-stone-500 font-bold text-sm bg-stone-50 border border-stone-50 px-6 py-3.5 rounded-2xl shadow-sm italic">
                        <Database size={18} className="text-orange-400 shrink-0" /> 
                        <span className="line-clamp-1">{devotee.address}</span>
                      </div>
                    )}
                    {devotee.sheetName && (
                      <div className="flex items-center gap-4 text-orange-600 font-black text-[11px] uppercase tracking-widest bg-orange-50 border border-orange-100 px-6 py-3.5 rounded-2xl shadow-sm">
                        <Database size={18} /> 
                        <span>{devotee.sheetName}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {isEditing && (
              <div className="flex flex-col gap-4 w-full md:w-auto md:self-end">
                <button 
                  onClick={handleSave}
                  className="bg-gradient-to-r from-orange-400 to-orange-500 text-white px-12 py-6 rounded-[1.5rem] font-black text-xs uppercase tracking-[0.2em] flex items-center justify-center gap-4 shadow-2xl shadow-orange-200 hover:scale-105 transition-all active:scale-95 group"
                >
                  <Save size={24} className="group-hover:scale-125 transition-transform" /> Commit Changes
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stats Cards Section */}
      <div className="max-w-5xl mx-auto px-8 -mt-12 relative z-20">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            { label: 'Total Invites', val: assignments.length, color: 'text-stone-800', bg: 'bg-white' },
            { label: 'Presence Score', val: devotee.attendanceCount ?? 0, color: 'text-orange-500', bg: 'bg-white' },
            { label: 'Confirmed Coming', val: comingCount, color: 'text-emerald-500', bg: 'bg-white' },
            { label: 'Awaiting Feedback', val: assignments.filter(a => a.response === 'NONE').length, color: 'text-stone-300', bg: 'bg-white' }
          ].map((stat, i) => (
            <div key={i} className={cn("p-10 rounded-[2.5rem] shadow-2xl shadow-stone-200/50 border border-stone-50 flex flex-col items-center text-center group hover:-translate-y-2 transition-all duration-500 cursor-default", stat.bg)}>
              <span className={cn("text-5xl font-serif font-black mb-3 transition-colors duration-500", stat.color)}>
                {(stat.val ?? 0).toString().padStart(2, '0')}
              </span>
              <span className="text-[10px] font-black text-stone-400 uppercase tracking-[0.3em] group-hover:text-stone-500 transition-colors duration-500">
                {stat.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="max-w-5xl mx-auto px-8 py-20">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          
          {/* Left Column: Essential Info */}
          <div className="lg:col-span-12 xl:col-span-4 space-y-10">
            <div className="bg-white p-12 rounded-[3.5rem] shadow-2xl shadow-stone-200/30 border border-stone-100 relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-40 h-40 bg-stone-50 rounded-full -mr-20 -mt-20 group-hover:scale-150 transition-transform duration-1000 pointer-events-none" />
              
              <div className="relative z-10">
                <div className="flex items-center gap-4 mb-12">
                  <div className="w-12 h-12 bg-orange-50 rounded-2xl flex items-center justify-center shadow-lg shadow-orange-100/50">
                    <Users size={24} className="text-orange-500" />
                  </div>
                  <h3 className="text-2xl font-black font-serif text-stone-800 tracking-tight">Mentor Hierarchy</h3>
                </div>

                <div className="space-y-12">
                  <div className="group/field">
                    <label className="text-[10px] font-black text-stone-400 uppercase tracking-[0.4em] mb-4 block">Primary Mentor</label>
                    {isEditing && canFullEdit ? (
                      <select 
                        value={editForm.mentor || ''} 
                        onChange={e => setEditForm({...editForm, mentor: e.target.value})}
                        className="w-full bg-stone-50 px-6 py-4 rounded-xl border border-stone-100 text-sm font-bold text-stone-700 outline-none focus:border-orange-200 transition-all font-serif italic"
                      >
                        <option value="">No Active Mentor</option>
                        {templeUsers.map(u => (
                          <option key={u.uid} value={u.displayName || u.email}>{u.displayName || u.email}</option>
                        ))}
                      </select>
                    ) : (
                      <p className="text-stone-800 font-serif font-black text-2xl italic tracking-tight">{devotee.mentor || 'Unassigned'}</p>
                    )}
                  </div>

                  {(isOwner || isMentor) && (
                    <div className="group/field">
                      <label className="text-[10px] font-black text-stone-400 uppercase tracking-[0.4em] mb-4 block">Facilitator Assigned</label>
                      {isEditing && canFullEdit ? (
                        <select 
                          value={editForm.facilitatorId || ''} 
                          onChange={e => {
                            const selectedUser = templeUsers.find(u => u.uid === e.target.value);
                            setEditForm({
                              ...editForm, 
                              facilitatorId: e.target.value,
                              facilitatorName: selectedUser?.displayName || selectedUser?.email || ''
                            });
                          }}
                          className="w-full bg-stone-50 px-6 py-4 rounded-xl border border-stone-100 text-sm font-bold text-stone-700 outline-none focus:border-orange-200 transition-all font-serif italic"
                        >
                          <option value="">No Facilitator</option>
                          {templeUsers.map(u => (
                            <option key={u.uid} value={u.uid}>{u.displayName || u.email}</option>
                          ))}
                        </select>
                      ) : (
                        <p className="text-stone-800 font-serif font-black text-2xl italic tracking-tight">{devotee.facilitatorName || templeUsers.find(u => u.uid === devotee.facilitatorId)?.displayName || devotee.facilitator || 'Independent'}</p>
                      )}
                    </div>
                  )}

                  <div className="group/field">
                    <label className="text-[10px] font-black text-stone-400 uppercase tracking-[0.4em] mb-4 block">Rounds Chanting</label>
                    {isEditing ? (
                      <input 
                        type="text"
                        value={editForm.chanting || ''}
                        onChange={e => setEditForm({...editForm, chanting: e.target.value})}
                        className="w-full bg-stone-50 px-6 py-4 rounded-xl border border-stone-100 text-sm font-bold text-stone-700 outline-none focus:border-orange-200 transition-all font-serif italic"
                        placeholder="Chanting Rounds"
                      />
                    ) : (
                      <div className="flex items-center gap-4 bg-orange-50/30 p-5 rounded-2xl border border-orange-50 shadow-inner">
                         <div className="bg-white p-3 rounded-xl border border-orange-100 shadow-sm">
                            <Clock size={20} className="text-orange-500" />
                         </div>
                         <p className="text-stone-800 font-black text-2xl font-serif italic tabular-nums">{devotee.chanting || '--'}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Activity Log & Engagement Feed */}
          <div className="lg:col-span-12 xl:col-span-8 space-y-12">
            <div className="flex flex-col md:flex-row md:items-center justify-between px-4 gap-6">
               <div className="flex-1">
                 <h3 className="text-3xl font-serif font-black text-stone-800 tracking-tight flex items-center gap-6">
                   Activity Log <div className="hidden md:block w-16 h-[2px] bg-orange-500/20" />
                 </h3>
                 <p className="text-[9px] text-stone-400 font-black uppercase tracking-[0.2em] mt-2 italic px-1">Event-specific Calling Responses recorded during invitations</p>
               </div>
               <div className="flex items-center gap-4">
                 <div className="relative">
                   <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                   <input
                     type="text"
                     placeholder="Search..."
                     value={activitySearch}
                     onChange={(e) => setActivitySearch(e.target.value)}
                     className="pl-9 pr-4 py-2.5 bg-white border border-stone-200 rounded-full text-xs font-medium outline-none focus:border-stone-400 focus:shadow-sm transition-all w-48 lg:w-64"
                   />
                 </div>
                 <div className="flex items-center gap-3 text-[10px] font-black text-emerald-500 uppercase tracking-[0.4em] bg-emerald-50 px-6 py-2.5 rounded-full border border-emerald-100">
                    <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-ping shrink-0" />
                    Live Sync
                 </div>
               </div>
            </div>

            <div 
              onScroll={(e) => handleScroll(e, 'assignments')}
              className="grid gap-8 max-h-[500px] overflow-y-auto pr-4 custom-scrollbar transition-all"
            >
               {(() => {
                 const filteredAssignments = assignments.filter(ass => {
                   const e = events[ass.eventId];
                   if (!e) return false;
                   return (e.title || '').toLowerCase().includes(activitySearch.toLowerCase()) ||
                          ass.response.toLowerCase().includes(activitySearch.toLowerCase());
                 });

                 if (filteredAssignments.length === 0) {
                   if (activitySearch) {
                     return (
                       <div className="flex flex-col items-center justify-center py-16 text-center">
                         <div className="w-16 h-16 bg-stone-50 rounded-[2rem] flex items-center justify-center mb-4 border border-stone-100 shadow-inner">
                           <Search size={24} className="text-stone-300" />
                         </div>
                         <p className="text-[10px] font-black text-stone-400 uppercase tracking-widest">No Result Found</p>
                       </div>
                     );
                   }

                   return (
                     <div className="bg-white p-24 rounded-[4rem] border-4 border-dashed border-stone-100 flex flex-col items-center gap-8 justify-center shadow-inner">
                        <div className="w-24 h-24 bg-stone-50 rounded-[2.5rem] flex items-center justify-center shadow-xl shadow-stone-100/50">
                           <Clock size={40} className="text-stone-200" />
                        </div>
                        <div className="text-center space-y-3">
                           <p className="text-stone-800 font-serif font-black text-2xl leading-tight tracking-tight italic">No Temporal Data Found</p>
                           <p className="text-stone-400 font-medium text-base italic">Historical records will synchronize here automatically.</p>
                        </div>
                     </div>
                   );
                 }

                 return filteredAssignments.slice(0, displayAssignmentsLimit).map(ass => {
                   const event = events[ass.eventId];
                 if (!event) return null;
                 const isComing = ass.response === 'COMING';
                 const isMaybe = (ass.response as any) === 'MAYBE';
                 const isAbsent = !attendanceRecords[ass.eventId] && event && (new Date(event.date) < new Date());
                 const isPresent = attendanceRecords[ass.eventId];

                 return (
                   <div key={ass.id} className="bg-white p-10 rounded-[3rem] border border-stone-50 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.05)] hover:shadow-2xl hover:shadow-stone-200 transition-all duration-500 group relative overflow-hidden">
                     <div className="absolute top-0 right-0 w-24 h-24 bg-stone-50/50 rounded-full -mr-12 -mt-12 group-hover:scale-150 transition-transform duration-700 pointer-events-none" />
                     
                     <div className="flex flex-col md:flex-row md:items-center justify-between gap-8 relative z-10">
                        <div className="flex flex-col gap-3">
                           <div className="flex items-center gap-5">
                             <div className={cn(
                               "w-16 h-16 rounded-[1.5rem] flex items-center justify-center transition-all duration-500 shadow-lg",
                               isPresent ? "bg-emerald-500 text-white shadow-emerald-200" : "bg-stone-50 text-stone-400 group-hover:bg-stone-800 group-hover:text-white"
                             )}>
                               {isPresent ? <CheckCircle size={28} /> : <Calendar size={28} />}
                             </div>
                             <div>
                               <h4 className="text-2xl font-serif font-black text-stone-800 tracking-tight group-hover:text-orange-500 transition-colors duration-300">{event.title}</h4>
                               <div className="flex items-center gap-3 mt-1">
                                 <span className="text-[10px] font-black text-stone-400 uppercase tracking-[0.3em]">
                                   {formatValue(event.date)}
                                 </span>
                                 <div className="flex items-center gap-2">
                                    <div className="w-1 h-1 bg-stone-300 rounded-full" />
                                    <span className="text-[10px] font-black text-orange-500/60 uppercase tracking-widest italic">
                                      Caller: {templeUsers.find(u => u.uid === ass.userId)?.displayName || templeUsers.find(u => u.uid === ass.userId)?.email || 'System'}
                                    </span>
                                 </div>
                               </div>
                             </div>
                           </div>
                        </div>
 
                        <div className="flex flex-wrap items-center gap-4">
                           {isPresent && (
                             <div className="bg-emerald-50 text-emerald-600 px-6 py-3 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] border border-emerald-100 shadow-sm">
                               Verified Presence
                             </div>
                           )}
                           {isAbsent && (
                             <div className="bg-stone-50 text-stone-400 px-6 py-3 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] border border-stone-100 italic">
                               Not Present
                             </div>
                           )}
                           
                           <div className="flex items-center gap-2">
                             <div className={cn(
                               "px-8 py-3.5 rounded-[1.25rem] text-xs font-black uppercase tracking-[0.2em] shadow-lg flex items-center justify-center border transition-all",
                               isComing ? "bg-orange-500 text-white border-orange-500 shadow-orange-100" :
                               isMaybe ? "bg-amber-400 text-white border-amber-500" :
                               "bg-white text-stone-400 border-stone-100"
                             )}>
                               {ass.response === 'NONE' ? formatValue(ass.status) : ass.response.replace('_', ' ')}
                             </div>
                             
                             {canEdit && (
                               <button 
                                 onClick={(e) => { e.stopPropagation(); deleteAssignment(ass.id!); }}
                                 className="relative p-2 h-[44px] w-[44px] flex items-center justify-center bg-red-50 text-red-400 hover:bg-red-500 hover:text-white rounded-2xl transition-all border border-red-100"
                                 title="Remove from log"
                               >
                                 <X size={20} />
                               </button>
                             )}
                           </div>
                        </div>
                     </div>
                     
                     {ass.responseText && (
                       <div className="mt-8 pt-8 border-t border-stone-50 flex items-start gap-4">
                          <Edit2 size={18} className="text-stone-300 shrink-0 mt-1" />
                          <p className="text-base font-medium text-stone-500 leading-relaxed italic max-w-2xl bg-stone-50/50 p-6 rounded-2xl">
                             "{ass.responseText}"
                          </p>
                       </div>
                     )}
                   </div>
                 );
                });
               })()}
            </div>

            {/* Facilitation Feedback Card / Engagement Feed */}
            <div className="bg-orange-500 p-12 rounded-[3.5rem] shadow-[0_40px_100px_-20px_rgba(249,115,22,0.3)] space-y-10 relative overflow-hidden group mt-12">
              <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-5 pointer-events-none" />
              
              <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-white/20 backdrop-blur-xl rounded-2xl flex items-center justify-center border border-white/20 shrink-0">
                    <CheckCircle size={24} className="text-white" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-2xl font-black font-serif text-white tracking-tight">Engagement Feed</h3>
                    <p className="text-[9px] text-white/60 font-bold uppercase tracking-[0.2em] mt-1 italic">Saved as persistent Facilitation Strategy in the main profile</p>
                  </div>
                </div>
                <div className="relative">
                   <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/60" />
                   <input
                     type="text"
                     placeholder="Search notes..."
                     value={engagementSearch}
                     onChange={(e) => setEngagementSearch(e.target.value)}
                     className="pl-9 pr-4 py-2.5 bg-white/10 backdrop-blur-md border border-white/20 rounded-full text-xs font-medium text-white placeholder-white/50 outline-none focus:border-white/40 focus:bg-white/20 transition-all w-48 lg:w-64"
                   />
                </div>
              </div>

              <div className="relative z-10 space-y-10">
                <div>
                   <label className="text-[10px] font-black text-white/50 uppercase tracking-[0.4em] mb-5 block">Priority Status</label>
                   {isEditing ? (
                    <select 
                      value={editForm.facilitationResponse || ''} 
                      onChange={e => setEditForm({...editForm, facilitationResponse: e.target.value})}
                      className="w-full bg-white/10 backdrop-blur-md px-6 py-4 rounded-xl border border-white/20 text-sm font-bold text-white outline-none focus:bg-white/20 transition-all"
                    >
                      <option value="" className="text-stone-800">Select Response</option>
                      <option value="Interested" className="text-stone-800">Interested</option>
                      <option value="Not Interested" className="text-stone-800">Not Interested</option>
                      <option value="Follow-up needed" className="text-stone-800">Follow-up needed</option>
                      <option value="Already Joined" className="text-stone-800">Already Joined</option>
                    </select>
                  ) : (
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "px-8 py-4 rounded-2xl text-xs font-black uppercase tracking-[0.2em] shadow-xl",
                        devotee.facilitationResponse === 'Interested' ? "bg-emerald-500 text-white" :
                        devotee.facilitationResponse === 'Not Interested' ? "bg-white/10 text-white/70" :
                        "bg-white text-orange-600"
                      )}>
                        {devotee.facilitationResponse || 'No Status'}
                      </div>
                      {canEdit && (devotee.facilitationResponse || devotee.facilitationResponseText) && (
                        <button 
                          onClick={clearFacilitationResponse}
                          className="p-4 bg-white/10 backdrop-blur-md hover:bg-white/20 text-white rounded-[1.25rem] transition-all border border-white/10 active:scale-90 shadow-xl"
                          title="Clear response"
                        >
                          <Trash2 size={20} />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-[10px] font-black text-white/50 uppercase tracking-[0.4em] mb-4 block">Confidential Notes</label>
                  {isEditing ? (
                    <textarea 
                      value={editForm.facilitationResponseText || ''} 
                      onChange={e => setEditForm({...editForm, facilitationResponseText: e.target.value})}
                      className="w-full bg-white/10 backdrop-blur-md px-6 py-5 rounded-2xl border border-white/20 text-sm font-bold text-white outline-none h-40 resize-none focus:bg-white/20 transition-all placeholder:text-white/30 italic"
                      placeholder="Input strategic notes..."
                    />
                  ) : (
                    <div 
                      onScroll={(e) => handleScroll(e, 'notes')}
                      className="bg-white/10 backdrop-blur-md p-8 rounded-[2rem] border border-white/10 max-h-[400px] overflow-y-auto shadow-inner group-hover:bg-white/15 transition-all space-y-6 custom-scrollbar-light"
                    >
                      {(() => {
                        const allNotes = devotee.facilitationNotes || [];
                        const filteredNotes = allNotes.filter(n => 
                          (n.note || '').toLowerCase().includes(engagementSearch.toLowerCase()) || 
                          (n.authorName || '').toLowerCase().includes(engagementSearch.toLowerCase()) ||
                          (n.status || '').toLowerCase().includes(engagementSearch.toLowerCase())
                        );

                        if (allNotes.length === 0) {
                          return (
                            <p className="text-white text-base font-medium leading-relaxed italic opacity-90">
                              {devotee.facilitationResponseText || 'No strategic metadata recorded.'}
                            </p>
                          );
                        }

                        if (filteredNotes.length === 0) {
                          return (
                            <div className="flex flex-col items-center justify-center py-12 text-center">
                               <div className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center mb-4">
                                 <Search size={20} className="text-white/40" />
                               </div>
                               <p className="text-xs font-bold text-white/50 uppercase tracking-widest">No Result Found</p>
                            </div>
                          );
                        }

                        return filteredNotes.slice(0, displayNotesLimit).map((note, idx) => (
                          <div key={idx} className="bg-white/5 p-4 rounded-xl border border-white/10 relative group/note">
                            <div className="flex justify-between items-start mb-2">
                              <span className="text-[9px] font-black uppercase text-white/40">{formatValue(note.date)}</span>
                              <div className="flex items-center gap-2">
                                <span className={cn(
                                  "text-[8px] font-black uppercase px-1.5 py-0.5 rounded",
                                  note.status === 'Interested' ? "bg-emerald-500/20 text-emerald-200" : "bg-white/20 text-white"
                                )}>
                                  {note.status}
                                </span>
                                {canEdit && (
                                  <button 
                                    onClick={() => deleteFacilitationNote(note)}
                                    className="p-2 w-10 h-10 flex items-center justify-center bg-white/10 hover:bg-red-500 hover:text-white text-white/50 rounded-xl transition-all"
                                  >
                                    <X size={16} />
                                  </button>
                                )}
                              </div>
                            </div>
                            <p className="text-white text-sm font-medium italic mb-2">"{note.note}"</p>
                            <p className="text-[8px] font-black text-white/30 uppercase tracking-widest">— {note.authorName}</p>
                          </div>
                        ));
                      })()}
                    </div>
                  )}
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
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
}
