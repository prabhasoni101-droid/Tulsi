export type UserRole = 'USER' | 'MENTOR' | 'OWNER';

export interface UserProfile {
  uid: string;
  displayName: string | null;
  email: string;
  role: UserRole;
  contact?: string;
  mentorId?: string;
  templeId?: string;
  searchHistory?: string[];
  isDeleted?: boolean;
  deletedAt?: string;
  accessStatus?: {
    history: boolean;
    facilitation: boolean;
    addDevotee: boolean;
  };
}

export interface Devotee {
  id?: string;
  name: string;
  contact: string;
  mentor: string;
  facilitator?: string;
  facilitationResponse?: string;
  facilitationResponseText?: string;
  facilitationNotes?: FacilitationNote[];
  chanting: string;
  age?: string;
  address?: string;
  gender?: string;
  institute?: string;
  dob?: string;
  facilitatorId?: string;
  facilitatorName?: string;
  attendanceCount: number;
  assignedCount?: number;
  templeId?: string;
  createdAt: string;
  sheetName?: string;
  isDuplicate?: boolean;
  duplicateType?: 'complete' | 'partial_name' | 'partial_contact' | null;
  duplicateCreatedAt?: string | null;
  duplicateHandled?: boolean;
  isDeleted?: boolean;
  deletedAt?: string;
  [key: string]: any;
}

export interface FacilitationNote {
  note: string;
  date: string;
  authorName: string;
  authorId: string;
  status: string;
}

export interface FacilitationResponse {
  id?: string;
  text: string;
  date: string;
  userDisplayName: string;
  userId: string;
}

export interface CallingHistory {
  id?: string;
  userId: string;
  eventId: string;
  eventName: string;
  eventDate: string;
  assignments: CallingAssignment[];
  submittedAt: string;
}

export interface Template {
  id: string;
  name: string;
  fields: string[]; // e.g., ['name', 'contact', 'age', 'dob', 'gender', 'address', 'institute', 'mentor', 'facilitator', 'chanting']
  createdAt: string;
}

export interface Event {
  id?: string;
  title: string;
  date: string;
  description: string;
  mediaUrl: string;
  isPublic: boolean;
  visibilityUpdatedAt?: any;
  visibilityUpdatedBy?: string | null;
  createdBy: string;
  templeId?: string;
  createdAt: string;
  assignmentsCount?: number;
  attendingCount?: number;
  templateId?: string; // Link to dynamic template
  isAttendanceOpen?: boolean;
  isDeleted?: boolean;
  deletedAt?: string;
  originalEventId?: string;
  importedFromCsv?: boolean;
}

export interface CallingAssignment {
  id?: string;
  eventId: string;
  devoteeId: string;
  userId: string;
  status: 'PENDING' | 'COMPLETED';
  response: 'COMING' | 'NOT_COMING' | 'MAYBE' | 'UNREACHABLE' | 'NONE';
  responseText?: string;
  devoteeName: string;
  devoteeContact: string;
  facilitatorName?: string;
  updatedAt: string;
}

export interface Attendance {
  id?: string;
  devoteeId: string;
  present: boolean;
  markedAt: string;
  markedBy: string;
}
