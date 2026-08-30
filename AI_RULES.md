# AI DEVELOPMENT RULES — READ BEFORE MODIFYING THIS PROJECT

1. Read `docs/PDR/MASTER_PDR.md` before making architectural or feature changes.
2. Treat the PDR as the behavioral source of truth. Current code is evidence, not authority, when it conflicts with a confirmed PDR rule.
3. Distinguish Current, Immediate, Future, Held, and TBD requirements. Do not implement future ideas accidentally.
4. Inspect the complete affected module, related services, types, routing, and Firestore rules before changing code.
5. Preserve tenant isolation. Never allow one organization/Owner workspace to access another.
6. Preserve Owner authority and the current permission model unless the PDR explicitly changes it.
7. Treat name/contact as mutable attributes. Use the future permanent Devotee ID as the canonical identity once that migration is introduced.
8. Before changing a field, schema, relationship, deletion flow, or role, inspect all dependent modules and define dependent-data behavior.
9. Never invent cascade deletion. For undefined dependent references, preserve/orphan according to the PDR unless a specific higher-priority rule says otherwise.
10. For ambiguous identity/CSV/conflict cases, do not guess. Skip/flag or request Owner resolution according to the PDR.
11. Never silently overwrite unrelated fields. Prefer field-level diffs and explicit merge semantics.
12. Preserve historical event/attendance relationships as defined by the PDR.
13. Sorting and filtering are view operations; they must not mutate source data.
14. Spreadsheet changes must preserve selection, editing, clipboard, history, row/column state, virtualization, filtering, sorting, and Firestore synchronization.
15. Do not rewrite unrelated modules. Prefer incremental changes and reuse existing architecture.
16. Maintain backward compatibility and provide migration logic for schema changes; do not force manual database recreation.
17. Backend authorization (Firestore/server rules) is mandatory; UI hiding is not a security boundary.
18. After implementation, run targeted tests plus regression checks for identity, permissions, deletion/restore, calling, attendance, imports, and tenant isolation.
19. If a new product decision is made, update the PDR and its changelog in the same change set.
20. Before finalizing, report changed files, behavioral changes, migration impact, security impact, performance impact, and remaining risks.
