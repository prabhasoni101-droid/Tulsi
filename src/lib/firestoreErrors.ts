import { FirebaseError } from 'firebase/app';

/** Map Firestore/Firebase errors to safe user-facing messages (no internal leaks). */
export function getFirestoreErrorMessage(error: unknown): string {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case 'permission-denied':
        return 'You do not have permission to perform this action.';
      case 'not-found':
        return 'The requested record was not found.';
      case 'already-exists':
        return 'This record already exists.';
      case 'resource-exhausted':
        return 'Too many requests. Please wait a moment and try again.';
      case 'failed-precondition':
        return 'This operation could not be completed. Please refresh and try again.';
      case 'unavailable':
        return 'Service temporarily unavailable. Check your connection.';
      case 'deadline-exceeded':
        return 'The request timed out. Please try again.';
      default:
        break;
    }
  }
  return 'Something went wrong. Please try again.';
}
