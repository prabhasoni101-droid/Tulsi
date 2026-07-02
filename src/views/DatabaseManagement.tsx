import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { 
  Search, Download, Trash2, Plus, Minus, Upload, Filter, 
  Save, FileSpreadsheet, ArrowUpDown, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Move,
  Edit2, X, AlertTriangle, ShieldCheck, Database,
  MoreVertical, Heart, User, Check, Clock,
  ChevronLeft, ChevronRight, Maximize2, Minimize2, Undo2, Redo2, Copy, Trash,
  GripHorizontal,Layers
} from 'lucide-react';
import { 
  collection, query, onSnapshot, doc, updateDoc, 
  deleteDoc, setDoc, addDoc, writeBatch, serverTimestamp,
  where, getDocs, orderBy, increment, deleteField,
  getDoc, limit
} from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../context/AuthContext';
import { Devotee, Event } from '../types';
import Layout from '../components/Layout';
import { cn, normalizePhoneNumber, sanitizeMobileInput, isValidMobileNumber } from '../lib/utils';
import Papa from 'papaparse';
import { useNavigate, Link } from 'react-router-dom';

const BASE_COLUMNS = ['Name', 'Age', 'Gender', 'Date of Birth', 'Address', 'Institute', 'Attendance', 'Contact No.', 'Mentor', 'Chanting', 'Facilitator', 'Profile'];

// Sub-components moved out for performance and stability
const EditableHeader: React.FC<{ 
  col: string, 
  isBaseColumn: boolean, 
  onUpdate: (old: string, updated: string) => void,
  onDelete: (col: string) => void
}> = ({ col, isBaseColumn, onUpdate, onDelete }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(col);

  if (isBaseColumn) return <span className="flex items-center gap-2">{col}</span>;

  if (isEditing) {
    return (
      <input 
        autoFocus
        className="bg-white border border-orange-200 px-2 py-1 rounded w-full outline-none text-xs font-bold text-orange-600"
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={() => {
          if (value !== col) {
            onUpdate(col, value);
          }
          setIsEditing(false);
        }}
        onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
      />
    );
  }

  return (
    <div className="flex items-center justify-between group/hdr">
      <span>{col}</span>
      <div className="flex items-center gap-1 opacity-0 group-hover/hdr:opacity-100 transition-opacity">
         <button onClick={() => setIsEditing(true)} className="p-1 hover:bg-stone-100 rounded text-stone-400 hover:text-orange-500">
           <Edit2 size={10} />
         </button>
         <button 
           onClick={() => onDelete(col)}
           className="p-1 hover:bg-stone-100 rounded text-stone-400 hover:text-red-500"
         >
           <X size={10} />
         </button>
      </div>
    </div>
  );
};

const checkIsNew = (createdAt: any, isImported: boolean | undefined) => {
  if (isImported === true) return false;
  if (!createdAt) return false;
  let date: Date;
  if (createdAt instanceof Date) {
     date = createdAt;
  } else if (typeof createdAt === 'object' && createdAt.seconds !== undefined) {
     date = new Date(createdAt.seconds * 1000);
  } else if (typeof createdAt === 'object' && typeof createdAt.toMillis === 'function') {
     date = new Date(createdAt.toMillis());
  } else if (typeof createdAt === 'number') {
     date = new Date(createdAt);
  } else if (typeof createdAt === 'string') {
     date = new Date(createdAt);
  } else {
     return false;
  }
  
  if (isNaN(date.getTime())) return false;
  
  const diffTime = Math.abs(new Date().getTime() - date.getTime());
  const diffHours = diffTime / (1000 * 60 * 60); 
  return diffHours <= 72;
};

const EditableCell = React.memo<{ 
  id: string, 
  field: string, 
  initialValue: string, 
  onSave: (id: string, field: string, value: string) => void,
  onMouseDown?: (r: number, c: number) => void,
  onMouseEnter?: (r: number, c: number) => void,
  onContextMenu?: (e: React.MouseEvent, r: number, c: number) => void,
  isSelected?: boolean,
  rowIdx: number,
  colIdx: number,
  badge?: React.ReactNode
}>(({ id, field, initialValue, onSave, onMouseDown, onMouseEnter, onContextMenu, isSelected, rowIdx, colIdx, badge }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (!isEditing) {
      setValue(initialValue);
    }
  }, [initialValue, isEditing]);

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
  };

  if (isEditing) {
    return (
      <input 
        autoFocus
        type={field === 'Contact No.' ? 'tel' : 'text'}
        inputMode={field === 'Contact No.' ? 'numeric' : undefined}
        maxLength={field === 'Contact No.' ? 10 : undefined}
        className="w-full h-full px-6 py-4 border-2 border-orange-500 outline-none font-black text-stone-700 bg-white"
        value={value}
        onChange={e => setValue(field === 'Contact No.' ? sanitizeMobileInput(e.target.value) : e.target.value)}
        onMouseDown={e => e.stopPropagation()}
        onBlur={() => {
           if (value !== initialValue) {
             onSave(id, field, value);
           }
           setIsEditing(false);
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setValue(initialValue);
            setIsEditing(false);
          }
        }}
      />
    );
  }

  return (
    <div 
      className={cn(
        "px-6 py-4 cursor-pointer select-none min-h-[56px] flex items-center", 
        isSelected ? "bg-orange-100 ring-2 ring-inset ring-orange-400" : "hover:bg-stone-50"
      )}
      onMouseDown={(e) => {
        if (e.button === 0) {
          onMouseDown?.(rowIdx, colIdx);
        }
      }}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={() => onMouseEnter?.(rowIdx, colIdx)}
      onContextMenu={(e) => onContextMenu?.(e, rowIdx, colIdx)}
    >
      <span className={cn("flex w-full text-sm font-bold text-stone-700 items-center justify-between", !value && "text-stone-300 italic text-xs")}>
        <span className="truncate flex-1">{value || `Add ${field}...`}</span>
        {badge}
      </span>
    </div>
  );
});

const formatValue = (val: any): string => {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object' && val.seconds !== undefined) {
    return new Date(val.seconds * 1000).toLocaleString();
  }
  return String(val);
};

const checkRowInSelection = (rIndex: number, selection: {startRow: number, startCol: number, endRow: number, endCol: number} | null) => {
  if (!selection) return false;
  const minRow = Math.min(selection.startRow, selection.endRow);
  const maxRow = Math.max(selection.startRow, selection.endRow);
  return rIndex >= minRow && rIndex <= maxRow;
};

const MemoizedTableRow = React.memo((props: any) => {
  const { d, rIndex, currentPage, itemsPerPage, allColumns, templeUsers, selectedDbEventId, dbAttendanceMap, totalEvents, selection, rowDragConfig, isOwner, isMentor, handleMouseDown, handleMouseEnter, handleUpdateFacilitator, handleAddToFacilitation, navigate, handleCellSave, handleDelete, handleCellContextMenu, handleToggleAttendance, handleDragTouchStart, handleDragTouchMove, handleDragTouchEnd, handleRowDragStartNative, handleRowDragOverNative, handleRowDragEndNative, attendanceColumnMeta, attendanceColumnMaps } = props;

  const rowRef = useRef<HTMLTableRowElement>(null);

  const isCellSelected = (rIdx: number, cIdx: number) => {
    if (!selection) return false;
    const { startRow, endRow, startCol, endCol } = selection;
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);
    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    return rIdx >= minRow && rIdx <= maxRow && cIdx >= minCol && cIdx <= maxCol;
  };

  const isRowDragTarget = rowDragConfig?.active && rowDragConfig.currentIndex === rIndex;
  const isRowDragSource = rowDragConfig?.active && rowDragConfig.draggedId === d.id;

  return (
    <tr 
      ref={rowRef}
      key={d.id} 
      data-row-idx={rIndex}
      draggable={false}
      onDragStart={(e) => {
        if (!rowRef.current?.draggable) {
          e.preventDefault();
          return;
        }
        if (e.dataTransfer) {
          e.dataTransfer.setData('text/plain', d.id);
          e.dataTransfer.effectAllowed = 'move';
        }
        setTimeout(() => {
          if (handleRowDragStartNative) handleRowDragStartNative(rIndex, d.id);
        }, 0);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        if (handleRowDragOverNative) handleRowDragOverNative(rIndex);
      }}
      onDragEnd={(e) => {
        if (handleRowDragEndNative) handleRowDragEndNative();
      }}
      onDrop={(e) => {
        e.preventDefault();
      }}
      className={cn(
        "group transition-colors duration-150", 
        d.duplicateType === 'complete' ? "bg-red-500 text-white" : 
        d.duplicateType === 'partial_name' ? "bg-sky-400 text-stone-900" : 
        d.duplicateType === 'partial_contact' ? "bg-green-400 text-stone-900" : "",
        isRowDragTarget && !isRowDragSource ? "border-t-2 border-blue-500 bg-blue-50/20" : "",
        isRowDragSource ? "opacity-30 bg-blue-50 relative pointer-events-none" : ""
      )}
    >
      <td className={cn(
        "px-4 py-3 w-16 text-center border-r text-xs font-black select-none cursor-grab transition-colors",
        rowDragConfig?.active && isRowDragSource ? "cursor-grabbing bg-blue-50" : "cursor-grab hover:bg-stone-50",
        d.duplicateType ? "border-white/20 text-white/80" : "border-stone-50 text-stone-300",
        isCellSelected(rIndex, -1) && "bg-orange-100"
      )}
      onMouseDown={(e) => {
        if (rowRef.current) rowRef.current.draggable = true;
        props.handleIndexMouseDown(e, rIndex, d.id);
      }}
      onMouseEnter={() => {
        if (rowRef.current) rowRef.current.draggable = true;
        props.handleIndexMouseEnter(rIndex);
      }}
      onMouseLeave={() => {
        if (rowRef.current) rowRef.current.draggable = false;
      }}
      onTouchStart={(e) => handleDragTouchStart?.(e, rIndex, d.id)}
      onTouchMove={(e) => handleDragTouchMove?.(e)}
      onTouchEnd={(e) => handleDragTouchEnd?.(e)}
      onTouchCancel={(e) => handleDragTouchEnd?.(e)}
      >
        <div className="flex flex-col items-center justify-center gap-1 pointer-events-none relative h-8">
          <span className={cn(
            "font-mono text-[11px] font-black transition-opacity duration-200 group-hover:opacity-0",
            d.duplicateType ? "text-white" : "text-stone-300"
          )}>
            {((currentPage - 1) * itemsPerPage + rIndex + 1).toString().padStart(2, '0')}
          </span>
          <GripHorizontal size={16} className="absolute opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-stone-400" />
          {d.duplicateType === 'complete' && <div className="absolute bottom-0 w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />}
          {(d.duplicateType === 'partial_contact' || d.duplicateType === 'partial_name') && <div className="absolute bottom-0 w-1.5 h-1.5 bg-amber-400 rounded-full" />}
        </div>
      </td>
      {allColumns.map((col: string, cIndex: number) => {
        if (col === 'Mentor') {
          const mentorVal = d.mentor || (d as any).Mentor || '';
          const authorizedMentors = templeUsers.filter((u: any) => u.role === 'MENTOR');
          return (
            <td 
              key={col} 
              data-row-idx={rIndex}
              data-col-idx={cIndex}
              className={cn("px-6 py-3 border-r border-stone-50", isCellSelected(rIndex, cIndex) && "bg-orange-100/50")}
              onMouseDown={() => handleMouseDown(rIndex, cIndex)}
              onMouseEnter={() => handleMouseEnter(rIndex, cIndex)}
              onContextMenu={(e) => handleCellContextMenu(e, rIndex, cIndex)}
            >
               <select 
                 value={mentorVal} 
                 onChange={(e) => handleCellSave(d.id!, 'Mentor', e.target.value)} 
                 onMouseDown={e => e.stopPropagation()}
                 onPointerDown={e => e.stopPropagation()}
                 className="w-full bg-transparent border border-stone-100 px-4 py-2 rounded-xl text-xs font-bold text-stone-600 outline-none cursor-pointer hover:border-orange-200 transition-all tracking-tight"
               >
                 <option value="">Add Mentor...</option>
                 {mentorVal && !authorizedMentors.find((u: any) => (u.displayName || u.email) === mentorVal) && (
                   <option value={mentorVal}>{mentorVal} (Unknown/Deleted)</option>
                 )}
                 {authorizedMentors.map((u: any) => <option key={u.uid} value={u.displayName || u.email}>{u.displayName || u.email}</option>)}
               </select>
            </td>
          );
        }
        if (col === 'Facilitator') {
          return (
            <td 
              key={col} 
              data-row-idx={rIndex}
              data-col-idx={cIndex}
              className={cn("px-6 py-3 border-r border-stone-50", isCellSelected(rIndex, cIndex) && "bg-orange-100/50")}
              onMouseDown={() => handleMouseDown(rIndex, cIndex)}
              onMouseEnter={() => handleMouseEnter(rIndex, cIndex)}
              onContextMenu={(e) => handleCellContextMenu(e, rIndex, cIndex)}
            >
               <select 
                 value={d.facilitatorId || ''} 
                 onChange={(e) => handleUpdateFacilitator(d.id!, e.target.value)} 
                 onMouseDown={e => e.stopPropagation()}
                 onPointerDown={e => e.stopPropagation()}
                 className="w-full bg-transparent border border-stone-100 px-4 py-2 rounded-xl text-xs font-bold text-stone-600 outline-none cursor-pointer hover:border-orange-200 transition-all tracking-tight"
               >
                 <option value="">Select Facilitator</option>
                 {d.facilitatorId && !templeUsers.find((u: any) => u.uid === d.facilitatorId) && (
                   <option value={d.facilitatorId}>{d.facilitatorName || 'Unknown/Deleted'}</option>
                 )}
                 {templeUsers.map((u: any) => <option key={u.uid} value={u.uid}>{u.displayName || u.email}</option>)}
               </select>
            </td>
          );
        }
        if (col === 'Profile') {
          return (
            <td 
              key={col} 
              data-row-idx={rIndex}
              data-col-idx={cIndex}
              className={cn("px-6 py-3 border-r border-stone-50 text-center", isCellSelected(rIndex, cIndex) && "bg-orange-100/50")}
              onMouseDown={() => handleMouseDown(rIndex, cIndex)}
              onMouseEnter={() => handleMouseEnter(rIndex, cIndex)}
              onContextMenu={(e) => handleCellContextMenu(e, rIndex, cIndex)}
            >
              <Link 
                  to={`/profile/${d.id}`}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="text-[10px] font-black uppercase tracking-[0.2em] bg-orange-50 text-orange-600 hover:bg-orange-500 hover:text-white px-4 py-2 rounded-xl transition-all border border-orange-100 hover:border-orange-500 active:scale-95 shadow-sm inline-block"
              >
                Profile
              </Link>
            </td>
          );
        }
        let val = '';
        if (col === 'Name') val = d.name || (d as any).Name || '';
        else if (col === 'Age') val = (d.age ?? (d as any).Age ?? '').toString();
        else if (col === 'Gender') val = d.gender || (d as any).Gender || '';
        else if (col === 'Date of Birth') val = d.dob || (d as any)['Date of Birth'] || '';
        else if (col === 'Address') val = d.address || (d as any).Address || '';
        else if (col === 'Institute') val = d.institute || (d as any).Institute || '';
        else if (col === 'Mentor') val = d.mentor || (d as any).Mentor || '';
        else if (col === 'Facilitator') val = d.facilitatorName || d.facilitator || (d as any).Facilitator || '';
        else if (col === 'Chanting') val = (d.chanting ?? (d as any).Chanting ?? '').toString();
        else if (col === 'Contact No.') val = d.contact || (d as any)['Contact No.'] || '';
        else if (col === 'Attendance') val = `[${d.attendanceCount || 0} / ${totalEvents || 0}]`;
        else {
          const raw = (d as any)[col];
          val = formatValue(raw);
        }
        const isNumeric = col === 'Age' || col === 'Chanting' || col === 'Attendance';
        
        if (col === 'Attendance') {
          if (selectedDbEventId === 'NONE') {
            return (
              <td key={col} className="p-0 border-r border-stone-50 font-mono">
                <EditableCell 
                  id={d.id!} 
                  field={col} 
                  initialValue={val} 
                  onSave={handleCellSave}
                  onMouseDown={handleMouseDown}
                  onMouseEnter={handleMouseEnter}
                  onContextMenu={handleCellContextMenu}
                  isSelected={isCellSelected(rIndex, cIndex)}
                  rowIdx={rIndex}
                  colIdx={cIndex}
                />
              </td>
            );
          }

          return (
            <td 
              key={col} 
              data-row-idx={rIndex}
              data-col-idx={cIndex}
              className={cn("px-6 py-3 border-r border-stone-50 text-center font-bold relative group/att cursor-pointer", isCellSelected(rIndex, cIndex) && "bg-orange-100/50")}
              onMouseDown={(e) => {
                if (e.button === 0) handleMouseDown(rIndex, cIndex);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                handleToggleAttendance(d.id!);
              }}
              onMouseEnter={() => handleMouseEnter(rIndex, cIndex)}
              onContextMenu={(e) => handleCellContextMenu(e, rIndex, cIndex)}
            >
                <div className="flex items-center justify-center gap-2">
                  <span className={cn(
                    "w-6 h-6 flex items-center justify-center rounded-lg text-[10px] font-black uppercase",
                    dbAttendanceMap[d.id!] ? "bg-green-100 text-green-700" : (Object.keys(dbAttendanceMap).length > 0 ? "bg-red-50 text-red-400" : "bg-stone-50 text-stone-400")
                  )}>
                    {dbAttendanceMap[d.id!] ? 'P' : (Object.keys(dbAttendanceMap).length > 0 ? 'A' : '-')}
                  </span>
                  <div className="absolute inset-x-0 bottom-0 py-0.5 bg-orange-400 text-[8px] text-white opacity-0 group-hover/att:opacity-100 transition-opacity font-black uppercase">Double click to Toggle</div>
                </div>
            </td>
          );
        }

        if (attendanceColumnMeta && attendanceColumnMeta[col]) {
          const fixedEventId = attendanceColumnMeta[col].eventId;
          const fixedMap = (attendanceColumnMaps && attendanceColumnMaps[fixedEventId]) || {};
          const hasLoaded = Object.keys(fixedMap).length > 0;
          return (
            <td 
              key={col} 
              data-row-idx={rIndex}
              data-col-idx={cIndex}
              className={cn("px-6 py-3 border-r border-stone-50 text-center font-bold", isCellSelected(rIndex, cIndex) && "bg-orange-100/50")}
              onMouseDown={(e) => { if (e.button === 0) handleMouseDown(rIndex, cIndex); }}
              onMouseEnter={() => handleMouseEnter(rIndex, cIndex)}
              onContextMenu={(e) => handleCellContextMenu(e, rIndex, cIndex)}
            >
              <div className="flex items-center justify-center">
                <span className={cn(
                  "w-6 h-6 flex items-center justify-center rounded-lg text-[10px] font-black uppercase",
                  fixedMap[d.id!] ? "bg-green-100 text-green-700" : (hasLoaded ? "bg-red-50 text-red-400" : "bg-stone-50 text-stone-400")
                )}>
                  {fixedMap[d.id!] ? 'P' : (hasLoaded ? 'A' : '-')}
                </span>
              </div>
            </td>
          );
        }

        return (
          <td 
            key={col} 
            data-row-idx={rIndex}
            data-col-idx={cIndex}
            className={cn("p-0 border-r border-stone-50 transition-colors focus-within:ring-inset focus-within:ring-2 focus-within:ring-orange-200", isNumeric && "font-mono")}
          >
            <EditableCell 
              id={d.id!} 
              field={col} 
              initialValue={val} 
              onSave={handleCellSave}
              onMouseDown={handleMouseDown}
              onMouseEnter={handleMouseEnter}
              onContextMenu={handleCellContextMenu}
              isSelected={isCellSelected(rIndex, cIndex)}
              rowIdx={rIndex}
              colIdx={cIndex}
              badge={col === 'Name' && checkIsNew(d.createdAt, d.isImported) ? <span className="ml-2 px-2 py-0.5 text-[10px] font-bold bg-green-100 text-green-700 border border-green-200 rounded-full animate-pulse uppercase tracking-wider flex-shrink-0">New</span> : undefined}
            />
          </td>
        );
      })}
      {(isOwner || isMentor) && (
        <td className="px-6 py-3 text-center">
          <div className="flex items-center justify-center gap-2">
            <div className="relative group/menu inline-block">
              <button className="p-2 hover:bg-stone-50 rounded-xl text-stone-400 transition-all"><MoreVertical size={18} /></button>
              <div className="absolute right-0 top-full mt-1 bg-white border border-stone-100 shadow-xl rounded-xl py-2 w-48 z-[70] hidden group-hover/menu:block">
                <button onClick={() => handleAddToFacilitation(d.id!)} className="w-full text-left px-4 py-2 text-[10px] font-black uppercase text-stone-600 hover:bg-stone-50 hover:text-saffron flex items-center gap-2 transition-colors"><Heart size={14} /> Add to Facilitation</button>
                <button onClick={() => navigate(`/profile/${d.id}`)} className="w-full text-left px-4 py-2 text-[10px] font-black uppercase text-stone-600 hover:bg-stone-50 hover:text-saffron flex items-center gap-2 transition-colors"><User size={14} /> View Profile</button>
              </div>
            </div>
            <button onClick={() => handleDelete(d.id!)} className="text-stone-300 hover:text-red-500 p-2.5 transition-all hover:bg-red-50 rounded-xl active:scale-90" title="Delete row"><Trash2 size={18} /></button>
          </div>
        </td>
      )}
    </tr>
  );
}, (prev, next) => {
  if (
    prev.d !== next.d ||
    prev.rIndex !== next.rIndex ||
    prev.currentPage !== next.currentPage ||
    prev.itemsPerPage !== next.itemsPerPage ||
    prev.allColumns !== next.allColumns ||
    prev.templeUsers !== next.templeUsers ||
    prev.selectedDbEventId !== next.selectedDbEventId ||
    prev.dbAttendanceMap[prev.d.id] !== next.dbAttendanceMap[next.d.id] ||
    prev.totalEvents !== next.totalEvents ||
    prev.attendanceColumnMeta !== next.attendanceColumnMeta ||
    prev.attendanceColumnMaps !== next.attendanceColumnMaps ||
    prev.isOwner !== next.isOwner ||
    prev.isMentor !== next.isMentor
  ) {
    return false;
  }

  const wasRowDragTarget = prev.rowDragConfig?.active && prev.rowDragConfig.currentIndex === prev.rIndex;
  const isRowDragTarget = next.rowDragConfig?.active && next.rowDragConfig.currentIndex === next.rIndex;
  const wasRowDragSource = prev.rowDragConfig?.active && prev.rowDragConfig.draggedId === prev.d.id;
  const isRowDragSource = next.rowDragConfig?.active && next.rowDragConfig.draggedId === next.d.id;

  if (wasRowDragTarget !== isRowDragTarget || wasRowDragSource !== isRowDragSource) {
    return false;
  }

  const wasSelected = checkRowInSelection(prev.rIndex, prev.selection);
  const isSelected = checkRowInSelection(next.rIndex, next.selection);

  if (wasSelected || isSelected) {
    if (prev.selection && next.selection) {
      if (
        prev.selection.startRow === next.selection.startRow &&
        prev.selection.startCol === next.selection.startCol &&
        prev.selection.endRow === next.selection.endRow &&
        prev.selection.endCol === next.selection.endCol
      ) {
        return true; // selection bounds are effectively the same
      } else {
        return false;
      }
    }
    return false;
  }

  return true; // No relevant prop changed, skip render
});

const DatabaseManagement: React.FC = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const isOwner = profile?.role === 'OWNER';
  const isMentor = profile?.role === 'MENTOR';
  
  const [devotees, setDevotees] = useState<Devotee[]>([]);
  const [totalEvents, setTotalEvents] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState<{key: string, direction: 'asc' | 'desc'} | null>({ key: 'Name', direction: 'asc' });
  const [showDuplicatesOnly, setShowDuplicatesOnly] = useState(false);
  const [duplicateFilterType, setDuplicateFilterType] = useState<'contact' | 'name' | 'complete'>('contact');
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
  const [sheets, setSheets] = useState<string[]>(['Main Database']);
  const [currentSheet, setCurrentSheet] = useState('Main Database');
  const [customColumns, setCustomColumns] = useState<string[]>([]);
  const [preventDuplicates, setPreventDuplicates] = useState(true);
  const [autoDeduplicateOnImport, setAutoDeduplicateOnImport] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [warningType, setWarningType] = useState<'contact' | 'name' | 'complete' | null>(null);
  const [templeUsers, setTempleUsers] = useState<any[]>([]);
  const [isWarningDismissed, setIsWarningDismissed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);

  // New States for requested features
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [redoStack, setRedoStack] = useState<any[]>([]);
  const [selection, setSelection] = useState<{startRow: number, startCol: number, endRow: number, endCol: number} | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);
  const isDraggingCellRef = useRef(false);
  const [isSelectingPending, setIsSelectingPending] = useState(false);
  const mouseDownPosRef = useRef<{x: number, y: number} | null>(null);
  const [rowDragConfig, setRowDragConfig] = useState<{ active: boolean, startIndex: number, currentIndex: number, draggedId?: string } | null>(null);
  const [columnOrder, setColumnOrder] = useState<string[]>([]);

  // Persistent column order loading (Moved to use templeId as key)
  useEffect(() => {
    if (profile?.templeId) {
      const savedOrder = localStorage.getItem(`col_order_${profile.templeId}`);
      if (savedOrder) {
        try {
          const parsed = JSON.parse(savedOrder);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setColumnOrder(parsed);
          }
        } catch (e) {
          console.error("Failed to parse saved column order", e);
        }
      }
    }
  }, [profile?.templeId]);

  // Sync columnOrder to localStorage
  useEffect(() => {
    if (profile?.templeId && columnOrder.length > 0) {
      localStorage.setItem(`col_order_${profile.templeId}`, JSON.stringify(columnOrder));
    }
  }, [columnOrder, profile?.templeId]);

  // Metadata for duplicated "Attendance" columns: maps a column name -> the fixed
  // event it snapshots. Kept OUT of devotee Firestore docs on purpose, so delete
  // works cleanly and never touches the real "Attendance" column.
  const [attendanceColumnMeta, setAttendanceColumnMeta] = useState<Record<string, { eventId: string, eventTitle: string }>>({});
  const [attendanceColumnMaps, setAttendanceColumnMaps] = useState<Record<string, Record<string, boolean>>>({});

  useEffect(() => {
    if (profile?.templeId) {
      const saved = localStorage.getItem(`attendance_cols_${profile.templeId}`);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed && typeof parsed === 'object') setAttendanceColumnMeta(parsed);
        } catch (e) {
          console.error("Failed to parse saved attendance columns", e);
        }
      }
    }
  }, [profile?.templeId]);

  useEffect(() => {
    if (profile?.templeId) {
      localStorage.setItem(`attendance_cols_${profile.templeId}`, JSON.stringify(attendanceColumnMeta));
    }
  }, [attendanceColumnMeta, profile?.templeId]);

  // Live P/A map for every event referenced by a duplicated Attendance column
  useEffect(() => {
    const eventIds = Array.from(new Set(Object.values(attendanceColumnMeta).map(m => m.eventId)));
    if (eventIds.length === 0) return;
    const unsubs = eventIds.map(eventId => 
      onSnapshot(collection(db, `events/${eventId}/attendance`), snap => {
        const map: Record<string, boolean> = {};
        snap.forEach(d => { map[d.id] = true; });
        setAttendanceColumnMaps(prev => ({ ...prev, [eventId]: map }));
      })
    );
    return () => unsubs.forEach(u => u());
  }, [attendanceColumnMeta]);
  const [draggedColumnIdx, setDraggedColumnIdx] = useState<number | null>(null);
  const [colContextMenu, setColContextMenu] = useState<{x: number, y: number, col: string, colIdx: number, isOpen: boolean} | null>(null);
  const rowDragTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [contextMenu, setContextMenu] = useState<{x: number, y: number, isOpen: boolean} | null>(null);
  const [showShiftMenu, setShowShiftMenu] = useState(false);
  const [zoom, setZoom] = useState(100);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollIntervalRef = useRef<number | null>(null);
  const pointerPosRef = useRef<{x: number, y: number}>({ x: 0, y: 0 });

  // Persistence logic for history
  useEffect(() => {
    if (!profile?.templeId) return;

    // Use subcollection to avoid requiring composite indexes for orderBy + where
    const historyQuery = query(
      collection(db, 'temples', profile.templeId, 'history'),
      orderBy('createdAt', 'desc'),
      limit(150)
    );

    const unsubHistory = onSnapshot(historyQuery, (snap) => {
      const allDocs = snap.docs.map(d => {
        const data = d.data();
        return { 
          historyDocId: d.id, 
          ...data,
          isUndone: data.isUndone ?? false,
          // Ensure we have a timestamp for sorting
          createdAtTs: data.createdAt?.toMillis?.() || (data.createdAt instanceof Date ? data.createdAt.getTime() : (typeof data.createdAt === 'number' ? data.createdAt : Date.now())),
          undoneAtTs: data.undoneAt?.toMillis?.() || (data.undoneAt instanceof Date ? data.undoneAt.getTime() : (typeof data.undoneAt === 'number' ? data.undoneAt : 0))
        };
      });
      
      const hs = allDocs
        .filter(d => !d.isUndone)
        .sort((a, b) => b.createdAtTs - a.createdAtTs)
        .slice(0, 100)
        .reverse(); // So newest is at end of array
      
      const rs = allDocs
        .filter(d => d.isUndone)
        .sort((a, b) => b.undoneAtTs - a.undoneAtTs)
        .slice(0, 50);

      setHistory(hs);
      setRedoStack(rs);
    }, (error) => {
      console.error("History listener error:", error);
    });

    return () => unsubHistory();
  }, [profile?.templeId]);

  const recordActivity = useCallback(async (action: any) => {
    if (!profile?.templeId) return;
    try {
      await addDoc(collection(db, 'temples', profile.templeId, 'history'), {
        ...action,
        templeId: profile.templeId,
        userId: profile.uid,
        userName: profile.displayName || 'Anonymous',
        createdAt: serverTimestamp(),
        isUndone: false
      });
    } catch (e) {
      console.error("Failed to log activity:", e);
    }
  }, [profile]);

  const handleMouseEnter = useCallback((rIdx: number, cIdx: number) => {
    if (rowDragConfig?.active) {
      setRowDragConfig(prev => {
        if (prev && prev.currentIndex !== rIdx) {
          return { ...prev, currentIndex: rIdx };
        }
        return prev;
      });
      return;
    }
    if (isDraggingCellRef.current) {
      setSelection(prev => {
        if (!prev) return { startRow: rIdx, startCol: cIdx, endRow: rIdx, endCol: cIdx };
        if (prev.endRow === rIdx && prev.endCol === cIdx) return prev;
        return { ...prev, endRow: rIdx, endCol: cIdx };
      });
    }
  }, [rowDragConfig?.active]);

   useEffect(() => {
    const handleMouseMove = (e: MouseEvent | DragEvent) => {
      pointerPosRef.current = { x: e.clientX, y: e.clientY };
      
      if (mouseDownPosRef.current && !isDraggingRef.current && !isDraggingCellRef.current && !rowDragConfig?.active) {
        const dx = e.clientX - mouseDownPosRef.current.x;
        const dy = e.clientY - mouseDownPosRef.current.y;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          if (!rowDragConfig?.active && isSelectingPending) {
            isDraggingCellRef.current = true;
          }
          setIsDragging(true);
          isDraggingRef.current = true;
        }
      }

      // Real-time element detection to ensure "mid-scroll" or fast movement selection works
      if (isDraggingCellRef.current || rowDragConfig?.active) {
        const element = document.elementFromPoint(e.clientX, e.clientY);
        const cell = element?.closest('[data-row-idx]');
        if (cell) {
          const rIdx = parseInt(cell.getAttribute('data-row-idx') || '-1', 10);
          const cIdx = parseInt(cell.getAttribute('data-col-idx') || '-1', 10);
          if (rIdx >= 0) {
            handleMouseEnter(rIdx, cIdx);
          }
        }
      }
    };
    
    if (isDragging || rowDragConfig?.active || isSelectingPending) {
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('dragover', handleMouseMove as any);
      
      const scrollStep = () => {
        if ((isDraggingCellRef.current || rowDragConfig?.active) && scrollContainerRef.current) {
          const container = scrollContainerRef.current;
          const rect = container.getBoundingClientRect();
          const edgeThreshold = 100; 
          const { x, y } = pointerPosRef.current;
          
          let scrollX = 0;
          let scrollY = 0;

          const maxSpeed = 35;

          if (x < rect.left + edgeThreshold) {
            scrollX = -((rect.left + edgeThreshold - x) / edgeThreshold) * maxSpeed;
          } else if (x > rect.right - edgeThreshold) {
            scrollX = ((x - (rect.right - edgeThreshold)) / edgeThreshold) * maxSpeed;
          }

          if (y < rect.top + edgeThreshold) {
            scrollY = -((rect.top + edgeThreshold - y) / edgeThreshold) * maxSpeed;
          } else if (y > rect.bottom - edgeThreshold) {
            scrollY = ((y - (rect.bottom - edgeThreshold)) / edgeThreshold) * maxSpeed;
          }

          if (scrollX !== 0 || scrollY !== 0) {
            container.scrollBy(scrollX, scrollY);
            
            const element = document.elementFromPoint(x, y);
            const cell = element?.closest('[data-row-idx]');
            if (cell) {
               const rIdx = parseInt(cell.getAttribute('data-row-idx') || '-1', 10);
               const cIdx = parseInt(cell.getAttribute('data-col-idx') || '-1', 10);
               if (rIdx >= 0) {
                 handleMouseEnter(rIdx, cIdx);
               }
            }
          }
        }
        scrollIntervalRef.current = requestAnimationFrame(scrollStep);
      };
      scrollIntervalRef.current = requestAnimationFrame(scrollStep);
    }

    return () => {
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('dragover', handleMouseMove as any);
      if (scrollIntervalRef.current) {
        cancelAnimationFrame(scrollIntervalRef.current);
        scrollIntervalRef.current = null;
      }
    };
  }, [isDragging, rowDragConfig?.active, isSelectingPending, handleMouseEnter]);

  const handleToggleAttendance = async (devoteeId: string) => {
    if (selectedDbEventId === 'NONE' || !profile?.templeId) return;
    
    try {
      const recordRef = doc(db, `events/${selectedDbEventId}/attendance`, devoteeId);
      const isPresent = dbAttendanceMap[devoteeId];
      
      if (isPresent) {
        try {
          await deleteDoc(recordRef);
          await updateDoc(doc(db, 'devotees', devoteeId), { 
            attendanceCount: increment(-1),
            updatedAt: serverTimestamp()
          });
        } catch (err: any) {
          if (err.code !== 'not-found' && !err.message?.includes('No document to update')) {
            console.error("Error updating devotee attendance count:", err);
          }
        }
      } else {
        try {
          await setDoc(recordRef, { 
            devoteeId,
            present: true,
            markedAt: new Date().toISOString(),
            markedBy: profile.uid,
            templeId: profile.templeId
          });
          await updateDoc(doc(db, 'devotees', devoteeId), { 
            attendanceCount: increment(1),
            updatedAt: serverTimestamp()
          });
        } catch (err: any) {
          if (err.code !== 'not-found' && !err.message?.includes('No document to update')) {
            console.error("Error updating devotee attendance count:", err);
          }
        }
      }
    } catch (err) {
      console.error("Error toggling attendance:", err);
    }
  };
  
  const devoteesRef = useRef(devotees);
  useEffect(() => { devoteesRef.current = devotees; }, [devotees]);

  const handleCellSave = useCallback(async (id: string, field: string, value: string, recordHistory = true) => {
    try {
      if (field === 'Contact No.' && value && !isValidMobileNumber(value)) {
        alert("Please enter a valid 10-digit mobile number.");
        return;
      }
      const dbField = field === 'Name' ? 'name' : field === 'Age' ? 'age' : field === 'Mentor' ? 'mentor' : field === 'Chanting' ? 'chanting' : field === 'Contact No.' ? 'contact' : field === 'Gender' ? 'gender' : field === 'Date of Birth' ? 'dob' : field === 'Address' ? 'address' : field === 'Institute' ? 'institute' : field === 'Facilitator' ? 'facilitatorName' : field;
      let finalVal = value;
      if (field === 'Contact No.') finalVal = normalizePhoneNumber(value);

      const targetDevotee = devoteesRef.current.find(d => d.id === id);
      
      let oldValue = '';
      if (targetDevotee) {
        if (dbField === 'name') oldValue = targetDevotee.name || (targetDevotee as any).Name || '';
        else if (dbField === 'contact') oldValue = targetDevotee.contact || (targetDevotee as any)['Contact No.'] || '';
        else if (dbField === 'age') oldValue = targetDevotee.age?.toString() ?? (targetDevotee as any).Age?.toString() ?? '';
        else if (dbField === 'mentor') oldValue = targetDevotee.mentor || (targetDevotee as any).Mentor || '';
        else if (dbField === 'chanting') oldValue = targetDevotee.chanting?.toString() ?? (targetDevotee as any).Chanting?.toString() ?? '';
        else if (dbField === 'gender') oldValue = targetDevotee.gender || (targetDevotee as any).Gender || '';
        else if (dbField === 'dob') oldValue = targetDevotee.dob || (targetDevotee as any)['Date of Birth'] || '';
        else if (dbField === 'address') oldValue = targetDevotee.address || (targetDevotee as any).Address || '';
        else if (dbField === 'institute') oldValue = targetDevotee.institute || (targetDevotee as any).Institute || '';
        else if (dbField === 'facilitatorName') oldValue = targetDevotee.facilitatorName || targetDevotee.facilitator || (targetDevotee as any).Facilitator || '';
        else oldValue = (targetDevotee as any)[dbField]?.toString() ?? '';
      }

      if (recordHistory && oldValue !== finalVal) {
        recordActivity({ id, field: dbField, oldValue, newValue: finalVal });
      }
      const others = devoteesRef.current.filter(d => d.id !== id);
      
      const nameVal = field === 'Name' ? value : (targetDevotee?.name || (targetDevotee as any)?.Name || '');
      const contactVal = field === 'Contact No.' ? normalizePhoneNumber(value) : (targetDevotee?.contact || (targetDevotee as any)?.['Contact No.'] || '');
      
      const nLow = nameVal.trim().toLowerCase();
      const cNorm = normalizePhoneNumber(contactVal);

      if (nLow !== 'new devotee') {
        let warning: string | null = null;
        for (const other of others) {
          const onLow = (other.name || (other as any).Name || '').trim().toLowerCase();
          const ocNorm = normalizePhoneNumber(other.contact || (other as any)['Contact No.'] || '');
          
          if (onLow === 'new devotee') continue;
          
          if (nLow === onLow && cNorm === ocNorm) { warning = 'Devotee Already Exists'; break; }
          if (cNorm === ocNorm && nLow !== onLow && cNorm !== '') { warning = 'Duplicate Contact Found'; break; }
          if (nLow === onLow && cNorm !== ocNorm && nLow !== '') { warning = 'Duplicate Name Found'; break; }
        }
        if (warning) {
          setDuplicateWarning(warning);
        }
      }

      try {
        await updateDoc(doc(db, 'devotees', id), { 
          [dbField]: finalVal,
          updatedAt: serverTimestamp()
        });
      } catch (err: any) {
        if (err.code !== 'not-found' && !err.message?.includes('No document to update')) {
          throw err;
        }
        console.warn(`Document ${id} not found, skipping update.`);
      }
    } catch (error) {
      console.error('Update error:', error);
    }
  }, [recordActivity]);

  const handleDeleteColumn = async (colName: string, recordHistory = true) => {
    try {
      if (attendanceColumnMeta[colName]) {
        setAttendanceColumnMeta(prev => {
          const next = { ...prev };
          delete next[colName];
          return next;
        });
        setColumnOrder(prev => prev.filter(c => c !== colName));
        return;
      }

      const devoteesToUpdate = devotees.filter(d => d[colName] !== undefined);
      const oldValues: Record<string, any> = {};
      devoteesToUpdate.forEach(d => {
        oldValues[d.id!] = d[colName];
      });

      if (recordHistory) {
        recordActivity({ type: 'deleteColumn', name: colName, oldValues });
      }

      const batch = writeBatch(db);
      devoteesToUpdate.forEach(d => {
        batch.set(doc(db, 'devotees', d.id!), {
          [colName]: deleteField()
        }, { merge: true });
      });
      await batch.commit();
      setCustomColumns(prev => prev.filter(c => c !== colName));
    } catch(err) {
      console.error('Delete column error:', err);
    }
  };

  const handleDuplicateColumn = async (colName: string) => {
    if (colName === 'Profile' || !profile?.templeId) return;

    if (colName === 'Attendance') {
      if (selectedDbEventId === 'NONE') {
        openAlert('Select an Event First', 'Please select an event in the Attendance column dropdown before duplicating it, so the new column knows which event to show.');
        return;
      }
      const event = dbAttendanceEvents.find(e => e.id === selectedDbEventId);
      const eventTitle = event?.title || 'Event';
      let newColName = `Attendance - ${eventTitle}`;
      let suffix = 2;
      while (allColumns.includes(newColName) || attendanceColumnMeta[newColName]) {
        newColName = `Attendance - ${eventTitle} (${suffix})`;
        suffix++;
      }

      setAttendanceColumnMeta(prev => ({ ...prev, [newColName]: { eventId: selectedDbEventId, eventTitle } }));
      setColumnOrder(prev => {
        const base = prev.length > 0 ? prev : allColumns;
        const idx = base.indexOf(colName);
        const next = [...base];
        if (idx === -1) { next.push(newColName); return next; }
        next.splice(idx + 1, 0, newColName);
        return next;
      });
      setColContextMenu(null);
      return;
    }

    let newColName = `${colName} Copy`;
    let suffix = 2;
    while (allColumns.includes(newColName)) {
      newColName = `${colName} Copy ${suffix}`;
      suffix++;
    }

    const getVal = (d: any) => {
      if (colName === 'Name') return d.name ?? d.Name ?? '';
      if (colName === 'Age') return d.age ?? d.Age ?? '';
      if (colName === 'Gender') return d.gender ?? d.Gender ?? '';
      if (colName === 'Date of Birth') return d.dob ?? d['Date of Birth'] ?? '';
      if (colName === 'Address') return d.address ?? d.Address ?? '';
      if (colName === 'Institute') return d.institute ?? d.Institute ?? '';
      if (colName === 'Mentor') return d.mentor ?? d.Mentor ?? '';
      if (colName === 'Facilitator') return d.facilitatorName ?? d.facilitator ?? d.Facilitator ?? '';
      if (colName === 'Chanting') return d.chanting ?? d.Chanting ?? '';
      if (colName === 'Contact No.') return d.contact ?? d['Contact No.'] ?? '';
      if (colName === 'Attendance') return d.attendanceCount ?? 0;
      return d[colName] ?? '';
    };

    const batch = writeBatch(db);
    devoteesRef.current.forEach(d => {
      batch.set(doc(db, 'devotees', d.id!), { [newColName]: getVal(d) }, { merge: true });
    });
    await batch.commit();

    setCustomColumns(prev => [...prev, newColName]);
    setColumnOrder(prev => {
      const base = prev.length > 0 ? prev : allColumns;
      const idx = base.indexOf(colName);
      const next = [...base];
      if (idx === -1) { next.push(newColName); return next; }
      next.splice(idx + 1, 0, newColName);
      return next;
    });
    setColContextMenu(null);
  };

  const handleUndo = async () => {
    if (history.length === 0) return;
    const lastAction = history[history.length - 1];
    
    // 48-hour limit check
    const actionTime = lastAction.createdAt ? (typeof lastAction.createdAt === 'number' ? lastAction.createdAt : (lastAction.createdAt.toMillis ? lastAction.createdAt.toMillis() : new Date(lastAction.createdAt).getTime())) : Date.now();
    const fortyEightHoursInMs = 48 * 60 * 60 * 1000;
    if (Date.now() - actionTime > fortyEightHoursInMs) {
      openAlert('Action Expired', 'Changes older than 48 hours cannot be undone.');
      return;
    }

    if (lastAction.historyDocId) {
       await updateDoc(doc(db, 'temples', profile.templeId, 'history', lastAction.historyDocId), {
         isUndone: true,
         undoneAt: serverTimestamp()
       });
    }
    
    if (lastAction.type === 'addRow') {
      const docRef = doc(db, 'devotees', lastAction.id);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        lastAction.data = snap.data();
      }
      await deleteDoc(docRef);
      return;
    }
    if (lastAction.type === 'addRows') {
      const dataMap: Record<string, any> = {};
      for (const id of lastAction.ids) {
        const docRef = doc(db, 'devotees', id);
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          dataMap[id] = snap.data();
        }
      }
      lastAction.dataMap = dataMap;
      const batch = writeBatch(db);
      lastAction.ids.forEach((id: string) => batch.delete(doc(db, 'devotees', id)));
      await batch.commit();
      return;
    }
    if (lastAction.type === 'moveRow') {
      try {
        if (lastAction.oldOrder !== undefined) {
          await updateDoc(doc(db, 'devotees', lastAction.id), { customOrder: lastAction.oldOrder });
        } else {
          await updateDoc(doc(db, 'devotees', lastAction.id), { createdAt: lastAction.oldTime });
        }
      } catch (err: any) {
        console.warn("Undo moveRow failed (doc missing):", err.message);
      }
      return;
    }
    if (lastAction.type === 'deleteDevotee') {
      try {
        await updateDoc(doc(db, 'devotees', lastAction.id), {
          isDeleted: false,
          deletedAt: deleteField()
        });
      } catch (err: any) {
        console.warn("Undo deleteDevotee failed (doc missing):", err.message);
      }
      return;
    }
    if (lastAction.type === 'bulkDeleteDevotees') {
      const batch = writeBatch(db);
      lastAction.ids.forEach((id: string) => {
        batch.set(doc(db, 'devotees', id), {
          isDeleted: false,
          deletedAt: deleteField()
        }, { merge: true });
      });
      await batch.commit();
      return;
    }
    if (lastAction.type === 'addColumn') {
      setCustomColumns(prev => prev.filter(c => c !== lastAction.name));
      return;
    }
    if (lastAction.type === 'deleteColumn') {
      const batch = writeBatch(db);
      Object.entries(lastAction.oldValues).forEach(([id, value]) => {
        batch.set(doc(db, 'devotees', id), {
          [lastAction.name]: value
        }, { merge: true });
      });
      await batch.commit();
      setCustomColumns(prev => [...prev, lastAction.name]);
      return;
    }
    if (lastAction.type === 'import') {
      const batch = writeBatch(db);
      Object.keys(lastAction.addedData).forEach(id => {
        batch.delete(doc(db, 'devotees', id));
      });
      lastAction.updatedData.forEach((item: any) => {
        batch.set(doc(db, 'devotees', item.id), item.oldValues, { merge: true });
      });
      await batch.commit();
      return;
    }
    if (lastAction.type === 'shiftCells') {
      const batch = writeBatch(db);
      Object.keys(lastAction.oldValues).forEach(devId => {
        batch.set(doc(db, 'devotees', devId), lastAction.oldValues[devId], { merge: true });
      });
      await batch.commit();
      return;
    }
    
    if (lastAction.type === 'moveColumn') {
      setColumnOrder(lastAction.oldOrder);
      return;
    }
    const prettyField = lastAction.field === 'name' ? 'Name' : 
                        lastAction.field === 'age' ? 'Age' : 
                        lastAction.field === 'mentor' ? 'Mentor' : 
                        lastAction.field === 'chanting' ? 'Chanting' : 
                        lastAction.field === 'contact' ? 'Contact No.' : 
                        lastAction.field === 'gender' ? 'Gender' :
                        lastAction.field === 'dob' ? 'Date of Birth' :
                        lastAction.field === 'address' ? 'Address' :
                        lastAction.field === 'institute' ? 'Institute' :
                        lastAction.field === 'facilitatorName' ? 'Facilitator' : lastAction.field;

    await handleCellSave(lastAction.id, prettyField, lastAction.oldValue, false);
  };

  const handleRedo = async () => {
    if (redoStack.length === 0) return;
    const nextAction = redoStack[0]; // Redo stack ordered by undoneAt desc, so 0 is most recent undone
    
    if (nextAction.historyDocId) {
      await updateDoc(doc(db, 'temples', profile.templeId, 'history', nextAction.historyDocId), {
        isUndone: false,
        undoneAt: deleteField()
      });
    }

    if (nextAction.type === 'moveColumn') {
      setColumnOrder(nextAction.newOrder);
      return;
    }
    if (nextAction.type === 'addRow') {
      const docRef = doc(db, 'devotees', nextAction.id);
      if (nextAction.data) {
        await setDoc(docRef, nextAction.data);
      } else {
        await setDoc(docRef, {
          name: 'New Devotee',
          templeId: profile?.templeId || '',
          isDeleted: false,
          createdAt: nextAction.newTime || Date.now()
        });
      }
      return;
    }
    if (nextAction.type === 'addRows') {
      const batch = writeBatch(db);
      nextAction.ids.forEach((id: string) => {
        const payload = nextAction.dataMap?.[id] || {
          name: 'New Devotee',
          templeId: profile?.templeId || '',
          isDeleted: false,
          createdAt: Date.now()
        };
        batch.set(doc(db, 'devotees', id), payload);
      });
      await batch.commit();
      return;
    }
    if (nextAction.type === 'moveRow') {
      try {
        if (nextAction.newOrder !== undefined) {
          await updateDoc(doc(db, 'devotees', nextAction.id), { customOrder: nextAction.newOrder });
        } else {
          await updateDoc(doc(db, 'devotees', nextAction.id), { createdAt: nextAction.newTime });
        }
      } catch (err: any) {
        console.warn("Redo moveRow failed (doc missing):", err.message);
      }
      return;
    }
    if (nextAction.type === 'deleteDevotee') {
      try {
        await updateDoc(doc(db, 'devotees', nextAction.id), {
          isDeleted: true,
          deletedAt: serverTimestamp()
        });
      } catch (err: any) {
        console.warn("Redo deleteDevotee failed (doc missing):", err.message);
      }
      return;
    }
    if (nextAction.type === 'bulkDeleteDevotees') {
      const batch = writeBatch(db);
      nextAction.ids.forEach((id: string) => {
        batch.set(doc(db, 'devotees', id), {
          isDeleted: true,
          deletedAt: serverTimestamp()
        }, { merge: true });
      });
      await batch.commit();
      return;
    }
    if (nextAction.type === 'addColumn') {
      setCustomColumns(prev => [...prev, nextAction.name]);
      return;
    }
    if (nextAction.type === 'deleteColumn') {
      const batch = writeBatch(db);
      Object.keys(nextAction.oldValues).forEach(id => {
        batch.set(doc(db, 'devotees', id), {
          [nextAction.name]: deleteField()
        }, { merge: true });
      });
      await batch.commit();
      setCustomColumns(prev => prev.filter(c => c !== nextAction.name));
      return;
    }
    if (nextAction.type === 'import') {
      const batch = writeBatch(db);
      Object.entries(nextAction.addedData).forEach(([id, data]) => {
        batch.set(doc(db, 'devotees', id), data);
      });
      nextAction.updatedData.forEach((item: any) => {
        batch.set(doc(db, 'devotees', item.id), item.newValues, { merge: true });
      });
      await batch.commit();
      return;
    }
    if (nextAction.type === 'shiftCells') {
      const batch = writeBatch(db);
      Object.keys(nextAction.updates).forEach(devId => {
        batch.set(doc(db, 'devotees', devId), nextAction.updates[devId], { merge: true });
      });
      await batch.commit();
      return;
    }

    const prettyField = nextAction.field === 'name' ? 'Name' : 
                        nextAction.field === 'age' ? 'Age' : 
                        nextAction.field === 'mentor' ? 'Mentor' : 
                        nextAction.field === 'chanting' ? 'Chanting' : 
                        nextAction.field === 'contact' ? 'Contact No.' : 
                        nextAction.field === 'gender' ? 'Gender' :
                        nextAction.field === 'dob' ? 'Date of Birth' :
                        nextAction.field === 'address' ? 'Address' :
                        nextAction.field === 'institute' ? 'Institute' :
                        nextAction.field === 'facilitatorName' ? 'Facilitator' : nextAction.field;

    await handleCellSave(nextAction.id, prettyField, nextAction.newValue, false);
  };

  useEffect(() => {
    if (duplicateWarning) {
      const timer = setTimeout(() => {
        setDuplicateWarning(null);
        setWarningType(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [duplicateWarning]);

  // Auto-delete complete duplicates logic
  useEffect(() => {
    if (!devotees.length || !isOwner) return;

    const checkAutoDelete = async () => {
      if (!autoDeduplicateOnImport) return; // Respect the toggle
      const now = new Date().getTime();
      const oneDayInMs = 24 * 60 * 60 * 1000;
      
      const completeGroups: { [key: string]: Devotee[] } = {};
      devotees.forEach(d => {
        const n = (d.name || (d as any).Name || '').trim().toLowerCase();
        const c = normalizePhoneNumber(d.contact || (d as any)['Contact No.'] || '');
        if (n && c) {
          const key = `${n}_${c}`;
          if (!completeGroups[key]) completeGroups[key] = [];
          completeGroups[key].push(d);
        }
      });

      const toDelete: string[] = [];
      Object.values(completeGroups).forEach(group => {
        if (group.length > 1) {
          const sorted = [...group].sort((a, b) => {
             const t1 = a.createdAt ? (typeof a.createdAt === 'string' ? new Date(a.createdAt).getTime() : (a.createdAt as any).seconds * 1000) : 0;
             const t2 = b.createdAt ? (typeof b.createdAt === 'string' ? new Date(b.createdAt).getTime() : (b.createdAt as any).seconds * 1000) : 0;
             return t1 - t2;
          });

          const duplicates = sorted.slice(1);
          duplicates.forEach(d => {
            const t = d.createdAt ? (typeof d.createdAt === 'string' ? new Date(d.createdAt).getTime() : (d.createdAt as any).seconds * 1000) : 0;
            if (now - t > oneDayInMs && !d.duplicateHandled) {
              toDelete.push(d.id!);
            }
          });
        }
      });

      if (toDelete.length > 0) {
        const batch = writeBatch(db);
        toDelete.forEach(id => {
          batch.set(doc(db, 'devotees', id), { 
            isDeleted: true, 
            deletedAt: serverTimestamp(),
            deletionReason: 'Auto-purge complete duplicate after 24h'
          }, { merge: true });
        });
        await batch.commit();
      }
    };

    checkAutoDelete();
  }, [devotees, isOwner, autoDeduplicateOnImport]);

  const [visibleCount, setVisibleCount] = useState(100);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [dbAttendanceEvents, setDbAttendanceEvents] = useState<Event[]>([]);
  const [selectedDbEventId, setSelectedDbEventId] = useState<string>('NONE');
  const [dbAttendanceMap, setDbAttendanceMap] = useState<Record<string, boolean>>({});

  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearchTerm(searchTerm), 300);
    return () => clearTimeout(t);
  }, [searchTerm]);

  // Reset infinite scroll when filters change
  useEffect(() => {
    setVisibleCount(100);
  }, [debouncedSearchTerm, showDuplicatesOnly, duplicateFilterType, sortConfig, currentSheet, isFullscreen]);

  useEffect(() => {
    if (profile?.templeId) {
      const q = query(
        collection(db, 'events'), 
        where('templeId', '==', profile.templeId),
        where('isDeleted', '==', false)
      );
      const unsub = onSnapshot(q, s => {
          const evts = s.docs.map(d => ({id: d.id, ...d.data()}) as Event);
          evts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
          setDbAttendanceEvents(evts);
          
          setSelectedDbEventId(current => {
            if (current !== 'NONE' && !evts.find(e => e.id === current)) {
              return 'NONE';
            }
            return current;
          });
      });
      return () => unsub();
    }
  }, [profile]);

  useEffect(() => {
    if (selectedDbEventId !== 'NONE') {
      const unsub = onSnapshot(collection(db, `events/${selectedDbEventId}/attendance`), snap => {
        const map: Record<string, boolean> = {};
        snap.forEach(d => { map[d.id] = true; });
        setDbAttendanceMap(map);
      });
      return () => unsub();
    } else {
      setDbAttendanceMap({});
    }
  }, [selectedDbEventId]);

  const [dialog, setDialog] = useState<{
    isOpen: boolean,
    title: string,
    message: string,
    onConfirm: (val?: string) => void,
    onCancel: () => void,
    type: 'alert' | 'confirm' | 'prompt',
    inputValue?: string
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
    onCancel: () => {},
    type: 'alert'
  });

  const openAlert = (title: string, message: string) => 
    setDialog({ isOpen: true, title, message, onConfirm: () => setDialog(d => ({...d, isOpen: false})), onCancel: () => setDialog(d => ({...d, isOpen: false})), type: 'alert' });

  const openConfirm = (title: string, message: string, onConfirm: () => void) =>
    setDialog({ isOpen: true, title, message, onConfirm: () => { onConfirm(); setDialog(d => ({...d, isOpen: false})); }, onCancel: () => setDialog(d => ({...d, isOpen: false})), type: 'confirm' });

  const openPrompt = (title: string, message: string, onConfirm: (val: string) => void) =>
    setDialog({ isOpen: true, title, message, onConfirm: (val) => { if(val) onConfirm(val); setDialog(d => ({...d, isOpen: false})); }, onCancel: () => setDialog(d => ({...d, isOpen: false})), type: 'prompt', inputValue: '' });

  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      // If we clicked outside the context menu and selection, clear it
      if (contextMenu?.isOpen && !isDragging) {
        setContextMenu(null);
      }
    };
    window.addEventListener('click', handleGlobalClick);
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    
    return () => {
      window.removeEventListener('click', handleGlobalClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu, isDragging, isFullscreen]);

  useEffect(() => {
    if (!profile?.templeId) return;

    const q = query(
      collection(db, 'devotees'),
      where('templeId', '==', profile.templeId)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs
        .map(doc => ({ 
          id: doc.id, 
          ...doc.data() 
        }))
        .filter((d: any) => !d.isDeleted) as Devotee[];
      
      setDevotees(data);

      const columns = new Set<string>();
      const internalKeys = [
        'id', 'name', 'age', 'attendanceCount', 'contact', 'mentor', 'chanting', 'facilitatorId',
        'templeId', 'isDeleted', 'deletedAt', 'duplicateType', 'duplicateHandled',
        'createdAt', 'facilitationResponse', 'facilitationResponseText', 'facilitationNotes',
        'address', 'gender', 'institute', 'dob', 'facilitatorName', 'assignedCount', 
        'sheetName', 'isDuplicate', 'duplicateCreatedAt', 'Age', 'Name', 'Mentor', 'Chanting', 'Contact No.'
      ];

      data.forEach(d => {
        Object.keys(d).forEach(key => {
          if (!internalKeys.includes(key) && !BASE_COLUMNS.includes(key)) {
            columns.add(key);
          }
        });
      });
      setCustomColumns(Array.from(columns));
    });

    const eventsUnsubscribe = onSnapshot(query(collection(db, 'events'), where('templeId', '==', profile.templeId)), (snap) => {
      const validCount = snap.docs.filter(d => !(d.data() as any).isDeleted).length;
      setTotalEvents(validCount);
    });
    
    const usersQuery = query(
      collection(db, 'users'),
      where('templeId', '==', profile.templeId)
    );
    const usersUnsubscribe = onSnapshot(usersQuery, (snap) => {
      const users = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
      // Use a Map to keep only unique uids and names (case-insensitive deduplication for name)
      const uniqueUsers: any[] = [];
      const seenNames = new Set();
      
      users.forEach((u: any) => {
        if (u.isDeleted) return;
        const nameKey = (u.displayName || u.email || '').toLowerCase().trim();
        if (!seenNames.has(nameKey)) {
          seenNames.add(nameKey);
          uniqueUsers.push(u);
        }
      });
      setTempleUsers(uniqueUsers);
    });

    return () => {
      unsubscribe();
      eventsUnsubscribe();
      usersUnsubscribe();
    };
  }, [profile?.templeId]);

  useEffect(() => {
    if (devotees.length > 0 || customColumns.length > 0) {
      const base = [...BASE_COLUMNS.filter(c => c !== 'Profile'), ...customColumns, 'Profile'];
      if (columnOrder.length === 0) {
        setColumnOrder(base);
      } else {
        const newOrder = [...columnOrder];
        // Add new columns that appeared in data
        base.forEach(c => {
          if (!newOrder.includes(c)) {
            // Insert before Profile
            const profileIdx = newOrder.indexOf('Profile');
            if (profileIdx !== -1) {
              newOrder.splice(profileIdx, 0, c);
            } else {
              newOrder.push(c);
            }
          }
        });
        // Remove columns no longer present
        const filtered = newOrder.filter(c => base.includes(c));
        if (JSON.stringify(filtered) !== JSON.stringify(columnOrder)) {
          setColumnOrder(filtered);
        }
      }
    }
  }, [customColumns, devotees.length, columnOrder]);

  const allColumns = useMemo(() => {
    if (columnOrder.length > 0) return columnOrder;
    return [...BASE_COLUMNS.filter(c => c !== 'Profile'), ...customColumns, 'Profile'];
  }, [columnOrder, customColumns]);

  const processedDevotees = useMemo(() => {
    const contactGroups: Record<string, number> = {};
    const nameGroups: Record<string, number> = {};
    const completeGroups: Record<string, number> = {};

    devotees.forEach(d => {
      const name = d.name || (d as any).Name || '';
      if (name === 'New Devotee') return; // Exclude placeholder
      
      const c = normalizePhoneNumber(d.contact || (d as any)['Contact No.'] || '');
      const n = name.trim().toLowerCase();
      const key = `${n}_${c}`;

      if (c) contactGroups[c] = (contactGroups[c] || 0) + 1;
      if (n) nameGroups[n] = (nameGroups[n] || 0) + 1;
      if (n && c) completeGroups[key] = (completeGroups[key] || 0) + 1;
    });

    return devotees.map(d => {
      const name = d.name || (d as any).Name || '';
      if (name === 'New Devotee') return { ...d, duplicateType: undefined };

      const c = normalizePhoneNumber(d.contact || (d as any)['Contact No.'] || '');
      const n = name.trim().toLowerCase();
      const key = `${n}_${c}`;
      
      let duplicateType: string | undefined = undefined;
      
      if (n && c && completeGroups[key] > 1) {
        duplicateType = 'complete';
      } else if (c && contactGroups[c] > 1) {
        duplicateType = 'partial_contact';
      } else if (n && nameGroups[n] > 1) {
        duplicateType = 'partial_name';
      }

      return { ...d, duplicateType, isDuplicate: !!duplicateType };
    });
  }, [devotees]);

  const filteredDevotees = useMemo(() => {
    let result = [...processedDevotees];

    if (debouncedSearchTerm) {
      const tokens = debouncedSearchTerm.toLowerCase().split(/\s+/).filter(t => t.length > 0);
      result = result.filter(d => {
        // Build a searchable string of all values in the devotee object
        const allText = Object.values(d).map(v => typeof v === 'string' || typeof v === 'number' ? String(v).toLowerCase() : '').join(' ');
        // Return true only if EVERY token is found somewhere in this complete string
        return tokens.every(token => allText.includes(token));
      });
    }

    if (showDuplicatesOnly) {
      if (duplicateFilterType === 'contact') {
        result = result.filter(d => d.duplicateType === 'partial_contact' || d.duplicateType === 'complete');
      } else if (duplicateFilterType === 'name') {
        result = result.filter(d => d.duplicateType === 'partial_name' || d.duplicateType === 'complete');
      } else if (duplicateFilterType === 'complete') {
        result = result.filter(d => d.duplicateType === 'complete');
      }
    }

    const getOrderValue = (d: any) => {
      if (d.customOrder !== undefined && d.customOrder !== null) {
        return Number(d.customOrder);
      }
      const getTime = (val: any) => {
        if (!val) return 0;
        if (val.seconds) return val.seconds * 1000 + (val.nanoseconds || 0) / 1000000;
        if (typeof val === 'number') return val;
        if (typeof val === 'string') return new Date(val).getTime();
        if (val.toDate) return val.toDate().getTime();
        return 0;
      };
      return -getTime(d.createdAt);
    };

    if (sortConfig && sortConfig.key !== 'Custom') {
      result.sort((a, b) => {
        const getRawValue = (item: any, key: string) => {
          if (key === 'Name') return item.name || '';
          if (key === 'Age') return item.age !== undefined && item.age !== null && item.age !== '' ? Number(item.age) : -1;
          if (key === 'Gender') return item.gender || '';
          if (key === 'Date of Birth') return item.dob || '';
          if (key === 'Address') return item.address || '';
          if (key === 'Institute') return item.institute || '';
          if (key === 'Mentor') return item.mentor || '';
          if (key === 'Facilitator') return item.facilitatorName || item.facilitator || '';
          if (key === 'Chanting') return item.chanting !== undefined && item.chanting !== null && item.chanting !== '' ? Number(item.chanting) : -1;
          if (key === 'Contact No.') return item.contact || '';
          if (key === 'Attendance') return item.attendanceCount ?? 0;
          return item[key] || '';
        };
        const aVal = getRawValue(a, sortConfig.key);
        const bVal = getRawValue(b, sortConfig.key);
        
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
        }
        
        return sortConfig.direction === 'asc' 
          ? String(aVal).localeCompare(String(bVal))
          : String(bVal).localeCompare(String(aVal));
      });
    } else {
      result.sort((a, b) => {
        const aVal = getOrderValue(a);
        const bVal = getOrderValue(b);
        if (aVal === bVal) {
          return (b.id || '').localeCompare(a.id || '');
        }
        return aVal - bVal;
      });
    }

    return result;
  }, [processedDevotees, searchTerm, sortConfig, showDuplicatesOnly, duplicateFilterType]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (isFullscreen && scrollHeight - scrollTop <= clientHeight + 800) {
      setVisibleCount(prev => Math.min(prev + 100, filteredDevotees.length));
    }
  }, [isFullscreen, filteredDevotees.length]);

  useEffect(() => {
    if (isFullscreen && scrollContainerRef.current) {
      const { scrollHeight, clientHeight } = scrollContainerRef.current;
      if (scrollHeight <= clientHeight && visibleCount < filteredDevotees.length) {
        // Content not large enough to cause scroll, load more
        setVisibleCount(prev => Math.min(prev + 100, filteredDevotees.length));
      }
    }
  }, [visibleCount, isFullscreen, filteredDevotees.length, zoom]);

  const handleBulkDelete = async () => {
    if (!selection || !profile?.templeId) return;
    const { startRow, endRow } = selection;
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);
    
    const devoteesToDelete = paginatedDevotees.slice(minRow, maxRow + 1);
    
    openConfirm('Bulk Delete', `Are you sure you want to delete ${devoteesToDelete.length} records?`, async () => {
      const batch = writeBatch(db);
      const ids = devoteesToDelete.map(d => d.id!);
      devoteesToDelete.forEach(d => {
        batch.update(doc(db, 'devotees', d.id!), { 
          isDeleted: true,
          deletedAt: serverTimestamp()
        });
      });
      await batch.commit();
      recordActivity({ type: 'bulkDeleteDevotees', ids });
      setSelection(null);
      setContextMenu(null);
    });
  };

  const handleDuplicateSelection = async () => {
    if (!selection || !profile?.templeId) return;
    const { startRow, endRow } = selection;
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);

    const rowsToDuplicate = paginatedDevotees.slice(minRow, maxRow + 1);
    if (rowsToDuplicate.length === 0) return;

    const getTimeMs = (c: any): number => {
      if (!c) return Date.now();
      if (typeof c === 'number') return c;
      if (c.toMillis) return c.toMillis();
      const t = new Date(c).getTime();
      return isNaN(t) ? Date.now() : t;
    };

    const batch = writeBatch(db);
    const newIds: string[] = [];
    [...rowsToDuplicate].reverse().forEach((row, i) => {
      const src = devoteesRef.current.find(d => d.id === row.id);
      if (!src) return;
      const { id, ...rest } = src as any;
      const ref = doc(collection(db, 'devotees'));
      newIds.push(ref.id);
      const srcTime = getTimeMs((src as any).createdAt);
      batch.set(ref, {
        ...rest,
        isDeleted: false,
        createdAt: new Date(srcTime - (i + 1)).toISOString(),
        updatedAt: serverTimestamp()
      });
    });
    await batch.commit();
    recordActivity({ type: 'addRows', ids: newIds });
    setSelection(null);
    setContextMenu(null);
  };
  
  const handleBulkCopy = () => {
    if (!selection) return;
    const { startRow, endRow, startCol, endCol } = selection;
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);
    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    
    let copyText = '';
    for (let r = minRow; r <= maxRow; r++) {
      const rowData = paginatedDevotees[r];
      const rowValues = [];
      for (let c = minCol; c <= maxCol; c++) {
        const colName = allColumns[c];
        let val = '';
        if (colName === 'Name') val = rowData.name || (rowData as any).Name || '';
        else if (colName === 'Age') val = (rowData.age ?? (rowData as any).Age ?? '').toString();
        else if (colName === 'Mentor') val = rowData.mentor || (rowData as any).Mentor || '';
        else if (colName === 'Chanting') val = (rowData.chanting ?? (rowData as any).Chanting ?? '').toString();
        else if (colName === 'Contact No.') val = rowData.contact || (rowData as any)['Contact No.'] || '';
        else val = formatValue((rowData as any)[colName]);
        rowValues.push(val);
      }
      copyText += rowValues.join('\t') + '\n';
    }
    
    navigator.clipboard.writeText(copyText);
    openAlert('Copied', `${(maxRow - minRow + 1) * (maxCol - minCol + 1)} cells copied to clipboard.`);
    setContextMenu(null);
  };

  const handleShiftCells = async (direction: 'up' | 'down' | 'left' | 'right') => {
    if (!selectionBounds || !profile?.uid) return;
    const { minRow, maxRow, minCol, maxCol } = selectionBounds;

    let rowDelta = 0;
    let colDelta = 0;
    if (direction === 'up') rowDelta = -1;
    if (direction === 'down') rowDelta = 1;
    if (direction === 'left') colDelta = -1;
    if (direction === 'right') colDelta = 1;

    const destMinRow = minRow + rowDelta;
    const destMaxRow = maxRow + rowDelta;
    const destMinCol = minCol + colDelta;
    const destMaxCol = maxCol + colDelta;

    if (destMinRow < 0 || destMinCol < 0 || destMaxRow >= filteredDevotees.length) {
      return; 
    }

    let currentAllCols = [...allColumns];
    let newCustomCols = [...customColumns];
    let customColsChanged = false;

    if (destMaxCol >= currentAllCols.length - 1) { 
      const colsToAdd = destMaxCol - (currentAllCols.length - 2);
      for (let i = 0; i < colsToAdd; i++) {
        newCustomCols.push(`Custom ${Date.now() + i}`);
      }
      setCustomColumns(newCustomCols);
      currentAllCols = [...BASE_COLUMNS.filter(c => c !== 'Profile'), ...newCustomCols, 'Profile'];
      customColsChanged = true;
      if (profile?.templeId) {
        await updateDoc(doc(db, 'temples', profile.templeId), {
          'databaseConfig.customColumns': newCustomCols
        });
      }
    }

    const updates: Record<string, any> = {};

    const getDbField = (colName: string) => {
      if (colName === 'Name') return 'name';
      if (colName === 'Age') return 'age';
      if (colName === 'Mentor') return 'mentor';
      if (colName === 'Chanting') return 'chanting';
      if (colName === 'Contact No.') return 'contact';
      return colName;
    };

    const getVal = (d: any, colName: string) => {
      if (colName === 'Name') return d.name || d.Name || '';
      if (colName === 'Age') return (d.age ?? d.Age ?? '').toString();
      if (colName === 'Mentor') return d.mentor || d.Mentor || '';
      if (colName === 'Chanting') return (d.chanting ?? d.Chanting ?? '').toString();
      if (colName === 'Contact No.') return d.contact || d['Contact No.'] || '';
      return d[colName] ?? '';
    };

    const restrictedCols = ['Attendance', 'Facilitator', 'Profile', '#'];

    for (let r = minRow; r <= maxRow; r++) {
      const srcDevotee = filteredDevotees[r];
      if (!updates[srcDevotee.id!]) updates[srcDevotee.id!] = {};
      
      const destDevotee = filteredDevotees[r + rowDelta];
      if (destDevotee && !updates[destDevotee.id!]) updates[destDevotee.id!] = {};

      for (let c = minCol; c <= maxCol; c++) {
        const srcCol = currentAllCols[c];
        const destCol = currentAllCols[c + colDelta];

        if (!srcCol || !destCol) continue;
        if (restrictedCols.includes(srcCol) || restrictedCols.includes(destCol)) continue;

        const val = getVal(srcDevotee, srcCol);
        const srcDbField = getDbField(srcCol);

        const isSrcOverwritten = 
          rowDelta === 0 && (c - colDelta >= minCol && c - colDelta <= maxCol) ||
          colDelta === 0 && (r - rowDelta >= minRow && r - rowDelta <= maxRow);

        if (!isSrcOverwritten) {
          updates[srcDevotee.id!][srcDbField] = ''; 
        }

        if (destDevotee) {
          const destDbField = getDbField(destCol);
          updates[destDevotee.id!][destDbField] = val;
        }
      }
    }

    const oldValues: Record<string, Record<string, any>> = {};
    Object.keys(updates).forEach(devId => {
      const devDoc = processedDevotees.find(x => x.id === devId);
      if (devDoc) {
        oldValues[devId] = {};
        Object.keys(updates[devId]).forEach(field => {
          oldValues[devId][field] = devDoc[field] ?? '';
        });
      }
    });

    const batch = writeBatch(db);
    Object.keys(updates).forEach(devId => {
      if (Object.keys(updates[devId]).length > 0) {
        batch.set(doc(db, 'devotees', devId), updates[devId], { merge: true });
      }
    });

    await batch.commit();

    recordActivity({
      type: 'shiftCells',
      updates,
      oldValues
    });
    setSelection(null);

    setSelection({
      startRow: destMinRow,
      endRow: destMaxRow,
      startCol: destMinCol,
      endCol: destMaxCol,
    });
    setContextMenu(null);
    setShowShiftMenu(false);
  };

  const handleIndexMouseDown = (e: React.MouseEvent, rIdx: number, dId: string) => {
    if (e.button !== 0) return;
    
    // Select the row explicitly, avoid starting box selection loop to allow for native drag
    setSelection({ startRow: rIdx, startCol: -1, endRow: rIdx, endCol: -1 });
  };

  const handleRowDragStartNative = (rIdx: number, dId: string) => {
    setSortConfig({ key: 'Custom', direction: 'asc' });
    setRowDragConfig({ active: true, startIndex: rIdx, currentIndex: rIdx, draggedId: dId });
    setSelection(null);
    setIsDragging(false);
    isDraggingRef.current = false;
  };

  const handleRowDragOverNative = (rIdx: number) => {
    setRowDragConfig(prev => {
      if (prev && prev.currentIndex !== rIdx) {
        return { ...prev, currentIndex: rIdx };
      }
      return prev;
    });
  };

  const handleRowDragEndNative = async () => {
    if (rowDragConfig?.active) {
      await executeDrop();
    }
  };

  const handleDragTouchStart = (e: React.TouchEvent, rIdx: number, dId: string) => {
    if (rowDragTimerRef.current) clearTimeout(rowDragTimerRef.current);
    
    rowDragTimerRef.current = setTimeout(() => {
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
      setSortConfig({ key: 'Custom', direction: 'asc' });
      setRowDragConfig({ active: true, startIndex: rIdx, currentIndex: rIdx, draggedId: dId });
      setSelection(null);
      setIsDragging(false);
      isDraggingRef.current = false;
    }, 250); // snappier 250ms delay for touch
  };

  const handleDragTouchMove = (e: React.TouchEvent) => {
    if (rowDragConfig?.active) {
      if (e.cancelable) e.preventDefault();
      
      const touch = e.touches[0];
      pointerPosRef.current = { x: touch.clientX, y: touch.clientY };
      
      const element = document.elementFromPoint(touch.clientX, touch.clientY);
      const rowElement = element?.closest('[data-row-idx]');
      if (rowElement) {
        const rIdx = parseInt(rowElement.getAttribute('data-row-idx') || '-1', 10);
        if (rIdx >= 0 && rIdx < paginatedDevotees.length) {
          setRowDragConfig(prev => prev ? { ...prev, currentIndex: rIdx } : null);
        }
      }
    }
  };

  const handleDragTouchEnd = async (e: React.TouchEvent) => {
    if (rowDragTimerRef.current) clearTimeout(rowDragTimerRef.current);
    
    if (rowDragConfig?.active) {
      e.preventDefault();
      await executeDrop();
    }
  };

  const handleIndexMouseEnter = (rIdx: number) => {
    if (rowDragConfig?.active) {
      setRowDragConfig(prev => prev ? { ...prev, currentIndex: rIdx } : null);
    } else {
      handleMouseEnter(rIdx, -1);
    }
  };

  const handleMouseDown = useCallback((rIdx: number, cIdx: number) => {
    mouseDownPosRef.current = { x: pointerPosRef.current.x, y: pointerPosRef.current.y };
    setIsSelectingPending(true);
    setSelection({ startRow: rIdx, startCol: cIdx, endRow: rIdx, endCol: cIdx });
    setContextMenu(null);
  }, []);

  const executeDrop = async () => {
    if (rowDragConfig?.active) {
      const { startIndex, currentIndex } = rowDragConfig;
      if (startIndex !== currentIndex) {
        // Calculate the unshifted paginated array using the original order!
        const unshiftedDevotees = isFullscreen 
          ? filteredDevotees.slice(0, visibleCount)
          : filteredDevotees.slice((currentPage - 1) * itemsPerPage, ((currentPage - 1) * itemsPerPage) + itemsPerPage);

        const draggedDevotee = unshiftedDevotees[startIndex];
        const targetDevotee = unshiftedDevotees[currentIndex];
        
        if (draggedDevotee && targetDevotee) {
          const getOrderValue = (d: any) => {
            if (d.customOrder !== undefined && d.customOrder !== null) {
              return Number(d.customOrder);
            }
            const getTime = (val: any) => {
              if (!val) return 0;
              if (val.seconds) return val.seconds * 1000 + (val.nanoseconds || 0) / 1000000;
              if (typeof val === 'number') return val;
              if (typeof val === 'string') return new Date(val).getTime();
              if (val.toDate) return val.toDate().getTime();
              return 0;
            };
            return -getTime(d.createdAt);
          };

          const targetOrder = getOrderValue(targetDevotee);
          let newOrder = 0;

          if (currentIndex < startIndex) {
            // Moved UP. Needs to be between targetDevotee and the one ABOVE it.
            const aboveDevotee = currentIndex > 0 ? unshiftedDevotees[currentIndex - 1] : null;
            if (aboveDevotee) {
              const aboveOrder = getOrderValue(aboveDevotee);
              if (aboveOrder === targetOrder) {
                newOrder = targetOrder - 0.0001;
              } else {
                newOrder = (targetOrder + aboveOrder) / 2;
              }
            } else {
              // It's the very top.
              newOrder = targetOrder - 1000;
            }
          } else {
            // Moved DOWN. Needs to be between targetDevotee and the one BELOW it.
            const belowDevotee = currentIndex < unshiftedDevotees.length - 1 ? unshiftedDevotees[currentIndex + 1] : null;
            if (belowDevotee) {
              const belowOrder = getOrderValue(belowDevotee);
              if (belowOrder === targetOrder) {
                newOrder = targetOrder + 0.0001;
              } else {
                newOrder = (targetOrder + belowOrder) / 2;
              }
            } else {
              // It's the very bottom.
              newOrder = targetOrder + 1000;
            }
          }

          try {
            // Optimistically store result to prevent flicker
            const result = [...unshiftedDevotees];
            const [draggedItem] = result.splice(startIndex, 1);
            const updatedDraggedItem = { ...draggedItem, customOrder: newOrder };
            result.splice(currentIndex, 0, updatedDraggedItem);
            setLastDropOrder(result);

            await updateDoc(doc(db, 'devotees', draggedDevotee.id!), {
              customOrder: newOrder
            });
            const originalOrder = getOrderValue(draggedDevotee);
            recordActivity({ type: 'moveRow', id: draggedDevotee.id!, oldOrder: originalOrder, newOrder });
          } catch(error: any) {
            if (error.code !== 'not-found' && !error.message?.includes('No document to update')) {
               console.error(error);
            }
            setLastDropOrder(null);
          }
        }
      }
    }
    setRowDragConfig(null);
    setIsDragging(false);
    isDraggingRef.current = false;
    isDraggingCellRef.current = false;
    setIsSelectingPending(false);
    mouseDownPosRef.current = null;
  };

  const handleMouseUp = async (e: React.MouseEvent | MouseEvent) => {
    if (rowDragTimerRef.current) clearTimeout(rowDragTimerRef.current);
    
    document.body.style.cursor = '';
    
    if (rowDragConfig?.active) {
      await executeDrop();
    }
    
    setRowDragConfig(null);
    setIsDragging(false);
    isDraggingRef.current = false;
    isDraggingCellRef.current = false;
    setIsSelectingPending(false);
    mouseDownPosRef.current = null;
  };

  const selectionBounds = useMemo(() => {
    if (!selection) return null;
    return {
      minRow: Math.min(selection.startRow, selection.endRow),
      maxRow: Math.max(selection.startRow, selection.endRow),
      minCol: Math.min(selection.startCol, selection.endCol),
      maxCol: Math.max(selection.startCol, selection.endCol)
    };
  }, [selection]);

  const isCellSelected = (rIdx: number, cIdx: number) => {
    if (!selectionBounds) return false;
    return rIdx >= selectionBounds.minRow && rIdx <= selectionBounds.maxRow && 
           cIdx >= selectionBounds.minCol && cIdx <= selectionBounds.maxCol;
  };

  const handleCellContextMenu = (e: React.MouseEvent, rIdx: number, cIdx: number) => {
    e.preventDefault();
    if (!isCellSelected(rIdx, cIdx)) {
      setSelection({ startRow: rIdx, startCol: cIdx, endRow: rIdx, endCol: cIdx });
    }
    setContextMenu({ x: e.clientX, y: e.clientY, isOpen: true });
  };

  const totalPages = Math.ceil(filteredDevotees.length / itemsPerPage);
  const [lastDropOrder, setLastDropOrder] = useState<any[] | null>(null);

  const paginatedDevotees = useMemo(() => {
    let base: any[] = [];
    if (isFullscreen) {
      base = filteredDevotees;
    } else {
      const start = (currentPage - 1) * itemsPerPage;
      base = filteredDevotees.slice(start, start + itemsPerPage);
    }

    if (rowDragConfig && rowDragConfig.active) {
      const { startIndex, currentIndex } = rowDragConfig;
      if (startIndex !== currentIndex && startIndex >= 0 && startIndex < base.length && currentIndex >= 0 && currentIndex < base.length) {
        const result = [...base];
        const [draggedItem] = result.splice(startIndex, 1);
        result.splice(currentIndex, 0, draggedItem);
        return result;
      }
    }

    // If we just finished a drag, keep the order until filteredDevotees catches up or timeout
    if (lastDropOrder) {
      // Use ID check to see if filteredDevotees has updated to the new order
      const isUpdated = base.length === lastDropOrder.length && lastDropOrder.every((item, idx) => {
         const currentItem = base[idx];
         return currentItem && currentItem.id === item.id;
      });
      if (!isUpdated) {
        return lastDropOrder;
      }
    }

    return base;
  }, [filteredDevotees, currentPage, itemsPerPage, isFullscreen, visibleCount, rowDragConfig, lastDropOrder]);

  const handleColumnDragStart = (e: React.DragEvent, idx: number) => {
    setDraggedColumnIdx(idx);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', idx.toString());
    }
  };

  const handleColumnDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (draggedColumnIdx === null || draggedColumnIdx === idx) return;
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  };

  const handleColumnDrop = (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    if (draggedColumnIdx === null || draggedColumnIdx === targetIdx) {
      setDraggedColumnIdx(null);
      return;
    }

    const newOrder = [...allColumns];
    const oldOrder = [...allColumns];
    const [movedCol] = newOrder.splice(draggedColumnIdx, 1);
    newOrder.splice(targetIdx, 0, movedCol);
    
    setColumnOrder(newOrder);
    recordActivity({ type: 'moveColumn', oldOrder, newOrder });
    setDraggedColumnIdx(null);
  };

  const handleColumnClick = (cIdx: number) => {
    setSelection({
      startRow: 0,
      endRow: Math.max(paginatedDevotees.length - 1, 0),
      startCol: cIdx,
      endCol: cIdx
    });
  };

  const handleColumnContextMenu = (e: React.MouseEvent, col: string, idx: number) => {
    e.preventDefault();
    handleColumnClick(idx);
    setColContextMenu({
      x: e.clientX,
      y: e.clientY,
      col,
      colIdx: idx,
      isOpen: true
    });
  };

  const handleCopyColumnData = () => {
    if (!colContextMenu) return;
    const { col } = colContextMenu;
    const fixedMeta = attendanceColumnMeta[col];
    const data = filteredDevotees.map(d => {
      let val = '';
      if (fixedMeta) {
        const m = attendanceColumnMaps[fixedMeta.eventId] || {};
        val = m[d.id!] ? 'P' : (Object.keys(m).length > 0 ? 'A' : '-');
      }
      else if (col === 'Name') val = d.name || (d as any).Name || '';
      else if (col === 'Age') val = (d.age ?? (d as any).Age ?? '').toString();
      else val = formatValue((d as any)[col]);
      return val;
    }).join('\n');
    
    navigator.clipboard.writeText(data);
    setColContextMenu(null);
    openAlert('Copied', `Column "${col}" data copied to clipboard.`);
  };

  useEffect(() => {
    if (lastDropOrder) {
      const timer = setTimeout(() => setLastDropOrder(null), 15000);
      return () => clearTimeout(timer);
    }
  }, [lastDropOrder]);

  useEffect(() => {
    setCurrentPage(1);
    setLastDropOrder(null);
  }, [searchTerm, showDuplicatesOnly, duplicateFilterType, sortConfig]);

  const handleUpdateFacilitator = async (devoteeId: string, facilitatorId: string) => {
    try {
      const user = templeUsers.find(u => u.uid === facilitatorId);
      await updateDoc(doc(db, 'devotees', devoteeId), { 
        facilitatorId,
        facilitatorName: user?.displayName || 'Anonymous',
        facilitator: user?.displayName || 'Anonymous'
      });
    } catch (error: any) {
      if (error.code !== 'not-found' && !error.message?.includes('No document to update')) {
        console.error(error);
      }
    }
  };

  const handleAddToFacilitation = async (devoteeId: string) => {
    if (!profile?.uid) return;
    try {
      await updateDoc(doc(db, 'devotees', devoteeId), {
        facilitatorId: profile.uid,
        facilitatorName: profile.displayName || 'Anonymous',
        facilitator: profile.displayName || 'Anonymous'
      });
      openAlert('Success', 'Devotee added to your facilitation list.');
    } catch (error) {
       console.error(error);
       openAlert('Error', 'Failed to add devotee.');
    }
  };

  const handleDelete = (id: string) => {
    openConfirm('Delete Record', 'Move this devotee to history? They can be restored within 30 days.', async () => {
      try {
        await updateDoc(doc(db, 'devotees', id), { 
          isDeleted: true,
          deletedAt: serverTimestamp()
        });
        recordActivity({ type: 'deleteDevotee', id });
      } catch (error: any) {
        if (error.code !== 'not-found' && !error.message?.includes('No document to update')) {
          console.error(error);
        }
      }
    });
  };

  const handleAddColumn = () => {
    openPrompt('New Column', 'Enter the name for the new column:', async (name) => {
      if (customColumns.includes(name)) return openAlert('Error', 'Column already exists');
      setCustomColumns([...customColumns, name]);
    });
  };

  const handleAddRows = async (count: number = 1) => {
    try {
      const templeId = profile?.templeId || profile?.uid;
      if (!templeId) return;

      if (count === 1) {
        // Optimized for single rapid clicks
        const docRef = await addDoc(collection(db, 'devotees'), {
          name: 'New Devotee',
          contact: '',
          age: '',
          mentor: '',
          chanting: '0',
          templeId,
          isDeleted: false,
          isImported: false,
          createdAt: new Date().toISOString()
        });
        recordActivity({ type: 'addRow', id: docRef.id });
        return;
      }

      const batch = writeBatch(db);
      const newIds: string[] = [];
      for (let i = 0; i < count; i++) {
        const ref = doc(collection(db, 'devotees'));
        newIds.push(ref.id);
        batch.set(ref, {
          name: 'New Devotee',
          contact: '',
          age: '',
          mentor: '',
          chanting: '0',
          templeId,
          isDeleted: false,
          isImported: false,
          createdAt: new Date().toISOString()
        });
      }
      await batch.commit();
      recordActivity({ type: 'addRows', ids: newIds });
    } catch (error) {
      console.error(error);
    }
  };

  const exportToCSV = () => {
    const data = filteredDevotees.map(d => {
      const row: any = {};
      allColumns.forEach(col => {
        if (col === 'Attendance') row[col] = `${d.attendanceCount || 0} / ${totalEvents}`;
        else if (attendanceColumnMeta[col]) {
          const m = attendanceColumnMaps[attendanceColumnMeta[col].eventId] || {};
          row[col] = m[d.id!] ? 'P' : (Object.keys(m).length > 0 ? 'A' : '-');
        }
        else if (col !== 'Profile') row[col] = (d as any)[col] || '';
      });
      return row;
    });
    const csv = Papa.unparse(data);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `database_export_${new Date().toISOString()}.csv`;
    a.click();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        setIsUploading(true);
        try {
          let importedCount = 0;
          let updatedCount = 0;
          
          // existingMap for matching active devotees
          const existingMap = new Map<string, Devotee>();
          devotees.forEach(d => {
            const name = (d.name || (d as any).Name || '').trim().toLowerCase();
            const contact = normalizePhoneNumber(d.contact || (d as any)['Contact No.'] || '');
            if (name || contact) {
              const key = `${name}_${contact}`;
              existingMap.set(key, d);
            }
          });

          // Local set to track duplicates within the current CSV
          const seenInImportLocally = new Set<string>();

          const addedData: Record<string, any> = {};
          const updatedData: { id: string, oldValues: Record<string, any>, newValues: Record<string, any> }[] = [];

          const CHUNK_SIZE = 450;
          for (let i = 0; i < results.data.length; i += CHUNK_SIZE) {
            const chunk = results.data.slice(i, i + CHUNK_SIZE);
            const batch = writeBatch(db);

            chunk.forEach((row: any) => {
              // Helper to find value from row case-insensitively
              const getVal = (aliases: string[]) => {
                const rowKeys = Object.keys(row);
                for (const alias of aliases) {
                  const match = rowKeys.find(rk => rk.trim().toLowerCase() === alias.toLowerCase());
                  if (match) return row[match];
                }
                return undefined;
              };

              const rawName = getVal(['Name', 'Devotee Name', 'Devotee']) || '';
              if (!rawName) return;
              const name = rawName.toString().trim();
              
              const rawContact = getVal(['Contact No.', 'Contact', 'PhoneNo', 'Mobile', 'Phone', 'Ph No.']) || '';
              const contact = normalizePhoneNumber(rawContact.toString());
              
              const key = `${name.toLowerCase()}_${contact}`;

              // Prepare mapped data using the internal field names
              const mappedData: any = {
                name,
                contact,
                templeId: profile?.templeId || profile?.uid,
                isDeleted: false
              };

              // Map other base fields to Firestore fields
              const age = getVal(['Age']);
              const mentor = getVal(['Mentor']);
              const chanting = getVal(['Chanting']);
              
              if (age !== undefined) mappedData.age = age;
              if (mentor !== undefined) mappedData.mentor = mentor;
              if (chanting !== undefined) mappedData.chanting = chanting;

              // Map custom columns (owner-created)
              customColumns.forEach(cc => {
                const val = getVal([cc]);
                if (val !== undefined) mappedData[cc] = val;
              });

              const existingDb = existingMap.get(key);

              if (existingDb && autoDeduplicateOnImport) {
                // Update mode: fill in information for existing records if currently empty
                const updateObj: any = {};
                const oldValues: Record<string, any> = {};
                Object.keys(mappedData).forEach(field => {
                  if (field === 'id' || field === 'templeId' || field === 'isDeleted') return;
                  
                  const incoming = mappedData[field];
                  const current = (existingDb as any)[field];
                  
                  // Only update if current DB value is truly missing/empty and we have something new
                  if ((current === undefined || current === null || current === '') && (incoming !== undefined && incoming !== null && incoming !== '')) {
                    updateObj[field] = incoming;
                    oldValues[field] = '';
                  }
                });

                if (Object.keys(updateObj).length > 0) {
                  batch.update(doc(db, 'devotees', existingDb.id!), updateObj);
                  updatedCount++;
                  updatedData.push({
                    id: existingDb.id!,
                    oldValues,
                    newValues: updateObj
                  });
                }
              } else if (seenInImportLocally.has(key) && autoDeduplicateOnImport) {
                // Skip duplicate within the same CSV file if protection is ON
                return;
              } else {
                // New entry logic
                const ref = doc(collection(db, 'devotees'));
                const newDoc = {
                  ...mappedData,
                  isImported: true,
                  createdAt: Date.now()
                };
                batch.set(ref, newDoc);
                importedCount++;
                seenInImportLocally.add(key);
                addedData[ref.id] = newDoc;
              }
            });
            
            await batch.commit();
            await new Promise(resolve => setTimeout(resolve, 150));
          }

          recordActivity({
            type: 'import',
            addedData,
            updatedData
          });

          openAlert('Import Process Complete', 
            `${importedCount} new devotee(s) added directly. ${updatedCount} existing entries were updated with missing column information from your file.`
          );
        } catch (error) {
          console.error("Upload error:", error);
          openAlert('Error', 'An error occurred during import.');
        } finally {
          setIsUploading(false);
          // clear the file input
          if (e.target) {
            e.target.value = '';
          }
        }
      },
      error: (err) => {
        console.error(err);
        openAlert('Error', 'Failed to parse CSV file.');
      }
    });
  };

  const togglePreventDuplicates = () => {
    setPreventDuplicates(!preventDuplicates);
  };


  const showYellowWarning = useMemo(() => {
    if (isWarningDismissed) return false;
    return processedDevotees.some(d => d.duplicateType === 'partial_contact' || d.duplicateType === 'partial_name');
  }, [processedDevotees, isWarningDismissed]);

  const hasCompleteDuplicates = useMemo(() => {
    return processedDevotees.some(d => d.duplicateType === 'complete');
  }, [processedDevotees]);

  const rowVirtualizer = useVirtualizer({
    count: paginatedDevotees.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 56,
    overscan: 10,
  });

  return (
    <Layout>
      <div 
        className={cn(
          "flex flex-col w-full transition-all duration-300",
          isFullscreen ? "fixed inset-0 z-[100] bg-white h-screen w-screen overflow-hidden" : "gap-6 h-full",
          rowDragConfig?.active && "select-none cursor-grabbing"
        )}
        onMouseUp={handleMouseUp}
        onMouseMove={(e) => {
          if (rowDragConfig?.active) {
            pointerPosRef.current = { x: e.clientX, y: e.clientY };
          }
        }}
        onTouchEnd={handleDragTouchEnd}
        onTouchCancel={handleDragTouchEnd}
      >
        {contextMenu?.isOpen && selection && (
          <div 
            className="fixed z-[160] animate-in zoom-in-95 duration-200 pointer-events-auto"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <div className="bg-white/40 backdrop-blur-xl border border-white/40 shadow-2xl rounded-2xl p-2 flex flex-col gap-1 min-w-[180px]">
              <div className="px-3 py-1.5 border-b border-white/20 mb-1">
                <span className="text-[10px] font-black uppercase text-stone-600/60 tracking-wider">Bulk Actions</span>
              </div>
              {!showShiftMenu ? (
                <>
                  <button 
                    onClick={handleBulkCopy}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-white/40 text-stone-700 text-[11px] font-bold transition-all"
                  >
                    <Copy size={14} className="text-blue-500" /> Copy Selection
                  </button>
                  <button 
                    onClick={handleDuplicateSelection}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-white/40 text-stone-700 text-[11px] font-bold transition-all"
                  >
                    <Layers size={14} className="text-purple-500" /> Duplicate
                  </button>
                  <button 
                    onClick={() => setShowShiftMenu(true)}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-xl hover:bg-white/40 text-stone-700 text-[11px] font-bold transition-all group"
                  >
                    <div className="flex items-center gap-3"><ArrowRight size={14} className="text-orange-500" /> Insert...</div>
                    <ChevronRight size={14} className="text-stone-400 group-hover:translate-x-1 transition-transform" />
                  </button>
                  <button 
                    onClick={handleBulkDelete}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-red-500/10 text-red-600 text-[11px] font-bold transition-all"
                  >
                    <Trash size={14} className="text-red-500" /> Delete Selection
                  </button>
                  <button 
                    onClick={() => { setSelection(null); setContextMenu(null); setShowShiftMenu(false); }}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-stone-500/10 text-stone-500 text-[11px] font-bold transition-all"
                  >
                    <X size={14} /> Clear Selection
                  </button>
                </>
              ) : (
                <>
                  <button 
                    onClick={() => setShowShiftMenu(false)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-white/40 text-stone-500 text-[11px] font-bold transition-all border-b border-white/20 mb-1"
                  >
                    <ChevronLeft size={14} /> Back
                  </button>
                  <div className="px-3 py-1.5 border-b border-white/20 mb-1">
                    <span className="text-[10px] font-black uppercase text-stone-600/60 tracking-wider">Shift Cells</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1 p-2 w-[160px] mx-auto">
                    <div />
                    <button onClick={() => handleShiftCells('up')} className="bg-white/60 hover:bg-orange-100 text-stone-600 hover:text-orange-600 rounded-lg p-2 flex items-center justify-center transition-all"><ArrowUp size={16} /></button>
                    <div />
                    <button onClick={() => handleShiftCells('left')} className="bg-white/60 hover:bg-orange-100 text-stone-600 hover:text-orange-600 rounded-lg p-2 flex items-center justify-center transition-all"><ArrowLeft size={16} /></button>
                    <div className="flex items-center justify-center pointer-events-none text-orange-200">
                      <Move size={16} />
                    </div>
                    <button onClick={() => handleShiftCells('right')} className="bg-white/60 hover:bg-orange-100 text-orange-600 hover:text-orange-700 bg-orange-50 rounded-lg p-2 flex items-center justify-center transition-all shadow-sm"><ArrowRight size={16} /></button>
                    <div />
                    <button onClick={() => handleShiftCells('down')} className="bg-white/60 hover:bg-orange-100 text-stone-600 hover:text-orange-600 rounded-lg p-2 flex items-center justify-center transition-all"><ArrowDown size={16} /></button>
                    <div />
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {colContextMenu?.isOpen && (
          <div 
            className="fixed z-[160] animate-in zoom-in-95 duration-200 pointer-events-auto"
            style={{ left: colContextMenu.x, top: colContextMenu.y }}
          >
            <div className="bg-white/40 backdrop-blur-xl border border-white/40 shadow-2xl rounded-2xl p-2 flex flex-col gap-1 min-w-[180px]">
              <div className="px-3 py-1.5 border-b border-white/20 mb-1">
                <span className="text-[10px] font-black uppercase text-stone-600/60 tracking-wider">Column: {colContextMenu.col}</span>
              </div>
              <button 
                onClick={handleCopyColumnData}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-white/40 text-stone-700 text-[11px] font-bold transition-all"
              >
                <Copy size={14} className="text-blue-500" /> Copy Column
              </button>
              <button 
                onClick={() => handleDuplicateColumn(colContextMenu.col)}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-white/40 text-stone-700 text-[11px] font-bold transition-all"
              >
                <Layers size={14} className="text-purple-500" /> Duplicate Column
              </button>
              <button 
                onClick={() => {
                  const col = colContextMenu.col;
                  setColContextMenu(null);
                  openConfirm('Delete Column', `Are you sure you want to delete the column "${col}"? This will remove it from all records.`, () => {
                    handleDeleteColumn(col);
                  });
                }}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-red-500/10 text-red-600 text-[11px] font-bold transition-all"
              >
                <Trash size={14} className="text-red-500" /> Delete Column
              </button>
              <button 
                onClick={() => setColContextMenu(null)}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-stone-500/10 text-stone-500 text-[11px] font-bold transition-all"
              >
                <X size={14} /> Cancel
              </button>
            </div>
          </div>
        )}

        {duplicateWarning && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-xl animate-in fade-in duration-500">
          <div className="bg-white/80 backdrop-blur-2xl p-10 rounded-[40px] shadow-[0_40px_100px_-20px_rgba(220,38,38,0.3)] flex flex-col items-center gap-8 border border-white/50 w-full max-w-sm text-center relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-red-500 via-orange-500 to-red-500" />
            <div className="relative">
              <div className="absolute inset-0 bg-red-500/20 blur-3xl rounded-full" />
              <div className="relative bg-gradient-to-br from-red-500 to-orange-600 p-6 rounded-3xl shadow-xl shadow-red-200">
                <AlertTriangle size={36} className="text-white" />
              </div>
            </div>
            <div className="space-y-3">
              <span className="text-[10px] font-black text-red-500 uppercase tracking-[0.4em]">Security Alert</span>
              <h3 className="text-3xl font-black text-slate-custom tracking-tighter">Duplicate Entry</h3>
              <p className="text-slate-500 font-medium text-sm leading-relaxed px-4">{duplicateWarning}</p>
            </div>
            <button onClick={() => setDuplicateWarning(null)} className="w-full bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-orange-500 text-white px-10 py-5 rounded-2xl font-black text-xs uppercase tracking-[0.2em] transition-all active:scale-95 shadow-2xl shadow-red-200 flex items-center justify-center gap-3">Remember</button>
          </div>
        </div>
      )}

      {showYellowWarning && isOwner && !showDuplicatesOnly && (
        <div className="fixed top-8 left-1/2 -translate-x-1/2 z-[200] animate-in fade-in slide-in-from-top-4 duration-500 pointer-events-auto">
          <div className="bg-amber-400 text-stone-900 px-8 py-4 rounded-2xl shadow-2xl shadow-amber-200/50 flex items-center gap-3 border-2 border-amber-300 ring-4 ring-white">
            <AlertTriangle size={20} className="animate-bounce" />
            <p className="text-sm font-black uppercase tracking-widest">Partial Duplicates Detected in Database</p>
            <button 
              onClick={() => setIsWarningDismissed(true)}
              className="ml-4 p-1 hover:bg-amber-500 rounded-lg transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {isOwner && hasCompleteDuplicates && (
        <div className="mx-10 mb-8 p-6 bg-red-50 border-2 border-red-100 rounded-3xl flex items-center justify-between animate-in fade-in duration-700">
          <div className="flex items-center gap-5">
            <div className="bg-red-500 p-3 rounded-2xl text-white shadow-lg shadow-red-200"><AlertTriangle size={24} /></div>
            <div>
              <h4 className="text-xl font-black text-red-900 font-serif tracking-tight">Resolve Complete Duplicates</h4>
              <p className="text-red-600 text-sm font-medium mt-0.5 italic">Devotees with identical Name and Contact found. Remove them within 24 hours or they will be deleted automatically.</p>
            </div>
          </div>
          <button onClick={() => { setShowDuplicatesOnly(true); setDuplicateFilterType('complete'); }} className="bg-white text-red-600 border border-red-200 px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-red-500 hover:text-white transition-all shadow-sm">Filter Now</button>
        </div>
      )}

      <div className={cn("flex flex-col flex-1 min-h-0", isFullscreen ? "" : "space-y-10 pb-10")}>
        {!isFullscreen && (
        <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-8 shrink-0">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2.5 h-2.5 bg-orange-500 rounded-full animate-pulse" />
              <span className="text-[10px] font-black text-orange-500 uppercase tracking-[0.4em]">Live Records</span>
            </div>
            <h1 className="text-5xl font-serif font-black text-stone-800 tracking-tight flex items-center gap-5">
              Database <span className="text-stone-300 font-light italic">/ {currentSheet}</span>
            </h1>
            <p className="text-stone-400 font-medium text-lg mt-3">Manage, filter and export your records with ease.</p>
          </div>
        </div>
        )}

        <div className={cn(
          "bg-white border border-stone-100 flex-1 flex flex-col group transition-all duration-500 shadow-2xl shadow-stone-200/50 min-h-0",
          isFullscreen ? "rounded-none border-none shadow-none" : "rounded-[2.5rem]"
        )}>
          {/* Excel-like Compact Toolbar */}
          <div className="bg-stone-50/40 border-b border-stone-200 px-3 py-1 flex flex-wrap items-center gap-2 shrink-0 relative z-50">
            {/* Sheet Tabs / Status */}
            <div className="flex items-center gap-1 border-r border-stone-200 pr-2">
              <span className="text-[10px] font-black text-stone-400 uppercase tracking-tight mr-1">Sheet:</span>
              <div className="flex items-center gap-0.5 bg-stone-200/50 p-0.5 rounded">
                {sheets.map(s => (
                  <button 
                    key={s}
                    onClick={() => setCurrentSheet(s)}
                    className={cn(
                      "px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-tight transition-all",
                      currentSheet === s ? "bg-white text-orange-600 shadow-sm" : "text-stone-500 hover:text-stone-700 hover:bg-stone-100"
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-0.5 border-r border-stone-200 pr-2">
              <button 
                onClick={handleUndo} 
                className={cn("p-1 rounded text-stone-500 hover:bg-stone-200 hover:text-orange-600 transition-all", history.length === 0 && "opacity-30 cursor-not-allowed")}
                title="Undo"
              >
                <Undo2 size={14} />
              </button>
              <button 
                onClick={handleRedo} 
                className={cn("p-1 rounded text-stone-500 hover:bg-stone-200 hover:text-orange-600 transition-all", redoStack.length === 0 && "opacity-30 cursor-not-allowed")}
                title="Redo"
              >
                <Redo2 size={14} />
              </button>
            </div>

            <div className="flex items-center gap-0.5 border-r border-stone-200 pr-2">
              <button onClick={() => setIsFullscreen(!isFullscreen)} className="flex items-center gap-1 px-1.5 py-0.5 tracking-tight rounded hover:bg-stone-200 group transition-all" title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}>
                <div className="text-stone-500 group-hover:text-stone-800 transition-all">
                  {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                </div>
                <span className="text-[9px] font-bold text-stone-600 uppercase">{isFullscreen ? 'Exit' : 'Full'}</span>
              </button>
              <button onClick={() => handleAddRows(1)} className="flex items-center gap-1 px-1.5 py-0.5 tracking-tight rounded hover:bg-stone-200 group transition-all">
                <div className="text-orange-500 group-hover:text-orange-600 transition-all"><Plus size={14} /></div>
                <span className="text-[9px] font-bold text-stone-600 uppercase">Add Row</span>
              </button>
              <button onClick={handleAddColumn} className="flex items-center gap-1 px-1.5 py-0.5 tracking-tight rounded hover:bg-stone-200 group transition-all">
                <div className="text-blue-500 group-hover:text-blue-600 transition-all"><Database size={14} /></div>
                <span className="text-[9px] font-bold text-stone-600 uppercase">Column</span>
              </button>
            </div>

            <div className="flex items-center gap-0.5 border-r border-stone-200 pr-2">
              {/* Filter / Sort Dropdown */}
              <div className="relative">
                <button 
                  onClick={() => setIsSortMenuOpen(!isSortMenuOpen)}
                  className={cn(
                    "flex items-center gap-1 px-2 py-0.5 rounded transition-all",
                    sortConfig || showDuplicatesOnly ? "bg-orange-100 text-orange-700" : "text-stone-600 hover:bg-stone-200"
                  )}
                >
                  <Filter size={14} />
                  <span className="text-[9px] font-bold uppercase tracking-tight">
                    {sortConfig ? sortConfig.key : 'Custom'}
                  </span>
                  <ArrowDown size={12} className={cn("transition-transform", isSortMenuOpen && "rotate-180")} />
                </button>

                {isSortMenuOpen && (
                  <div className="absolute top-full left-0 mt-1 w-48 bg-white border border-stone-200 rounded shadow-xl z-[200] overflow-hidden animate-in fade-in slide-in-from-top-1 duration-200">
                    <div className="p-1 border-b border-stone-50">
                      <button onClick={() => { setSortConfig({ key: 'Custom', direction: 'asc' }); setIsSortMenuOpen(false); }} className={cn("w-full text-left px-2 py-1 rounded text-[10px] font-bold transition-all", (!sortConfig || sortConfig?.key === 'Custom') ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-50")}>Custom</button>
                    </div>
                    <div className="p-1 space-y-0.5 max-h-48 overflow-y-auto no-scrollbar">
                      <p className="px-2 py-1 text-[8px] font-black text-stone-400 uppercase tracking-widest">Fields</p>
                      {['Name', 'Age', 'Attendance', 'Contact No.', 'Mentor', 'Chanting'].map(key => (
                        <div key={key} className="flex gap-0.5">
                          <button onClick={() => { setSortConfig({ key, direction: 'asc' }); setShowDuplicatesOnly(false); setIsSortMenuOpen(false); }} className={cn("flex-1 text-left px-2 py-1 rounded text-[9px] font-bold transition-all", sortConfig?.key === key && sortConfig.direction === 'asc' ? "bg-orange-500 text-white" : "text-stone-500 hover:bg-stone-50")}>{key} ↑</button>
                          <button onClick={() => { setSortConfig({ key, direction: 'desc' }); setShowDuplicatesOnly(false); setIsSortMenuOpen(false); }} className={cn("flex-1 text-left px-2 py-1 rounded text-[9px] font-bold transition-all", sortConfig?.key === key && sortConfig.direction === 'desc' ? "bg-orange-500 text-white" : "text-stone-500 hover:bg-stone-50")}>↓</button>
                        </div>
                      ))}
                      <div className="pt-1 border-t border-stone-100 mt-1">
                        <p className="px-2 py-1 text-[8px] font-black text-orange-400 uppercase tracking-widest">Duplicates</p>
                        <button onClick={() => { setShowDuplicatesOnly(true); setDuplicateFilterType('contact'); setIsSortMenuOpen(false); }} className={cn("w-full text-left px-2 py-1 rounded text-[9px] font-bold transition-all", showDuplicatesOnly && duplicateFilterType === 'contact' ? "bg-orange-100 text-orange-700" : "text-stone-500 hover:bg-stone-50")}>By Contact</button>
                        <button onClick={() => { setShowDuplicatesOnly(true); setDuplicateFilterType('name'); setIsSortMenuOpen(false); }} className={cn("w-full text-left px-2 py-1 rounded text-[9px] font-bold transition-all", showDuplicatesOnly && duplicateFilterType === 'name' ? "bg-orange-100 text-orange-700" : "text-stone-500 hover:bg-stone-50")}>By Name</button>
                        <button onClick={() => { setShowDuplicatesOnly(true); setDuplicateFilterType('complete'); setIsSortMenuOpen(false); }} className={cn("w-full text-left px-2 py-1 rounded text-[9px] font-bold transition-all", showDuplicatesOnly && duplicateFilterType === 'complete' ? "bg-orange-100 text-orange-700" : "text-stone-500 hover:bg-stone-50")}>Complete</button>
                        <button onClick={() => { setShowDuplicatesOnly(false); setIsSortMenuOpen(false); }} className="w-full text-left px-2 py-1 rounded text-[8px] font-black text-stone-300 uppercase tracking-widest hover:bg-stone-50 transition-all mt-0.5">Clear</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <button 
                onClick={() => setShowDuplicatesOnly(!showDuplicatesOnly)} 
                className={cn(
                  "flex items-center gap-1 px-2 py-0.5 rounded transition-all",
                  showDuplicatesOnly ? "bg-red-100 text-red-700" : "text-stone-600 hover:bg-stone-200"
                )}
                title="Find Duplicates"
              >
                <AlertTriangle size={14} />
                <span className="text-[9px] font-bold uppercase tracking-tight">Duplicates</span>
              </button>

              <div className="flex items-center gap-1 px-1.5 py-0.5 bg-stone-100 rounded">
                <span className="text-[8px] font-black text-stone-400 uppercase tracking-tight">Auto:</span>
                <button 
                  onClick={() => setAutoDeduplicateOnImport(!autoDeduplicateOnImport)}
                  className={cn(
                    "w-6 h-3 rounded-full transition-all relative flex items-center px-0.5",
                    autoDeduplicateOnImport ? "bg-emerald-500" : "bg-stone-300"
                  )}
                >
                  <div className={cn(
                    "w-2 h-2 bg-white rounded-full transition-all shadow-sm transform",
                    autoDeduplicateOnImport ? "translate-x-3" : "translate-x-0"
                  )} />
                </button>
              </div>
            </div>

            <div className="flex items-center gap-0.5 border-r border-stone-200 pr-2">
              <button onClick={() => exportToCSV()} className="flex items-center gap-1 px-1.5 py-0.5 tracking-tight rounded hover:bg-stone-200 group transition-all">
                <div className="text-emerald-500 group-hover:text-emerald-600 transition-all"><Download size={14} /></div>
                <span className="text-[9px] font-bold text-stone-600 uppercase">Export</span>
              </button>
              <label className="flex items-center gap-1 px-1.5 py-0.5 tracking-tight rounded hover:bg-stone-200 group transition-all cursor-pointer">
                <div className="text-purple-500 group-hover:text-purple-600 transition-all"><Upload size={14} /></div>
                <span className="text-[9px] font-bold text-stone-600 uppercase">Import</span>
                <input type="file" className="hidden" accept=".csv" onChange={handleFileUpload} />
              </label>
            </div>

            <div className="flex items-center gap-2">
              <button 
                onClick={togglePreventDuplicates} 
                className={cn(
                  "flex items-center gap-1 px-2 py-0.5 rounded transition-all",
                  preventDuplicates ? "bg-red-600 text-white" : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                )}
              >
                {preventDuplicates ? <ShieldCheck size={12} /> : <Trash2 size={12} />}
                <span className="text-[9px] font-bold uppercase tracking-tight">{preventDuplicates ? "Protected" : "Bulk"}</span>
              </button>
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <div className="relative group">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-stone-400 group-focus-within:text-orange-500 transition-colors" size={12} />
                <input 
                  type="text"
                  className="w-36 py-0.5 pl-7 pr-2 text-[10px] rounded border border-stone-200 bg-white outline-none focus:border-orange-300 transition-all font-bold text-stone-700"
                  placeholder="Search..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>
          </div>



          <div 
            className="flex-1 flex flex-col min-h-0 relative bg-stone-50/10 overflow-hidden"
            onContextMenu={(e) => {
              e.preventDefault();
              if (selection) {
                setContextMenu({ x: e.clientX, y: e.clientY, isOpen: true });
              }
            }}
          >
            <div 
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className={cn(
                "border border-stone-100 shadow-inner bg-white flex-1 min-h-0 custom-scrollbar", 
                isFullscreen ? "m-0 rounded-none border-none" : "rounded-3xl max-h-[600px] m-6"
              )}
              style={{ overflow: 'auto' }}
            >
              <div className="inline-block min-w-max min-h-max">
                <table 
                  style={{ zoom: `${zoom}%` }}
                  className="w-full text-left border-collapse min-w-max relative select-none"
                >
                <thead className="bg-stone-50/80 sticky top-0 z-20 backdrop-blur-md border-b border-stone-100">
                  <tr className="text-[11px] uppercase font-black text-stone-400 tracking-[0.2em]">
                    <th className="px-8 py-5 w-20 text-center border-r border-stone-100 bg-stone-50/50">#</th>
                    {allColumns.map((col, idx) => {
                      if (col === 'Attendance') {
                        return (
                          <th 
                            key={col} 
                            draggable
                            onDragStart={(e) => handleColumnDragStart(e, idx)}
                            onDragOver={(e) => handleColumnDragOver(e, idx)}
                            onDrop={(e) => handleColumnDrop(e, idx)}
                            className={cn(
                              "px-8 py-5 border-r border-stone-100 cursor-move transition-all",
                              draggedColumnIdx === idx ? "opacity-30 bg-stone-200" : "hover:bg-stone-100"
                            )}
                            onClick={() => handleColumnClick(idx)}
                            onContextMenu={(e) => handleColumnContextMenu(e, col, idx)}
                          >
                            <select 
                              value={selectedDbEventId}
                              onChange={(e) => setSelectedDbEventId(e.target.value)}
                              onMouseDown={e => e.stopPropagation()}
                              className="bg-transparent font-black uppercase text-stone-400 outline-none w-36 cursor-pointer"
                            >
                              <option value="NONE">ATTENDANCE (EVENTS)</option>
                              {dbAttendanceEvents.map(e => (
                                <option key={e.id} value={e.id}>{e.title}</option>
                              ))}
                            </select>
                          </th>
                        );
                      }
                      if (attendanceColumnMeta[col]) {
                        return (
                          <th 
                            key={col} 
                            draggable
                            onDragStart={(e) => handleColumnDragStart(e, idx)}
                            onDragOver={(e) => handleColumnDragOver(e, idx)}
                            onDrop={(e) => handleColumnDrop(e, idx)}
                            className={cn(
                              "px-8 py-5 border-r border-stone-100 cursor-move transition-all",
                              draggedColumnIdx === idx ? "opacity-30 bg-stone-200" : "hover:bg-stone-100"
                            )}
                            onClick={() => handleColumnClick(idx)}
                            onContextMenu={(e) => handleColumnContextMenu(e, col, idx)}
                            title={attendanceColumnMeta[col].eventTitle}
                          >
                            <span className="font-black uppercase text-stone-400 tracking-tight truncate block w-36" title={attendanceColumnMeta[col].eventTitle}>
                              {attendanceColumnMeta[col].eventTitle}
                            </span>
                          </th>
                        );
                      }
                      return (
                        <th 
                          key={col} 
                          draggable
                          onDragStart={(e) => handleColumnDragStart(e, idx)}
                          onDragOver={(e) => handleColumnDragOver(e, idx)}
                          onDrop={(e) => handleColumnDrop(e, idx)}
                          className={cn(
                            "px-8 py-5 border-r border-stone-100 cursor-move transition-all",
                            draggedColumnIdx === idx ? "opacity-30 bg-stone-200" : "hover:bg-stone-100"
                          )}
                          onClick={() => handleColumnClick(idx)}
                          onContextMenu={(e) => handleColumnContextMenu(e, col, idx)}
                        >
                          <EditableHeader 
                            col={col} 
                            isBaseColumn={BASE_COLUMNS.includes(col)} 
                            onUpdate={(old, updated) => setCustomColumns(prev => prev.map(c => c === old ? updated : c))}
                            onDelete={(c) => handleDeleteColumn(c)}
                          />
                        </th>
                      );
                    })}
                    {(isOwner || isMentor) && <th className="px-8 py-5 w-24 text-center">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-50">
                  {rowVirtualizer.getVirtualItems().length > 0 && rowVirtualizer.getVirtualItems()[0].start > 0 && (
                    <tr><td style={{ height: `${rowVirtualizer.getVirtualItems()[0].start}px` }} colSpan={allColumns.length + 2} /></tr>
                  )}
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const d = paginatedDevotees[virtualRow.index];
                    const rIndex = virtualRow.index;
                    return (
                      <MemoizedTableRow
                        key={d.id}
                        d={d}
                        rIndex={rIndex}
                        currentPage={currentPage}
                        itemsPerPage={itemsPerPage}
                        allColumns={allColumns}
                        templeUsers={templeUsers}
                        selectedDbEventId={selectedDbEventId}
                        dbAttendanceMap={dbAttendanceMap}
                        totalEvents={totalEvents}
                        attendanceColumnMeta={attendanceColumnMeta}
                        attendanceColumnMaps={attendanceColumnMaps}
                        selection={selection}
                        rowDragConfig={rowDragConfig}
                        isOwner={isOwner}
                        isMentor={isMentor}
                        handleMouseDown={handleMouseDown}
                        handleMouseEnter={handleMouseEnter}
                        handleIndexMouseDown={handleIndexMouseDown}
                        handleIndexMouseEnter={handleIndexMouseEnter}
                        handleDragTouchStart={handleDragTouchStart}
                        handleDragTouchMove={handleDragTouchMove}
                        handleDragTouchEnd={handleDragTouchEnd}
                        handleRowDragStartNative={handleRowDragStartNative}
                        handleRowDragOverNative={handleRowDragOverNative}
                        handleRowDragEndNative={handleRowDragEndNative}
                        handleUpdateFacilitator={handleUpdateFacilitator}
                        handleAddToFacilitation={handleAddToFacilitation}
                        navigate={navigate}
                        handleCellSave={handleCellSave}
                        handleDelete={handleDelete}
                        handleCellContextMenu={handleCellContextMenu}
                        handleToggleAttendance={handleToggleAttendance}
                      />
                    );
                  })}
                  {rowVirtualizer.getVirtualItems().length > 0 && (
                    <tr><td style={{ height: `${rowVirtualizer.getTotalSize() - rowVirtualizer.getVirtualItems()[rowVirtualizer.getVirtualItems().length - 1].end}px` }} colSpan={allColumns.length + 2} /></tr>
                  )}
                  {filteredDevotees.length === 0 && (
                    <tr>
                      <td colSpan={allColumns.length + 2} className="px-8 py-40 text-center">
                        <div className="flex flex-col items-center gap-5">
                          <div className="w-20 h-20 bg-stone-50 rounded-[2rem] flex items-center justify-center shadow-inner"><Search size={36} className="text-stone-200" /></div>
                          <p className="text-stone-400 font-bold text-lg">No matching records found.</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              </div>
            </div>

            {isFullscreen && (
              <div className="bg-white border-t border-stone-200 px-4 py-1.5 flex items-center justify-between shrink-0 select-none z-50">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                    <span className="text-[10px] font-bold text-stone-500 uppercase tracking-tight">Connected</span>
                  </div>
                  <div className="h-3 w-px bg-stone-200" />
                  <span className="text-[10px] font-bold text-stone-600 uppercase tracking-tight">{filteredDevotees.length} records in this view</span>
                </div>
                
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2 bg-stone-100 px-2 py-0.5 rounded-lg border border-stone-200/50">
                    <button 
                      onClick={() => setZoom(prev => Math.max(50, prev - 10))} 
                      className="p-1 hover:bg-white hover:text-orange-600 rounded transition-all text-stone-400"
                    >
                      <Minus size={12} strokeWidth={3} />
                    </button>
                    <div className="w-10 text-center">
                      <span className="text-[11px] font-black text-stone-800">{zoom}%</span>
                    </div>
                    <button 
                      onClick={() => setZoom(prev => Math.min(150, prev + 10))} 
                      className="p-1 hover:bg-white hover:text-orange-600 rounded transition-all text-stone-400"
                    >
                      <Plus size={12} strokeWidth={3} />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Pagination Controls */}
            {totalPages > 1 && !isFullscreen && (
              <div className="px-10 py-6 border-t border-stone-50 flex items-center justify-between bg-stone-50/20">
                <div className="flex items-center gap-4">
                  <p className="text-xs font-bold text-stone-400 uppercase tracking-widest">
                    Showing <span className="text-stone-800">{(currentPage - 1) * itemsPerPage + 1}</span> to <span className="text-stone-800">{Math.min(currentPage * itemsPerPage, filteredDevotees.length)}</span> of <span className="text-stone-800">{filteredDevotees.length}</span>
                  </p>
                  
                  <div className="h-4 w-px bg-stone-200" />
                  
                  <select 
                    value={itemsPerPage} 
                    onChange={e => {
                      setItemsPerPage(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                    className="bg-transparent text-[10px] font-black uppercase tracking-widest text-stone-500 outline-none cursor-pointer"
                  >
                    {[25, 50, 100, 250].map(size => (
                      <option key={size} value={size}>{size} per page</option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <button 
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(prev => prev - 1)}
                    className="p-2 rounded-xl border border-stone-100 hover:bg-white disabled:opacity-30 disabled:hover:bg-transparent transition-all"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  
                  <div className="flex items-center gap-1">
                    {[...Array(Math.min(5, totalPages))].map((_, i) => {
                      // Simple sliding window for pagination if totalPages > 5
                      let pageNum = i + 1;
                      if (totalPages > 5 && currentPage > 3) {
                        pageNum = Math.min(currentPage - 2 + i, totalPages - 4 + i);
                      }
                      
                      return (
                        <button
                          key={pageNum}
                          onClick={() => setCurrentPage(pageNum)}
                          className={cn(
                            "w-10 h-10 rounded-xl text-xs font-black transition-all",
                            currentPage === pageNum 
                              ? "bg-orange-500 text-white shadow-lg shadow-orange-100" 
                              : "text-stone-400 hover:bg-stone-50"
                          )}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                    {totalPages > 5 && currentPage < totalPages - 2 && (
                      <>
                        <span className="px-2 text-stone-300">...</span>
                        <button onClick={() => setCurrentPage(totalPages)} className="w-10 h-10 rounded-xl text-xs font-black text-stone-400 hover:bg-stone-50">{totalPages}</button>
                      </>
                    )}
                  </div>

                  <button 
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage(prev => prev + 1)}
                    className="p-2 rounded-xl border border-stone-100 hover:bg-white disabled:opacity-30 disabled:hover:bg-transparent transition-all"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {dialog.isOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-stone-900/60 backdrop-blur-xl animate-in fade-in duration-500">
          <div className="bg-white/95 backdrop-blur-2xl p-10 rounded-[2.5rem] shadow-[0_40px_100px_-20px_rgba(0,0,0,0.1)] w-full max-w-md border border-white/50 animate-in zoom-in-95 duration-300">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-14 h-14 bg-orange-50 rounded-2xl flex items-center justify-center shadow-xl shadow-orange-100/50"><Database size={28} className="text-orange-500" /></div>
              <div>
                <span className="text-[10px] font-black text-orange-500 uppercase tracking-[0.4em] mb-1 block">Database Prompt</span>
                <h3 className="text-3xl font-serif font-black text-stone-800 tracking-tight leading-none">{dialog.title}</h3>
              </div>
            </div>
            {dialog.message && <p className="text-stone-500 font-medium text-base mb-8 leading-relaxed bg-stone-50/50 p-6 rounded-2xl border border-stone-100/50 italic">{dialog.message}</p>}
            {dialog.type === 'prompt' && (
              <div className="mb-8">
                <label className="text-[10px] font-black text-stone-400 uppercase tracking-[0.4em] block mb-3 px-1">Entry Required</label>
                <input autoFocus type="text" placeholder="Type here..." className="w-full px-6 py-4 rounded-xl border border-stone-100 focus:border-orange-200 outline-none bg-stone-50/30 font-bold text-stone-700 transition-all focus:ring-8 focus:ring-orange-50 italic" value={dialog.inputValue} onChange={e => setDialog(prev => ({ ...prev, inputValue: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') dialog.onConfirm(dialog.inputValue || ''); if (e.key === 'Escape') dialog.onCancel(); }} />
              </div>
            )}
            <div className="flex gap-4">
              <button onClick={dialog.onCancel} className="flex-1 px-8 py-5 rounded-2xl bg-stone-100 text-stone-500 font-black uppercase tracking-widest text-xs hover:bg-stone-200 transition-all active:scale-95">Dismiss</button>
              <button onClick={() => dialog.onConfirm(dialog.inputValue || '')} className="flex-1 px-8 py-5 rounded-2xl bg-gradient-to-r from-orange-400 to-orange-500 text-white font-black uppercase tracking-widest text-xs shadow-xl shadow-orange-100/50 transition-all hover:scale-[1.02] active:scale-95">Proceed</button>
            </div>
          </div>
        </div>
      )}

      {isUploading && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-stone-900/60 backdrop-blur-md">
          <div className="flex flex-col items-center">
            <h1 className="text-5xl md:text-7xl font-serif font-bold text-orange-500 animate-pulse tracking-tight">
              Radhe Radhe...
            </h1>
            <p className="mt-6 text-white text-sm font-bold uppercase tracking-[0.3em] opacity-80 animate-pulse">
              Processing Large CSV • Please Wait
            </p>
          </div>
        </div>
      )}
      </div>
    </Layout>
  );
};

export default DatabaseManagement;
