import React, { useState, useEffect } from 'react';
import { db } from '../../services/firebase';
import { collection, query, where, onSnapshot, getDocs, addDoc, serverTimestamp, collectionGroup, orderBy, updateDoc, doc } from 'firebase/firestore';
import { useAuth } from '../../context/AuthContext';
import { Devotee, UserProfile, CallingAssignment, Event } from '../../types';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { SearchInput } from '../../components/SearchInput';
import { Users, Phone, FileText, Plus, UserPlus, X, Loader2, Filter, ChevronRight, Calendar, ArrowUpDown, AlertTriangle, MoreVertical, Heart, User, Layers } from 'lucide-react';
import { cn, normalizePhoneNumber, sanitizeMobileInput, isValidMobileNumber } from '../../lib/utils';
import ContactLink from '../../components/ContactLink';
import { subscribeToVisibleEvents } from '../../services/eventVisibility';

const MentorDashboard = () => {
  const { profile } = useAuth();
  const [activeTab, setActiveTab] = useState<'facilitation' | 'users' | 'reports' | 'accessibility'>('facilitation');
  const [devotees, setDevotees] = useState<Devotee[]>([]);
  const [appUsers, setAppUsers] = useState<(UserProfile & { completionRate?: number, attendeesCount?: number })[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddingDevotee, setIsAddingDevotee] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(25);
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
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  useEffect(() => {
    if (duplicateWarning) {
      const timer = setTimeout(() => setDuplicateWarning(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [duplicateWarning]);

  const [selectedFacilitatorId, setSelectedFacilitatorId] = useState<string>('all');
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [accessibilityUser, setAccessibilityUser] = useState<UserProfile | null>(null);
  const [userAssignments, setUserAssignments] = useState<CallingAssignment[]>([]);
  const [events, setEvents] = useState<Record<string, Event>>({});
  const [loadingAssignments, setLoadingAssignments] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!profile?.templeId) return;

    let activeEventsMap: Record<string, Event> = {};

    const unsubscribeD = onSnapshot(collection(db, 'devotees'), (snapshot) => {
      setDevotees(snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as Devotee))
        .filter(d => d.templeId === profile.templeId && !d.isDeleted)
      );
    });

    const unsubscribeE = subscribeToVisibleEvents(profile.templeId, (visibleEvents) => {
      const eMap: Record<string, Event> = {};
      visibleEvents.forEach(e => {
        eMap[e.id!] = e;
      });
      activeEventsMap = eMap;
      setEvents(eMap);
    });

    const unsubscribeU = onSnapshot(collection(db, 'users'), async (snapshot) => {
      const usersData = snapshot.docs
        .map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile))
         .filter(u => u.templeId === profile.templeId && !u.isDeleted && u.role !== 'OWNER');
      
      const updatedUsers = await Promise.all(usersData.map(async (u) => {
        const qA = query(collectionGroup(db, 'assignments'), where('userId', '==', u.uid));
        const assSnap = await getDocs(qA);
        
        const validAssignments = assSnap.docs
          .map(d => ({...d.data(), eventRef: d.ref.parent.parent?.id} as any))
          .filter(d => d.eventRef && activeEventsMap[d.eventRef as string]);
          
        const total = validAssignments.length;
        const completed = validAssignments.filter(d => d.status === 'COMPLETED').length;
        const rate = total > 0 ? Math.round((completed / total) * 100) : 0;
        
        let attendeesCount = 0;
        for (const ass of validAssignments) {
          if (!ass.eventRef || !ass.devoteeId) continue;
          try {
            const attDoc = await (await import('firebase/firestore')).getDoc(doc(db, `events/${ass.eventRef}/attendance`, ass.devoteeId as string));
            if (attDoc.exists()) {
              attendeesCount++;
            }
          } catch (e) {}
        }

        return { ...u, completionRate: rate, attendeesCount };
      }));
      setAppUsers(updatedUsers);
    });

    return () => {
      unsubscribeD();
      unsubscribeE();
      unsubscribeU();
    };
  }, [profile?.templeId]);

  // Live stream selected user assignments so they update instantly if anything changes
  useEffect(() => {
    if (!selectedUser?.uid || !profile?.templeId) {
      setUserAssignments([]);
      return;
    }
    setLoadingAssignments(true);
    const qA = query(collectionGroup(db, 'assignments'), where('userId', '==', selectedUser.uid));
    const unsubscribeA = onSnapshot(qA, (snap) => {
      const assignments = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as CallingAssignment));
      const validAssignments = assignments.filter(a => events[a.eventId]);
      setUserAssignments(validAssignments);
      setLoadingAssignments(false);
    }, (error) => {
      console.error(error);
      setLoadingAssignments(false);
    });

    return () => unsubscribeA();
  }, [selectedUser?.uid, events, profile?.templeId]);

  const viewUserAssignments = (user: UserProfile) => {
    setSelectedUser(user);
  };

  const handleToggleAccess = async (userId: string, feature: 'history' | 'facilitation' | 'addDevotee', currentValue: boolean) => {
    try {
      await updateDoc(doc(db, 'users', userId), {
        [`accessStatus.${feature}`]: !currentValue
      });
    } catch (error) {
      console.error(error);
    }
  };

  const handleAddToFacilitation = async (devoteeId: string) => {
    if (!profile) return;
    try {
      await updateDoc(doc(db, 'devotees', devoteeId), {
        facilitatorId: profile.uid,
        facilitatorName: profile.displayName || 'Anonymous',
        facilitationResponse: 'Interested',
        updatedAt: serverTimestamp()
      });
      alert("Added to your facilitation list!");
    } catch (err) {
      console.error(err);
      alert("Failed to add to facilitation.");
    }
  };

  const handleAddDevotee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDevotee.name || !newDevotee.contact || !profile?.templeId) return;

    if (!isValidMobileNumber(newDevotee.contact)) {
      alert("Please enter a valid 10-digit mobile number.");
      return;
    }

    setIsSubmitting(true);
    setDuplicateWarning(null);

    try {
      const devoteeName = newDevotee.name!.trim();
      const normalizedContact = normalizePhoneNumber(newDevotee.contact || '');
      
      // Duplicate Detection
      const nLow = devoteeName.toLowerCase();
      const cNorm = normalizedContact;

      let warning = null;
      let duplicateType: 'complete' | 'partial_name' | 'partial_contact' | null = null;

      for (const other of devotees) {
        const onLow = (other.name || (other as any).Name || '').trim().toLowerCase();
        const ocNorm = normalizePhoneNumber(other.contact || (other as any)['Contact No.'] || '');
        
        if (nLow === onLow && cNorm === ocNorm) {
          warning = "Devotee already exists.";
          duplicateType = 'complete';
          break;
        }
        if (cNorm === ocNorm && nLow !== onLow && cNorm !== '') {
          warning = "Duplicate contact found.";
          duplicateType = 'partial_contact';
          break;
        }
        if (nLow === onLow && cNorm !== ocNorm && nLow !== '') {
          warning = "Duplicate name found.";
          duplicateType = 'partial_name';
          break;
        }
      }

      if (warning) {
        setDuplicateWarning(warning);
      }

      await addDoc(collection(db, 'devotees'), {
        ...newDevotee,
        name: devoteeName,
        contact: normalizedContact,
        templeId: profile!.templeId,
        createdAt: serverTimestamp(),
        attendanceCount: 0,
        facilitatorId: profile!.uid,
        facilitatorName: profile!.displayName || 'Mentor',
        isDuplicate: !!duplicateType,
        duplicateType: duplicateType || null,
        duplicateCreatedAt: duplicateType === 'complete' ? new Date().toISOString() : null,
        duplicateHandled: false
      });
      setIsAddingDevotee(false);
      setNewDevotee({ name: '', contact: '', mentor: '', chanting: '0', age: '', address: '', gender: 'MALE', institute: '', dob: '' });
    } catch (error) {
      console.error(error);
      alert("Error adding devotee");
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredDevotees = devotees.filter(d => {
    if (d.isPrivate) return false;
    const tokens = searchTerm.toLowerCase().split(/\s+/).filter(t => t.length > 0);
    const allText = Object.values(d).map(v => typeof v === 'string' || typeof v === 'number' ? String(v).toLowerCase() : '').join(' ');
    const matchesSearch = tokens.every(token => allText.includes(token));
    
    if (selectedFacilitatorId === 'all') return matchesSearch;
    return matchesSearch && d.facilitatorId === selectedFacilitatorId;
  });

  const sortedDevotees = [...filteredDevotees].sort((a, b) => a.name.localeCompare(b.name));

  const totalPages = Math.ceil(sortedDevotees.length / itemsPerPage);
  const paginatedDevotees = sortedDevotees.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedFacilitatorId]);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold font-serif text-stone-800 tracking-tight">Mentor Insights</h2>
        <p className="text-stone-500 mt-1">Oversee facilitation and calling activities.</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-3 overflow-x-auto pb-2">
          {[
            { id: 'facilitation', label: 'Facilitation DB', icon: Users },
            { id: 'users', label: 'User Directory', icon: Phone },
            { id: 'reports', label: 'Calling Reports', icon: FileText },
            { id: 'accessibility', label: 'User Accessibility', icon: Layers },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={cn(
                "flex items-center gap-2 px-6 py-3 rounded-2xl font-bold transition-all border",
                activeTab === tab.id 
                  ? "bg-stone-900 text-white border-stone-900 shadow-lg shadow-stone-200" 
                  : "bg-white text-stone-600 hover:bg-stone-50 border-stone-200"
              )}
            >
              <tab.icon size={18} />
              {tab.label}
            </button>
          ))}
        </div>

        <button 
          onClick={() => setIsAddingDevotee(true)}
          className="flex items-center gap-2 px-6 py-3 bg-saffron text-white rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-stone-900 transition-all shadow-lg shadow-orange-100"
        >
          <Plus size={18} /> Add Devotee
        </button>
      </div>

      <div className="bg-white rounded-3xl p-8 border border-stone-200 shadow-sm min-h-[400px]">
        {activeTab === 'facilitation' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <SearchInput 
                className="max-w-md w-full"
                placeholder="Search devotees..."
                value={searchTerm}
                onChange={setSearchTerm}
              />

              <div className="flex items-center gap-2 bg-stone-50 p-2 rounded-[1.2rem] border border-stone-200 w-full md:w-auto">
                <Filter size={14} className="text-stone-400 ml-2" />
                <select 
                  value={selectedFacilitatorId}
                  onChange={(e) => setSelectedFacilitatorId(e.target.value)}
                  className="bg-transparent text-[10px] font-black uppercase tracking-widest text-stone-600 outline-none cursor-pointer pr-4"
                >
                  <option value="all">All Facilitators</option>
                  {appUsers.sort((a,b) => (a.displayName || '').localeCompare(b.displayName || '')).map(user => (
                    <option key={user.uid} value={user.uid}>{user.displayName}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-stone-400 text-[10px] uppercase font-black tracking-widest border-b border-stone-100 font-serif">
                    <th className="py-4 px-4">Devotee Name</th>
                    <th className="py-4 px-4">Contact</th>
                    <th className="py-4 px-4">Facilitator</th>
                    <th className="py-4 px-4 text-right">Status</th>
                    <th className="py-4 px-4 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-50">
                  {paginatedDevotees.map((d) => (
                    <tr key={d.id} className="hover:bg-stone-50/50 transition-colors group">
                      <td className="py-4 px-4">
                        <p className="font-bold font-serif text-stone-800 flex items-center gap-2">
                          {d.duplicateType === 'complete' && !d.duplicateHandled && (
                            <span
                              title="Another sevak also added this devotee. Awaiting owner assignment."
                              className="w-2 h-2 bg-red-500 rounded-full shrink-0 animate-pulse"
                            />
                          )}
                          {d.name}
                        </p>
                        <p className="text-[10px] font-black text-stone-300 uppercase">Mentor: {d.mentor || 'None'}</p>
                      </td>
                      <td className="py-4 px-4 text-stone-600 text-sm font-medium">
                        <ContactLink contact={d.contact || ''} className="hover:text-saffron hover:underline">{d.contact}</ContactLink>
                      </td>
                      <td className="py-4 px-4">
                        <span className="bg-orange-50 text-saffron text-[10px] font-black uppercase px-3 py-1 rounded-lg border border-orange-100">
                          {d.facilitatorName || 'Unknown'}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-right">
                        <span className="text-xs font-bold text-stone-400 bg-stone-100 px-3 py-1 rounded-lg">{d.chanting || 0} Rounds</span>
                      </td>
                      <td className="py-4 px-4 text-center">
                        <div className="relative group/menu inline-block">
                          <button className="p-2 hover:bg-stone-50 rounded-xl text-stone-400 transition-all">
                            <MoreVertical size={18} />
                          </button>
                          <div className="absolute right-0 top-full mt-1 bg-white border border-stone-100 shadow-xl rounded-xl py-2 w-48 z-50 hidden group-hover/menu:block text-left">
                            <button 
                              onClick={() => handleAddToFacilitation(d.id!)}
                              className="w-full text-left px-4 py-2 text-[10px] font-black uppercase text-stone-600 hover:bg-stone-50 hover:text-saffron flex items-center gap-2 transition-colors"
                            >
                              <Heart size={14} /> Add to Facilitation
                            </button>
                            <button 
                              onClick={() => navigate(`/profile/${d.id}`)}
                              className="w-full text-left px-4 py-2 text-[10px] font-black uppercase text-stone-600 hover:bg-stone-50 hover:text-saffron flex items-center gap-2 transition-colors"
                            >
                              <User size={14} /> View Profile
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {sortedDevotees.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-20 text-center text-stone-400 italic">No devotees found matching criteria.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="pt-6 border-t border-stone-100 flex items-center justify-between">
                <p className="text-[10px] font-black text-stone-400 uppercase tracking-widest">
                  Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, sortedDevotees.length)} of {sortedDevotees.length}
                </p>
                <div className="flex items-center gap-2">
                  <button 
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(prev => prev - 1)}
                    className="p-2 rounded-xl border border-stone-200 disabled:opacity-30 hover:bg-stone-50 transition-all"
                  >
                    <ChevronRight size={18} className="rotate-180" />
                  </button>
                  <span className="text-xs font-bold text-stone-600 px-4">Page {currentPage} of {totalPages}</span>
                  <button 
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage(prev => prev + 1)}
                    className="p-2 rounded-xl border border-stone-200 disabled:opacity-30 hover:bg-stone-50 transition-all"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'users' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {appUsers.map((user) => (
              <div 
                key={user.uid} 
                className="bg-white border border-stone-200 p-6 rounded-3xl flex items-center gap-4 hover:border-saffron/30 transition-all hover:shadow-md group cursor-pointer"
                onClick={() => viewUserAssignments(user)}
              >
                <div className="w-14 h-14 bg-stone-100 text-stone-400 group-hover:bg-orange-50 group-hover:text-saffron rounded-2xl flex items-center justify-center font-bold text-xl uppercase shadow-sm transition-colors">
                  {user.displayName?.[0] || '?'}
                </div>
                <div className="flex-1">
                  <div className="flex justify-between items-start">
                    <h4 className="font-bold font-serif text-stone-800 text-lg leading-tight">{user.displayName}</h4>
                    <ChevronRight size={16} className="text-stone-300 group-hover:text-saffron" />
                  </div>
                  <p className="text-xs text-stone-500">{user.email}</p>
                  <div className="text-xs font-black text-saffron uppercase mt-2 flex items-center gap-1.5 bg-orange-50 px-3 py-1 rounded-lg w-fit">
                    <Phone size={10} /> {user.contact ? <ContactLink contact={user.contact} className="hover:underline">{user.contact}</ContactLink> : 'No contact'}
                  </div>
                  
                  <div className="mt-4 pt-4 border-t border-stone-50">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[10px] font-black text-stone-400 uppercase tracking-widest">Calling Status</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black text-stone-400 capitalize">{user.attendeesCount || 0} Attended</span>
                        <span className="text-[10px] font-black text-emerald-500">{user.completionRate || 0}%</span>
                      </div>
                    </div>
                    <div className="w-full h-1.5 bg-stone-100 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-emerald-500 transition-all duration-1000"
                        style={{ width: `${user.completionRate || 0}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'reports' && (
          <div className="flex flex-col items-center justify-center py-24 text-stone-400">
            <div className="w-20 h-20 bg-stone-50 rounded-full flex items-center justify-center mb-6">
              <FileText size={40} className="opacity-20" />
            </div>
            <p className="text-xl font-bold font-serif text-stone-800">No reports generated yet</p>
            <p className="text-sm text-stone-500 mt-2 max-w-xs text-center leading-relaxed">Activities and calling metrics will appear here after event processing.</p>
          </div>
        )}

        {activeTab === 'accessibility' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {appUsers.map((user) => (
              <div 
                key={user.uid} 
                className="bg-white border border-stone-200 p-6 rounded-3xl group shadow-sm flex items-center justify-between hover:border-saffron/30 hover:shadow-md transition-all cursor-pointer animate-fade-in"
                onClick={() => setAccessibilityUser(user)}
              >
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 bg-stone-100 text-stone-400 group-hover:bg-orange-50 group-hover:text-saffron rounded-2xl flex items-center justify-center font-bold text-xl uppercase transition-colors">
                    {user.displayName?.[0] || '?'}
                  </div>
                  <div>
                    <h4 className="font-bold font-serif text-stone-800 text-lg leading-tight group-hover:text-saffron transition-colors">{user.displayName}</h4>
                    <p className="text-xs text-stone-500 mt-1">{user.email}</p>
                    <span className="inline-block text-[10px] font-black uppercase text-stone-400 bg-stone-50 px-2.5 py-1 rounded-lg border border-stone-100 mt-2.5">
                      Configure Permissions
                    </span>
                  </div>
                </div>
                <ChevronRight size={18} className="text-stone-300 group-hover:text-saffron transition-all" />
              </div>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {accessibilityUser && (() => {
          const liveUser = appUsers.find(u => u.uid === accessibilityUser.uid) || accessibilityUser;
          return (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-stone-900/60 p-4 backdrop-blur-md">
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="bg-white rounded-[2.5rem] w-full max-w-lg overflow-hidden flex flex-col shadow-2xl border border-stone-100"
              >
                <div className="p-8 border-b border-stone-100 flex justify-between items-center bg-stone-50/50">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-orange-50 text-saffron rounded-xl flex items-center justify-center font-bold text-lg">
                      {liveUser.displayName?.[0]}
                    </div>
                    <div>
                      <h2 className="text-2xl font-serif font-black text-stone-800 tracking-tight">{liveUser.displayName}</h2>
                      <p className="text-[10px] font-black text-stone-400 uppercase tracking-[0.2em] mt-1">Portal Accessibility</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setAccessibilityUser(null)}
                    className="p-3 hover:bg-stone-100 rounded-2xl transition-all text-stone-400"
                  >
                    <X size={24} />
                  </button>
                </div>

                <div className="p-8 space-y-6">
                  <p className="text-sm text-stone-500 leading-normal font-medium">
                    Configure which features are visible and active on <strong>{liveUser.displayName}</strong>'s Sevak Portal. Changes apply instantly.
                  </p>
                  
                  <div className="space-y-4">
                    {[
                      { key: 'history', label: 'Call History', desc: 'Allows user to view historical event logs and call reporting templates.', defaultVal: false },
                      { key: 'facilitation', label: 'Facilitation DB', desc: 'Grants access to view the active facilitation dashboard and manage direct list devotees.', defaultVal: true },
                      { key: 'addDevotee', label: 'Add Devotee Form', desc: 'Enables adding new entries directly into the community congregation index.', defaultVal: true }
                    ].map(feature => {
                      let isActive = false;
                      if (liveUser.accessStatus && liveUser.accessStatus[feature.key as keyof typeof liveUser.accessStatus] !== undefined) {
                        isActive = !!liveUser.accessStatus[feature.key as keyof typeof liveUser.accessStatus];
                      } else {
                        isActive = feature.defaultVal;
                      }

                      return (
                        <div key={feature.key} className="flex justify-between items-center p-5 bg-stone-50 rounded-3xl border border-stone-100 hover:border-saffron/10 transition-all">
                          <div className="flex-1 pr-4 text-left">
                            <span className="text-sm font-black text-stone-700 block uppercase tracking-wide">{feature.label}</span>
                            <span className="text-xs text-stone-400 mt-1 block leading-normal">{feature.desc}</span>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className={cn(
                              "text-[10px] font-bold uppercase tracking-widest",
                              isActive ? "text-emerald-500" : "text-stone-400"
                            )}>
                              {isActive ? 'On' : 'Off'}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleToggleAccess(liveUser.uid, feature.key as any, isActive)}
                              className={cn(
                                "w-14 h-8 rounded-full transition-all relative outline-none", 
                                isActive ? "bg-emerald-500 shadow-sm shadow-emerald-105" : "bg-stone-200"
                              )}
                            >
                              <div className={cn(
                                "w-6 h-6 bg-white rounded-full absolute top-1 transition-all shadow-md",
                                isActive ? "left-7" : "left-1"
                              )} />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </motion.div>
            </div>
          );
        })()}

        {selectedUser && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-stone-900/60 p-4 backdrop-blur-md">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="bg-white rounded-[2.5rem] w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl"
            >
              <div className="p-8 border-b border-stone-100 flex justify-between items-center bg-stone-50/50">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-orange-50 text-saffron rounded-xl flex items-center justify-center font-bold text-lg">
                    {selectedUser.displayName?.[0]}
                  </div>
                  <div>
                    <h2 className="text-2xl font-serif font-black text-stone-800 tracking-tight">{selectedUser.displayName}</h2>
                    <p className="text-[10px] font-black text-stone-400 uppercase tracking-[0.2em] mt-1">Assigned Calling Lists</p>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedUser(null)}
                  className="p-3 hover:bg-stone-100 rounded-2xl transition-all text-stone-400"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-8">
                {loadingAssignments ? (
                  <div className="flex flex-col items-center justify-center py-20 gap-4">
                    <Loader2 className="animate-spin text-saffron" size={40} />
                    <p className="text-stone-400 font-bold uppercase text-[10px] tracking-widest">Scanning Assignments...</p>
                  </div>
                ) : userAssignments.length > 0 ? (
                  <div className="grid gap-6">
                    {Object.entries(
                      userAssignments.reduce((acc, curr) => {
                        const eventName = events[curr.eventId]?.title || 'Unknown Event';
                        if (!acc[eventName]) acc[eventName] = [];
                        acc[eventName].push(curr);
                        return acc;
                      }, {} as Record<string, CallingAssignment[]>)
                    ).map(([eventName, assignments], idx) => (
                      <div key={idx} className="bg-stone-50 rounded-3xl border border-stone-100 overflow-hidden">
                        <div className="px-6 py-4 bg-white border-b border-stone-100 flex items-center gap-3">
                          <Calendar size={16} className="text-saffron" />
                          <h3 className="font-bold font-serif text-stone-800">{eventName}</h3>
                        </div>
                        <div className="p-4 grid gap-3">
                          {(assignments as CallingAssignment[]).map((ass) => (
                            <div 
                              key={ass.id} 
                              className="bg-white p-4 rounded-2xl border border-stone-100 flex items-center justify-between hover:border-saffron/20 transition-all cursor-pointer group"
                              onClick={() => {
                                // Close modal then navigate to devotee profile
                                setSelectedUser(null);
                                navigate(`/profile/${ass.devoteeId}`);
                              }}
                            >
                              <div className="flex items-center gap-4">
                                <div className="w-10 h-10 bg-stone-50 rounded-xl flex items-center justify-center text-stone-400 group-hover:text-saffron transition-colors">
                                  <Users size={18} />
                                </div>
                                <div>
                                  <p className="font-bold text-stone-800 group-hover:text-saffron transition-colors">{ass.devoteeName}</p>
                                  <p className="text-[10px] font-black text-stone-300 uppercase">{ass.devoteeContact}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className={cn(
                                  "text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg border",
                                  ass.status === 'COMPLETED' 
                                    ? "bg-emerald-50 text-emerald-500 border-emerald-100" 
                                    : "bg-orange-50 text-orange-400 border-orange-100"
                                )}>
                                  {ass.status}
                                </span>
                                <ChevronRight size={16} className="text-stone-300" />
                                <div className="relative group/menu inline-block" onClick={(e) => e.stopPropagation()}>
                                  <button className="p-2 hover:bg-stone-50 rounded-xl text-stone-400 transition-all">
                                    <MoreVertical size={18} />
                                  </button>
                                  <div className="absolute right-0 top-full mt-1 bg-white border border-stone-100 shadow-xl rounded-xl py-2 w-48 z-50 hidden group-hover/menu:block text-left">
                                    <button 
                                      onClick={() => handleAddToFacilitation(ass.devoteeId)}
                                      className="w-full text-left px-4 py-2 text-[10px] font-black uppercase text-stone-600 hover:bg-stone-50 hover:text-saffron flex items-center gap-2 transition-colors"
                                    >
                                      <Heart size={14} /> Add to Facilitation
                                    </button>
                                    <button 
                                      onClick={() => {
                                          setSelectedUser(null);
                                          navigate(`/profile/${ass.devoteeId}`);
                                      }}
                                      className="w-full text-left px-4 py-2 text-[10px] font-black uppercase text-stone-600 hover:bg-stone-50 hover:text-saffron flex items-center gap-2 transition-colors"
                                    >
                                      <User size={14} /> View Profile
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-20 text-stone-300">
                    <FileText size={48} className="mb-4 opacity-20" />
                    <p className="font-bold font-serif text-lg">No Active Assignments</p>
                    <p className="text-sm">Owner has not assigned any public event calls to this user.</p>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}

        {isAddingDevotee && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-stone-900/60 p-4 backdrop-blur-md">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-[2.5rem] w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl border border-stone-200"
            >
              <div className="p-8 border-b border-stone-100 flex justify-between items-center bg-stone-50/50">
                <div>
                  <h2 className="text-2xl font-serif font-black text-stone-800 tracking-tight">Add New Devotee</h2>
                  <p className="text-[10px] font-black text-stone-400 uppercase tracking-[0.2em] mt-1">Manual Database Entry</p>
                </div>
                <button 
                  onClick={() => setIsAddingDevotee(false)}
                  className="p-3 hover:bg-stone-100 rounded-2xl transition-all text-stone-400"
                >
                  <X size={24} />
                </button>
              </div>

              <form onSubmit={handleAddDevotee} className="p-8 overflow-y-auto space-y-8">
                <AnimatePresence>
                  {duplicateWarning && (
                    <motion.div 
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className={cn(
                        "p-4 rounded-2xl flex flex-col gap-2 transition-all mb-4 overflow-hidden",
                        duplicateWarning.includes('exists') ? "bg-red-50 border border-red-100 text-red-700" : "bg-amber-50 border border-amber-100 text-amber-700"
                      )}
                    >
                      <div className="flex items-center gap-2">
                         <AlertTriangle size={16} />
                         <p className="text-[10px] font-black uppercase tracking-widest">Duplicate Warning</p>
                      </div>
                      <p className="text-sm font-bold tracking-tight">{duplicateWarning}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-stone-400 uppercase tracking-widest pl-1">Full Name *</label>
                    <input 
                      required
                      type="text" 
                      placeholder="e.g. Rahul Sharma"
                      className="w-full bg-stone-50 border border-stone-200 px-5 py-4 rounded-2xl focus:border-saffron outline-none transition-all font-medium"
                      value={newDevotee.name}
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
                      value={newDevotee.contact}
                      onChange={e => setNewDevotee({...newDevotee, contact: sanitizeMobileInput(e.target.value)})}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-stone-400 uppercase tracking-widest pl-1">Chanting Details</label>
                    <input 
                      type="text" 
                      placeholder="e.g. 16 rounds"
                      className="w-full bg-stone-50 border border-stone-200 px-5 py-4 rounded-2xl focus:border-saffron outline-none transition-all font-medium"
                      value={newDevotee.chanting}
                      onChange={e => setNewDevotee({...newDevotee, chanting: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-stone-400 uppercase tracking-widest pl-1">Institute / Education</label>
                    <input 
                      type="text" 
                      placeholder="College or Office"
                      className="w-full bg-stone-50 border border-stone-200 px-5 py-4 rounded-2xl focus:border-saffron outline-none transition-all font-medium"
                      value={newDevotee.institute}
                      onChange={e => setNewDevotee({...newDevotee, institute: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-stone-400 uppercase tracking-widest pl-1">Date of Birth</label>
                    <input 
                      type="date" 
                      className="w-full bg-stone-50 border border-stone-200 px-5 py-4 rounded-2xl focus:border-saffron outline-none transition-all font-medium"
                      value={newDevotee.dob}
                      onChange={e => setNewDevotee({...newDevotee, dob: e.target.value})}
                    />
                  </div>

                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-stone-400 uppercase tracking-widest pl-1">Current Address</label>
                  <textarea 
                    placeholder="Full residential address..."
                    className="w-full bg-stone-50 border border-stone-200 px-5 py-4 rounded-2xl focus:border-saffron outline-none transition-all font-medium h-32 resize-none"
                    value={newDevotee.address}
                    onChange={e => setNewDevotee({...newDevotee, address: e.target.value})}
                  />
                </div>

                <div className="flex gap-4 pt-4">
                  <button 
                    type="button" 
                    onClick={() => setIsAddingDevotee(false)}
                    className="flex-1 px-8 py-4 rounded-2xl border border-stone-200 text-stone-600 font-bold hover:bg-stone-50 transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit" 
                    disabled={isSubmitting}
                    className="flex-[2] btn-primary bg-stone-900 border-none shadow-xl shadow-stone-200 py-4 flex items-center justify-center gap-2"
                  >
                    {isSubmitting ? <Loader2 className="animate-spin" /> : <UserPlus size={20} />}
                    {isSubmitting ? 'Saving...' : 'Add Devotee to DB'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default MentorDashboard;
