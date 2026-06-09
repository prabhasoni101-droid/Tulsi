# Senior Tester's Deep Audit Report (Hinglish)

## Executive Summary
App ka structure accha hai, but data management aur scalability mein "Hidden Cracks" hain. Specially, client-side filtering 1000+ records ke baad phone ko garam (heat up) kar degi.

## Part 1: Duplicate Management Tests (Test Cases)

| Test ID | Scenario | Input Data | Expected Result | Actual Code Behavior (Audit) |
| :--- | :--- | :--- | :--- | :--- |
| **DUP-01** | Case Sensitivity | `Name: RAHUL`, `Name: rahul` | Reject/Merge | Code uses `.toLowerCase()` for display, but checking logic needs to be verified for strict uniqueness. |
| **DUP-02** | Phone Formatting | `9876...` vs `+91 9876...` | Duplicate Alert | System currently checks strict string match. `+91` variations will likely bypass the duplicate check. |
| **DUP-03** | Extra Spaces | `Amit ` vs `Amit` | Auto-trim & Alert | Code uses `.trim()` in updates, but needs test for CSV imports. |

## Part 2: Performance Parameters (App Capacity)

1. **Filtering Latency:** 
   - *Test:* 5k records load karke search bar use karna.
   - *Risk:* `DatabaseManagement.tsx` uses `filteredDevotees = devotees.filter(...)`. This is O(n). As records grow, UI will freeze.
   - *Recommendation:* Server-side pagination (limit/offset) implement karna hoga.

2. **Attendance Finalization:**
   - *Test:* Click "Finalize" when 500+ attendees are present.
   - *Risk:* Code contains a loop with `getDocs` inside. It might hit Firebase quota limits if not batched properly for profile syncing.

## Part 3: Event Capacity Parameters

1. **Event Overload:** 
   - *Test:* 50 active events with each having 200 assignments.
   - *Problem:* `AttendanceSheet.tsx` loads all events via `onSnapshot`. Too much metadata will increase initial load time.

## Part 4: Security (The Hard Audit)

1. **Firestore Rules Audit:**
   - Rules ko check karna hoga ki kya koi `write` access bypass toh nahi ho raha.
   - Check if `facilitatorId` can be spoofed by an attendee.

## Part 5: Duplicates & Spelling Management

- **Issue:** System ignores phonetic similarity. "Prabh" and "Prabhu" are treated as totally different.
- **Problem:** Spelling mistakes are not suggested/flagged.

---
**Next Actions:**
1. Check `firestore.rules` for permission leaks.
2. Run a "Dirty Dozen" payload test.
3. Verify if `AuthContext` properly segregates Owner/Mentor views.
