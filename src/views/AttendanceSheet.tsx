import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../services/firebase';
import { collection, query, where, onSnapshot, doc, setDoc, getDocs, updateDoc, increment, writeBatch, deleteDoc, collectionGroup, serverTimestamp } from 'firebase/firestore';
import { Devotee, Event, Attendance, CallingAssignment, Template } from '../types';
import Papa from 'papaparse';
import Layout from '../components/Layout';
import { SearchInput } from '../components/SearchInput';
import { 
  History, 
  Check, 
  X, 
  Calendar,
  Filter,
  CheckCircle2,
  Share2,
  Lock,
  Unlock,
  Download,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  QrCode,
  ChevronDown as ChevronDownIcon,
  ChevronRight as ChevronRightIcon,
  MoreVertical,
  Plus,
  Users,
  Heart,
  User
} from 'lucide-react';
import { cn, getPublicAttendanceUrl, normalizePhoneNumber } from '../lib/utils';
import ContactLink from '../components/ContactLink';
import { useAuth } from '../context/AuthContext';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { QRCodeSVG } from 'qrcode.react';

const HistoryEventTab: React.FC<{ event: Event, onDelete: (e: React.MouseEvent) => void | Promise<void>, onView: () => void }> = ({ event, onDelete, onView }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [devotees, setDevotees] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    if (isOpen && !fetched) {
      const fetchDetails = async () => {
        setLoading(true);
        try {
          const assSnap = await getDocs(collection(db, `events/${event.id}/assignments`));
          const attSnap = await getDocs(collection(db, `events/${event.id}/attendance`));
          
          const attData: Record<string, boolean> = {};
          attSnap.docs.forEach(d => attData[d.id] = d.data().present || false);
          
          const assignedIds = assSnap.docs.map(d => d.data().devoteeId).filter(Boolean);
          if (assignedIds.length > 0) {
            // Firestore 'in' query limit is 30. For simplicity we assume < 30 here.
            // If more are needed, we would need to chunk this request.
            const devoteesQuery = query(collection(db, "devotees"), where("__name__", "in", assignedIds));
            const devSnap = await getDocs(devoteesQuery);
            const devList = devSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            setDevotees(devList);
          }
          setAttendance(attData);
          setFetched(true);
        } catch (err) {
          console.error("Error fetching history details:", err);
        } finally {
          setLoading(false);
        }
      };
      fetchDetails();
    }
  }, [isOpen, event.id, fetched]);

  return (
    <div className="bg-white border border-stone-100 rounded-3xl overflow-hidden shadow-sm transition-all hover:shadow-md">
      <div className="px-6 py-5 flex items-center justify-between">
        <div 
          className="flex items-center gap-4 cursor-pointer group flex-1"
          onClick={() => setIsOpen(!isOpen)}
        >
          <div className="p-3 bg-stone-50 rounded-2xl text-stone-400 group-hover:text-saffron transition-colors">
            {isOpen ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
          </div>
          <div>
            <h3 className="font-bold font-serif text-stone-800 text-lg group-hover:text-saffron transition-colors">{event.title}</h3>
            <p className="text-sm text-stone-500 font-medium">
              {new Date(event.date).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <button 
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onView(); }}
            className="px-4 py-2 text-xs font-black uppercase tracking-wider text-saffron hover:bg-orange-50 rounded-xl transition-colors"
          >
            Open Sheet
          </button>
          <button 
            onClick={onDelete}
            className="p-3 text-red-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
            title="Delete Record Permanently"
          >
            <Trash2 size={24} />
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="px-6 pb-6 pt-2 border-t border-stone-50 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="bg-stone-50/50 rounded-2xl p-4 space-y-2">
            <h4 className="text-[10px] font-black text-stone-400 uppercase tracking-widest mb-3 px-2">Assigned Candidates</h4>
            {loading ? (
              <div className="py-4 text-center text-stone-400 text-sm italic">Loading candidates...</div>
            ) : devotees.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {devotees.map(d => (
                  <div key={d.id} className="flex items-center justify-between bg-white p-3 rounded-xl border border-stone-100 shadow-sm">
                    <span className="font-bold text-stone-700 font-serif">{d.name}</span>
                    <span className={cn(
                      "px-2 py-0.5 rounded-lg text-[10px] font-black uppercase",
                      attendance[d.id] ? "bg-green-100 text-green-600" : "bg-red-100 text-red-600"
                    )}>
                      {attendance[d.id] ? "Present" : "Absent"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-4 text-center text-stone-400 text-sm italic">No candidates were assigned to this event.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const TemplateItem: React.FC<{ template: Template, onDelete: () => Promise<void> }> = ({ template, onDelete }) => {
  const [isConfirming, setIsConfirming] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  return (
    <div className="group bg-white border border-stone-100 p-6 rounded-3xl shadow-sm hover:shadow-md transition-all flex items-center gap-6 relative overflow-hidden">
      {isDeleting && (
        <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-20 flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      
      {!isConfirming ? (
        <button 
          onClick={() => setIsConfirming(true)}
          className="p-3 text-red-300 hover:text-red-500 hover:bg-red-50 rounded-2xl transition-all shrink-0"
          title="Delete Template"
        >
          <Trash2 size={20} />
        </button>
      ) : (
        <div className="flex flex-col gap-2 shrink-0 z-10">
          <button 
            onClick={async () => {
              setIsDeleting(true);
              try {
                await onDelete();
              } catch (err) {
                console.error("Delete template error:", err);
                alert("Failed to delete template. You might not have permissions.");
                setIsConfirming(false);
              } finally {
                setIsDeleting(false);
              }
            }}
            className="px-4 py-2 bg-red-500 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-red-600 transition-all shadow-lg shadow-red-100"
          >
            Delete
          </button>
          <button 
            onClick={() => setIsConfirming(false)}
            className="px-4 py-2 bg-stone-100 text-stone-500 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-stone-200 transition-all"
          >
            Cancel
          </button>
        </div>
      )}
      
      <div>
        <h4 className="font-bold text-stone-800 font-serif">{template.name}</h4>
        <p className="text-[10px] text-stone-400 font-bold uppercase tracking-widest mt-1">{template.fields.length} Fields Configured</p>
      </div>
    </div>
  );
};

const AttendanceSheet = () => {
  const [events, setEvents] = useState<Event[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [devotees, setDevotees] = useState<Devotee[]>([]);
  const [assignedDevotees, setAssignedDevotees] = useState<Devotee[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<any[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [newTemplate, setNewTemplate] = useState<{ name: string, fields: string[] }>({ name: '', fields: ['name', 'contact'] }); // required fields by default
  const [searchTerm, setSearchTerm] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(25);

  const [showQRModal, setShowQRModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string, title: string } | null>(null);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [uploadingAttendance, setUploadingAttendance] = useState(false);
  const attendanceFileInputRef = React.useRef<HTMLInputElement>(null);
  const { profile } = useAuth();
  const navigate = useNavigate();

  // 1. Reactive filtering of the master list
  const filteredEvents = React.useMemo(() => {
    return events.filter(e => e.id && !deletedIds.has(e.id));
  }, [events, deletedIds]);

  // 2. Derived event lists from the filtered master list
  const activeEvents = React.useMemo(() => {
    const now = new Date();
    return filteredEvents.filter(e => {
      if ((e as any).isDeleted || (e as any).importedFromCsv) return false;
      const date = new Date(e.date);
      const diffHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);
      const isStaticHistory = !(e as any).isAttendanceOpen && diffHours > 24;
      return !isStaticHistory;
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [filteredEvents]);

  const vaultEvents = React.useMemo(() => {
    const now = new Date();
    return filteredEvents.filter(e => {
      if ((e as any).isDeleted || (e as any).importedFromCsv) return false;
      const date = new Date(e.date);
      const diffHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);
      const isStaticHistory = !(e as any).isAttendanceOpen && diffHours > 24;
      return isStaticHistory;
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [filteredEvents]);

  const historyEvents = React.useMemo(() => {
    return filteredEvents.filter(e => !!(e as any).isDeleted || !!(e as any).isArchived || !!(e as any).importedFromCsv)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [filteredEvents]);

  useEffect(() => {
    if (!profile?.templeId) return;

    const unsubEvents = onSnapshot(query(collection(db, 'events'), where('templeId', '==', profile.templeId)), (snap) => {
      const eventData = snap.docs
        .filter(doc => doc.exists())
        .map(doc => ({ id: doc.id, ...doc.data() } as Event));
      
      setEvents(eventData);
    }, (error) => {
      console.error("Snapshot error:", error);
    });

    const unsubDevotees = onSnapshot(query(collection(db, 'devotees'), where('templeId', '==', profile.templeId)), (snap) => {
      setDevotees(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Devotee)));
    });

    const unsubTemplates = onSnapshot(query(collection(db, 'templates'), where('templeId', '==', profile.templeId)), (snap) => {
      setTemplates(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Template)));
    });

    return () => {
      unsubEvents();
      unsubDevotees();
      unsubTemplates();
    };
  }, [profile?.templeId]);

  // Auto-select logic: ensure we always have an event selected if available
  useEffect(() => {
    const dropdownAll = [...activeEvents, ...vaultEvents];
    
    // If we have no selection OR the current selection is gone from the list
    if (dropdownAll.length > 0) {
      const isStillInList = dropdownAll.some(e => e.id === selectedEventId);
      if (!selectedEventId || !isStillInList) {
        // Prefer active, then vault
        const nextId = activeEvents.length > 0 ? activeEvents[0].id : vaultEvents[0].id;
        if (nextId) setSelectedEventId(nextId);
      }
    } else if (historyEvents.length > 0) {
      // Fallback to history if NOTHING else exists
      if (!selectedEventId || !historyEvents.some(e => e.id === selectedEventId)) {
        if (historyEvents[0].id) setSelectedEventId(historyEvents[0].id);
      }
    } else {
      // Truly empty
      if (selectedEventId !== '') setSelectedEventId('');
    }
  }, [activeEvents, vaultEvents, historyEvents, selectedEventId]);

  useEffect(() => {
    if (!selectedEventId) return;
    
    const unsubAttendance = onSnapshot(collection(db, `events/${selectedEventId}/attendance`), (snap) => {
      const records = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setAttendanceRecords(records);
    });
    return unsubAttendance;
  }, [selectedEventId]);

  const currentEvent = events.find(e => e.id === selectedEventId);

  const handleRemoveAttendance = async (devoteeId: string) => {
    if (!selectedEventId || (currentEvent as any)?.isDeleted) return;
    await deleteDoc(doc(db, `events/${selectedEventId}/attendance`, devoteeId));
    await updateDoc(doc(db, 'devotees', devoteeId), {
      attendanceCount: increment(-1)
    });
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

  const togglePublicAttendance = async () => {
    if (!selectedEventId) return;
    const isOpen = (currentEvent as any)?.isAttendanceOpen;
    await updateDoc(doc(db, 'events', selectedEventId), {
      isAttendanceOpen: !isOpen
    });
  };

  const shareAttendanceLink = () => {
    const url = getPublicAttendanceUrl(selectedEventId);
    if (navigator.share) {
      navigator.share({
        title: `Attendance for ${currentEvent?.title}`,
        url: url
      });
    } else {
      navigator.clipboard.writeText(url);
      alert("Attendance link copied to clipboard!");
    }
  };

  const [finalizing, setFinalizing] = useState(false);
  const handleFinalize = async () => {
    if (!selectedEventId || !currentEvent || finalizing) return;
    
    setFinalizing(true);
    try {
      // 1. Close and mark as finalized
      await updateDoc(doc(db, 'events', selectedEventId), {
        isAttendanceOpen: false,
        isFinalized: true
      });
      
      // 2. Sync counts for those who attended
      for (const record of attendanceRecords) {
        if (!record.devoteeId) continue;
        const qAll = query(collectionGroup(db, 'attendance'), where('devoteeId', '==', record.devoteeId), where('present', '==', true));
        const allSnap = await getDocs(qAll);
        await updateDoc(doc(db, 'devotees', record.devoteeId), {
          attendanceCount: allSnap.size
        });
      }

      alert("Attendance finalized and all profiles synced accurately!");
    } catch (error) {
      console.error(error);
      alert("Failed to finalize attendance.");
    } finally {
      setFinalizing(false);
    }
  };

  const exportPDF = () => {
    if (!currentEvent) return;
    const doc = new jsPDF() as any;
    
    doc.setFontSize(20);
    doc.text(`Attendance Report: ${currentEvent.title}`, 14, 22);
    doc.setFontSize(11);
    doc.text(`Date: ${new Date(currentEvent.date).toLocaleDateString()}`, 14, 30);
    doc.text(`Total Present: ${attendanceRecords.length}`, 14, 38);

    const tableData = attendanceRecords.map((d, index) => [
      index + 1,
      d.name,
      d.contact,
      d.facilitatorName || 'None',
      d.age || 'N/A',
      new Date(d.markedAt).toLocaleTimeString()
    ]);

    doc.autoTable({
      startY: 45,
      head: [['#', 'Name', 'Contact', 'Facilitator', 'Age', 'Time']],
      body: tableData,
      headStyles: { fillColor: [212, 163, 115] }
    });

    doc.save(`Attendance_${currentEvent.title.replace(/\s+/g, '_')}.pdf`);
  };

  const handlePermanentDelete = async (eventId: string, eventTitle: string, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!eventId) return;
    
    setDeleteConfirm({ id: eventId, title: eventTitle });
  };

  const handleCreateTemplate = async () => {
    if (!newTemplate.name || newTemplate.fields.length === 0 || !profile?.templeId) return;
    
    const templateId = `temp_${Date.now()}`;
    await setDoc(doc(db, 'templates', templateId), {
      ...newTemplate,
      id: templateId,
      templeId: profile.templeId,
      createdAt: new Date().toISOString()
    });
    setNewTemplate({ name: '', fields: ['name', 'contact'] });
    alert("Template created successfully!");
  };

  const availableFields = [
    { id: 'name', label: 'Candidate Name' },
    { id: 'contact', label: 'Contact Number' },
    { id: 'age', label: 'Age' },
    { id: 'dob', label: 'Date of Birth' },
    { id: 'address', label: 'Address' },
    { id: 'gender', label: 'Gender' },
    { id: 'institute', label: 'Institute Name' },
    { id: 'mentor', label: 'Mentor Name (Dropdown)' },
    { id: 'facilitator', label: 'Facilitator Name (Dropdown)' },
    { id: 'chanting', label: 'Chanting Rounds' }
  ];

  const confirmPermanentDelete = async () => {
    if (!deleteConfirm) return;
    const { id: eventId, title: eventTitle } = deleteConfirm;
    setDeleteConfirm(null);

    try {
      setDeletedIds(prev => {
        const updated = new Set(Array.from(prev));
        updated.add(eventId);
        return updated;
      });
      
      if (selectedEventId === eventId) {
        setSelectedEventId('');
      }

      const eventRef = doc(db, 'events', eventId);
      const [attendanceSnap, assignmentsSnap] = await Promise.all([
        getDocs(collection(db, `events/${eventId}/attendance`)),
        getDocs(collection(db, `events/${eventId}/assignments`))
      ]);
      
      const batch = writeBatch(db);
      attendanceSnap.docs.forEach(d => batch.delete(d.ref));
      assignmentsSnap.docs.forEach(d => batch.delete(d.ref));
      batch.delete(eventRef);
      
      await batch.commit();
    } catch (err: any) {
      console.error("Delete failed:", err);
      alert(`Delete failed: ${err.message}`);
      setDeletedIds(prev => {
        const next = new Set(Array.from(prev));
        next.delete(eventId);
        return next;
      });
    }
  };

  const handleSoftDelete = async (eventId: string, eventTitle: string, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!eventId) return;
    
    if (window.confirm(`Move "${eventTitle}" to History?`)) {
      try {
        setEvents(prev => prev.map(ev => ev.id === eventId ? { ...ev, isDeleted: true } : ev));
        if (selectedEventId === eventId) setSelectedEventId('');
        await updateDoc(doc(db, 'events', eventId), { 
          isDeleted: true,
          isAttendanceOpen: false,
          isPublic: false
        });
      } catch (err: any) {
        console.error("Soft delete failed:", err);
        alert("Failed to move to history.");
      }
    }
  };

  const [clearHistoryConfirm, setClearHistoryConfirm] = useState(false);
  const handleClearAllHistory = () => {
    if (historyEvents.length === 0) return;
    setClearHistoryConfirm(true);
  };

  const confirmClearAllHistory = async () => {
    setClearHistoryConfirm(false);
    try {
      const idsToDelete = historyEvents.map(e => e.id!).filter(id => !!id);
      setDeletedIds(prev => {
        const next = new Set(Array.from(prev));
        idsToDelete.forEach(id => next.add(id));
        return next;
      });
      
      for (const eId of idsToDelete) {
        const eventRef = doc(db, 'events', eId);
        const [att, ass] = await Promise.all([
          getDocs(collection(db, `events/${eId}/attendance`)),
          getDocs(collection(db, `events/${eId}/assignments`))
        ]);
        const batch = writeBatch(db);
        att.docs.forEach(d => batch.delete(d.ref));
        ass.docs.forEach(d => batch.delete(d.ref));
        batch.delete(eventRef);
        await batch.commit();
      }
    } catch (err: any) {
      console.error("Clear All failed:", err);
      alert("Failed to clear some records.");
    }
  };

  const handleAttendanceUploadClick = () => {
    attendanceFileInputRef.current?.click();
  };

  const handleAttendanceCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!profile?.templeId) {
      alert("Unable to determine your temple. Please refresh and try again.");
      if (e.target) e.target.value = '';
      return;
    }

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        setUploadingAttendance(true);
        try {
          const rows: any[] = (results.data as any[]).filter(r => r && Object.keys(r).length > 0);
          if (rows.length === 0) {
            alert("The uploaded file has no data rows.");
            return;
          }

          const headers = Object.keys(rows[0]);
          const nameAliases = ['name', 'devotee name', 'devotee', 'नाम'];
          const contactAliases = ['contact', 'contact no.', 'contact no', 'mobile', 'phone', 'ph no.', 'संपर्क', 'फोन', 'मोबाइल'];
          const nameKey = headers.find(h => nameAliases.includes(h.trim().toLowerCase()));
          const contactKey = headers.find(h => contactAliases.includes(h.trim().toLowerCase()));

          if (!nameKey || !contactKey) {
            alert('Could not find "Name" and "Contact" columns in the uploaded file.');
            return;
          }

          const eventCols = headers.filter(h => h !== nameKey && h !== contactKey);
          if (eventCols.length === 0) {
            alert("No event columns were found in the uploaded file.");
            return;
          }

          // Resolve or create an event for every event column (title = column header)
          const eventTitleToId = new Map<string, string>();
          events.forEach(ev => { if (ev.title) eventTitleToId.set(ev.title.trim().toLowerCase(), ev.id!); });

          const eventBatch = writeBatch(db);
          let newEventOps = 0;
          eventCols.forEach(col => {
            const key = col.trim().toLowerCase();
            if (!eventTitleToId.has(key)) {
              const evRef = doc(collection(db, 'events'));
              eventBatch.set(evRef, {
                title: col.trim(),
                date: new Date().toISOString(),
                description: 'Imported from attendance CSV upload.',
                mediaUrl: '',
                isPublic: false,
                createdBy: profile.uid,
                templeId: profile.templeId,
                createdAt: new Date().toISOString(),
                isAttendanceOpen: false,
                isDeleted: false,
                importedFromCsv: true
              });
              eventTitleToId.set(key, evRef.id);
              newEventOps++;
            }
          });
          if (newEventOps > 0) await eventBatch.commit();

          // Lookup maps for Rule 1/2/3 devotee matching:
          // Rule 1: Name + Contact both match -> immediate match
          // Rule 2: Name is ambiguous (shared by multiple devotees) -> match by Contact
          // Rule 3: Contact is ambiguous (shared by multiple devotees) -> match by Name
          const byNameContact = new Map<string, string>();
          const byContact = new Map<string, string[]>();
          const byName = new Map<string, string[]>();
          devotees.forEach(d => {
            const n = (d.name || '').trim().toLowerCase();
            const c = normalizePhoneNumber(d.contact || '');
            if (n && c) byNameContact.set(`${n}_${c}`, d.id!);
            if (c) byContact.set(c, [...(byContact.get(c) || []), d.id!]);
            if (n) byName.set(n, [...(byName.get(n) || []), d.id!]);
          });

          const resolveDevoteeId = (rawName: string, normContact: string): string | undefined => {
            const n = rawName.trim().toLowerCase();
            const c = normContact;
            const compositeKey = `${n}_${c}`;
            // Rule 1
            if (n && c && byNameContact.has(compositeKey)) return byNameContact.get(compositeKey);
            // Rule 2: multiple devotees share this name -> disambiguate via contact
            const nameMatches = byName.get(n) || [];
            if (nameMatches.length > 1 && c) {
              const contactMatches = byContact.get(c) || [];
              const overlap = contactMatches.find(id => nameMatches.includes(id));
              if (overlap) return overlap;
            }
            // Rule 3: multiple devotees share this contact -> disambiguate via name
            const contactMatches = byContact.get(c) || [];
            if (contactMatches.length > 1 && n) {
              const overlap = contactMatches.find(id => (byName.get(n) || []).includes(id));
              if (overlap) return overlap;
            }
            // Single unambiguous match on contact or name alone
            if (contactMatches.length === 1) return contactMatches[0];
            if (nameMatches.length === 1) return nameMatches[0];
            return undefined;
          };

          let presentCount = 0, absentCount = 0, newDevoteeCount = 0;
          let batch = writeBatch(db);
          let opCount = 0;
          const flush = async () => {
            if (opCount > 0) { await batch.commit(); batch = writeBatch(db); opCount = 0; }
          };

          for (const row of rows) {
            const rawName = (row[nameKey] || '').toString().trim();
            const rawContact = (row[contactKey] || '').toString().trim();
            if (!rawName && !rawContact) continue;

            const normContact = normalizePhoneNumber(rawContact);
            const compositeKey = `${rawName.toLowerCase()}_${normContact}`;

            const presentCols: string[] = [];
            const absentCols: string[] = [];
            eventCols.forEach(col => {
              const cell = (row[col] ?? '').toString().trim().toUpperCase();
              if (cell === 'P' || cell === 'PRESENT') presentCols.push(col);
              else if (cell === 'A' || cell === 'ABSENT') absentCols.push(col);
            });
            if (presentCols.length === 0 && absentCols.length === 0) continue;

            let devoteeId = resolveDevoteeId(rawName, normContact);
            const isNewDevotee = !devoteeId;
            if (!devoteeId) {
              devoteeId = doc(collection(db, 'devotees')).id;
              batch.set(doc(db, 'devotees', devoteeId), {
                name: rawName || 'Unknown',
                contact: normContact,
                mentor: '',
                chanting: '0',
                attendanceCount: presentCols.length,
                templeId: profile.templeId,
                isDeleted: false,
                isImported: true,
                createdAt: new Date().toISOString()
              });
              opCount++;
              const n = rawName.trim().toLowerCase();
              if (normContact) byContact.set(normContact, [...(byContact.get(normContact) || []), devoteeId]);
              if (n) byName.set(n, [...(byName.get(n) || []), devoteeId]);
              byNameContact.set(compositeKey, devoteeId);
              newDevoteeCount++;
            } else if (presentCols.length > 0) {
              batch.update(doc(db, 'devotees', devoteeId), { attendanceCount: increment(presentCols.length) });
              opCount++;
            }

            presentCols.forEach(col => {
              const eventId = eventTitleToId.get(col.trim().toLowerCase())!;
              batch.set(doc(collection(db, `events/${eventId}/assignments`)), {
                eventId, devoteeId, userId: profile.uid,
                devoteeName: rawName, devoteeContact: normContact,
                status: 'COMPLETED', response: 'COMING', updatedAt: new Date().toISOString()
              });
              batch.set(doc(db, `events/${eventId}/attendance`, devoteeId!), {
                devoteeId, name: rawName, contact: normContact, present: true,
                markedAt: new Date().toISOString(), markedBy: profile.uid, templeId: profile.templeId
              });
              opCount += 2;
              presentCount++;
            });
            absentCols.forEach(col => {
              const eventId = eventTitleToId.get(col.trim().toLowerCase())!;
              batch.set(doc(collection(db, `events/${eventId}/assignments`)), {
                eventId, devoteeId, userId: profile.uid,
                devoteeName: rawName, devoteeContact: normContact,
                status: 'COMPLETED', response: 'NOT_COMING', updatedAt: new Date().toISOString()
              });
              batch.set(doc(db, `events/${eventId}/attendance`, devoteeId!), {
                devoteeId, name: rawName, contact: normContact, present: false,
                markedAt: new Date().toISOString(), markedBy: profile.uid, templeId: profile.templeId
              });
              opCount += 2;
              absentCount++;
            });

            if (opCount >= 400) await flush();
          }
          await flush();

          alert(`Attendance import complete. Present: ${presentCount}, Absent: ${absentCount}, New devotees added: ${newDevoteeCount}.`);
        } catch (err) {
          console.error("Attendance CSV upload failed:", err);
          alert("Failed to process the attendance CSV file.");
        } finally {
          setUploadingAttendance(false);
          if (e.target) e.target.value = '';
        }
      },
      error: (err) => {
        console.error(err);
        alert("Failed to parse the CSV file.");
      }
    });
  };

  const filteredAttendance = attendanceRecords.filter(d => {
    const tokens = searchTerm.toLowerCase().split(/\s+/).filter(t => t.length > 0);
    const allText = Object.values(d).map(v => typeof v === 'string' || typeof v === 'number' ? String(v).toLowerCase() : '').join(' ');
    return tokens.every(token => allText.includes(token));
  });

  const totalPages = Math.ceil(filteredAttendance.length / itemsPerPage);
  const paginatedAttendance = filteredAttendance.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedEventId]);

  const isStatic = (eventObj: Event | undefined) => {
    if (!eventObj) return false;
    return (eventObj as any).isDeleted;
  };

  if (showHistory) {
    return (
      <Layout>
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <button onClick={() => setShowHistory(false)} className="text-stone-400 hover:text-saffron flex items-center gap-1 font-medium transition-colors">
              <ChevronLeft size={18} /> Back to Live Vault
            </button>
            <div className="flex items-center gap-4">
              <input
                type="file"
                ref={attendanceFileInputRef}
                className="hidden"
                accept=".csv"
                onChange={handleAttendanceCSVUpload}
              />
              <button
                onClick={handleAttendanceUploadClick}
                disabled={uploadingAttendance}
                className="text-orange-600 hover:text-orange-700 text-[10px] font-black uppercase tracking-widest flex items-center gap-1 border border-orange-100 px-3 py-1.5 rounded-xl bg-orange-50 transition-colors disabled:opacity-50"
              >
                <Download size={14} className="rotate-180" /> {uploadingAttendance ? 'Uploading...' : 'Upload Attendance'}
              </button>
              {historyEvents.length > 0 && (
                <button 
                  onClick={handleClearAllHistory}
                  className="text-red-500 hover:text-red-700 text-[10px] font-black uppercase tracking-widest flex items-center gap-1 border border-red-100 px-3 py-1.5 rounded-xl bg-red-50 transition-colors"
                >
                  <Trash2 size={14} /> Clear All History
                </button>
              )}
              <h1 className="text-3xl text-stone-900 font-serif font-bold">Attendance History</h1>
            </div>
          </div>

          <div className="space-y-4">
            {historyEvents.map(eventItem => (
              <HistoryEventTab 
                key={eventItem.id} 
                event={eventItem} 
                onDelete={(e) => handlePermanentDelete(eventItem.id!, eventItem.title, e)}
                onView={() => { setSelectedEventId(eventItem.id!); setShowHistory(false); }}
              />
            ))}
            {historyEvents.length === 0 && (
              <div className="py-20 text-center text-stone-400 italic bg-white rounded-3xl border border-dashed border-stone-200">
                No history events found (deleted from dashboard).
              </div>
            )}
          </div>
        </div>
      </Layout>
    );
  }

  if (showTemplateManager) {
    return (
      <Layout>
        <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex items-center justify-between">
            <button onClick={() => setShowTemplateManager(false)} className="text-stone-400 hover:text-saffron flex items-center gap-1 font-medium transition-colors">
              <ChevronLeft size={18} /> Back to Vault
            </button>
            <h1 className="text-4xl text-stone-900 font-serif font-black tracking-tight">Form Designer</h1>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
            {/* Template List */}
            <div className="lg:col-span-4 space-y-6">
              <h3 className="text-sm font-black text-stone-400 uppercase tracking-widest px-1">Managed Templates</h3>
              <div className="space-y-3">
                {templates.map(t => (
                  <TemplateItem 
                    key={t.id} 
                    template={t} 
                    onDelete={() => deleteDoc(doc(db, 'templates', t.id))} 
                  />
                ))}
                {templates.length === 0 && (
                  <div className="p-10 text-center border-2 border-dashed border-stone-100 rounded-[2.5rem] text-stone-300 italic text-sm">
                    No templates designed yet.
                  </div>
                )}
              </div>
            </div>

            {/* Template Creator */}
            <div className="lg:col-span-8 bg-white border border-stone-100 p-10 rounded-[3rem] shadow-2xl shadow-stone-200/50 space-y-8">
              <div className="flex items-center gap-4 mb-2">
                <div className="w-12 h-12 bg-orange-50 rounded-2xl flex items-center justify-center text-orange-500">
                  <Plus size={24} />
                </div>
                <div>
                   <h2 className="text-2xl font-serif font-black text-stone-800">Design New Template</h2>
                   <p className="text-stone-400 text-sm font-medium">Select fields to include in the attendance form.</p>
                </div>
              </div>

              <div className="space-y-6">
                <div className="space-y-3">
                  <label className="text-[10px] font-black text-stone-400 uppercase tracking-[0.4em] px-1">Template Name</label>
                  <input 
                    type="text"
                    placeholder="e.g. Regular Preaching Session"
                    className="w-full px-8 py-5 rounded-[1.5rem] border border-stone-100 bg-stone-50/30 focus:bg-white focus:border-orange-200 outline-none transition-all shadow-inner font-bold text-stone-800"
                    value={newTemplate.name}
                    onChange={e => setNewTemplate({...newTemplate, name: e.target.value})}
                  />
                </div>

                <div className="space-y-4">
                  <label className="text-[10px] font-black text-stone-400 uppercase tracking-[0.4em] px-1">Select Placeholders</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {availableFields.map(field => {
                      const isSelected = newTemplate.fields.includes(field.id);
                      return (
                        <button
                          key={field.id}
                          onClick={() => {
                            if (field.id === 'name' || field.id === 'contact') return; // Essential
                            if (isSelected) {
                              setNewTemplate({...newTemplate, fields: newTemplate.fields.filter(f => f !== field.id)});
                            } else {
                              setNewTemplate({...newTemplate, fields: [...newTemplate.fields, field.id]});
                            }
                          }}
                          className={cn(
                            "flex items-center justify-between px-6 py-4 rounded-2xl border transition-all text-sm font-bold",
                            isSelected ? "bg-orange-500 border-orange-500 text-white shadow-lg shadow-orange-100" : "bg-stone-50 border-stone-100 text-stone-400 hover:border-orange-200"
                          )}
                        >
                          {field.label}
                          {isSelected ? <Check size={16} /> : (field.id === 'name' || field.id === 'contact' ? <Lock size={14} className="opacity-50" /> : <Plus size={16} className="opacity-0 group-hover:opacity-100" />)}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <button 
                  onClick={handleCreateTemplate}
                  disabled={!newTemplate.name}
                  className="w-full py-6 bg-stone-900 text-white rounded-[1.5rem] font-black uppercase tracking-[0.3em] text-xs shadow-2xl shadow-stone-200 hover:bg-black transition-all active:scale-[0.98] disabled:opacity-30"
                >
                  Build Template
                </button>
              </div>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-10 h-full flex flex-col pb-10">
        {/* Header Section */}
        <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-8">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2.5 h-2.5 bg-orange-500 rounded-full animate-pulse" />
              <span className="text-[10px] font-black text-orange-500 uppercase tracking-[0.4em]">Live System</span>
            </div>
            <h1 className="text-5xl text-stone-800 font-serif font-black tracking-tight">Attendance Vault</h1>
            <p className="text-stone-400 font-medium text-lg mt-3">Real-time attendance tracking and management.</p>
          </div>
          
          <div className="flex flex-wrap items-center gap-4">
            <button 
              onClick={() => setShowTemplateManager(true)}
              className="flex items-center gap-3 px-8 py-4 bg-orange-50 border border-orange-100 rounded-2xl text-xs font-black uppercase tracking-widest text-orange-600 hover:bg-orange-100 transition-all active:scale-95 shadow-sm"
            >
              <Plus size={20} /> Design Form
            </button>
            <button 
              onClick={() => setShowHistory(true)}
              className="flex items-center gap-3 px-8 py-4 bg-white border border-stone-100 rounded-2xl text-xs font-black uppercase tracking-widest text-stone-500 hover:bg-stone-50 transition-all active:scale-95 shadow-sm"
            >
              <History size={20} className="text-orange-400" /> See History
            </button>
            <div className="flex items-center gap-3 bg-white rounded-2xl border border-stone-100 p-2 shadow-sm">
              <select 
                value={selectedEventId} 
                onChange={e => setSelectedEventId(e.target.value)}
                className="bg-transparent px-4 py-2 outline-none text-stone-700 font-bold text-sm appearance-none pr-10 bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20width%3D%2220%22%20height%3D%2220%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22none%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cpath%20d%3D%22M5%207.5L10%2012.5L15%207.5%22%20stroke%3D%22%23AF8048%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22/%3E%3C/svg%3E')] bg-[length:18px] bg-[right_10px_center] bg-no-repeat"
              >
                <optgroup label="Active Events">
                  {activeEvents.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
                </optgroup>
                {vaultEvents.length > 0 && (
                  <optgroup label="Attendance Vault">
                    {vaultEvents.map(e => (
                      <option key={e.id} value={e.id}>
                        {e.title}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
          </div>
        </div>

        {selectedEventId && (
          <div className="bg-white border border-stone-100 rounded-[2.5rem] flex-1 flex flex-col group overflow-hidden shadow-2xl shadow-stone-200/50 p-8 space-y-10">
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 bg-stone-50/30 p-8 rounded-[2rem] border border-stone-50">
              <div>
                <span className="text-[10px] font-black text-orange-500 uppercase tracking-[0.4em] mb-2 block">Current Selection</span>
                <h2 className="text-3xl font-serif font-black text-stone-800">{currentEvent?.title}</h2>
                <p className="text-stone-400 font-medium text-base mt-1">
                  Organized for {currentEvent && new Date(currentEvent.date).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button 
                  onClick={togglePublicAttendance}
                  className={cn(
                    "flex items-center gap-2.5 px-6 py-3.5 rounded-2xl text-xs font-black uppercase tracking-widest transition-all shadow-lg active:scale-95",
                    (currentEvent as any)?.isAttendanceOpen 
                      ? "bg-green-500 text-white shadow-green-100 border border-green-500" 
                      : "bg-white border border-stone-100 text-stone-500 hover:bg-stone-50"
                  )}
                >
                  {(currentEvent as any)?.isAttendanceOpen ? <Unlock size={18} /> : <Lock size={18} />}
                  Public Marking {(currentEvent as any)?.isAttendanceOpen ? 'ON' : 'OFF'}
                </button>
                <button onClick={shareAttendanceLink} className="p-3.5 bg-white border border-stone-100 rounded-2xl hover:bg-stone-50 transition-colors shadow-sm" title="Share Public Link">
                  <Share2 size={20} className="text-orange-400" />
                </button>
                {!isStatic(currentEvent) && (
                  <button 
                    onClick={() => setShowQRModal(true)} 
                    className="p-3.5 bg-orange-50 border border-orange-100 rounded-2xl hover:bg-orange-100 transition-colors shadow-sm" 
                    title="Show QR Scan"
                  >
                    <QrCode size={20} className="text-orange-500" />
                  </button>
                )}
                <button onClick={exportPDF} className="p-3.5 bg-white border border-stone-100 rounded-2xl hover:bg-stone-50 transition-colors shadow-sm" title="Export PDF">
                  <Download size={20} className="text-stone-500" />
                </button>
                {!(currentEvent as any)?.isDeleted && (
                  <button 
                    onClick={handleFinalize}
                    disabled={finalizing}
                    className="flex items-center gap-3 px-8 py-3.5 bg-gradient-to-r from-orange-400 to-orange-500 text-white rounded-2xl text-xs font-black uppercase tracking-widest shadow-xl shadow-orange-200 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 disabled:hover:scale-100"
                  >
                    {finalizing ? "Finalizing..." : (currentEvent as any)?.isFinalized ? "Re-Sync Profile" : "Finalize & Sync"}
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-col lg:flex-row justify-between items-center gap-8">
              <SearchInput 
                className="flex-1"
                placeholder="Find devotee, contact or facilitator..."
                value={searchTerm}
                onChange={setSearchTerm}
              />
              <div className="flex items-center gap-4 bg-orange-50/50 px-8 py-4 rounded-[1.5rem] border border-orange-100 shadow-sm">
                 <Users size={22} className="text-orange-500" />
                 <span className="text-sm font-black uppercase tracking-[0.2em] text-orange-600">Present Today: {attendanceRecords.length}</span>
              </div>
            </div>

            <div className="overflow-x-auto rounded-[2rem] border border-stone-50 shadow-inner bg-stone-50/10">
               <table className="w-full text-left border-collapse">
                  <thead className="bg-stone-50/50">
                    <tr className="text-[11px] font-black text-stone-400 uppercase tracking-[0.2em] border-b border-stone-100">
                      <th className="px-8 py-5">Devotee</th>
                      <th className="px-8 py-5 text-center">Contact</th>
                      <th className="px-8 py-5 text-center">Facilitator</th>
                      <th className="px-8 py-5 text-center">Age</th>
                      <th className="px-8 py-5 text-center">Time</th>
                      <th className="px-8 py-5 text-center">Actions</th>
                    </tr>
                  </thead>
                   <tbody className="divide-y divide-stone-50">
                    {paginatedAttendance.map(record => (
                      <tr key={record.id} className="hover:bg-white transition-colors group">
                        <td className="px-8 py-5">
                          <button 
                            onClick={() => navigate(`/profile/${record.devoteeId}`)}
                            className="font-serif font-black text-stone-800 text-lg hover:text-orange-500 transition-colors"
                          >
                            {record.name}
                          </button>
                        </td>
                        <td className="px-8 py-5 text-center text-sm font-mono text-stone-400 font-bold">
                          <ContactLink contact={record.contact || ''} className="hover:text-saffron hover:underline">{record.contact}</ContactLink>
                        </td>
                        <td className="px-8 py-5 text-center">
                          <span className="px-4 py-2 bg-orange-50 text-orange-600 rounded-full text-[10px] font-black uppercase tracking-[0.1em] border border-orange-100">
                            {record.facilitatorName}
                          </span>
                        </td>
                        <td className="px-8 py-5 text-center text-base font-black font-serif text-stone-700">{record.age}</td>
                        <td className="px-8 py-5 text-center text-[10px] text-stone-400 font-black uppercase tracking-widest bg-stone-50/30">
                          {new Date(record.markedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="px-8 py-5 text-center">
                           <div className="flex items-center justify-center gap-2">
                             <div className="relative group/menu inline-block">
                               <button className="p-2 hover:bg-stone-50 rounded-xl text-stone-400 transition-all">
                                 <MoreVertical size={18} />
                               </button>
                               <div className="absolute right-0 top-full mt-1 bg-white border border-stone-100 shadow-xl rounded-xl py-2 w-48 z-50 hidden group-hover/menu:block">
                                 <button 
                                   onClick={() => handleAddToFacilitation(record.devoteeId)}
                                   className="w-full text-left px-4 py-2 text-[10px] font-black uppercase text-stone-600 hover:bg-stone-50 hover:text-saffron flex items-center gap-2 transition-colors"
                                 >
                                   <Heart size={14} /> Add to Facilitation
                                 </button>
                                 <button 
                                   onClick={() => navigate(`/profile/${record.devoteeId}`)}
                                   className="w-full text-left px-4 py-2 text-[10px] font-black uppercase text-stone-600 hover:bg-stone-50 hover:text-saffron flex items-center gap-2 transition-colors"
                                 >
                                   <User size={14} /> View Profile
                                 </button>
                               </div>
                             </div>
                             <button 
                              onClick={() => handleRemoveAttendance(record.id)}
                              className="p-3 text-stone-200 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                              title="Remove attendance entry"
                             >
                               <Trash2 size={20} />
                             </button>
                           </div>
                        </td>
                      </tr>
                    ))}
                    {filteredAttendance.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-40 text-center text-stone-400 italic font-medium bg-white">
                          <div className="flex flex-col items-center gap-5">
                            <div className="w-20 h-20 bg-stone-50 rounded-[2rem] flex items-center justify-center">
                              <History size={36} className="text-stone-100" />
                            </div>
                            <p className="text-stone-400 font-bold text-lg">
                              {searchTerm ? "No matching records found." : "Waiting for devotees to mark attendance..."}
                            </p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
               </table>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="pt-6 border-t border-stone-100 flex items-center justify-between">
                <p className="text-[10px] font-black text-stone-400 uppercase tracking-widest">
                  Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, filteredAttendance.length)} of {filteredAttendance.length}
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
      </div>


      {/* Clear All History Confirmation Modal */}
      {clearHistoryConfirm && (
        <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-6 text-center">
          <div className="bg-white rounded-[40px] p-10 max-w-sm w-full shadow-2xl animate-in zoom-in-95 duration-300 border border-stone-100">
            <div className="space-y-6">
              <div className="inline-block p-5 bg-red-50 rounded-3xl mb-2 text-red-500">
                <Trash2 size={40} />
              </div>
              <div>
                <h3 className="text-2xl font-serif font-bold text-stone-800">Clear All History?</h3>
                <p className="text-stone-500 text-sm mt-3 leading-relaxed">
                  Are you sure you want to permanently delete <span className="font-bold text-red-600">{historyEvents.length}</span> records from history?
                  <br /><br />
                  This action is irreversible and will remove all history data for these events.
                </p>
              </div>

              <div className="flex flex-col gap-3 pt-6">
                <button 
                  onClick={confirmClearAllHistory}
                  className="w-full py-4 bg-red-600 text-white rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-red-200 hover:bg-red-700 transition-all"
                >
                  Delete All History
                </button>
                <button 
                  onClick={() => setClearHistoryConfirm(false)}
                  className="w-full py-4 bg-stone-100 text-stone-600 rounded-2xl font-black uppercase tracking-widest hover:bg-stone-200 transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-6 text-center">
          <div className="bg-white rounded-[40px] p-10 max-w-sm w-full shadow-2xl animate-in zoom-in-95 duration-300 border border-stone-100">
            <div className="space-y-6">
              <div className="inline-block p-5 bg-red-50 rounded-3xl mb-2 text-red-500">
                <Trash2 size={40} />
              </div>
              <div>
                <h3 className="text-2xl font-serif font-bold text-stone-800">Confirm Deletion</h3>
                <p className="text-stone-500 text-sm mt-3 leading-relaxed">
                  Are you sure you want to permanently delete <span className="font-bold text-stone-700">"{deleteConfirm.title}"</span>? 
                  <br /><br />
                  This will remove all associated attendance and records from the system. This cannot be undone.
                </p>
              </div>

              <div className="flex flex-col gap-3 pt-6">
                <button 
                  onClick={confirmPermanentDelete}
                  className="w-full py-4 bg-red-600 text-white rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-red-200 hover:bg-red-700 transition-all"
                >
                  Confirm Permanent Delete
                </button>
                <button 
                  onClick={() => setDeleteConfirm(null)}
                  className="w-full py-4 bg-stone-100 text-stone-600 rounded-2xl font-black uppercase tracking-widest hover:bg-stone-200 transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showQRModal && currentEvent && (
        <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-6 text-center">
          <div className="bg-white rounded-[40px] p-10 max-w-sm w-full shadow-2xl relative animate-in zoom-in-95 duration-300 border border-stone-100">
            <button 
              onClick={() => setShowQRModal(false)}
              className="absolute top-8 right-8 p-2 text-stone-400 hover:text-stone-600 transition-colors"
            >
              <X size={24} />
            </button>
            
            <div className="space-y-8">
              <div className="inline-block p-5 bg-orange-50 rounded-3xl mb-2 text-saffron">
                <QrCode size={40} />
              </div>
              <div>
                <h3 className="text-2xl font-serif font-bold text-stone-800 tracking-tight">Scan Attendance</h3>
                <p className="text-stone-500 text-sm mt-2 font-medium">Show this QR to devotees at the entrance</p>
              </div>

              <div className="bg-white p-6 rounded-[2rem] border-4 border-stone-50 flex justify-center shadow-inner">
                <QRCodeSVG 
                  value={getPublicAttendanceUrl(selectedEventId)}
                  size={200}
                  level="H"
                  includeMargin={true}
                />
              </div>

              <div className="p-5 bg-orange-50 rounded-2xl border border-orange-100">
                <p className="text-[10px] font-black text-saffron uppercase tracking-[0.2em] mb-2">Public Connection Link</p>
                <p className="text-xs text-stone-600 break-all font-mono leading-relaxed">
                  {getPublicAttendanceUrl(selectedEventId)}
                </p>
              </div>

              <button 
                onClick={shareAttendanceLink}
                className="w-full py-4 bg-stone-900 text-white rounded-2xl font-black uppercase tracking-widest hover:bg-black transition-all shadow-xl shadow-stone-200 hover:-translate-y-0.5 active:translate-y-0"
              >
                Copy & Close
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default AttendanceSheet;
