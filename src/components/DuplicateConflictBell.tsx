import React, { useState, useEffect, useRef } from 'react';
import { Bell } from 'lucide-react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { Devotee } from '../types';
import {
  ConflictAssignment,
  syncConflictsFromDevotees,
  listenToConflicts,
  resolveConflict,
  earliestCandidate,
  CONFLICT_AUTO_RESOLVE_MS,
} from '../lib/duplicateConflicts';
import { cn } from '../lib/utils';

// Renders the bell icon itself, the pending-count badge, and the dropdown
// with one entry per unresolved duplicate-facilitation conflict. Also owns
// the two background jobs that make the whole feature self-driving:
//  1) watching `devotees` for newly-created cross-facilitator duplicates and
//     writing/refreshing a conflictAssignments doc for each group, and
//  2) a 1-second ticker that auto-resolves any conflict whose 5-minute
//     window has elapsed to whichever facilitator added it first.
const DuplicateConflictBell: React.FC<{ templeId: string }> = ({ templeId }) => {
  const [conflicts, setConflicts] = useState<ConflictAssignment[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());
  const containerRef = useRef<HTMLDivElement>(null);

  // Job 1: keep conflictAssignments in sync with live duplicate devotees.
  useEffect(() => {
    if (!templeId) return;
    const qD = query(
      collection(db, 'devotees'),
      where('templeId', '==', templeId),
      where('duplicateType', '==', 'complete')
    );
    const unsub = onSnapshot(qD, (snap) => {
      const devotees = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Devotee));
      syncConflictsFromDevotees(templeId, devotees).catch((err) =>
        console.error('Failed to sync duplicate conflicts:', err)
      );
    });
    return () => unsub();
  }, [templeId]);

  // Listen for pending conflicts to show in the bell.
  useEffect(() => {
    if (!templeId) return;
    return listenToConflicts(templeId, setConflicts);
  }, [templeId]);

  // Job 2: tick every second so countdowns update, and auto-resolve any
  // conflict whose 5-minute window has passed without an explicit owner
  // decision. resolvingRef tracks conflict ids we've already sent a resolve
  // request for, so a slow round-trip doesn't cause the same conflict to be
  // resolved multiple times before its onSnapshot listener removes it here.
  const resolvingRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const interval = setInterval(() => {
      const t = Date.now();
      setNowMs(t);
      conflicts.forEach((c) => {
        if (t >= c.expiresAtMs && !resolvingRef.current.has(c.id)) {
          resolvingRef.current.add(c.id);
          const winner = earliestCandidate(c);
          resolveConflict(c, winner.facilitatorId, 'auto')
            .catch((err) => console.error('Failed to auto-resolve duplicate conflict:', err))
            .finally(() => resolvingRef.current.delete(c.id));
        }
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [conflicts]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleAssign = async (conflict: ConflictAssignment, facilitatorId: string) => {
    try {
      await resolveConflict(conflict, facilitatorId, 'owner');
    } catch (err) {
      console.error('Failed to assign duplicate conflict:', err);
      alert('Could not assign this devotee. Please try again.');
    }
  };

  if (!templeId) return null;

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setIsOpen((v) => !v)}
        aria-label="Duplicate facilitation notifications"
        className="relative p-2.5 rounded-full bg-white border border-stone-200 text-stone-500 hover:text-orange-500 hover:border-orange-200 transition-colors shadow-sm"
      >
        <Bell size={20} />
        {conflicts.length > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-black rounded-full flex items-center justify-center">
            {conflicts.length}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-3 w-96 max-w-[90vw] bg-white rounded-3xl border border-stone-200 shadow-xl z-[70] overflow-hidden">
          <div className="px-6 py-4 border-b border-stone-100">
            <h3 className="font-serif font-black text-stone-800">Duplicate Facilitation</h3>
            <p className="text-[10px] text-stone-400 font-bold uppercase tracking-widest mt-0.5">
              Two sevaks added the same devotee
            </p>
          </div>

          <div className="max-h-[420px] overflow-y-auto no-scrollbar">
            {conflicts.length === 0 ? (
              <p className="text-sm text-stone-400 text-center py-10 px-6">No pending conflicts right now.</p>
            ) : (
              conflicts.map((c) => {
                const secondsLeft = Math.max(0, Math.round((c.expiresAtMs - nowMs) / 1000));
                const mm = Math.floor(secondsLeft / 60);
                const ss = secondsLeft % 60;
                const defaultWinnerId = earliestCandidate(c).facilitatorId;
                return (
                  <div key={c.id} className="px-6 py-5 border-b border-stone-50 last:border-b-0">
                    <div className="flex items-center justify-between mb-1">
                      <p className="font-bold text-stone-800">{c.devoteeName}</p>
                      <span className="text-[10px] font-black text-orange-500 tabular-nums">
                        {mm}:{ss.toString().padStart(2, '0')}
                      </span>
                    </div>
                    <p className="text-xs text-stone-400 mb-3">{c.contact}</p>
                    <div className="space-y-2">
                      {c.candidates.map((cand) => (
                        <div
                          key={cand.facilitatorId}
                          className={cn(
                            "flex items-center justify-between px-4 py-2.5 rounded-2xl border",
                            cand.facilitatorId === defaultWinnerId
                              ? "border-orange-200 bg-orange-50/50"
                              : "border-stone-100 bg-stone-50/50"
                          )}
                        >
                          <span className="text-sm font-bold text-stone-700">{cand.facilitatorName}</span>
                          <button
                            onClick={() => handleAssign(c, cand.facilitatorId)}
                            className="text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full bg-stone-900 text-white hover:bg-orange-500 transition-colors"
                          >
                            Assign
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default DuplicateConflictBell;