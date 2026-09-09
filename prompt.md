A. [First read:

* `docs/PDR/MASTER_PDR.md`
* `AI_RULES.md`

Then inspect the codebase and identify ONLY the files related to:

* Owner Database
* spreadsheet engine
* Firestore data access
* IndexedDB/cache
* CSV import
* attendance
* events/public visibility
* routing/navigation
* authentication.

Do NOT modify any file.

Create a short report containing:

1. current architecture,
2. current Firestore listeners,
3. current bulk operation implementation,
4. current spreadsheet rendering path,
5. current attendance architecture,
6. current event visibility architecture,
7. current route/navigation architecture,
8. current auth persistence architecture.

STOP after the report.

STRICT SCOPE LOCK:
Do not modify code.
Do not add features.
Do not refactor unrelated code.
Do not fix bugs yet.]

B. [Create a small performance baseline for the existing Owner Database.

Use synthetic data only.

Test:

* 7,000 rows
* 15,000 rows
* 20,000 rows

Measure approximately:

* initial database render,
* scrolling,
* search,
* sort,
* filter,
* row selection,
* bulk delete simulation.

Do NOT redesign or optimize anything yet.

Save the findings in a short developer note.

STRICT SCOPE LOCK:
Only performance measurement.
No architecture changes.
No UI changes.
No business logic changes.
]

C. [Implement ONLY the Owner Database Workspace Store.

Goal:
React component state must no longer be the sole source of truth for spreadsheet row data.

Create a centralized local store for:

* devotee records,
* row IDs,
* column metadata.

Use the existing project state architecture where practical.

Rows must be keyed by permanent devotee document ID.

Do NOT implement Firestore sync yet.

Do NOT implement bulk operations yet.

Do NOT change UI behavior.

Add basic tests for:

* add row,
* update row,
* remove row,
* get row by ID.

STRICT SCOPE LOCK:
Only create the Workspace Store and its tests.
No unrelated refactoring.]

D. [Move the Owner Database row data to use the new Workspace Store created in the previous task.

The existing database UI must continue to behave exactly as before.

Important:

* preserve permanent devotee IDs,
* preserve current columns,
* preserve current sorting/filtering behavior,
* preserve existing CRUD behavior.

Do not redesign rendering yet.

First migrate data ownership only.

After implementation:

* run typecheck,
* run build,
* verify Owner Database still opens.

STRICT SCOPE LOCK:
Only migrate Owner Database row data ownership to Workspace Store.
Do not optimize unrelated functionality.]

E. [Create separate local state for spreadsheet view information.

Separate:

* search,
* filters,
* sorting,
* selection,
* active cell,
* scroll position,
* column widths,
* hidden columns.

These must NOT be stored inside every devotee row object.

The existing UI behavior must remain unchanged.

Do not implement Firestore synchronization.

STRICT SCOPE LOCK:
Only separate spreadsheet view state from row data.
No new features.
]

F. [Connect the Owner Database Workspace Store to the existing IndexedDB infrastructure.

Persist locally:

* devotee records,
* row IDs,
* column metadata,
* workspace/view metadata where already supported.

On reload:

1. restore local workspace,
2. make it available to UI,
3. do not block rendering while waiting for Firestore.

Do NOT change Firestore synchronization yet.

STRICT SCOPE LOCK:
Only IndexedDB persistence for the workspace.
Do not modify authentication, attendance, events, or unrelated pages.
]
G. [Create a central Firestore Sync Coordinator for Owner Database changes.

It must manage:

* pending writes,
* retries,
* sync state,
* errors.

Do not yet connect every database operation to it.

Create the architecture and basic tests.

The coordinator must be independent from spreadsheet cell components.

STRICT SCOPE LOCK:
Only create the sync coordinator abstraction.
Do not migrate existing writes yet.
]
H. [Modify ONLY Owner Database devotee synchronization.

Current large snapshot behavior must be changed so that Firestore `docChanges()` are applied incrementally to the Workspace Store.

Do NOT rebuild the complete 7,000+ row array whenever one document changes.

Preserve:

* create,
* update,
* delete behavior.

Do not change queries or permissions yet.

STRICT SCOPE LOCK:
Only incremental devotee snapshot synchronization.
]
I. [Inspect the Owner Database and its related child components.

Remove duplicated Firestore listeners for the same devotee dataset where possible.

Create one shared data source/store subscription for the Owner workspace.

Do not change what data users are allowed to access.

Verify listener count before and after.

STRICT SCOPE LOCK:
Only devotee listener deduplication.
No UI redesign.
No permission changes.
]
J. [Implement field-level dirty tracking for Owner Database rows.

For each changed devotee:

* track only changed fields,
* preserve original value,
* merge multiple edits to the same row.

Example:

Name change
then phone change
then address change

must become ONE pending document operation containing only final changed fields.

Do not change the UI yet.

STRICT SCOPE LOCK:
Only dirty-state tracking.
No bulk delete.
No attendance changes.
]
K. [Connect Owner Database edits to the Sync Coordinator.

Rules:

* never write on every keystroke,
* commit cell edit locally first,
* coalesce rapid edits,
* send only changed fields,
* eliminate no-op writes.

Example:
A → AB → ABC → ABCD while typing must not generate four Firestore writes.

The final committed value should be synchronized safely.

STRICT SCOPE LOCK:
Only edit synchronization/write coalescing.
Do not modify bulk operations.
]
L. []
M. []
N. []
O. []
P. []
Q. []
R. []
S. []
T. []
U. []
V. []
W. []
X. []
Y. []
Z. []

