# H-01 PublicStudentWorkspaceDTO

The workspace API is a presentation boundary, not a serialized copy of repository state.

`publicState()` must construct `PublicStudentWorkspaceDTO` from explicitly named fields. The DTO rejects unknown top-level keys, so adding a new repository collection cannot expose it automatically.

Internal collections including AI persistence, consent and legal records, role invitations, credit ledger entries, and recovery-engine state are forbidden. Safe derived summaries may be exposed only after their public shape is intentionally added to the allowlist and covered by tests.

The compatibility placeholders that remain in the DTO are deliberately empty or projected representations. They do not copy their repository collections.
