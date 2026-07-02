// Persistence seam. Everything that touches Firestore lives here (ADR 0001):
// the rest of the app calls these functions and never imports firebase/firestore
// directly. If persistence ever changes (emulator, onSnapshot real-time, a
// different backend), this is the only file that moves.
//
// Data model (projects/{id}):
//   name, ownerId, createdAt, updatedAt, momentCount, writtenCount,
//   moments[], written[], chapters[], threads[], characters[],
//   view, edition, lastVerName
//   snapshots/{id} subcollection: { name, when, createdAt, moments[], written[] }

import { db } from "./firebase.js";
import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
} from "firebase/firestore";
import { buildSeedDoc } from "./seed.js";

const PROJECTS = "projects";

// ---- helpers ---------------------------------------------------------------

// Firestore Timestamp -> millis (for sorting / display). Tolerates plain
// numbers and missing values.
function millis(ts) {
  if (!ts) return 0;
  if (typeof ts === "number") return ts;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.seconds === "number") return ts.seconds * 1000;
  return 0;
}

// Normalise a persisted moment so downstream code can assume the shape.
function normMoment(m) {
  return {
    id: m.id,
    ch: m.ch,
    thread: m.thread,
    char: m.char,
    text: typeof m.text === "string" ? m.text : "",
    deps: Array.isArray(m.deps) ? m.deps.slice() : [],
    planned: !!m.planned,
    coChars: Array.isArray(m.coChars) ? m.coChars.slice() : [],
    coThreads: Array.isArray(m.coThreads) ? m.coThreads.slice() : [],
  };
}

// The subset of a project document that makes up the editable board state.
function normDoc(data) {
  return {
    name: typeof data.name === "string" ? data.name : "Untitled project",
    chapters: Array.isArray(data.chapters) ? data.chapters : [],
    threads: Array.isArray(data.threads) ? data.threads : [],
    characters: Array.isArray(data.characters) ? data.characters : [],
    moments: Array.isArray(data.moments) ? data.moments.map(normMoment) : [],
    written: Array.isArray(data.written) ? data.written : [],
    view: data.view === "character" ? "character" : "thread",
    edition: data.edition === "weave" ? "weave" : "ledger",
    lastVerName: typeof data.lastVerName === "string" ? data.lastVerName : "",
  };
}

// ---- projects --------------------------------------------------------------

// All of a User's projects, newest-modified first, shaped for the project-list
// cards (id, name, updatedAt, momentCount, writtenCount).
export async function listProjects(uid) {
  const snap = await getDocs(
    query(collection(db, PROJECTS), where("ownerId", "==", uid))
  );
  const rows = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      name: data.name || "Untitled project",
      updatedAt: millis(data.updatedAt) || millis(data.createdAt),
      momentCount:
        typeof data.momentCount === "number"
          ? data.momentCount
          : (data.moments || []).length,
      writtenCount:
        typeof data.writtenCount === "number"
          ? data.writtenCount
          : (data.written || []).length,
    };
  });
  rows.sort((a, b) => b.updatedAt - a.updatedAt);
  return rows;
}

// Create a project from a full board doc (from seed.js). Returns the new id.
export async function createProject(uid, docState) {
  const ref = await addDoc(collection(db, PROJECTS), {
    ownerId: uid,
    name: docState.name || "Untitled project",
    chapters: docState.chapters || [],
    threads: docState.threads || [],
    characters: docState.characters || [],
    moments: (docState.moments || []).map(normMoment),
    written: docState.written || [],
    view: docState.view === "character" ? "character" : "thread",
    edition: docState.edition === "weave" ? "weave" : "ledger",
    lastVerName: docState.lastVerName || "",
    momentCount: (docState.moments || []).length,
    writtenCount: (docState.written || []).length,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

// Load one project's full board state. Returns null if it doesn't exist.
export async function loadProject(projectId) {
  const ref = doc(db, PROJECTS, projectId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, ...normDoc(snap.data()) };
}

// Persist the working board. Callers debounce (~2s) before invoking this.
export async function saveProject(projectId, docState) {
  const ref = doc(db, PROJECTS, projectId);
  await updateDoc(ref, {
    name: docState.name,
    chapters: docState.chapters || [],
    threads: docState.threads || [],
    characters: docState.characters || [],
    moments: (docState.moments || []).map(normMoment),
    written: docState.written || [],
    view: docState.view === "character" ? "character" : "thread",
    edition: docState.edition === "weave" ? "weave" : "ledger",
    lastVerName: docState.lastVerName || "",
    momentCount: (docState.moments || []).length,
    writtenCount: (docState.written || []).length,
    updatedAt: serverTimestamp(),
  });
}

// Rename only (used by inline header edit and the project-list menu).
export async function renameProject(projectId, name) {
  await updateDoc(doc(db, PROJECTS, projectId), {
    name: name,
    updatedAt: serverTimestamp(),
  });
}

// Delete a project and all its snapshots.
export async function deleteProject(projectId) {
  const snaps = await getDocs(collection(db, PROJECTS, projectId, "snapshots"));
  await Promise.all(snaps.docs.map((s) => deleteDoc(s.ref)));
  await deleteDoc(doc(db, PROJECTS, projectId));
}

// ---- snapshots (subcollection) --------------------------------------------

// All named snapshots for a project, newest first. Loaded on demand (when the
// Versions panel opens), not on initial board load.
export async function listSnapshots(projectId) {
  const snap = await getDocs(
    query(
      collection(db, PROJECTS, projectId, "snapshots"),
      orderBy("createdAt", "desc")
    )
  );
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      name: data.name || "Snapshot",
      when: data.when || "",
      moments: Array.isArray(data.moments) ? data.moments.map(normMoment) : [],
      written: Array.isArray(data.written) ? data.written : [],
    };
  });
}

// Add a named snapshot. Returns the stored snapshot (with its new id).
export async function addSnapshot(projectId, snap) {
  const ref = await addDoc(collection(db, PROJECTS, projectId, "snapshots"), {
    name: snap.name,
    when: snap.when,
    moments: (snap.moments || []).map(normMoment),
    written: snap.written || [],
    createdAt: serverTimestamp(),
  });
  return {
    id: ref.id,
    name: snap.name,
    when: snap.when,
    moments: snap.moments,
    written: snap.written,
  };
}

export async function deleteSnapshot(projectId, snapId) {
  await deleteDoc(doc(db, PROJECTS, projectId, "snapshots", snapId));
}

// ---- first-login seed ------------------------------------------------------

// On first sign-in a User has no projects. Seed the Romeo & Juliet demo so they
// land on a playable board. Idempotent: if any project already exists, does
// nothing. Returns true if it seeded.
export async function ensureSeed(uid) {
  const existing = await getDocs(
    query(collection(db, PROJECTS), where("ownerId", "==", uid))
  );
  if (!existing.empty) return false;
  await createProject(uid, buildSeedDoc());
  return true;
}

// Record the user profile document once, on sign-up. Bookkeeping only; not
// load-bearing for the board.
export async function ensureUserDoc(uid, email) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return;
  await setDoc(ref, { email: email || "", createdAt: serverTimestamp() });
}
