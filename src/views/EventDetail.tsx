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
  updateDoc, 
  setDoc,
  deleteDoc,
  serverTimestamp,
  writeBatch,
  getDocs
} from 'firebase/firestore';
import { Event, CallingAssignment, UserProfile, Devotee, Attendance } from '../types';
import { useAuth } from '../context/AuthContext';
import Layout from '../components/Layout';
import ContactLink from '../components/ContactLink';
import { motion, AnimatePresence } from 'motion/react';
import { SearchInput } from '../components/SearchInput';
import { 
  Phone, 
  CheckCircle, 
  XCircle, 
  UserPlus, 
  Eye, 
  EyeOff, 
  ChevronLeft,
  Users,
  ClipboardCheck,
  MoreVertical,
  MinusCircle,
  Calendar,
  Heart,
  User
} from 'lucide-react';
import { cn, getPublicAttendanceUrl } from '../lib/utils';

const EventDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile, isOwner, isMentor } = useAuth();
  const [event, setEvent] = useState<Event | null>(null);
  const [assignments, setAssignments] = useState<CallingAssignment[]>([]);
  const [attendance, setAttendance] = useState<Record<string, boolean>>({});
  const [appUsers, setAppUsers] = useState<UserProfile[]>([]);
  const [devotees, setDevotees] = useState<Devotee[]>([]);
  
  // Assignment State
  const [isAssigning, setIsAssigning] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedDevotees, setSelectedDevotees] = useState<string[]>([]);
  const [searchDevotee, setSearchDevotee] = useState('');
  const [assignFacilitatorFilter, setAssignFacilitatorFilter] = useState('NONE');
  const [assignAttendanceEvents, setAssignAttendanceEvents] = useState<Event[]>([]);
  const [selectedAssignEventId, setSelectedAssignEventId] = useState<string>('NONE');
  const [assignAttendanceMap, setAssignAttendanceMap] = useState<Record<string, boolean>>({});
  const [dashboardSearch, setDashboardSearch] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [facilitatorFilter, setFacilitatorFilter] = useState('ALL');
  const [activeDashboardTab, setActiveDashboardTab] = useState<'calling' | 'attendance'>('calling');
  const [attendanceStore, setAttendanceStore] = useState<Record<string, any>>({});

  useEffect(() => {
    if (!id) return;

    // Fetch Event
    const unsubEvent = onSnapshot(doc(db, 'events', id), (doc) => {
      if (doc.exists()) setEvent({ id: doc.id, ...doc.data() } as Event);
      else navigate('/');
    });

    // Fetch Attendance
    const unsubAttendance = onSnapshot(collection(db, `events/${id}/attendance`), (snap) => {
      const data: Record<string, boolean> = {};
      const store: Record<string, any> = {};
      snap.docs.forEach(doc => {
        const attData = doc.data();
        data[doc.id] = attData.present;
        store[doc.id] = attData;
      });
      setAttendance(data);
      setAttendanceStore(store);
    });

    // Fetch Assignments
    let qA;
    if (isOwner || isMentor) {
      qA = query(collection(db, `events/${id}/assignments`));
    } else if (profile?.uid) {
      qA = query(collection(db, `events/${id}/assignments`), where('userId', '==', profile.uid));
    }

    let unsubAssignments = () => {};
    if (qA) {
      unsubAssignments = onSnapshot(qA, (snapshot) => {
        setAssignments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CallingAssignment)));
      });
    }

    let unsubDevotees = () => {};
    if (profile?.templeId) {
      const qD = query(collection(db, 'devotees'), where('templeId', '==', profile.templeId));
      unsubDevotees = onSnapshot(qD, (snap) => {
        let devs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Devotee));
        setDevotees(devs);
      });
    }

    let unsubUsers = () => {};
    if (isOwner || isMentor) {
      // Fetch Users for Assignment
      const qU = query(collection(db, 'users'), where('templeId', '==', profile?.templeId));
      unsubUsers = onSnapshot(qU, snap => {
        let usrs = snap.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile));
        // Keep deleted users too (but only for display/name-resolution) so that
        // Sevaks assigned on old/past events still show their real name instead
        // of "Unknown". Only exclude deleted users from the active assignment list.
        setAppUsers(usrs);
      });
    }

    return () => {
      unsubEvent();
      unsubAssignments();
      unsubAttendance();
      unsubDevotees();
      unsubUsers();
    };
  }, [id, isOwner, isMentor, profile, navigate]);

  useEffect(() => {
    if (isAssigning && profile?.templeId && assignAttendanceEvents.length === 0) {
      import('firebase/firestore').then(({ getDocs, query, collection, where }) => {
        getDocs(query(collection(db, 'events'), where('templeId', '==', profile.templeId)))
          .then(s => {
            const evts = s.docs.map(d => ({id: d.id, ...d.data()}) as Event);
            evts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
            setAssignAttendanceEvents(evts);
          });
      });
    }
  }, [isAssigning, profile]);

  useEffect(() => {
    if (selectedAssignEventId === 'NONE') {
      setAssignAttendanceMap({});
      return;
    }
    const unsub = onSnapshot(collection(db, `events/${selectedAssignEventId}/attendance`), snap => {
      const map: Record<string, boolean> = {};
      snap.forEach(d => { map[d.id] = true; });
      setAssignAttendanceMap(map);
    });
    return () => unsub();
  }, [selectedAssignEventId]);

  const validAssignments = React.useMemo(() => {
    return assignments; // Removed strict devotee existence check so standard users can always see their assignments
  }, [assignments]);

  const filteredAssignmentsForDashboard = React.useMemo(() => {
    return assignments.filter(ass => {
      const sevak = appUsers.find(u => u.uid === ass.userId)?.displayName || 'Unknown';
      const devotee = devotees.find(d => d.id === ass.devoteeId);
      const facilitator = (devotee?.facilitatorName || devotee?.facilitator || ass.facilitatorName || 'None').trim();
      const dName = (devotee?.name || ass.devoteeName || '').trim();
      
      const dContact = (devotee?.contact || ass.devoteeContact || '').trim();
      
      const tokens = dashboardSearch.toLowerCase().split(/\s+/).filter(t => t.length > 0);
      const allText = `${dName} ${sevak} ${facilitator} ${dContact} ${ass.responseText || ''}`.toLowerCase();
      const matchesSearch = tokens.length === 0 || tokens.every(token => allText.includes(token));
      
      const matchesStatus = statusFilter === 'ALL' || ass.status === statusFilter;
      const matchesFacilitator = facilitatorFilter === 'ALL' || facilitator === facilitatorFilter;
      return matchesSearch && matchesStatus && matchesFacilitator;
    }).sort((a, b) => {
      const devA = devotees.find(d => d.id === a.devoteeId);
      const devB = devotees.find(d => d.id === b.devoteeId);
      
      const getFacilitator = (d: any, ass: any) => {
        return (d?.facilitatorName || d?.facilitator || ass?.facilitatorName || 'None').trim().toLowerCase();
      };

      const getDevoteeName = (d: any, ass: any) => {
        return (d?.name || ass?.devoteeName || '').trim().toLowerCase();
      };

      const facA = getFacilitator(devA, a);
      const facB = getFacilitator(devB, b);
      
      const facilitatorCompare = facA.localeCompare(facB);
      if (facilitatorCompare !== 0) return facilitatorCompare;

      const nameA = getDevoteeName(devA, a);
      const nameB = getDevoteeName(devB, b);
      return nameA.localeCompare(nameB);
    });
  }, [assignments, appUsers, devotees, dashboardSearch, statusFilter, facilitatorFilter]);

  const filteredDevoteesForAssigning = React.useMemo(() => {
    const list = devotees
      .filter(d => {
        const isAlreadyAssigned = assignments.some(ass => ass.devoteeId === d.id);
        if (isAlreadyAssigned) return false;
        const tokens = searchDevotee.toLowerCase().split(/\s+/).filter(t => t.length > 0);
        const allText = Object.values(d).map(v => typeof v === 'string' || typeof v === 'number' ? String(v).toLowerCase() : '').join(' ');
        const matchesSearch = tokens.every(token => allText.includes(token));
        const matchesFacilitator = assignFacilitatorFilter === 'ALL' || 
                                (assignFacilitatorFilter === 'NONE' ? !(d.facilitatorName || d.facilitator) : ((d.facilitatorName || d.facilitator) === assignFacilitatorFilter));
        return matchesSearch && matchesFacilitator;
      });
    return list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [devotees, assignments, searchDevotee, assignFacilitatorFilter]);

  const sortedAssignments = React.useMemo(() => {
    return [...validAssignments].sort((a, b) => {
      const isAPresent = attendance[a.devoteeId] || false;
      const isBPresent = attendance[b.devoteeId] || false;

      const getRank = (ass: CallingAssignment, present: boolean) => {
        // Condition 1: Coming and Present
        if (ass.response === 'COMING' && present) return 1;
        // Condition 2: Not Coming but Present
        if (ass.response === 'NOT_COMING' && present) return 2;
        // Condition 3: Coming but Not Present (includes Maybe/None)
        if (ass.response === 'COMING' && !present) return 3;
        if ((ass.response as any) === 'MAYBE' && !present) return 4;
        if (ass.response === 'NONE' && !present) return 5;
        // Condition 4: Not Coming and Not Present
        if (ass.response === 'NOT_COMING' && !present) return 6;
        return 7;
      };

      // If no attendance has been marked at all (everyone is not present), sort by response only
      const anyPresent = Object.values(attendance).some(p => p);
      if (!anyPresent) {
        const responseRank = (r: string) => {
          if (r === 'COMING') return 1;
          if (r === 'MAYBE') return 2;
          if (r === 'NONE') return 3;
          if (r === 'NOT_COMING') return 4;
          return 5;
        };
        return responseRank(a.response) - responseRank(b.response);
      }

      return getRank(a, isAPresent) - getRank(b, isBPresent);
    });
  }, [assignments, attendance]);

  const handleTogglePublic = async () => {
    if (!event) return;
    const currentStatus = event.isPublic === true;
    await updateDoc(doc(db, 'events', event.id!), { isPublic: !currentStatus });
  };

  const togglePublicAttendance = async () => {
    if (!event) return;
    const isOpen = !!(event as any)?.isAttendanceOpen;
    await updateDoc(doc(db, 'events', event.id!), {
      isAttendanceOpen: !isOpen
    });
  };

  const handleUpdateAssignment = async (assignmentId: string, response: CallingAssignment['response'], responseText?: string) => {
    const updateData: any = {
      response,
      updatedAt: serverTimestamp()
    };
    
    // Only mark status as COMPLETED if the user selected a specific response (COMING or NOT_COMING)
    if (response !== 'NONE') {
      updateData.status = 'COMPLETED';
    }
    
    if (responseText !== undefined) updateData.responseText = responseText;

    await updateDoc(doc(db, `events/${id}/assignments/${assignmentId}`), updateData);
  };

  const handleBulkAssign = async () => {
    if (!selectedUserId || selectedDevotees.length === 0 || !id) return;
    
    const batch = writeBatch(db);
    selectedDevotees.forEach(devId => {
      const devotee = devotees.find(d => d.id === devId);
      if (!devotee) return;
      
      const assignRef = doc(collection(db, `events/${id}/assignments`));
      batch.set(assignRef, {
        eventId: id,
        devoteeId: devId,
        userId: selectedUserId,
        devoteeName: devotee.name,
        devoteeContact: devotee.contact,
        status: 'PENDING',
        response: 'NONE',
        updatedAt: serverTimestamp()
      });

      // Increment assignedCount on devotee
      const devRef = doc(db, 'devotees', devId);
      batch.update(devRef, {
        assignedCount: (devotee.assignedCount || 0) + 1
      });
    });

    await batch.commit();
    setIsAssigning(false);
    setSelectedDevotees([]);
    setSelectedUserId(null);
  };

  const handleAddToFacilitation = async (devoteeId: string) => {
    if (!profile) return;
    try {
      await updateDoc(doc(db, 'devotees', devoteeId), {
        facilitatorId: profile.uid,
        facilitatorName: profile.displayName || 'Anonymous',
        facilitationResponse: 'Interested', // Default when added
        updatedAt: serverTimestamp()
      });
      alert("Added to your facilitation list!");
    } catch (err) {
      console.error(err);
      alert("Failed to add to facilitation.");
    }
  };

  if (!event) return null;

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div className="space-y-2">
            <button onClick={() => navigate('/')} className="text-stone-400 hover:text-saffron flex items-center gap-1 text-sm font-medium">
              <ChevronLeft size={16} /> Back to Hub
            </button>
            <h1 className="text-4xl text-stone-900 font-serif font-bold">{event.title}</h1>
            <p className="text-stone-500 flex items-center gap-2">
              <Calendar size={18} className="text-saffron" />
              {new Date(event.date).toLocaleDateString(undefined, { dateStyle: 'full' })}
            </p>
            {event.mediaUrl && (
              <div className="mt-4 rounded-3xl overflow-hidden shadow-2xl border-4 border-white">
                <img src={event.mediaUrl} alt={event.title} className="w-full max-h-[400px] object-cover" referrerPolicy="no-referrer" />
              </div>
            )}
          </div>

          {(isOwner || isMentor) && (
            <div className="flex gap-2">
              <button 
                onClick={handleTogglePublic}
                className={cn(
                  "flex items-center gap-2 px-6 py-2 rounded-xl font-bold transition-all",
                  event.isPublic ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-stone-200 text-stone-600 hover:bg-stone-300"
                )}
              >
                {event.isPublic ? <><Eye size={18} /> Public</> : <><EyeOff size={18} /> Internal Only</>}
              </button>
              <button 
                onClick={() => setIsAssigning(true)}
                className="btn-primary bg-saffron border-none flex items-center gap-2"
              >
                <UserPlus size={18} /> Assign Calling
              </button>
            </div>
          )}
        </div>

        {/* User Specific: My Calling List */}
        {!isOwner && !isMentor && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-serif font-bold text-stone-700">My Calling List</h2>
                <span className="text-xs font-black text-stone-400 uppercase bg-stone-50 px-3 py-1 rounded-full">
                  {assignments.length} assigned
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-4 max-w-3xl mx-auto w-full">
              <AnimatePresence>
              {sortedAssignments.map((assignment) => {
                const devotee = devotees.find(d => d.id === assignment.devoteeId);
                const dName = devotee?.name || assignment.devoteeName || '';
                const dContact = devotee?.contact || assignment.devoteeContact || '';
                
                return (
                <motion.div 
                  layout 
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 1.8, type: 'spring', bounce: 0.35 }}
                  key={assignment.id} 
                  className="bg-white border border-stone-100 rounded-3xl p-6 shadow-sm flex flex-col justify-between relative group hover:border-saffron/20 transition-all"
                >
                  {attendance[assignment.devoteeId] && (
                    <div className="absolute top-0 right-0 px-3 py-1 bg-green-600 text-white text-[10px] font-black uppercase rounded-bl-xl z-10 transition-colors">
                      Present
                    </div>
                  )}
                  <div>
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex-1">
                        <button 
                          onClick={() => navigate(`/profile/${assignment.devoteeId}`)}
                          className="text-lg font-bold font-serif text-stone-800 hover:text-saffron transition-colors text-left"
                        >
                          {dName}
                        </button>
                        <div className="flex items-center gap-3 mt-1">
                          <ContactLink 
                            contact={dContact}
                            className="text-stone-400 font-bold flex items-center gap-1 text-sm hover:text-saffron hover:underline"
                          >
                            <Phone size={14} /> {dContact}
                          </ContactLink>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <div className={cn(
                          "px-3 py-1 rounded-full text-[10px] font-black uppercase transition-colors",
                          assignment.status === 'COMPLETED' ? "bg-green-100 text-green-700" : "bg-orange-100 text-saffron"
                        )}>
                          {assignment.status}
                        </div>
                        <div className="relative">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuId(openMenuId === assignment.id ? null : assignment.id);
                            }}
                            className="p-1 hover:bg-stone-50 rounded-full text-stone-400 transition-colors"
                          >
                            <MoreVertical size={16} />
                          </button>
                          {openMenuId === assignment.id && (
                            <div className="absolute right-0 top-full mt-1 bg-white border border-stone-100 shadow-xl rounded-xl py-2 w-48 z-50 animate-in fade-in slide-in-from-top-2">
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenMenuId(null);
                                  handleAddToFacilitation(assignment.devoteeId);
                                }}
                                className="w-full text-left px-4 py-2 text-[10px] font-black uppercase text-stone-600 hover:bg-stone-50 hover:text-saffron flex items-center gap-2 transition-colors"
                              >
                                <Heart size={14} /> Add to Facilitation
                              </button>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenMenuId(null);
                                  navigate(`/profile/${assignment.devoteeId}`);
                                }}
                                className="w-full text-left px-4 py-2 text-[10px] font-black uppercase text-stone-600 hover:bg-stone-50 hover:text-saffron flex items-center gap-2 transition-colors"
                              >
                                <User size={14} /> View Profile
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 space-y-3">
                    <div className="grid grid-cols-3 gap-1">
                      <button 
                        onClick={() => handleUpdateAssignment(assignment.id!, 'COMING', (document.getElementById(`resp-${assignment.id}`) as HTMLTextAreaElement)?.value)}
                        className={cn(
                          "flex flex-col items-center justify-center gap-1 py-2 rounded-xl transition-all border font-bold text-[10px]",
                          assignment.response === 'COMING' ? "bg-green-600 text-white border-green-600" : "bg-stone-50 text-stone-600 border-stone-100 hover:border-green-300"
                        )}
                      >
                        <CheckCircle size={14} /> Coming
                      </button>
                      <button 
                        onClick={() => handleUpdateAssignment(assignment.id!, 'MAYBE' as any, (document.getElementById(`resp-${assignment.id}`) as HTMLTextAreaElement)?.value)}
                        className={cn(
                          "flex flex-col items-center justify-center gap-1 py-2 rounded-xl transition-all border font-bold text-[10px]",
                          (assignment.response as any) === 'MAYBE' ? "bg-amber-500 text-white border-amber-500" : "bg-stone-50 text-stone-600 border-stone-100 hover:border-amber-300"
                        )}
                      >
                        <Users size={14} /> Maybe
                      </button>
                      <button 
                        onClick={() => handleUpdateAssignment(assignment.id!, 'NOT_COMING', (document.getElementById(`resp-${assignment.id}`) as HTMLTextAreaElement)?.value)}
                        className={cn(
                          "flex flex-col items-center justify-center gap-1 py-2 rounded-xl transition-all border font-bold text-[10px]",
                          assignment.response === 'NOT_COMING' ? "bg-red-600 text-white border-red-600" : "bg-stone-50 text-stone-600 border-stone-100 hover:border-red-300"
                        )}
                      >
                        <XCircle size={14} /> Not
                      </button>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest pl-1">Response / Notes</label>
                      <div className="relative">
                        <textarea
                          id={`resp-${assignment.id}`}
                          placeholder="Enter devotee response here..."
                          defaultValue={assignment.responseText || ''}
                          className="w-full bg-stone-50 border border-stone-100 rounded-xl p-3 text-sm outline-none focus:border-saffron/50 transition-all resize-none h-20 pb-10"
                        />
                        <button 
                          onClick={() => {
                            const val = (document.getElementById(`resp-${assignment.id}`) as HTMLTextAreaElement).value;
                            handleUpdateAssignment(assignment.id!, assignment.response, val);
                          }}
                          className="absolute bottom-2 right-2 px-3 py-1 bg-saffron text-white text-[10px] font-black uppercase rounded-lg hover:bg-stone-900 transition-all"
                        >
                          Send
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
                );
              })}
              </AnimatePresence>
              {assignments.length === 0 && (
                <div className="col-span-full py-20 bg-white/80 backdrop-blur-md border border-stone-100 rounded-3xl text-center text-stone-400 italic">
                  No devotees assigned for this event. 
                </div>
              )}
            </div>
          </div>
        )}

        {/* Owner View: Dashboard Tabs */}
        {(isOwner || isMentor) && (
          <div className="space-y-6">
            <div className="flex bg-stone-100 p-1 rounded-2xl border border-stone-200 w-fit">
              <button 
                onClick={() => setActiveDashboardTab('calling')}
                className={cn("px-6 py-2 rounded-xl transition-all font-bold text-sm", activeDashboardTab === 'calling' ? "bg-white shadow text-saffron" : "text-stone-500")}
              >
                Calling Dashboard
              </button>
              <button 
                onClick={() => setActiveDashboardTab('attendance')}
                className={cn("px-6 py-2 rounded-xl transition-all font-bold text-sm", activeDashboardTab === 'attendance' ? "bg-white shadow text-saffron" : "text-stone-500")}
              >
                Attendance Tab
              </button>
            </div>

            {activeDashboardTab === 'calling' ? (
              <div className="space-y-4">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                   <h2 className="text-xl font-serif font-bold text-stone-700">Calling List Status</h2>
                   <div className="flex flex-wrap gap-2">
                     <SearchInput 
                       className="w-48"
                       inputClassName="py-2 pl-10 pr-4 text-xs rounded-xl"
                       placeholder="Search dash..."
                       value={dashboardSearch}
                       onChange={setDashboardSearch}
                     />
                     <select 
                      className="bg-white border border-stone-200 rounded-xl px-3 py-2 text-xs font-black uppercase text-stone-600 outline-none focus:border-saffron transition-all"
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                     >
                       <option value="ALL">All Status</option>
                       <option value="PENDING">Pending</option>
                       <option value="COMPLETED">Completed</option>
                     </select>
                    <select 
                      className="bg-white border border-stone-200 rounded-xl px-3 py-2 text-xs font-black uppercase text-stone-600 outline-none focus:border-saffron transition-all"
                      value={facilitatorFilter}
                      onChange={(e) => setFacilitatorFilter(e.target.value)}
                     >
                       <option value="ALL">All Facilitators</option>
                       {Array.from(new Set(
                         [
                           ...assignments.map(a => {
                             const d = devotees.find(dev => dev.id === a.devoteeId);
                             return (d?.facilitatorName || d?.facilitator || a.facilitatorName || '').trim();
                           }),
                           ...appUsers.map(u => (u.displayName || '').trim())
                         ].filter(Boolean)
                       )).sort((a, b) => a.localeCompare(b)).map(f => (
                         <option key={f} value={f}>{f}</option>
                       ))}
                     </select>
                   </div>
                </div>
                <div className="bg-white/80 backdrop-blur-md border border-stone-100 rounded-3xl overflow-hidden shadow-xl shadow-stone-100">
                  <div className="overflow-x-auto">
                    <div className="w-full min-w-[800px] flex flex-col">
                      <div className="flex bg-stone-50/80 border-b border-stone-100 text-[10px] uppercase font-black text-stone-400 tracking-widest font-serif sticky top-0 z-10 w-full">
                        <div className="flex-[2] p-5">Devotee</div>
                        <div className="flex-[1.5] p-5">Facilitator</div>
                        <div className="flex-[1.5] p-5">Sevak (Caller)</div>
                        <div className="flex-[1.5] p-5">Status / Response</div>
                        <div className="flex-[2] p-5">Notes</div>
                        <div className="w-[120px] p-5 text-center">Actions</div>
                      </div>
                      <div className="bg-white/50 w-full">
                        {filteredAssignmentsForDashboard.length === 0 ? (
                          <div className="p-20 text-center text-stone-400 italic w-full border-t border-stone-50">No calling assignments made yet.</div>
                        ) : (
                          <div className="h-[600px] overflow-y-auto overflow-x-hidden w-full">
                            {filteredAssignmentsForDashboard.map((ass, index) => {
                              const devotee = devotees.find(d => d.id === ass.devoteeId);
                              const dName = devotee?.name || ass.devoteeName || '';
                              const dContact = devotee?.contact || ass.devoteeContact || '';
                              return (
                                <div key={ass.id || index} className="flex border-t border-stone-50 hover:bg-stone-50/50 transition-colors w-full min-h-[80px]">
                                  <div className="flex-[2] p-5 flex flex-col justify-center">
                                    <button 
                                      onClick={() => navigate(`/profile/${ass.devoteeId}`)}
                                      className="font-bold font-serif text-stone-700 hover:text-saffron transition-colors text-left truncate"
                                    >
                                      {dName}
                                    </button>
                                    <p className="text-xs text-stone-400 font-mono truncate">{dContact}</p>
                                  </div>
                                  <div className="flex-[1.5] p-5 flex items-center">
                                    <span className="text-xs font-black uppercase text-stone-300 truncate">
                                      {devotee?.facilitatorName || devotee?.facilitator || 'None'}
                                    </span>
                                  </div>
                                  <div className="flex-[1.5] p-5 flex items-center">
                                    <span className="text-sm font-bold text-stone-600 truncate">
                                      {appUsers.find(u => u.uid === ass.userId)?.displayName || 'Unknown'}
                                    </span>
                                  </div>
                                  <div className="flex-[1.5] p-5 flex items-center">
                                    <div className="flex flex-col gap-1">
                                      <span className={cn(
                                        "inline-flex w-fit px-2 py-0.5 rounded-lg text-[10px] font-black uppercase",
                                        ass.status === 'COMPLETED' ? "bg-green-100 text-green-700" : "bg-orange-50 text-saffron"
                                      )}>
                                        {ass.status}
                                      </span>
                                      {ass.response !== 'NONE' && (
                                        <span className={cn(
                                          "inline-flex w-fit px-2 py-0.5 rounded-lg text-[10px] font-black uppercase",
                                          ass.response === 'COMING' ? "bg-green-600 text-white" :
                                          ass.response === 'MAYBE' ? "bg-gold text-white" : "bg-red-600 text-white"
                                        )}>
                                          {ass.response}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex-[2] p-5 max-w-[200px] flex items-center">
                                    <p className="text-sm text-stone-500 italic line-clamp-2" title={ass.responseText}>
                                      {ass.responseText || <span className="text-stone-300">No notes</span>}
                                    </p>
                                  </div>
                                  <div className="w-[120px] p-5 text-center flex items-center justify-center">
                                    <div className="flex items-center justify-center gap-2">
                                      <div className="relative group/menu">
                                        <button className="p-2 hover:bg-stone-50 rounded-xl text-stone-400 transition-all">
                                          <MoreVertical size={18} />
                                        </button>
                                        <div className="absolute right-0 top-full mt-1 bg-white border border-stone-100 shadow-xl rounded-xl py-2 w-48 z-50 hidden group-hover/menu:block">
                                          <button 
                                            onClick={() => handleAddToFacilitation(ass.devoteeId)}
                                            className="w-full text-left px-4 py-2 text-[10px] font-black uppercase text-stone-600 hover:bg-stone-50 hover:text-saffron flex items-center gap-2 transition-colors"
                                          >
                                            <Heart size={14} /> Add to Facilitation
                                          </button>
                                          <button 
                                            onClick={() => navigate(`/profile/${ass.devoteeId}`)}
                                            className="w-full text-left px-4 py-2 text-[10px] font-black uppercase text-stone-600 hover:bg-stone-50 hover:text-saffron flex items-center gap-2 transition-colors"
                                          >
                                            <User size={14} /> View Profile
                                          </button>
                                        </div>
                                      </div>
                                      {isOwner && (
                                        <button onClick={() => deleteDoc(doc(db, `events/${id}/assignments/${ass.id!}`))} className="p-2 text-stone-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all">
                                          <MinusCircle size={18} />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="bg-white/80 backdrop-blur-md border border-stone-100 rounded-3xl p-8 flex flex-col items-center text-center space-y-4">
                  <Heart size={48} className="text-saffron animate-pulse" />
                  <h3 className="text-2xl font-serif font-bold text-stone-800">Attendance Distribution</h3>
                  <p className="text-stone-500 text-sm max-w-md italic">
                    "Share this unique link with devotees at the event or via WhatsApp to capture real-time attendance."
                  </p>
                  
                  <div className="flex items-center gap-4 py-2">
                    <span className="text-sm font-black uppercase text-stone-600">Attendance Marking:</span>
                    <button 
                      onClick={togglePublicAttendance}
                      className={cn(
                        "px-4 py-2 rounded-full text-xs font-black uppercase transition-all shadow-sm",
                        (event as any)?.isAttendanceOpen 
                          ? "bg-green-500 text-white shadow-green-100" 
                          : "bg-red-500 text-white shadow-red-100"
                      )}
                    >
                      {(event as any)?.isAttendanceOpen ? 'OPEN' : 'CLOSED'}
                    </button>
                  </div>

                  <div className="w-full max-w-md p-4 bg-stone-50 border border-stone-200 rounded-2xl flex items-center gap-3">
                    <input 
                      readOnly
                      className="flex-1 bg-transparent text-xs font-mono text-stone-500 outline-none"
                      value={getPublicAttendanceUrl(id!)}
                    />
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(getPublicAttendanceUrl(id!));
                        alert("Link copied!");
                      }}
                      className="text-saffron font-black text-xs uppercase"
                    >
                      Copy
                    </button>
                  </div>
                  <button 
                    onClick={() => window.open(getPublicAttendanceUrl(id!), '_blank')}
                    className="text-stone-400 hover:text-saffron text-xs font-black uppercase underline transition-colors"
                  >
                    Open Sheet &rarr;
                  </button>
                </div>

                <div className="bg-white/80 backdrop-blur-md border border-stone-100 rounded-3xl overflow-hidden shadow-xl">
                  <div className="p-6 border-b border-stone-100 flex justify-between items-center bg-stone-50/50">
                    <h3 className="text-lg font-serif font-bold text-stone-800">Present Devotees</h3>
                    <span className="text-xs bg-saffron text-white px-3 py-1 rounded-full font-black uppercase tracking-wider">
                      {Object.keys(attendance).length} Present
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-stone-50 text-[10px] font-black text-stone-400 uppercase tracking-widest font-serif">
                        <tr>
                          <th className="p-5">Name</th>
                          <th className="p-5">Contact</th>
                          <th className="p-5">Facilitator</th>
                          <th className="p-5">Age</th>
                          <th className="p-5">Time</th>
                          <th className="p-5 text-center">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-50">
                         {Object.entries(attendanceStore).map(([devId, data]: [string, any]) => (
                           <tr key={devId} className="hover:bg-stone-50 transition-colors">
                             <td className="p-5">
                               <button 
                                onClick={() => navigate(`/profile/${devId}`)}
                                className="font-bold font-serif text-stone-700 hover:text-saffron transition-colors"
                               >
                                 {data.name}
                               </button>
                             </td>
                             <td className="p-5 text-sm font-medium text-stone-500">{data.contact}</td>
                             <td className="p-5 text-xs font-black text-stone-300 uppercase">{data.facilitatorName}</td>
                             <td className="p-5 text-sm font-medium text-stone-500">{data.age}</td>
                             <td className="p-5 text-[10px] text-stone-400 font-mono">{data.markedAt ? new Date(data.markedAt).toLocaleTimeString() : 'N/A'}</td>
                             <td className="p-5 text-center">
                               <div className="relative group/menu inline-block">
                                 <button className="p-2 hover:bg-stone-50 rounded-xl text-stone-400 transition-all">
                                   <MoreVertical size={18} />
                                 </button>
                                 <div className="absolute right-0 top-full mt-1 bg-white border border-stone-100 shadow-xl rounded-xl py-2 w-48 z-50 hidden group-hover/menu:block">
                                   <button 
                                     onClick={() => handleAddToFacilitation(devId)}
                                     className="w-full text-left px-4 py-2 text-[10px] font-black uppercase text-stone-600 hover:bg-stone-50 hover:text-saffron flex items-center gap-2 transition-colors"
                                   >
                                     <Heart size={14} /> Add to Facilitation
                                   </button>
                                   <button 
                                     onClick={() => navigate(`/profile/${devId}`)}
                                     className="w-full text-left px-4 py-2 text-[10px] font-black uppercase text-stone-600 hover:bg-stone-50 hover:text-saffron flex items-center gap-2 transition-colors"
                                   >
                                      <User size={14} /> View Profile
                                   </button>
                                 </div>
                               </div>
                             </td>
                           </tr>
                         ))}
                         {Object.keys(attendanceStore).length === 0 && (
                           <tr>
                             <td colSpan={6} className="p-20 text-center text-stone-400 italic">No one has marked attendance yet.</td>
                           </tr>
                         )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Assign Calling Modal */}
      {isAssigning && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-stone-900/40 p-4 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-3xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl border border-stone-100"
          >
            <div className="p-6 border-b border-stone-100 flex justify-between items-center bg-stone-50/30">
              <h2 className="text-2xl font-serif font-bold text-stone-800">Assign Calling List</h2>
              <button 
                onClick={() => {
                  setIsAssigning(false);
                  setSelectedDevotees([]);
                  setSelectedUserId(null);
                }}
                className="text-stone-400 hover:text-saffron p-2 transition-colors"
              >
                <ChevronLeft className="rotate-90" />
              </button>
            </div>

            <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
              {/* Left: User Selection */}
              <div className="w-full md:w-1/3 border-r border-stone-100 p-6 space-y-4 overflow-y-auto">
                <h3 className="text-xs font-black text-stone-400 uppercase tracking-widest">1. Select Sevak</h3>
                <div className="space-y-2">
                  {appUsers.filter(u => !u.isDeleted).map(user => (
                    <button
                      key={user.uid}
                      onClick={() => setSelectedUserId(user.uid)}
                      className={cn(
                        "w-full flex items-center gap-3 p-3 rounded-2xl transition-all text-left group",
                        selectedUserId === user.uid ? "bg-saffron text-white shadow-lg shadow-saffron/20" : "bg-stone-50 text-stone-600 hover:bg-stone-100"
                      )}
                    >
                      <div className={cn("w-8 h-8 rounded-full flex items-center justify-center text-sm font-black uppercase transition-colors", selectedUserId === user.uid ? "bg-white/20" : "bg-stone-200 text-stone-400 group-hover:bg-stone-300")}>
                        {user.displayName?.[0]}
                      </div>
                      <div className="truncate flex-1">
                        <p className="font-bold text-sm leading-tight">{user.displayName}</p>
                        <p className="text-[10px] font-black uppercase opacity-70">{user.role}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Right: Devotee Selection */}
              <div className="flex-1 p-6 space-y-4 flex flex-col overflow-hidden">
                <div className="flex justify-between items-center">
                  <h3 className="text-xs font-black text-stone-400 uppercase tracking-widest">2. Select Devotees ({selectedDevotees.length})</h3>
                  <div className="flex gap-2">
                    <select 
                      value={assignFacilitatorFilter}
                      onChange={e => setAssignFacilitatorFilter(e.target.value)}
                      className="bg-white border border-stone-200 rounded-xl px-3 py-1 text-[10px] font-black uppercase text-stone-600 outline-none focus:border-saffron transition-all"
                    >
                      <option value="NONE">General (Unassigned)</option>
                      <option value="ALL">Show All Devotees</option>
                      <optgroup label="Registered Facilitators">
                        {appUsers.filter(u => u.role !== 'OWNER').map(u => (
                          <option key={u.uid} value={u.displayName || u.email || ''}>{u.displayName || u.email}</option>
                        ))}
                      </optgroup>
                    </select>
                    <SearchInput 
                      className="w-48"
                      inputClassName="py-1 pl-8 pr-3 text-[10px] font-bold rounded-full"
                      placeholder="Search name..."
                      value={searchDevotee}
                      onChange={setSearchDevotee}
                    />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto border border-stone-100 rounded-2xl flex flex-col">
                  <div className="flex bg-stone-50 sticky top-0 font-serif border-b border-stone-100 text-sm z-10 w-full min-w-[700px]">
                    <div className="p-3 w-10 flex items-center justify-center">
                      <input 
                        type="checkbox" 
                        className="accent-saffron"
                        checked={selectedDevotees.length > 0 && filteredDevoteesForAssigning.length > 0 && filteredDevoteesForAssigning.every(d => selectedDevotees.includes(d.id!))}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedDevotees(Array.from(new Set([...selectedDevotees, ...filteredDevoteesForAssigning.map(d => d.id!)])));
                          else setSelectedDevotees(selectedDevotees.filter(id => !filteredDevoteesForAssigning.map(d => d.id!).includes(id)));
                        }}
                      />
                    </div>
                    <div className="flex-[2] p-3 flex items-center font-bold text-stone-600 font-sans text-xs uppercase tracking-widest">Name</div>
                    <div className="flex-[1.5] p-3 flex items-center font-bold text-stone-600 font-sans text-xs uppercase tracking-widest">Facilitator</div>
                    <div className="flex-[1] p-3 flex items-center font-black text-[10px] uppercase text-stone-400">Response</div>
                    <div className="flex-[1.5] p-3 flex items-center">
                      <select 
                        value={selectedAssignEventId}
                        onChange={(e) => setSelectedAssignEventId(e.target.value)}
                        className="bg-stone-100 border border-stone-200 rounded-xl px-2 py-1 text-[10px] font-black uppercase text-stone-600 outline-none focus:border-saffron focus:bg-white transition-all w-full"
                      >
                        <option value="NONE">Attendance</option>
                        {assignAttendanceEvents.map(e => (
                          <option key={e.id} value={e.id}>{e.title}</option>
                        ))}
                      </select>
                    </div>
                    <div className="w-16 p-3 flex items-center justify-center font-bold text-stone-600 font-sans text-xs uppercase tracking-widest">Info</div>
                  </div>
                  <div className="flex-1 w-full min-w-[700px]">
                    {filteredDevoteesForAssigning.length === 0 ? (
                      <div className="p-20 text-center text-stone-400 italic">No available devotees found matching filters.</div>
                    ) : (
                      <div className="h-[400px] overflow-y-auto w-full">
                        {filteredDevoteesForAssigning.map((d, index) => {
                          return (
                            <div key={d.id || index} className={cn("flex border-b border-stone-50 hover:bg-stone-50 transition-colors w-full min-h-[60px]", selectedDevotees.includes(d.id!) && "bg-saffron/10")}>
                              <div className="w-10 p-3 flex items-center justify-center">
                                <input 
                                  type="checkbox" 
                                  className="accent-saffron"
                                  checked={selectedDevotees.includes(d.id!)}
                                  onChange={() => {
                                    setSelectedDevotees(prev => 
                                      prev.includes(d.id!) ? prev.filter(i => i !== d.id) : [...prev, d.id!]
                                    );
                                  }}
                                />
                              </div>
                              <div className="flex-[2] p-3 flex flex-col justify-center font-bold font-serif text-sm">
                                <span className="truncate">{d.name}</span>
                              </div>
                              <div className="flex-[1.5] p-3 flex items-center text-stone-500 font-black text-[10px] uppercase truncate">
                                {d.facilitatorName || d.facilitator || <span className="text-stone-300">Unassigned</span>}
                              </div>
                              <div className="flex-[1] p-3 flex items-center">
                                <span className={cn(
                                  "px-2 py-0.5 rounded-lg text-[10px] font-black uppercase truncate max-w-full inline-block",
                                  d.facilitationResponse === 'Interested' ? "bg-green-100 text-green-700" :
                                  d.facilitationResponse === 'Not Interested' ? "bg-red-100 text-red-700" : "bg-stone-100 text-stone-400"
                                )}>
                                  {d.facilitationResponse || 'None'}
                                </span>
                              </div>
                              <div className="flex-[1.5] p-3 flex items-center justify-center">
                                {selectedAssignEventId !== 'NONE' ? (
                                  <span className={cn(
                                    "w-6 h-6 flex items-center justify-center rounded-lg text-[10px] font-black uppercase",
                                    assignAttendanceMap[d.id!] ? "bg-green-100 text-green-700" : (Object.keys(assignAttendanceMap).length > 0 ? "bg-red-50 text-red-400" : "bg-stone-50 text-stone-400")
                                  )}>
                                    {assignAttendanceMap[d.id!] ? 'P' : (Object.keys(assignAttendanceMap).length > 0 ? 'A' : '-')}
                                  </span>
                                ) : (
                                  <span className="text-stone-300 text-sm font-bold">-</span>
                                )}
                              </div>
                              <div className="w-16 p-3 flex items-center justify-center text-stone-400 text-xs">
                                <button onClick={() => navigate(`/profile/${d.id}`)} className="p-2 hover:bg-stone-100 hover:text-stone-600 rounded-xl transition-colors">
                                  <Eye size={14} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="p-6 bg-stone-50 border-t border-stone-100 flex justify-end gap-3">
               <button 
                onClick={() => setIsAssigning(false)}
                className="px-6 py-2 rounded-xl text-xs font-black uppercase text-stone-500 hover:bg-stone-100 transition-colors"
               >
                Cancel
               </button>
               <button 
                disabled={!selectedUserId || selectedDevotees.length === 0}
                onClick={handleBulkAssign}
                className="bg-saffron text-white px-8 py-2 rounded-xl text-xs font-black uppercase tracking-widest shadow-lg shadow-saffron/20 disabled:opacity-50 disabled:shadow-none hover:scale-105 transition-all"
               >
                Confirm Assignment ({selectedDevotees.length})
               </button>
            </div>
          </motion.div>
        </div>
      )}
    </Layout>
  );
};

export default EventDetail;
