import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MessageSquare, MessageCircle, Send, X } from 'lucide-react';

interface ContactLinkProps {
  contact: string;
  className?: string;
  children?: React.ReactNode;
}

const ContactLink: React.FC<ContactLinkProps> = ({ contact, className, children }) => {
  const [showMenu, setShowMenu] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const isLongPressRef = useRef<boolean>(false);

  const handleStart = (e: React.TouchEvent | React.MouseEvent) => {
    // Only capture primary button for mouse click
    if (e.type === 'mousedown' && (e as React.MouseEvent).button !== 0) return;
    isLongPressRef.current = false;
    
    timerRef.current = setTimeout(() => {
      isLongPressRef.current = true;
      setShowMenu(true);
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur(); 
      }
    }, 1000); // 1000ms (approximately 1 second) duration as requested
  };

  const handleEnd = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const rawNumber = contact.replace(/\D/g, '');

  return (
    <div className="relative inline-flex">
      <a 
        href={`tel:${contact}`} 
        className={className}
        onMouseDown={handleStart}
        onMouseUp={handleEnd}
        onMouseLeave={handleEnd}
        onTouchStart={handleStart}
        onTouchEnd={handleEnd}
        onClick={(e) => {
          if (isLongPressRef.current || showMenu) {
            e.preventDefault();
            e.stopPropagation();
            isLongPressRef.current = false; // Reset
          }
        }}
        onContextMenu={(e) => {
          if (showMenu) {
            e.preventDefault(); 
            e.stopPropagation();
          }
        }}
      >
        {children || contact}
      </a>

      <AnimatePresence>
        {showMenu && (
          <>
            <div 
              className="fixed inset-0 z-[100]" 
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowMenu(false);
              }}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 10 }}
              className="absolute z-[101] bottom-full mb-2 left-1/2 -translate-x-1/2 bg-white rounded-2xl shadow-xl border border-stone-100 p-2 flex gap-2 min-w-max"
            >
              <a 
                href={`whatsapp://send?phone=${rawNumber}`}
                className="flex items-center gap-2 px-4 py-2 hover:bg-emerald-50 rounded-xl transition-colors text-emerald-600 font-bold text-sm bg-white"
                onClick={() => setShowMenu(false)}
              >
                <MessageCircle size={16} /> WhatsApp
              </a>
              <a 
                href={`sms:${rawNumber}`}
                className="flex items-center gap-2 px-4 py-2 hover:bg-blue-50 rounded-xl transition-colors text-blue-600 font-bold text-sm bg-white"
                onClick={() => setShowMenu(false)}
              >
                <MessageSquare size={16} /> SMS/Text
              </a>
              <a 
                href={`tg://resolve?phone=${rawNumber}`}
                className="flex items-center gap-2 px-4 py-2 hover:bg-sky-50 rounded-xl transition-colors text-sky-600 font-bold text-sm bg-white"
                onClick={() => setShowMenu(false)}
              >
                <Send size={16} /> Telegram
              </a>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowMenu(false);
                }}
                className="p-2 text-stone-400 hover:text-stone-600 hover:bg-stone-50 rounded-xl transition-colors"
                title="Cancel"
              >
                <X size={16} />
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ContactLink;
