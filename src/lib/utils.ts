import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getPublicAttendanceUrl(eventId: string): string {
  const base = import.meta.env.BASE_URL || '/';
  return `${window.location.origin}${base}#/public-attendance/${eventId}`;
}

export function normalizePhoneNumber(phone: any): string {
  if (!phone) return '';
  // Remove all non-numeric characters except +
  let cleaned = String(phone).replace(/[^\d+]/g, '');

  
  // If it's a 10 digit number, assume it's Indian and prefix +91
  if (cleaned.length === 10 && /^\d+$/.test(cleaned)) {
    cleaned = '+91' + cleaned;
  }
  
  // If it starts with 91 but no +, add +
  if (cleaned.startsWith('91') && cleaned.length === 12) {
    cleaned = '+' + cleaned;
  }

  return cleaned;
}

// Strips everything except digits and caps the length at 10 — used inside
// onChange handlers so the input box itself never accepts junk/extra digits.
export function sanitizeMobileInput(value: string): string {
  return String(value || '').replace(/\D/g, '').slice(0, 10);
}

// A "valid" Indian mobile number: exactly 10 digits, first digit 6-9.
// Blocks things like 0000000000, or partial/random numbers.
export function isValidMobileNumber(value: string): boolean {
  const digits = String(value || '').replace(/\D/g, '');
  return /^[6-9]\d{9}$/.test(digits);
}

export type DuplicateType = 'NONE' | 'SAME_CONTACT' | 'SAME_NAME' | 'COMPLETE';

export function getDuplicateType(name1: string, contact1: string, name2: string, contact2: string): DuplicateType {
  const n1 = name1.trim().toLowerCase();
  const n2 = name2.trim().toLowerCase();
  const c1 = normalizePhoneNumber(contact1);
  const c2 = normalizePhoneNumber(contact2);

  if (n1 === n2 && c1 === c2) return 'COMPLETE';
  if (c1 === c2) return 'SAME_CONTACT';
  if (n1 === n2) return 'SAME_NAME';
  
  return 'NONE';
}
