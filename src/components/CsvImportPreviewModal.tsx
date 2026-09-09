import React, { useState } from 'react';
import { StagedImportPlan, StagedRowDiff } from '../lib/stagedCsvImportEngine';
import { 
  FileText, 
  CheckCircle2, 
  RefreshCw, 
  AlertTriangle, 
  XCircle, 
  MinusCircle, 
  Sparkles, 
  Columns, 
  Calendar,
  X,
  ArrowRight,
  Database
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

interface CsvImportPreviewModalProps {
  isOpen: boolean;
  fileName: string;
  plan: StagedImportPlan | null;
  isStaging: boolean;
  isCommitting: boolean;
  progressStep: string;
  progressPercent: number;
  onCommit: () => void;
  onClose: () => void;
}

export const CsvImportPreviewModal: React.FC<CsvImportPreviewModalProps> = ({
  isOpen,
  fileName,
  plan,
  isStaging,
  isCommitting,
  progressStep,
  progressPercent,
  onCommit,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'summary' | 'diffs' | 'issues'>('summary');

  if (!isOpen) return null;

  const totalChanges = (plan?.insertedCount || 0) + (plan?.updatedCount || 0);

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="bg-white rounded-[2.5rem] shadow-2xl border border-stone-100 w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col my-auto"
        >
          {/* Header */}
          <div className="px-8 py-6 border-b border-stone-100 flex items-center justify-between bg-stone-50/50 shrink-0">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-stone-900 text-white rounded-2xl flex items-center justify-center shadow-md">
                <FileText size={22} />
              </div>
              <div>
                <h2 className="text-2xl font-serif font-black text-stone-800 tracking-tight">
                  Staged CSV Import Preview
                </h2>
                <p className="text-xs text-stone-400 font-bold tracking-widest uppercase mt-0.5">
                  {fileName} {plan ? `(${plan.totalRows} rows processed in ${plan.processingMs}ms)` : ''}
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              disabled={isCommitting}
              className="p-2.5 rounded-2xl bg-stone-100 hover:bg-stone-200 text-stone-500 transition-colors disabled:opacity-30"
            >
              <X size={18} />
            </button>
          </div>

          {/* Body Content */}
          <div className="p-8 overflow-y-auto flex-1 space-y-8 no-scrollbar">
            {/* Staging / Committing Progress Bar */}
            {(isStaging || isCommitting) && (
              <div className="bg-orange-50 border border-orange-200 p-6 rounded-3xl space-y-3 animate-pulse">
                <div className="flex items-center justify-between text-xs font-black uppercase tracking-widest text-orange-700">
                  <span className="flex items-center gap-2">
                    <RefreshCw size={14} className="animate-spin text-orange-500" />
                    {progressStep || (isStaging ? 'Staging CSV data in worker...' : 'Committing to database...')}
                  </span>
                  <span>{progressPercent}%</span>
                </div>
                <div className="w-full h-3 bg-orange-200/60 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-orange-500 rounded-full transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            )}

            {plan && (
              <>
                {/* Navigation Tabs */}
                <div className="flex items-center gap-2 bg-stone-100 p-1.5 rounded-2xl w-fit">
                  <button
                    onClick={() => setActiveTab('summary')}
                    className={cn(
                      "px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                      activeTab === 'summary' ? "bg-white text-stone-900 shadow-sm" : "text-stone-400 hover:text-stone-600"
                    )}
                  >
                    Summary
                  </button>
                  <button
                    onClick={() => setActiveTab('diffs')}
                    className={cn(
                      "px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                      activeTab === 'diffs' ? "bg-white text-stone-900 shadow-sm" : "text-stone-400 hover:text-stone-600"
                    )}
                  >
                    Field Diffs ({plan.insertedCount + plan.updatedCount})
                  </button>
                  {(plan.conflictCount > 0 || plan.invalidCount > 0 || plan.duplicateCount > 0) && (
                    <button
                      onClick={() => setActiveTab('issues')}
                      className={cn(
                        "px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2",
                        activeTab === 'issues' ? "bg-red-500 text-white shadow-sm" : "text-red-500 hover:bg-red-50"
                      )}
                    >
                      <AlertTriangle size={12} />
                      Issues ({plan.conflictCount + plan.invalidCount + plan.duplicateCount})
                    </button>
                  )}
                </div>

                {activeTab === 'summary' && (
                  <div className="space-y-8">
                    {/* Metrics Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="bg-emerald-50 border border-emerald-100 p-5 rounded-3xl space-y-1">
                        <div className="flex items-center gap-2 text-emerald-600 text-xs font-black uppercase tracking-widest">
                          <CheckCircle2 size={16} /> New Records
                        </div>
                        <p className="text-3xl font-black font-serif text-emerald-900">{plan.insertedCount}</p>
                        <p className="text-[10px] font-bold text-emerald-700">Ready to insert</p>
                      </div>

                      <div className="bg-sky-50 border border-sky-100 p-5 rounded-3xl space-y-1">
                        <div className="flex items-center gap-2 text-sky-600 text-xs font-black uppercase tracking-widest">
                          <RefreshCw size={16} /> Updated Records
                        </div>
                        <p className="text-3xl font-black font-serif text-sky-900">{plan.updatedCount}</p>
                        <p className="text-[10px] font-bold text-sky-700">Field-level changes</p>
                      </div>

                      <div className="bg-stone-50 border border-stone-200 p-5 rounded-3xl space-y-1">
                        <div className="flex items-center gap-2 text-stone-500 text-xs font-black uppercase tracking-widest">
                          <MinusCircle size={16} /> Unchanged Records
                        </div>
                        <p className="text-3xl font-black font-serif text-stone-700">{plan.unchangedCount}</p>
                        <p className="text-[10px] font-bold text-stone-400">0 Writes (Skipped)</p>
                      </div>

                      <div className="bg-amber-50 border border-amber-100 p-5 rounded-3xl space-y-1">
                        <div className="flex items-center gap-2 text-amber-600 text-xs font-black uppercase tracking-widest">
                          <AlertTriangle size={16} /> Duplicates / Conflicts
                        </div>
                        <p className="text-3xl font-black font-serif text-amber-900">{plan.duplicateCount + plan.conflictCount}</p>
                        <p className="text-[10px] font-bold text-amber-700">Flagged safely</p>
                      </div>
                    </div>

                    {/* Auto-Detected Columns Badges */}
                    {(plan.autoDetectedColumns.length > 0 || plan.detectedAttendanceCols.length > 0) && (
                      <div className="bg-stone-50 p-6 rounded-3xl border border-stone-100 space-y-4">
                        <h4 className="text-xs font-black uppercase tracking-widest text-stone-600 flex items-center gap-2">
                          <Columns size={16} className="text-orange-500" /> Auto-Detected CSV Schema
                        </h4>

                        {plan.autoDetectedColumns.length > 0 && (
                          <div className="space-y-2">
                            <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Custom Columns:</span>
                            <div className="flex flex-wrap gap-2">
                              {plan.autoDetectedColumns.map((col) => (
                                <span key={col} className="px-3 py-1 bg-white border border-stone-200 rounded-full text-xs font-bold text-stone-700 shadow-sm">
                                  {col}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {plan.detectedAttendanceCols.length > 0 && (
                          <div className="space-y-2">
                            <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest flex items-center gap-1">
                              <Calendar size={12} className="text-orange-500" /> Attendance Event Columns:
                            </span>
                            <div className="flex flex-wrap gap-2">
                              {plan.detectedAttendanceCols.map((col) => (
                                <span key={col} className="px-3 py-1 bg-orange-50 border border-orange-200 rounded-full text-xs font-bold text-orange-800 shadow-sm">
                                  {col}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'diffs' && (
                  <div className="space-y-4">
                    <h4 className="text-xs font-black uppercase tracking-widest text-stone-500">
                      Sample Field-Level Diffs (Showing first {Math.min(15, plan.diffs.filter(d => d.type === 'INSERT' || d.type === 'UPDATE').length)} changes)
                    </h4>

                    <div className="space-y-3 max-h-[400px] overflow-y-auto no-scrollbar pr-1">
                      {plan.diffs
                        .filter((d) => d.type === 'INSERT' || d.type === 'UPDATE')
                        .slice(0, 15)
                        .map((diff, idx) => (
                          <div key={idx} className="p-4 bg-stone-50 rounded-2xl border border-stone-100 space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className={cn(
                                  "px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider",
                                  diff.type === 'INSERT' ? "bg-emerald-100 text-emerald-700" : "bg-sky-100 text-sky-700"
                                )}>
                                  {diff.type}
                                </span>
                                <span className="font-bold text-stone-800 text-sm font-serif">{diff.name}</span>
                              </div>
                              <span className="text-xs font-mono text-stone-400">{diff.contact}</span>
                            </div>

                            {diff.type === 'UPDATE' && diff.newValues && (
                              <div className="space-y-1 pt-1 border-t border-stone-200/60">
                                {Object.keys(diff.newValues).map((field) => (
                                  <div key={field} className="text-xs flex items-center gap-2 text-stone-600 font-mono">
                                    <span className="font-bold capitalize text-stone-500">{field}:</span>
                                    <span className="text-red-500 line-through">{String(diff.oldValues?.[field] || '(empty)')}</span>
                                    <ArrowRight size={10} className="text-stone-400" />
                                    <span className="text-emerald-600 font-bold">{String(diff.newValues[field])}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {activeTab === 'issues' && (
                  <div className="space-y-4">
                    <h4 className="text-xs font-black uppercase tracking-widest text-red-500">
                      Flagged Rows & Validation Errors
                    </h4>

                    <div className="space-y-3 max-h-[400px] overflow-y-auto no-scrollbar pr-1">
                      {plan.diffs
                        .filter((d) => d.type === 'INVALID' || d.type === 'CONFLICT' || d.type === 'DUPLICATE')
                        .map((diff, idx) => (
                          <div key={idx} className="p-4 bg-red-50/50 rounded-2xl border border-red-100 space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-black text-red-600 uppercase tracking-wider">
                                Row {diff.rowNumber} — {diff.type}
                              </span>
                              <span className="text-xs font-bold text-stone-700">{diff.name}</span>
                            </div>
                            <p className="text-xs text-stone-600 italic">{diff.reason || 'Flagged issue'}</p>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer Actions */}
          <div className="px-8 py-6 border-t border-stone-100 bg-stone-50/50 flex items-center justify-between shrink-0">
            <button
              onClick={onClose}
              disabled={isCommitting}
              className="px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest text-stone-500 hover:bg-stone-200 transition-colors disabled:opacity-30"
            >
              Cancel (0 Writes)
            </button>

            {plan && (
              <button
                onClick={onCommit}
                disabled={isCommitting || isStaging || totalChanges === 0}
                className="px-8 py-4 rounded-2xl bg-stone-900 hover:bg-orange-500 text-white text-[10px] font-black uppercase tracking-[0.2em] shadow-xl shadow-stone-900/20 transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-3"
              >
                <Database size={16} />
                {isCommitting ? 'Committing Changes...' : `Commit Import (${totalChanges} Changes)`}
              </button>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
