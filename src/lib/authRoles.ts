import type { UserRole } from '../types';

export type LoginMode = 'user' | 'mentor' | 'owner';

const ROLE_RANK: Record<UserRole, number> = {
  USER: 1,
  MENTOR: 2,
  OWNER: 3,
};

export function roleMeetsMinimum(role: UserRole | undefined | null, minRole: UserRole): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[minRole];
}

export function loginModeToMinRole(mode: LoginMode): UserRole {
  if (mode === 'owner') return 'OWNER';
  if (mode === 'mentor') return 'MENTOR';
  return 'USER';
}

export function roleMatchesLoginMode(role: UserRole, mode: LoginMode): boolean {
  if (mode === 'owner') return role === 'OWNER';
  if (mode === 'mentor') return role === 'MENTOR' || role === 'OWNER';
  return role === 'USER';
}

export const PROFILE_SAFE_UPDATE_FIELDS = ['displayName', 'contact', 'searchHistory', 'accessStatus'] as const;
