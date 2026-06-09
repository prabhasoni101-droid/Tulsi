import React, { useState, useRef, useEffect } from 'react';
import { Search, Clock, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/utils';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  onSearch?: (value: string) => void;
  inputClassName?: string;
}

export const SearchInput: React.FC<SearchInputProps> = ({ 
  value, 
  onChange, 
  placeholder = "Search...", 
  className,
  onSearch,
  inputClassName
}) => {
  const [showHistory, setShowHistory] = useState(false);
  const { profile, updateProfile } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);

  const history = profile?.searchHistory || [];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowHistory(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const saveToHistory = async (term: string) => {
    if (!term.trim()) return;
    const cleanTerm = term.trim();
    // Move to front and limit to 15 items
    const newHistory = [cleanTerm, ...history.filter(item => item !== cleanTerm)].slice(0, 15);
    await updateProfile({ searchHistory: newHistory });
  };

  const removeFromHistory = async (e: React.MouseEvent, termToRemove: string) => {
    e.stopPropagation();
    const newHistory = history.filter(item => item !== termToRemove);
    await updateProfile({ searchHistory: newHistory });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      saveToHistory(value);
      if (onSearch) onSearch(value);
      setShowHistory(false);
    }
  };

  const handleSelectHistory = (term: string) => {
    onChange(term);
    saveToHistory(term);
    if (onSearch) onSearch(term);
    setShowHistory(false);
  };

  return (
    <div className={cn("relative w-full", className)} ref={containerRef}>
      <div className="relative group/search">
        <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-stone-400 group-focus-within/search:text-orange-500 transition-colors" size={20} />
        <input 
          type="text" 
          placeholder={placeholder}
          className={cn(
            "w-full pl-16 pr-6 py-4 rounded-[1.5rem] border border-stone-100 outline-none focus:border-orange-200 focus:ring-8 focus:ring-orange-50 bg-white transition-all text-base font-medium shadow-sm",
            inputClassName
          )}
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={() => setShowHistory(true)}
          onKeyDown={handleKeyDown}
        />
      </div>

      <AnimatePresence>
        {showHistory && history.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 5, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            className="absolute top-full left-0 right-0 z-[100] bg-white border border-stone-100 rounded-[2rem] shadow-2xl overflow-hidden py-4 ring-1 ring-black/5"
          >
            <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
              {history.map((term, index) => (
                <div 
                  key={`${term}-${index}`}
                  className="flex items-center justify-between px-6 py-3.5 hover:bg-stone-50 cursor-pointer group transition-colors"
                  onClick={() => handleSelectHistory(term)}
                >
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <Clock size={16} className="text-stone-300 group-hover:text-stone-400 shrink-0" />
                    <span className="text-stone-700 font-bold truncate tracking-tight">{term}</span>
                  </div>
                  <button 
                    onClick={(e) => removeFromHistory(e, term)}
                    className="p-2 text-stone-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all opacity-0 group-hover:opacity-100 flex items-center justify-center"
                    aria-label="Remove from history"
                  >
                    <X size={14} strokeWidth={3} />
                  </button>
                </div>
              ))}
              <div className="px-6 py-2 border-t border-stone-50 mt-2">
                 <button 
                   onClick={() => updateProfile({ searchHistory: [] })}
                   className="text-[10px] font-black text-stone-300 uppercase tracking-widest hover:text-red-500 transition-colors"
                 >
                   Clear all history
                 </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
