# ISKCON Devotee & Advanced Event Management Platform — Master PDR v1.0
**Date:** 2026-08-30

> This file is the behavioral and architectural source of truth for future human/AI development. It intentionally separates current behavior, intended master behavior, future work, and TBD decisions.

# 1. Document Control

Purpose: This document is the single source of truth for product behavior, business rules, data relationships, permissions, lifecycle rules, conflict handling, and future compatibility. It is intended to be provided to future AI coding agents before any meaningful change to the application.

Version: Master PDR v1.0 | Date: 2026-08-30 | Current codebase inspected: Tulsi-main archive supplied in this conversation.

Normative language: MUST = mandatory rule; SHOULD = recommended unless a higher-priority rule overrides it; MAY = optional/future; TBD = intentionally undecided; HOLD = future work, not current behavior.

Source precedence: (1) explicitly confirmed current/master behavior from the product owner in this PDR, (2) explicit future-feature instructions marked Future, (3) current code only as evidence of implementation, never as authority when it conflicts with confirmed intended behavior.

Important: This PDR documents behavior and architecture, not implementation code. Future implementation prompts may be generated from this PDR, but this PDR is the higher-level contract.

# 2. Executive Product Definition

Current mission: manage large preaching/mega-event workflows, devotee records, calling, attendance, facilitation, mentor hierarchy, event visibility, and engagement follow-up for a large organization such as the present ISKCON/Spown use case.

Short-term scale target: reliably manage 25,000–30,000+ devotees without breaking data integrity or producing unacceptable UI lag, while retaining person-level engagement visibility.

Long-term product: a highly customizable organizational operating platform combining event management, spreadsheet/database behavior comparable to Google Sheets/Excel, Canva-like content/event tooling, customizable forms/workflows, role/permission controls, school/college/office/club/society workflows, live-stream and social-promotion integration, and automation.

Core philosophy: the database is the heart of the current system; the future platform generalizes the database into a configurable object/workflow layer without forcing existing organizations to rebuild their data.

# 3. Product Scope — Current vs Master

Current scope includes Owner, Mentor, User/Sevak, Devotee; event creation; event visibility; calling assignment; calling response; attendance forms/templates/import; database management; devotee profiles; facilitation; history; role-specific dashboards; statistics; notifications; CSV import/export; duplicate detection.

Immediate intended improvements include required-field configuration, large-data search optimization, stronger event visibility correctness, permanent Devotee ID architecture, dependency-safe changes, and data-integrity rules documented here.

Future scope includes custom forms, custom roles, custom workflows, branch/team/department structures, self-service devotee profiles, automated reminders, AI suggestions, advanced analytics, location attendance, live streaming, social promotion control, Canva-like tooling, and Office-like modules.

Held/not-approved changes from the prior research discussion: the proposed 6-attempt rate-limit policy, optimistic UI as a global performance rule, blanket batch-processing of every write, and HTML/pre-render caching as a mandatory rule are NOT made mandatory by this PDR. They remain unapproved proposals until explicitly accepted later.

# 4. Current Codebase Baseline (Observed)

The supplied codebase is a React 19 + TypeScript + Vite + Firebase application with React Router and Firestore. The project already contains a spreadsheet foundation, CSV engines, event visibility service, duplicate conflict service, role/auth logic, and dedicated Owner/Mentor/User dashboards.

Notable modules observed: src/views/DatabaseManagement.tsx, EventDetail.tsx, AttendanceSheet.tsx, DevoteeProfile.tsx, History.tsx; src/lib/attendanceImportEngine.ts; src/lib/csvImportEngine.ts; src/lib/duplicateConflicts.ts; src/services/eventVisibility.ts; src/context/AuthContext.tsx; firestore.rules; spreadsheet hooks under src/lib/spreadsheet/.

The current spreadsheet foundation is already layered into Selection, Editing, Clipboard, History, Columns, Rows, Viewport and Scroll state, and a virtualization-ready grid exists. The PDR therefore treats Spreadsheet Engine work as an evolution, not a greenfield replacement.

The codebase already uses @tanstack/react-virtual for scalable rendering. This is a virtualization utility, not a spreadsheet application library; the PDR still requires no third-party spreadsheet product/library.

# 5. Current-Code / Intended-Behavior Gaps That Must Not Become Future “Features”

These are explicitly implementation gaps or risks found during inspection. Future AI must treat the PDR rule as authoritative and should not preserve an accidental current behavior merely because it exists in code.

| Area | Observed in code | Intended PDR rule | Priority |
| --- | --- | --- | --- |
| Event visibility | Firestore list rule permits active same-tenant users to list events; client/service filtering is expected to hide private events but the rule is broad. | Internal/not-public events must not be visible to User/Mentor at all. Public is the authorization/visibility state for caller portals. | Critical |
| Facilitation conflict timer | duplicateConflicts.ts currently defines a 5-minute auto-resolve timer. | Owner has 24 hours to resolve a multiple-facilitator conflict; unresolved conflict is removed from competing lists and owner is notified. | Critical |
| Devotee edit authority | Firestore rules currently allow isMentor() to create/update devotee documents. | Current intended rule is Owner-only editing of existing devotee records. User/Mentor may add devotees through authorized forms, but after submission they cannot edit. | Critical |
| Calling response schema | CallingAssignment includes UNREACHABLE, while business rule requires exactly Coming/Maybe/Not Coming. | Current caller UI must use exactly three choices; No Response/Unreachable is not a separate final response state. | High |
| Spreadsheet foundation | SpreadsheetStateManager and SpreadsheetGrid exist but are additive; DatabaseManagement still contains current table architecture. | Future migration should be incremental, preserve CRUD, and never rewrite unrelated behavior. | High |
| Auth / credential model | User/Mentor credentials are written to a users document, including a password field comment indicating production hashing intent. | Credentials must not be stored as plaintext application data. Authentication secrets belong to an authentication service/secure credential system. | Critical |
| Generic user self-creation | AuthContext contains bootstrap logic that can create a USER profile for a signed-in Firebase user if no profile exists. | Current business model requires organization-controlled User/Mentor access via Owner-created credentials. Any unsolicited self-created account path must be explicitly disabled or isolated. | Critical |

# 6. Terminology & Domain Model

Organization/Tenant: an isolated logical workspace. Current code uses templeId as the tenant boundary. Master architecture generalizes this to organizationId/workspaceId while preserving the current mapping for migration.

Owner: root organization administrator and current authoritative editor.

Mentor: supervisory role; current intended extra powers are caller monitoring/statistics and feature-access management, but not unrestricted data editing.

User/Sevak/Caller: operational worker who receives calling assignments and can provide follow-up/facilitation according to permissions.

Devotee: person record being managed. Future permanent Devotee ID becomes the immutable identity anchor.

Event: organizational activity with optional attendance, calling and public visibility.

Calling Assignment: event-scoped relationship between exactly one devotee and one user/caller in the current model.

Facilitation: long-term spiritual guidance relationship between a devotee and a facilitator/user.

Attendance: event-specific presence state, independent enough to survive event dashboard deletion and remain in Attendance History.

# 7. Multi-Organization / Tenant Architecture

Every organization must be isolated. No Owner may see or affect another Owner’s organization/workspace.

Current tenant key is templeId. Master architecture SHOULD promote this concept to organizationId/workspaceId while retaining a compatibility alias/migration mapping from templeId.

All primary records — devotees, users/mentors, events, assignments, settings, templates, history, conflicts — MUST carry or be derivable from the tenant boundary.

Cross-tenant reads/writes are forbidden at both UI and Firestore authorization layers.

Future branches such as school, office, club or event-management workspaces must reuse the same tenant isolation pattern rather than fork security rules per vertical.

# 8. Authentication & Session Rules

Owner login: email-based authentication. Each Owner email establishes an isolated Owner/organization workspace.

User/Mentor login: organization-provisioned credentials/IDs. The supplied credential must match exactly; a one-character mismatch is rejected.

Persistent session: after initial successful login, Owner/Mentor/User sessions may remain active across app close/reopen until explicitly invalidated by account/role state or logout.

Owner maximum device sessions: 4. User/Mentor maximum device sessions: 2.

Role/access revocation: if Owner removes or disables access, the user’s active work must be blocked at authorization level; the UI should reflect the state immediately when possible, and refresh must never restore unauthorized access.

Role change User↔Mentor: existing account remains the same identity but its permitted portal and responsibilities migrate according to the role-change rules defined below. A session using the previous role must be invalidated when the new role cannot be safely applied live.

Restricted feature rule: unauthorized features SHOULD not be rendered at all. Backend authorization remains mandatory even when the UI hides the feature.

Password recovery current behavior: Owner controls/knows provisioned credentials. Future security hardening may replace this with a dedicated reset flow.

# 9. Roles & Permission Architecture

Owner = root authority. Owner controls data manipulation, event management, devotee management, database management, attendance records, assignments, settings, history, restore and organization configuration.

Mentor = User capabilities plus current supervisory functions: monitor caller completion/statistics and manage feature accessibility for Users. In the intended current version Mentor does not get unrestricted devotee editing or facilitation-list management unless Owner explicitly grants a future custom permission.

User/Sevak/Caller = operational access: assigned calling, response submission/update within the allowed event state, facilitation workflow, limited profile viewing, and authorized forms.

Future roles are open-ended. Owner may create custom roles.

Permission model is feature-based rather than hard-coded only by role. Future permission units may include View, Create, Edit, Delete, Assign, Restore, Export, Manage, Configure.

Default Deny rule: if a user lacks an explicit permission through role or explicit override, the action is denied.

Permission changes are Owner-controlled through Settings. Where a setting is immediately enforceable it applies immediately; where architectural reload is necessary it applies at next page load/refresh while the pre-change operation remains valid until activation.

# 10. Settings Architecture

Settings groups: Users & Permissions, Events, Attendance, Database, Profile, Calling, Facilitation, History, Security, Personalization.

Scope levels: Global, Event-specific, User/Mentor-specific, and future workflow/department-specific.

Owner may intentionally override a global setting at a narrower scope when that setting permits override.

Each setting must declare whether narrower scopes may override it. No blanket assumption may be made.

Owner can reset the full application configuration to default state.

Master customization: Owner can add custom fields, dropdown values, statuses and workflows without editing source code.

Immediate vs deferred setting activation must be explicit per setting; before activation, the previous setting governs; after activation, the new setting governs.

# 11. Database — Source of Truth & Schema

The database is the heart of the current system. All major application activity must have a defined database relationship.

Current principal devotee columns: Name, Age, Attendance, Facilitator, Contact No., Institute/University, Gender, Date of Birth, Address, Chanting, Mentor, Updated, Profile, Action, plus extensible custom fields.

Owner updates must propagate to all dependent views via identity-safe references. Future permanent Devotee ID is the canonical identity and should replace name/phone as the primary join key.

No undocumented write source is allowed. Authorized data-entry sources are the sources explicitly defined in Section 12.

No devotee data field should be duplicated across multiple independent stores unless the duplication is a deliberate denormalized display/cache field with an explicit synchronization rule.

| Current field | Meaning | Authority/behavior |
| --- | --- | --- |
| Name | Devotee identity/display name | Owner-editable; propagates. |
| Age | Age value | Owner-editable; future may be derived from DOB if explicitly designed. |
| Attendance | Dynamic event attendance selector/count | View derived from Attendance records; Owner can correct source attendance. |
| Facilitator | Current spiritual guide | Owner-controlled relationship in current model. |
| Contact No. | Phone contact | Owner-editable; primary current import matching field before permanent ID. |
| Institute/University | Institution affiliation | Owner/form/import controlled according to source. |
| Gender | Gender value | Field configured by form/template. |
| DOB | Exact date of birth | Field-level validation required. |
| Address | Residential address | Permission-sensitive field. |
| Chanting | Rounds/mala count | Owner/profile controlled. |
| Mentor | Mentor relationship/display | Owner-controlled current value; event records preserve historical context. |
| Updated | Latest update date/time or update indicator basis | System maintained. |
| Profile | Navigation into advanced profile | Read capability controlled by role/permission. |
| Action | Remove/delete flow | Owner control for global deletion. |

# 12. Authorized Data Ingestion Sources

Source 1 — User Add Devotee Form: User can submit a new devotee through the authorized form, subject to validation and duplicate checks.

Source 2 — Mentor Add Devotee Form: Mentor can submit according to the current allowed role capability; after submission User/Mentor cannot edit the record.

Source 3 — Owner Database Entry: Owner may directly create/edit records in the spreadsheet-like database.

Source 4 — CSV Database Import: Owner imports devotee data using the database import workflow.

Source 5 — Attendance Form: an event attendance form may introduce a new devotee when the Allow Unknown Devotees setting is enabled; otherwise an unknown person cannot be added through attendance.

Any other unapproved write path is a defect and must be treated as a logic/security bug.

# 13. Permanent Identity Architecture

Future Master Rule: every devotee gets an immutable permanent Devotee ID that never changes during ordinary profile edits, assignment changes, duplicate cleanup, role changes, event participation or data migration.

Name and contact are attributes, not identity keys, in the Master architecture.

All calling, attendance, facilitation, profile activity, mentor history and event-specific records MUST reference Devotee ID when the Master migration is enabled.

Current-version records without Devotee ID must be migratable. Migration should map existing records deterministically wherever possible and request Owner intervention only for genuinely ambiguous mappings.

Master compatibility principle: adding the permanent ID must not require users to recreate the entire database or re-enter historical information.

Historical snapshots may retain display name/contact for auditability, but the immutable Devotee ID remains the authoritative link.

# 14. Duplicate Detection & Resolution

Current visual duplicate signals: Red = same Name + same Contact; Green = same Contact with different Name; Blue = same Name with different Contact.

Color is a diagnostic indicator, not a substitute for identity. Future Master architecture should preserve the visible semantics while driving actual linkage by permanent Devotee ID.

Multi-record duplicate clusters must be recomputed after every relevant name/contact change. A row’s color must disappear when it no longer matches the duplicate condition.

For compound clusters, system must evaluate strongest match first, then lower-confidence relationships. It must not auto-merge ambiguous records.

CSV/form ambiguous matches are skipped and reported rather than guessed.

The Owner remains the final authority for duplicate cleanup in current behavior.

# 15. Devotee Profile Architecture

Every active devotee has an advanced profile.

Personal Info: identity, phone, source/affiliation and basic information.

Response: program attendance, calling outcomes, invitations/engagement counts.

Mentor Hierarchy: current mentor, current facilitator and chanting/rounds information.

Activity Log: event participation, event-specific calling outcome, reason for absence/non-attendance; searchable by event/date.

Engagement Feed: follow-up responses, contact attempts/outcomes, spiritual-life issues/notes and ongoing facilitator engagement; searchable by date and interest/response state.

Activity Log and Engagement Feed can be deleted into their relevant history path and then permanently deleted. Permanent deletion is irreversible.

Owner has complete monitoring/edit authority. User/Mentor access is permission-scoped.

Future “self-profile” mode may allow a devotee to view and selectively update their own spiritual-growth profile without granting general database edit access.

# 16. Devotee Profile Change Indicators & History

When Owner changes name or phone, historical views that display the person may reflect the updated current attribute. A temporary yellow marker may indicate that a profile identity field changed; the marker should disappear after its one-time-view window or when the value is reverted exactly to the prior value, according to the intended UI rule.

The current-value propagation must not rewrite event-specific historical identity anchors once permanent IDs are introduced; historical event relationship remains tied to the same person.

# 17. Event Management Architecture

Create Event required fields: Event Name and Event Date. Optional: Description and Photo.

After event creation, the system prepares the event’s attendance capability and calling assignment capability.

Owner may import a calling list only from events still present in Event History; if the source event has been permanently removed from Event History, it is no longer available for calling-list import.

Owner may configure/import an attendance template for the event. Attendance forms are customizable per event from available devotee biodata fields.

Event visibility default = Not Public/Internal. Only Owner should see an internal event until it becomes Public.

Public = event is live/workable in caller/mentor portals. Assigned callers see their assignments; users without assignments may see “No calling assigned” when the event is public.

Not Public = event hidden from User/Mentor portals. Public→Not Public must hide it immediately without requiring a refresh.

Owner may create/configure future events in advance and publish them when needed.

# 18. Event Lifecycle & Deletion

Primary event state machine is intentionally simple: Not Public ↔ Public. There is no separate mandatory “Closed/Completed” state in the current business model.

Dashboard deletion = event moves to History/soft-deleted state; event metadata and calling context remain recoverable according to history rules.

History deletion = event metadata/calling information may be permanently deleted. Attendance remains independent in Attendance History until explicitly deleted there.

Restoring an event restores the prior event state and event data. Attendance may differ from the original state if Owner changed attendance while the event was deleted or independently managed.

Event deletion/restore must not implicitly delete or restore Attendance History.

Calling history becomes profile-level retained context after event-level deletion. Event-level calling data may disappear permanently when the event itself is permanently deleted.

# 19. Calling Management System

Calling is event-centric. Facilitation is person-centric and long-term.

Owner manually assigns calling inside an event through the Assign Calling interface.

Assign Calling view is database-linked. Database changes should reflect in calling assignment views.

One devotee → one assigned User in the current model. One User → many devotees.

Future multiple-caller setting is not adopted as current behavior; if later approved, it must introduce a defined multi-response model rather than overwriting responses.

Caller can see name and phone, tap phone to initiate default dialing, and tap name to open a limited devotee profile. Caller cannot edit devotee profile.

Caller response choices are exactly: Coming, Maybe, Not Coming. Maybe and Not Coming require a reason/message.

Calling lifecycle label: Assigned → Pending → Called → Response Submitted → Completed. Business completion of the overall event/calling workload is controlled by Owner/publication workflow rather than an automatic reminder system.

Calling response can be changed by the caller while the event is Public/live. Once the event is Not Public, caller response editing is blocked.

No automatic recalling is required in the current system.

# 20. Calling Transfer & Role Change

Current manual transfer: Owner unassigns the devotee from the first user, then assigns the devotee to the second user via Assign Calling.

The old caller’s portal must lose the calling immediately; refresh must be the fallback if a live subscription fails to reflect the change.

Calling history/responses remain associated with the devotee/event context and are not intended to be casually destroyed merely because current ownership changes.

If a User’s role changes to Mentor, their existing calling assignments follow the same identity into the Mentor portal. If a Mentor becomes User, the same principle applies within the narrower access model.

If a User/Mentor account is disabled/deleted, pending calling is not automatically transferred. Current assignments are removed until Owner explicitly reallocates responsibilities.

# 21. Facilitation System

Purpose: give each devotee a personal spiritual guide/facilitator for long-term support and spiritual advancement.

Four current entry paths: Facilitation form; Owner direct database assignment; Attendance form selected facilitator; Calling list “Add to Facilitation”.

Multiple facilitator claims create an Owner-resolved conflict. Owner sees the devotee and claimants in the notification area and selects the winning facilitator.

Confirmed business rule: Owner has up to 24 hours to resolve a facilitator conflict. If unresolved, the devotee is removed from the competing facilitation lists and Owner is notified.

Current Mentor portal does not get facilitation-list management merely because the user is a Mentor; this is a deliberately restricted current behavior.

Follow-up notes entered by facilitator are written to the devotee’s Engagement Feed.

Facilitator change creates a clear transition marker in Engagement Feed and subsequent history continues under the new facilitator. Existing historical engagement remains preserved.

If no facilitator is assigned, Owner monitors/handles the devotee and may filter unassigned records.

Future automation: reminders, AI follow-up suggestions, task scheduling, growth milestones.

# 22. Attendance Engine

Normal attendance is form-driven, not manually entered by Owner as the primary workflow. Owner retains correction authority at all times.

Only Owner may correct/edit attendance after submission.

One devotee may have only one attendance for a given event.

Attendance forms use configurable event-specific fields from the devotee biodata set. Owner may choose which fields appear.

Allow Unknown Devotees setting controls whether people not yet in the database may submit attendance and become new devotee records.

Attendance matching order: exact Name + Contact match first; otherwise Contact; otherwise Name. Ambiguity must not create duplicate attendance.

Attendance CSV event detection: a column is considered an attendance/event column when its values contain recognized attendance values such as P, A, Present, Absent. The column header becomes the event name. One CSV may contain multiple event columns.

Attendance CSV supports internal and externally imported events equally for attendance counts and database attendance display.

Non-attendance columns in an attendance CSV are not treated as events.

Re-upload of the same attendance file must apply only changed attendance records; unchanged records are not rewritten.

Corrected attendance value replaces the prior value as the current authoritative attendance state.

# 23. Attendance History & Independence

Event attendance is independent enough to outlive the event dashboard record. Deleting/restoring an Event does not automatically mutate Attendance History.

Attendance History has its own delete lifecycle. If the attendance sheet is removed from Attendance History, dependent profile counts/histories should update accordingly.

After a devotee is permanently deleted, attendance can remain as an orphan historical record; future permanent IDs may be retained alongside display name for historical identity.

# 24. CSV Database Import Engine

General CSV import (outside attendance) applies to devotee database data.

CSV columns are intended to map by database field names. Matching priority is contact number first, then name, with exact/strict field mapping rules.

Invalid data types may be ignored rather than corrupting the database.

Existing devotee with matching contact and extra non-empty information may receive that extra information in the corresponding field. A matching contact is the critical current identity signal.

Duplicate visual semantics use Red/Green/Blue as defined above.

Ambiguous records must be skipped and reported, not guessed.

Large imports require progress percentage, error indication, and transactional safety. If the import cannot complete according to its defined atomicity boundary, the data state should revert to the last valid state for that operation.

Future Master architecture should use staged import, validation, deterministic mapping, diff generation, commit, and final reconciliation rather than row-by-row unstructured writes.

# 25. Search, Filter & Sort Architecture

Search should exist only where the current feature already provides search, unless a future feature explicitly adds a new search scope.

Search must be real-time/word-by-word and remain responsive for 15k, 20k, 25k+ records.

Where a feature has search results, selecting a result should navigate to the relevant feature/row/profile according to that feature’s design.

Filters are session/view state. They disappear when the app is closed unless a future setting explicitly introduces saved views.

Multiple filters combine as a conjunction by default (AND semantics), following spreadsheet-style behavior.

Sorting and filtering never mutate the underlying database order or values. They modify only the current view.

Master search engine should prefer indexed/local in-memory search over repeated Firestore scans when the full data set is already loaded and a true server query is not required. The exact algorithm may evolve, but behavior must remain deterministic and responsive.

# 26. Spreadsheet Engine — Master Architecture

The Owner database evolves into a production-grade spreadsheet engine inspired by Google Sheets/Excel, without using a third-party spreadsheet product/library.

Mandatory layers: Core State Manager; Virtual Rendering; Keyboard Navigation; Selection; Editing; Clipboard; Undo/Redo; Rows; Columns; Search; Filter; Sort; Drag/Fill; Validation; Conflict Detection; Autosave; Realtime Sync; Edit History; Bulk Operations; Power Features.

Infinite rows and columns are mandatory in Master Version. Infinite-sheet rendering activates only in Full Screen mode; outside Full Screen, current Owner Portal behavior remains.

Selection must support single/multi range, shift selection, whole row/column, drag, auto-scroll and fill handle UI.

Keyboard coverage should match common spreadsheet expectations including arrows, Enter, Tab, Home/End, Ctrl-navigation, Shift selection and standard copy/paste/delete/undo/redo operations.

Editing must support transaction-aware updates, paste shape reconstruction, rollback on failed save, and safe Firestore synchronization.

Row/column operations include insert, delete, duplicate, move, hide, unhide, resize, protect; columns also support rename and type metadata.

Find/Replace is mandatory now. Formula engine is planned later and must not be introduced incidentally.

Sorting/filtering operate on view models and never rewrite underlying record order merely because a user sorts the view.

Virtualization must prevent the DOM from scaling linearly with all rows and columns.

| Spreadsheet layer | Required behavior |
| --- | --- |
| Core State | Independent Selection, Editing, Clipboard, History, Column, Row, Viewport/Scroll state. |
| Rendering | Row + column virtualization, sticky header, sticky first column, grid lines, row numbers, column letters. |
| Navigation | Arrow, Enter, Tab, Home/End, Page navigation, Ctrl/Shift ranges. |
| Editing | F2, Delete, Backspace, copy/paste/cut, undo/redo, fill/duplicate actions. |
| Structure | Insert/move/delete/duplicate/hide/resize/protect rows and columns. |
| Discovery | Search, Find/Replace, multi-filter and multi-column sort. |
| Integrity | Validation, duplicate detection, conflict handling, autosave, edit history. |
| Power | Formula bar later, named columns, column types, checkbox/dropdown/calendar/image/hyperlink/notes/comments/attachments/labels. |

# 27. Data Consistency & Conflict Resolution Constitution

Owner has highest data authority.

An older client state must never overwrite a newer Owner-controlled value.

User/Mentor cannot update Owner-only devotee fields under the current model.

Ambiguous import mapping is skipped and exposed to Owner.

Failed network/database writes use retry where safe; if the operation still cannot be committed, the UI should roll back to the prior valid state.

Idempotency is required for actions where duplicate submission could create duplicate records, especially calling responses and attendance.

Facilitation conflicts follow the explicit Owner-resolution workflow and 24-hour rule.

Parent-child destructive actions require defined dependent-data behavior. No AI may invent a cascade-delete just because a relation exists.

Current default for undefined dependent references is orphan/preserve rather than destructive cascade, unless a higher-priority rule explicitly states otherwise.

| Priority | Data source / authority |
| --- | --- |
| 1 | Owner Edit |
| 2 | CSV Import |
| 3 | Attendance Form |
| 4 | Mentor/User Form |

Source priority is a resolution rule, not permission to overwrite unrelated fields. Field-level diffing and explicit dependency rules still apply.

# 28. Notifications & Indicators

Current notification trigger: facilitation conflicts.

Future notifications: application conflicts, errors, security events, assignment alerts, missed follow-ups, attendance alerts, scheduled reminders and other important activities.

Current notification access: Owner only.

Notifications are ordered newest first today. Future priority may elevate critical security/conflict notifications above date order.

Unread notifications do not disappear. After being read, a notification may disappear within 3 hours under the current rule.

Transient UI markers such as profile-update or conflict indicators must declare their own lifetime; notification expiry must not be reused blindly for other markers.

# 29. Reports & Analytics

Owner current report view: who is coming, who may come, who is not coming, and reasons.

Mentor current statistics: calling completion and caller performance counts/aggregate calling status.

Attendance analytics: person-wise attendance, total attendance, event-wise counts, and specific-event attendance.

Future User/Mentor personal profile analytics: event/date based calling line graph, caller response detail on hover, horizontal graph scrolling, and circular performance percentage ring.

Event report must show the event’s calling and attendance. Calling history can be deleted more aggressively than attendance because attendance is independently archived.

Future custom reports: Owner may compose dashboards/reports from fields and metrics without source-code changes.

# 30. History, Restore & Permanent Delete

History Tab and Attendance History are different systems with different controls.

History Tab currently holds deleted events, deleted devotees, deleted users/mentors and deleted profile/activity content as applicable.

Attendance History stores attendance sheets separately.

Restore authority = Owner only.

Restore as Previous: restore exact prior state, including relationships, assignments and profile data as of deletion time.

Restore as New: future feature; reintroduced record behaves as a new entry with no prior history. This is not available after permanent deletion.

After permanent deletion, recovery is impossible. Permanent deletion is not undoable.

Bulk restore per history group is a future feature; current version does not need it.

Future deletion date/time display is optional/TBD.

# 31. User/Mentor Deletion, Role Change & Responsibility Transfer

Role change User→Mentor or Mentor→User presents a migration/confirmation flow and transfers only the information appropriate to the destination role.

If User is disabled/deleted, Owner may transfer Calling + Facilitation responsibilities to a selected User or Mentor. “Continue without assigning” is always available in the Mentor case; Mentor responsibilities may transfer only to another Mentor.

The old user’s name in database relationship fields should change to the new assignee according to the normal assignment semantics.

Role changes must not silently broaden privileges. Destination role receives only its permitted data and capabilities.

# 32. Security Architecture

Default deny at Firestore rules is required and already present in the supplied codebase.

Client-side hiding is not security. Every protected action must be enforced in Firestore/server authorization.

Tenant boundaries must be enforced on every primary collection and relationship.

Restricted data such as personal contact/profile details must follow role-based access.

Plaintext passwords must never be stored in Firestore application documents in the Master architecture.

Dangerous operations use confirmation. Password re-entry for high-risk operations remains TBD/future unless explicitly approved.

Security notifications and audit logging are future features. Audit Log is intentionally held, not current.

# 33. Performance & Scalability Architecture

Primary scale target: 25k–30k+ devotees.

Core performance principles: avoid rendering all rows/cells; avoid unnecessary repeated backend reads; reuse already-loaded data; maintain realtime synchronization; use field-level diffs; use staged/bulk processing for large imports.

Spreadsheet rendering must virtualize both axes in Full Screen mode.

Search/filter/sort should operate on in-memory indexed structures when data is already loaded, while avoiding huge client-side scans when only a server-side subset is logically required.

Large imports should provide progress and error reporting and avoid blocking the main thread for the whole job.

The app should not read the same dataset repeatedly merely because the user switches windows/tabs inside one session. Session-scoped data reuse is required, subject to realtime invalidation and security.

Performance optimizations must never weaken consistency or authorization.

# 34. Import/Export & Migration Safety

Current export: complete database sheet.

Future export: selected rows/columns and multiple formats.

Import pipeline should have stages: parse → normalize → validate → identify → diff → preview/report → commit → reconcile.

Any migration that introduces new fields or permanent IDs must be backward-compatible with existing data and must be repeatable/idempotent.

Schema changes must be additive where possible. Destructive transformations require explicit migration plans and rollback strategy.

No user should need to manually recreate an organization database because of a Master Version upgrade.

# 35. Backup & Disaster Recovery (Future)

Backup is intentionally future/held.

Proposed future behavior: Firebase backup capability, weekly cadence, Owner ON/OFF control, full or partial restore (devotee/event/attendance/feature), and safe recovery.

While the app is open, accidental bulk modifications should first be recoverable through the spreadsheet Undo system where history exists.

# 36. Future Feature Register

Self-service devotee spiritual-growth profile.

Automatic reminders and intelligent follow-up suggestions.

Task scheduling and growth milestones.

Location/radius attendance with duration-based qualification/pass logic.

Live-stream control from the platform.

Social-media promotion control/integration.

Custom forms and field builders, including photo fields.

Custom roles and granular permissions.

Departments/branches/teams and organization-specific workflows.

School/college/office/club/society management templates.

Excel/Google Sheets-like spreadsheet; Canva-like content tools; future Word/PowerPoint-like branches/modules.

Custom reports/dashboards.

Audit Log.

Automatic history retention/removal settings.

Backup/restore.

# 37. Explicitly Held / TBD Decisions

Permanent-ID migration mapping behavior when current records are missing/ambiguous: TBD.

Password re-entry for permanent delete: TBD/future.

Deletion date/time display in History: future/maybe.

Custom saved views beyond normal new-column behavior: not approved.

Global optimistic UI, blanket batching, 6-attempt rate-limit and HTML/pre-render caching: not approved as PDR-mandatory rules.

Multiple callers per devotee: future setting mentioned but not part of current one-devotee-one-user rule.

Mentor multiple/single relationship in future version: current answer says current version permits multiple, future version may change; exact future cardinality is not finalized.

# 38. Backward Compatibility & Migration Constitution

Every future feature must answer: What existing records does this touch? How are old records mapped? What happens if the new field is missing? What happens if an old relationship is ambiguous? Can users continue without re-entering data?

Schema evolution should be additive and version-aware. Existing records must remain readable by the new application until migration is complete.

Feature rollout should be separable from data migration. A feature can ship with dual-read/dual-write compatibility where necessary, then migrate data, then remove legacy behavior only after validation.

Historical records are not disposable just because a current UI field changed. They must preserve the ability to reconstruct the correct person/event relationship.

# 39. AI Change Protocol — Mandatory Before Any Future Coding

Rule 1 — Read this PDR before touching code.

Rule 2 — Inspect the current codebase, routing, types, services, Firestore rules, and affected module before implementation.

Rule 3 — Identify whether requested change is Current, Immediate, Future, Held, or TBD. Do not implement future ideas accidentally.

Rule 4 — Identify all dependent modules and data relationships before changing a schema/field/state.

Rule 5 — Preserve Owner authority and tenant isolation.

Rule 6 — Preserve permanent identity when available; never use mutable name/contact as the Master primary key once Devotee ID exists.

Rule 7 — Never silently overwrite unrelated data. Use field-level diffs and explicit merge semantics.

Rule 8 — Do not convert an implementation bug into a documented feature.

Rule 9 — For conflicts, prefer deterministic business rules. For ambiguous cases, skip/flag/ask Owner rather than guess.

Rule 10 — For destructive operations, inspect dependent data behavior first.

Rule 11 — Maintain backward compatibility and existing user data.

Rule 12 — Before changing authentication/security, inspect both UI guards and Firestore rules.

Rule 13 — Before modifying spreadsheet behavior, identify impact on selection, editing, clipboard, history, row/column state, virtualization, filtering and Firestore synchronization.

Rule 14 — After implementation, run regression tests for affected workflows plus core identity, permissions, deletion, restore, calling, attendance and tenant isolation.

Rule 15 — Document any new decision in the Decision Log instead of burying it in code comments.

# 40. Suggested Change Request Template

```text
CHANGE REQUEST
Feature/Issue:
Reason:
Current behavior:
Desired behavior:
Scope: Current / Immediate / Future
Affected data/entities:
Dependencies:
Conflict cases:
Migration required? Yes/No
Rollback strategy:
Permission impact:
Security impact:
Performance impact:
PDR sections to update:
Acceptance tests:
```

# 41. Acceptance & Regression Matrix

Identity: same devotee remains the same person after name/phone edits; permanent ID survives all ordinary changes.

Tenant: Owner A cannot read or change Owner B data.

Visibility: internal event is invisible to User/Mentor; public event is visible and only assigned calling is actionable.

Calling: one devotee is assigned to one User; response choices and event visibility rules are enforced.

Facilitation: conflicting claims notify Owner and resolve according to 24-hour rule.

Attendance: one attendance per devotee per event; Owner-only corrections; unknown-devotee setting works.

Import: unchanged rows are not rewritten; ambiguous rows are reported; invalid types do not corrupt data.

Delete/restore: soft delete recoverable, permanent delete irreversible, attendance remains independent when specified.

Spreadsheet: filters/sorts change view only; undo returns prior valid state; Full Screen virtualization handles large data.

Search: real-time and responsive at target scale.

Settings: immediately applicable settings take effect immediately; deferred settings activate at the defined lifecycle point.

# 42. Repository Placement & AI Integration

Recommended location inside the repository: docs/PDR/MASTER_PDR.md (human-readable source of truth). Keep the DOCX outside runtime code for design/review, or in docs/PDR/ as an optional artifact.

Add a root-level AI instruction file such as AI_RULES.md or a project-specific agent instruction file that tells coding agents to read docs/PDR/MASTER_PDR.md before modifying code.

The PDR should be versioned in Git and updated together with meaningful architectural changes. The PDR should not be generated from code automatically; instead code changes and PDR changes should be reviewed together.

For large future AI agents, provide a small machine-oriented summary file that points to the PDR and highlights the non-negotiable rules: tenant isolation, Owner authority, permanent ID, dependency safety, backward compatibility, no accidental feature invention.

Do not place the PDR inside the src/ directory if it is not imported by the app. Keeping it under docs/ avoids accidental bundle inclusion.

# 43. Recommended Repository Instruction File

```text
Before changing this project:
1. Read docs/PDR/MASTER_PDR.md in full.
2. Identify Current vs Future vs TBD rules.
3. Inspect all affected modules and Firestore rules.
4. Never treat accidental current code behavior as the intended product rule when the PDR says otherwise.
5. Preserve tenant isolation, Owner authority, identity relationships, historical data and backward compatibility.
6. For schema changes, define migration and rollback before implementation.
7. For destructive operations, define dependent-data behavior first.
8. For ambiguous conflicts, do not guess; skip/flag or request Owner decision.
9. Make the smallest safe change that satisfies the request.
10. Run regression tests and summarize changed files, behavior and risks.
```

# 44. Implementation Roadmap Derived from the PDR

Phase 0 — Stabilize security and intended visibility: enforce tenant isolation, Owner-only editing semantics, correct private-event reads, remove insecure credential storage paths, align duplicate conflict timing with the PDR.

Phase 1 — Identity and data integrity: introduce permanent Devotee ID with migration-safe dual references.

Phase 2 — Spreadsheet migration: adopt existing spreadsheet foundation incrementally inside Owner Portal, preserving existing CRUD outside Full Screen.

Phase 3 — Attendance/calling/facilitation hardening and test coverage.

Phase 4 — Custom settings/forms/roles/workflows.

Phase 5 — Advanced analytics, automation, location attendance, streaming/social integrations.

Phase 6 — Cross-vertical templates and Office-like modules.

# 45. Final Non-Negotiable Principles

1. Data integrity beats convenience.

2. Owner authority is the highest business priority in the current model.

3. Tenant isolation is mandatory.

4. Name and phone are mutable attributes, not permanent identity in the Master architecture.

5. Attendance is independently preserved from Event History unless Attendance itself is deleted.

6. Calling and Facilitation are different domains and must never be conflated.

7. UI hiding is not security; backend authorization must enforce rules.

8. Sorting/filtering changes view, not source data.

9. Future upgrades must not force manual database recreation.

10. AI must never invent or silently change a business rule.
