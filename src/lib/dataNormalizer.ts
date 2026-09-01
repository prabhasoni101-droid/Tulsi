import { Devotee } from '../types';
import { normalizePhoneNumber } from './utils';

/**
 * Normalizes a raw Firestore or CSV devotee document into a standardized Devotee object.
 * Reconciles legacy aliases (Name, Contact No., Age, Date of Birth, Facilitator, etc.)
 * into canonical fields without altering or losing any custom user columns.
 */
export function normalizeDevoteeDoc(raw: any): Devotee {
  if (!raw || typeof raw !== 'object') return raw;

  const name = String(raw.name ?? raw.Name ?? raw['Devotee Name'] ?? raw.devotee ?? '').trim();
  const rawContact = String(raw.contact ?? raw['Contact No.'] ?? raw.phone ?? raw.mobile ?? raw.PhNo ?? '').trim();
  const contact = normalizePhoneNumber(rawContact);
  const age = raw.age ?? raw.Age ?? '';
  const mentor = String(raw.mentor ?? raw.Mentor ?? '').trim();
  const chanting = raw.chanting ?? raw.Chanting ?? '';
  const gender = String(raw.gender ?? raw.Gender ?? '').trim();
  const dob = String(raw.dob ?? raw['Date of Birth'] ?? raw.DOB ?? '').trim();
  const address = String(raw.address ?? raw.Address ?? '').trim();
  const institute = String(raw.institute ?? raw.Institute ?? '').trim();
  const facilitatorName = String(raw.facilitatorName ?? raw.facilitator ?? raw.Facilitator ?? '').trim();

  // Create normalized document preserving raw custom keys
  const normalized: any = {
    ...raw,
    name,
    contact,
    age: age !== '' ? age : undefined,
    mentor,
    chanting: chanting !== '' ? chanting : undefined,
    gender,
    dob,
    address,
    institute,
    facilitatorName,
    attendanceCount: Number(raw.attendanceCount ?? 0),
    isDeleted: Boolean(raw.isDeleted ?? false)
  };

  // Build a pre-computed search key for instant multi-token filtering (<3ms for 20,000+ items)
  const searchParts: string[] = [
    name,
    contact,
    rawContact,
    mentor,
    facilitatorName,
    institute,
    address,
    gender,
    dob,
    String(age),
    String(chanting)
  ];

  // Include custom column values in search index
  Object.keys(raw).forEach((key) => {
    const val = raw[key];
    if (val && typeof val !== 'object' && typeof val !== 'function') {
      searchParts.push(String(val));
    }
  });

  normalized.searchKey = searchParts.join(' ').toLowerCase();

  return normalized as Devotee;
}

/**
 * Fast batch normalization for an array of devotee documents.
 */
export function normalizeDevoteeList(rawDocs: any[]): Devotee[] {
  if (!Array.isArray(rawDocs)) return [];
  return rawDocs.map(normalizeDevoteeDoc);
}
