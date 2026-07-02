# Sense of Thread — Product Requirements Document

## Overview

Sense of Thread is a web-based fiction plotting and continuity tool for novelists. It helps writers organize their plot across chapters, track character arcs and story threads, and detect continuity breaks before they reach readers.

## Vision

A writer should be able to map their entire novel on one screen — seeing at a glance how each moment connects to what comes before and after, and whether every payoff has its setup. Sense of Thread makes continuity problems visible before the manuscript is finished.

## User Persona

**Primary**: Fiction writers (novelists, short-story authors) drafting or revising prose. Age 25–65, comfort with web apps, working solo or in a small critique group. They return daily during active drafting; may have multiple projects in parallel (one novel per project, potentially multiple drafts).

**Pain point**: Missing setups, forgotten callbacks, continuity breaks discovered late in revision. Currently tracked in spreadsheets or notebooks — scattered, hard to visualize, easy to lose.

## Core Features

### Authentication & Multi-Project

- **Sign up / Sign in**: Email + password via Firebase Auth.
- **Password reset**: Email link to reset forgotten passwords.
- **First-login seed**: New accounts receive a demo "Romeo & Juliet" project to explore.
- **Project list**: Displays all Projects owned by the User, sorted by last-modified. Each card shows project name, last-modified date, and progress (written/total moments).
- **Project creation**: Button to create a new blank project.

### The Board

- **Dual view modes**:
    - **Ledger**: Continuity-focused. Moments are card blocks; arrows show dependencies. Highlights which setups are missing.
    - **Weave**: Story-focused. Moments are pills; arcs show threads crossing chapters. Visualizes multi-thread interweave.
- **Dual row modes**:
    - **Story Threads**: Each row is a narrative strand (e.g., "The Feud", "The Romance").
    - **Character Arcs**: Each row is a character's journey.
- **Columns**: Chapters of the story (user-configurable count and names).
- **Moments**: Plot blocks placed at (Chapter, Row) cells. User can:
    - Type the moment text inline.
    - Mark as "Written" (drafted prose) or "Planned" (outline only).
    - Drag to move between chapters (re-chapter).
    - Assign to a different thread or character arc.

### Dependency Tracking

- **Connect blocks**: Draw an arrow from moment A to moment B, marking B as dependent on A.
- **Continuity check**: If a dependent moment appears in an earlier chapter than its setup, the board flags it as a "continuity break" (red outline, red arrow).
- **Lineage panel**: Click a moment to see its upstream (what must be known first) and downstream (what depends on it) in the side panel. Highlights the lineage on the board.

### Version Snapshots

- **Named snapshots**: User can take a named, timestamped snapshot of the current board state (moments + written set).
- **Snapshot history**: A sidebar "Versions" panel lists all snapshots, shows which is the current working state, and allows reverting to any prior snapshot.
- **Unsaved indicator**: A dot in the Versions button shows when the working board has changed since the last snapshot.

### Project Settings

- **Project name**: Editable inline in the board header. Auto-saved to Firestore.
- **Export** (out of scope v1): Users can eventually export the board as JSON, CSV, or markdown.

## Technical Architecture

### Stack

- **Frontend**: React 18 (Vite build, class components)
- **Data**: Firebase Firestore (cloud database)
- **Auth**: Firebase Authentication (email/password)
- **Persistence**: Debounced auto-save (~2 s after last mutation)
- **Data model**: See CONTEXT.md and docs/adr/0001-firebase-firestore-persistence.md

### Key Decisions

- **Multi-project**: Each user can have unlimited projects.
- **Last-write-wins**: No real-time multi-tab sync (yet).
- **Auto-save**: Changes are written to Firestore automatically after a 2-second debounce.
- **Snapshots as subcollection**: Full snapshot history doesn't bloat the main project document.
- **Local auth**: Users stay logged in across browser restarts.

## Scope

### In Scope (MVP)

- Sign up / sign in / password reset
- Multiple projects per user
- Create / rename / delete projects
- Ledger and Weave view modes
- Story Threads and Character Arcs row modes
- Create / move / assign / mark-as-written moments
- Dependency arrows and continuity break detection
- Named snapshots and revert history
- The Margin (lineage panel)
- Project progress card (moments written / total)
- Debounced auto-save to Firestore

### Out of Scope (v2+)

- Real-time multi-tab/multi-device sync
- Collaborative editing
- Export to formats (JSON, CSV, Markdown, Word)
- Search within a project
- Filters (show only unwritten moments, show only moments in a thread)
- Undo/redo persistence across page reloads
- Mobile app or responsive mobile web
- User profile / account settings UI (beyond password reset)
- Sharing projects with other users

## Success Metrics

- **Adoption**: 100+ sign-ups in first 3 months.
- **Retention**: 30%+ of users return weekly during their active writing season.
- **Feature adoption**: 80% of users who create a project take at least one snapshot.
- **Continuity breaks caught**: Anecdotal — users report finding and fixing breaks they would have missed.

## Development Phases

### Phase 1: Auth + Core Board (4–6 weeks)

- Firebase setup (Firestore + Auth)
- Sign up / sign in / password reset flows
- Project list and creation
- Board component (Ledger + Weave, Threads + Characters)
- Dependency arrows and continuity detection
- Auto-save and basic snapshots

### Phase 2: Polish + Deploy (2–3 weeks)

- Inline project renaming
- Snapshot revert flow
- The Margin (lineage panel)
- Error handling and edge cases
- Firestore security rules
- Deploy to production

### Phase 3: Feedback & Iteration (ongoing)

- Monitor analytics
- Gather user feedback
- Plan v2 features based on usage patterns
