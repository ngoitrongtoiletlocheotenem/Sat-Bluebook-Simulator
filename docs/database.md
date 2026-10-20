# Database and historical integrity

`server/db.ts` applies versioned transactional migrations and records them in `schema_migrations`. Version 1 creates the base schema; version 2 adds user-owned image-upload metadata in `question_assets`. Run `npm run db:migrate`; startup also applies unapplied migrations. `npm run db:seed` adds original content and taxonomy idempotently. It never creates fake student progress.

SQLite defaults to `data/sat.sqlite`, uses foreign keys and WAL, and serializes connection access. Set `DATABASE_URL` for the same Knex schema and queries to use PostgreSQL. This is a real runtime adapter, not an exported SQL sketch. PostgreSQL requires an externally running database; see verification for its current test status.

| Table             | Purpose                                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| users             | Unique email, bcrypt hash, name, server-controlled role, optional profile                                                   |
| sessions          | SHA-256 of random cookie token, CSRF secret, expiry, user foreign key                                                       |
| domains / skills  | Database-driven official taxonomy and approximate blueprint proportions                                                     |
| questions         | Stable id/public id, indexed section/domain/skill/difficulty/status, owner, current version, usage                          |
| question_versions | Append-only validated rich content, choices, explanation/rationales, provenance and assets                                  |
| blueprints        | Version, published flag, author, independent adaptive/time configuration and module pools                                   |
| attempts          | User, seed, immutable blueprint/content snapshot, status, current module/question, revision                                 |
| module_attempts   | Route, duration, server deadline, locked close timestamp, routing decision snapshot                                         |
| responses         | Foreign key to exact question version; answer, eliminated choices, review flag, anchored highlights, note, accumulated time |
| score_results     | Saved original report/model version and user ownership                                                                      |
| bookmarks         | Unique user/question collection                                                                                             |
| error_logs        | Original question version/attempt/answer, reason, retry count, review state and due date                                    |
| import_jobs       | User-owned validated preview and permanent confirmation report                                                              |
| question_assets   | Upload owner, original filename, generated image URL, byte size, media type, and upload time                                |

Archives are logical. Student private questions stay owned by that student; shared questions are editable only through authorized server routes. Attempts reference old versions even after edits and archives. User role changes invalidate existing sessions.

Question search paginates server-side (20 default, 100 maximum) with indexed taxonomy columns. No client request loads the entire bank for normal browsing. Backups/export are explicit downloads. Asset files are stored separately from relational data and must be backed up with the database.
