# ADR 0001 — Firebase Firestore for project persistence with email/password auth

## Status

Accepted

## Context

PlotBoard needs cloud persistence so Users can access their Projects from any device and never lose work. The initial cookie-based approach failed because a full Document with Snapshots serialises to ~15 KB — well beyond the browser's per-cookie limit. A backend store is required.

## Decision

Use **Firebase Firestore** for data persistence and **Firebase Auth** (email/password) for identity.

### Firestore data model

```
users/{uid}                         ← written once on first sign-up (display name etc.)

projects/{projectId}                ← one document per Project
  name:         string              ← editable inline in board header
  ownerId:      string              ← Firebase Auth uid; enforced by security rules
  createdAt:    Timestamp
  updatedAt:    Timestamp
  momentCount:  number              ← denormalised for project-list card
  writtenCount: number              ← denormalised for project-list card
  moments:      Array<Moment>       ← full working Document
  written:      Array<number>       ← Written set (Moment IDs)
  chapters:     Array<Chapter>      ← board columns (per-project structure)
  threads:      Array<Thread>       ← Story-Thread rows (per-project structure)
  characters:   Array<Character>    ← Character-Arc rows (per-project structure)
  view:         "thread"|"character"
  edition:      "ledger"|"weave"
  lastVerName:  string

  snapshots/{snapId}                ← subcollection; one document per named Snapshot
    name:       string
    when:       string              ← human-readable label ("Jul 2 · 3:00 PM")
    createdAt:  Timestamp
    moments:    Array<Moment>
    written:    Array<number>
```

`dirty` is **not stored** in Firestore. It is local React state: `true` when the working Document has changed since the last Snapshot was taken.

### Key sub-decisions

| Decision           | Choice                                               | Rationale                                                                                |
| ------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Snapshots location | Subcollection                                        | Working document stays lean; snapshot history doesn't bloat the main doc                 |
| Save trigger       | Debounced auto-save (~2 s)                           | Writers shouldn't think about saving; explicit snapshots are for intentional checkpoints |
| Multi-tab strategy | Last-write-wins (`getDoc` on load, `setDoc` on save) | Solo tool; real-time sync complexity not justified                                       |
| Auth persistence   | `LOCAL`                                              | Personal daily-use tool; re-login on browser restart is unwanted friction                |
| First-login seed   | Romeo & Juliet demo project                          | Gives new Users an immediately playable board without onboarding copy                    |
| View + Edition     | Stored per-Project in Firestore                      | Preferences should follow the User across devices                                        |
| Password reset     | Included (`sendPasswordResetEmail`)                  | Omitting it permanently locks out Users who forget their password                        |

## Consequences

- Firestore security rules must enforce `request.auth.uid == resource.data.ownerId` on all project reads and writes.
- The `storage.js` module is the single seam for persistence — Firebase calls live there only.
- Snapshot subcollection documents are fetched on demand (when the Versions panel opens), not on initial board load.
- A first-login provisioning step must detect new accounts (empty projects collection) and seed the Romeo & Juliet project.
- Real-time multi-tab sync is deferred. If added later, an `onSnapshot` listener replaces `getDoc` in `storage.js` with no data model changes required.
