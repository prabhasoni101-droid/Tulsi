# Security Specification - ISKCON Devotee Management

## 1. Data Invariants
- A `CallingAssignment` must always reference a valid `devoteeId` and `userId`.
- Only an `OWNER` can create or modify `Event` documents.
- A `USER` can only modify the `status` and `response` of a `CallingAssignment` assigned to them.
- `Devotee` records can be created by any authenticated user, but only `OWNER` can delete or modify them globally (users can add, but owner manages).
- `Attendance` records are managed by the `OWNER`.

## 2. The Dirty Dozen Payloads (Targeting PERMISSION_DENIED)
1. **Privilege Escalation**: Attempting to create a user profile with `role: "OWNER"` as a normal user.
2. **Unauthorized Event Creation**: A `USER` attempting to create an `Event`.
3. **Identity Spoofing in Assignments**: User A trying to update User B's `CallingAssignment`.
4. **Illegal Field Injection**: Adding an `isVerified` field to a `Devotee` document that isn't in the schema.
5. **Direct Attendance Manipulation**: A `USER` attempting to mark themselves or someone else as present in an event's `attendance` subcollection.
6. **Data Scraping (Blanket Read)**: An unauthenticated user attempting to list all `devotees`.
7. **Bypassing Assigned List**: A `USER` trying to read `CallingAssignment` documents for an event that aren't assigned to them.
8. **Shadow Developer Deletion**: A `MENTOR` trying to delete a `Devotee` record.
9. **Tampering with Terminal State**: Trying to change a `CallingAssignment` response after the event is no longer public (if locking is logic).
10. **Resource Exhaustion**: Sending a 1MB string as a devotee's `name`.
11. **Orphaned Writes**: Creating a `CallingAssignment` for a non-existent `eventId`.
12. **PII Leak**: A signed-in user trying to fetch a private contact detail they don't have access to (if we implement private info).

## 3. Test Runner (Conceptual firestore.rules.test.ts)
```ts
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';

// ... setup environment ...

// Example Test Case:
it('should deny a USER from creating an Event', async () => {
  const user = db.withData({}).withAuth({ uid: 'user1', token: { email_verified: true } });
  await assertFails(user.collection('events').add({ title: 'Festival' }));
});

it('should allow OWNER to create an Event', async () => {
  const owner = db.withData({ 'users/owner1': { role: 'OWNER' } }).withAuth({ uid: 'owner1' });
  await assertSucceeds(owner.collection('events').add({ title: 'Festival', date: '...' }));
});
```
