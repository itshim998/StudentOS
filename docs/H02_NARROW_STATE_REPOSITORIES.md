# H-02 Narrow state repositories

Normal HTTP requests no longer reconstruct the entire StudentOS account from every table. The repository exposes dashboard, academic-context, test-session, account-lifecycle, recovery, and AI scopes. In migrated Supabase shards each scope is returned by one RPC; before migration, the compatibility path queries only the selected tables and issues those reads concurrently.

Multi-collection writes use `persist_studentos_state_patch`, so the profile and all supplied collection rows commit or roll back together. Removing an item from an in-memory array is deliberately not treated as a database deletion. Call `deleteCollectionRows`, `archiveCollectionRows`, or a domain-specific delete operation explicitly.

Source-artifact database deletion is performed by a dedicated transactional RPC. Private object storage remains an external system and is deleted separately after the database transaction.

Apply `202607280001_h02_narrow_state_repositories.sql` identically to every StudentOS data shard before relying on transactional multi-collection writes in Supabase mode.

Path-addressed test start, finish, evaluation, answer-save, and read operations now call `loadTestSession` with the server-decoded session ID. The test scope preserves the public workspace fields returned by those endpoints while filtering the test session and result rows to that entity and excluding AI, consent/legal, and recovery histories.
