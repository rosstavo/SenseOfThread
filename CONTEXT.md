# sense-of-thread — Domain Glossary

## User

An authenticated account identified by an email address and password via Firebase Auth. A User owns one or more Projects.

## Project

A named fiction plotting workspace belonging to exactly one User. Contains a working Document and an ordered history of named Snapshots. The project name is editable inline in the board header.

## Document

The current working state of a Project: the full set of Moments, the Written set, and the User's View and Edition preferences. The Document is auto-saved to Firestore on a short debounce after every mutation.

## Moment

A single plot block — a discrete narrative event assigned to a Chapter and a primary row (Thread or Character Arc). The fundamental unit of the board. Moments carry a dependency list (which other Moments must precede them) used to detect continuity breaks.

## Thread

A story strand that spans multiple Chapters (e.g. "The Feud", "The Romance"). When View = Story Threads, board rows are Threads.

## Character Arc

A character's narrative journey through the story. When View = Character Arcs, board rows are Character Arcs.

## Chapter

A column on the board representing one narrative division of the story.

## View

The row axis of the board. Either **Story Threads** or **Character Arcs**. Stored per-Project in Firestore.

## Edition

The display mode of the board. Either **Ledger** (continuity book — card layout with dependency arrows) or **Weave** (story map — pill layout with curved arcs). Stored per-Project in Firestore.

## Written

The set of Moment IDs the User has marked as drafted prose. Distinct from _planned_ (outlined but not yet written).

## Snapshot

A named, timestamped deep copy of the Document's Moments and Written set, taken intentionally by the User. Stored in a `snapshots` subcollection under a Project document. The working Document is never rolled back automatically — only on an explicit revert to a Snapshot.

## dirty

A local-only UI flag. `true` when the working Document has been modified since the last Snapshot was taken. Signals to the User that their current state has no named checkpoint. Never persisted to Firestore — derived entirely from in-memory React state.
