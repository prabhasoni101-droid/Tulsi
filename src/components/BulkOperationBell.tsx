import React, { useState, useEffect, useRef } from 'react';
import { Bell, AlertTriangle } from 'lucide-react';
import { listenToBulkJobAlerts, dismissBulkJobAlert, BulkJobAlert, alertTimestamp } from '../lib/bulkJobAlerts';
import { cn } from '../lib/utils';

// Bell that surfaces durable bulk-operation failure notifications to the Owner
// in real time (same pattern as DuplicateConflictBell). One durable jobId => one
// alert doc, so retries/refreshes never duplicate.
const BulkOperationBell: React.FC<{ templeId: string }> = ({ templeId }) => {
  const [alerts, setAlerts] = useState<BulkJobAlert[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!templeId) return;
    return listenToBulkJobAlerts(templeId, setAlerts);
  }, [templeId]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleDismiss = async (alert: BulkJobAlert) => {
    try {
      await dismissBulkJobAlert(templeId, alert.id);
      setAlerts((prev) => prev.filter((a) => a.id !== alert.id));
    } catch (err) {
      console.error('Failed to dismiss bulk alert:', err);
    }
  };

  if (!templeId) return null;

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setIsOpen((v) => !v)}
        aria-label="Bulk operation notifications"
        className="relative p-2.5 rounded-full bg-white border border-stone-200 text-stone-500 hover:text-orange-500 hover:border-orange-200 transition-colors shadow-sm"
      >
        <AlertTriangle size={20} />
        {alerts.length > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-black rounded-full flex items-center justify-center">
            {alerts.length}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-3 w-96 max-w-[90vw] bg-white rounded-3xl border border-stone-200 shadow-xl z-[70] overflow-hidden">
          <div className="px-6 py-4 border-b border-stone-100">
            <h3 className="font-serif font-black text-stone-800">Bulk Operations</h3>
            <p className="text-[10px] text-stone-400 font-bold uppercase tracking-widest mt-0.5">
              Operations that need attention
            </p>
          </div>

          <div className="max-h-[420px] overflow-y-auto no-scrollbar">
            {alerts.length === 0 ? (
              <p className="text-sm text-stone-400 text-center py-10 px-6">No alerts right now.</p>
            ) : (
              alerts.map((a) => (
                <div key={a.id} className="px-6 py-5 border-b border-stone-50 last:border-b-0">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Bell size={16} className="text-red-500 shrink-0" />
                      <span className="font-bold text-stone-800 text-sm capitalize truncate">
                        {String(a.operationType || 'Bulk operation').replace(/([A-Z])/g, ' $1')}
                      </span>
                    </div>
                    <span className="text-[10px] text-stone-400 font-bold shrink-0">
                      {alertTimestamp(a.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-xs text-stone-600 leading-relaxed mb-3">{a.message}</p>
                  {a.failedCount > 0 && (
                    <p className="text-[10px] font-black uppercase tracking-widest text-red-500 mb-3">
                      {a.failedCount} of {a.totalCount} failed
                    </p>
                  )}
                  <button
                    onClick={() => handleDismiss(a)}
                    className="text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full bg-stone-100 text-stone-600 hover:bg-stone-900 hover:text-white transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default BulkOperationBell;