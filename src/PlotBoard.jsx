import React from "react";
import {
  saveProject,
  listSnapshots,
  addSnapshot,
  deleteSnapshot,
  renameProject,
} from "./storage.js";

// Parse an inline CSS string ("prop:val;prop:val") into a React style object.
// The component logic below produces CSS strings (ported verbatim from the
// original design component); this adapts them to React's style prop.
function sty(css) {
  const o = {};
  if (!css) return o;
  css.split(";").forEach((decl) => {
    const i = decl.indexOf(":");
    if (i === -1) return;
    const prop = decl.slice(0, i).trim();
    const val = decl.slice(i + 1).trim();
    if (!prop) return;
    const camel = prop.startsWith("--")
      ? prop
      : prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    o[camel] = val;
  });
  return o;
}

// Colour palette new thread/character rows cycle through (reused from the seed
// docs' tones so added rows sit visually alongside the starter ones).
const ROW_PALETTE = [
  "#7c3b2c", "#2f6e62", "#a1863c", "#8a4a3a", "#5b6b63",
  "#a5645a", "#6b6558", "#8a4a3a", "#3a6b5b", "#9a6a2c",
];

// A one-or-two-character badge from a label, e.g. "The Feud" -> "TF",
// "Romeo" -> "Ro". Used as the default `mark` for a newly added row.
function markFromLabel(label) {
  const words = String(label || "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2);
  return (words[0][0] + words[1][0]).toUpperCase();
}

export default class PlotBoard extends React.Component {
  static NS = "http://www.w3.org/2000/svg";

  constructor(props) {
    super(props);
    const p = props.project || {};
    // Board structure + content come from the loaded Firestore project doc.
    this.projectId = p.id;
    this.chapters = Array.isArray(p.chapters) ? p.chapters : [];
    this.threads = Array.isArray(p.threads) ? p.threads : [];
    this.characters = Array.isArray(p.characters) ? p.characters : [];
    this.moments = Array.isArray(p.moments) ? p.moments : [];
    this.written = new Set(Array.isArray(p.written) ? p.written : []);
    this.state = {
      name: p.name || "Untitled project",
      view: p.view === "character" ? "character" : "thread",
      edition: p.edition === "weave" ? "weave" : "ledger",
      selected: null,
      marginHidden: false, // The Margin shows on first load; hides once a block is deselected
      writeTick: 0,
      connectMode: false,
      connectFrom: null,
      placing: false,      // "Add block" placement mode — pick a cell to drop the new block into
      placingCh: null,     // chapter (column) currently hovered while placing
      placingRk: null,     // row key currently hovered while placing
      menuOpen: false,
      blockMenu: false,
      versions: [],
      versionsLoaded: false,
      versionsBusy: false,
      dirty: false,
      draftName: "",
      lastVerName: p.lastVerName || "",
      editingName: false,
      nameDraft: "",
      editingRow: null,   // key of the thread/character row being edited inline
      rowDraft: {},        // { label, note, color, mark } while editing a row
      editingText: false, // whether the selected block's text is being edited
      textDraft: "",       // working copy of the block text while editing
      editingChapter: null, // n of the chapter whose editor popover is open
      chapterDraft: {},     // { label, title } while editing a chapter
    };
  }

  componentDidMount() {
    this._draw = () => this.drawArrows();
    window.addEventListener("resize", this._draw);
    // Escape backs out of placement mode.
    this._onKey = (e) => { if (e.key === "Escape" && this.state.placing) this.cancelPlacing(); };
    window.addEventListener("keydown", this._onKey);
    this.forceUpdate();
    this.scheduleDraw();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => this.drawArrows());
    [150, 400, 900].forEach((t) => setTimeout(() => this.drawArrows(), t));
    if (window.ResizeObserver) {
      this._ro = new ResizeObserver(() => this.drawArrows());
      requestAnimationFrame(() => {
        const w = this.root && this.root.querySelector(".rows-wrap");
        if (w) this._ro.observe(w);
      });
    }
  }
  componentWillUnmount() {
    window.removeEventListener("resize", this._draw);
    window.removeEventListener("keydown", this._onKey);
    if (this._ro) this._ro.disconnect();
    clearTimeout(this._saveTimer);
    if (this._needSave) this.flushSave(); // don't lose the last edit on unmount
  }
  componentDidUpdate() { this.scheduleDraw(); this.persist(); }
  scheduleDraw() { requestAnimationFrame(() => requestAnimationFrame(() => this.drawArrows())); }

  // Mark the working document as needing a Firestore write. Called from every
  // mutation choke point (pushUndo, view/edition changes, snapshot/revert,
  // rename) so idle interactions like selecting a moment don't trigger writes.
  markSave() { this._needSave = true; }

  // Debounced auto-save (~2 s after the last mutation) — ADR 0001.
  persist() {
    if (!this.projectId || !this._needSave) return;
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.flushSave(), 2000);
  }
  flushSave() {
    if (!this.projectId || !this._needSave) return;
    this._needSave = false;
    clearTimeout(this._saveTimer);
    saveProject(this.projectId, {
      name: this.state.name,
      chapters: this.chapters,
      threads: this.threads,
      characters: this.characters,
      moments: this.moments || [],
      written: Array.from(this.written || []),
      view: this.state.view,
      edition: this.ed(),
      lastVerName: this.state.lastVerName,
    }).catch((err) => {
      console.warn("PlotBoard: auto-save failed", err);
      this._needSave = true; // retry on the next mutation
    });
  }

  ed() { return this.state.edition === "weave" ? "weave" : "ledger"; }
  setEdition(e) { this.markSave(); this.setState({ edition: e, selected: null }); }
  curMoments() { return this.moments || []; }
  rowKeyOf(m) { return this.state.view === "thread" ? m.thread : m.char; }
  coKeys(m) { return this.state.view === "thread" ? m.coThreads || [] : m.coChars || []; }
  isWritten(id) { return !!(this.written && this.written.has(id)); }
  toggleWritten(id) { if (!this.written) this.written = new Set(); this.pushUndo(); if (this.written.has(id)) this.written.delete(id); else this.written.add(id); this.setState((s) => ({ writeTick: s.writeTick + 1, dirty: true })); }
  // Status is a single boolean: written, or (its default inverse) planned.
  setWritten(id, val) {
    if (!this.written) this.written = new Set();
    if (this.written.has(id) === val) return;
    this.pushUndo();
    if (val) this.written.add(id); else this.written.delete(id);
    this.setState((s) => ({ writeTick: s.writeTick + 1, dirty: true }));
  }
  chShort(n) { const c = this.chapters.find((x) => x.n === n); return c ? c.label : "#" + n; }
  chInfo(n) { const c = this.chapters.find((x) => x.n === n); return c ? c.label + " · " + c.title : "Chapter " + n; }

  setView(v) { this.markSave(); this.setState({ view: v }); }
  select(id) {
    if (this.state.connectMode) {
      const from = this.state.connectFrom;
      if (from == null) { this.setState({ connectFrom: id }); return; }
      if (from === id) { this.setState({ connectFrom: null }); return; }
      this.addDependency(from, id);
      this.setState({ connectMode: false, connectFrom: null });
      return;
    }
    this.setState((s) => {
      const deselecting = s.selected === id;
      return { selected: deselecting ? null : id, marginHidden: deselecting, blockMenu: false, editingText: false };
    });
  }
  toggleBlockMenu() { this.setState((s) => ({ blockMenu: !s.blockMenu })); }
  toggleConnect() { this.setState((s) => ({ connectMode: !s.connectMode, connectFrom: null, placing: false, placingCh: null, placingRk: null })); }
  startConnect(id) { this.setState({ connectMode: true, connectFrom: id }); }
  addDependency(a, b) {
    const ma = (this.moments || []).find((m) => m.id === a);
    const mb = (this.moments || []).find((m) => m.id === b);
    if (!ma || !mb) return;
    const dep = ma.ch <= mb.ch ? ma : mb;
    const tgt = ma.ch <= mb.ch ? mb : ma;
    if (dep.id !== tgt.id && !tgt.deps.includes(dep.id)) { this.pushUndo(); tgt.deps.push(dep.id); }
    this.setState({ dirty: true });
  }
  // Sever one connection. The edge lives on the dependent block's deps array,
  // so `target` is whichever block holds it (the later one for an upstream link,
  // the selected block for a downstream one).
  removeDependency(targetId, depId) {
    const t = (this.moments || []).find((m) => m.id === targetId);
    if (!t || !Array.isArray(t.deps) || !t.deps.includes(depId)) return;
    this.pushUndo();
    t.deps = t.deps.filter((d) => d !== depId);
    this.setState({ dirty: true });
  }
  // "Add block" no longer drops straight into the top-left cell. Instead it
  // arms a placement mode: the board highlights the column/cell under the
  // cursor and shows a ＋ target, and the block lands wherever the user clicks
  // (see placeBlock). Toggle it off if it's already armed.
  startPlacing() {
    if (!this.threads[0] || !this.characters[0]) return; // need at least one row of each axis
    this.setState((s) => ({
      placing: !s.placing, placingCh: null, placingRk: null,
      connectMode: false, connectFrom: null, selected: null, blockMenu: false,
    }));
  }
  cancelPlacing() { this.setState({ placing: false, placingCh: null, placingRk: null }); }
  hoverPlace(ch, rk) {
    if (!this.state.placing) return;
    if (this.state.placingCh === ch && this.state.placingRk === rk) return;
    this.setState({ placingCh: ch, placingRk: rk });
  }
  // Drop a fresh block into the chosen chapter (column) and row (thread/character).
  placeBlock(ch, rowKey) {
    const firstThread = this.threads[0];
    const firstChar = this.characters[0];
    if (!firstThread || !firstChar) return; // need at least one row of each axis
    const nextId = Math.max(0, ...(this.moments || []).map((m) => m.id)) + 1;
    const nm = {
      id: nextId, ch,
      thread: this.state.view === "thread" ? rowKey : firstThread.key,
      char: this.state.view === "character" ? rowKey : firstChar.key,
      text: "New moment — describe what the reader learns here.",
      deps: [], planned: true, coChars: [], coThreads: [],
    };
    this.pushUndo();
    (this.moments || (this.moments = [])).push(nm);
    this.setState({ selected: nextId, dirty: true, placing: false, placingCh: null, placingRk: null });
  }
  assignRow(id, key) {
    if (!key) return; // "— Unassigned —" placeholder
    const m = (this.moments || []).find((x) => x.id === id);
    if (!m) return;
    const cur = this.state.view === "thread" ? m.thread : m.char;
    if (cur === key) return;
    this.pushUndo();
    // Re-home on the current axis, and drop the new home from that axis's
    // co-appearance list so a block never echoes into its own home row.
    if (this.state.view === "thread") {
      m.thread = key;
      if (Array.isArray(m.coThreads)) m.coThreads = m.coThreads.filter((k) => k !== key);
    } else {
      m.char = key;
      if (Array.isArray(m.coChars)) m.coChars = m.coChars.filter((k) => k !== key);
    }
    this.setState({ dirty: true });
  }
  // Mirror the block into (or out of) another row on the current axis: threads
  // in thread view, characters in character view. The home row can't be a
  // co-star of itself, so it's rejected here.
  toggleCoRow(id, key) {
    const m = (this.moments || []).find((x) => x.id === id);
    if (!m || !key) return;
    if (this.rowKeyOf(m) === key) return;
    const field = this.state.view === "thread" ? "coThreads" : "coChars";
    const list = Array.isArray(m[field]) ? m[field] : (m[field] = []);
    const i = list.indexOf(key);
    this.pushUndo();
    if (i > -1) list.splice(i, 1); else list.push(key);
    this.setState({ dirty: true });
  }
  // --- rows (threads / character arcs) ------------------------------------
  // The row axis is view-dependent: threads in thread view, characters in
  // character view. curRows() is the live array for the current axis.
  curRows() { return this.state.view === "thread" ? this.threads : this.characters; }
  addRow() {
    const isThread = this.state.view === "thread";
    const rows = isThread ? this.threads : (this.characters || (this.characters = []));
    const key = (isThread ? "t" : "c") + Date.now().toString(36);
    const label = isThread ? "New thread" : "New character";
    const color = ROW_PALETTE[rows.length % ROW_PALETTE.length];
    const row = { key, label, note: "", color, mark: markFromLabel(label) };
    this.pushUndo();
    rows.push(row);
    // Open straight into inline edit so the user can name it immediately.
    this.setState({ editingRow: key, rowDraft: { ...row }, selected: null });
  }
  startEditRow(key) {
    const row = (this.curRows() || []).find((r) => r.key === key);
    if (!row) return;
    this.setState({ editingRow: key, rowDraft: { label: row.label, note: row.note || "", color: row.color, mark: row.mark } });
  }
  onRowDraft(field, value) { this.setState((s) => ({ rowDraft: { ...s.rowDraft, [field]: value } })); }
  commitEditRow() {
    const key = this.state.editingRow;
    const draft = this.state.rowDraft || {};
    const row = (this.curRows() || []).find((r) => r.key === key);
    this.setState({ editingRow: null, rowDraft: {} });
    if (!row) return;
    const label = (draft.label || "").trim() || row.label;
    const mark = (draft.mark || "").trim() || markFromLabel(label);
    this.pushUndo();
    row.label = label;
    row.note = (draft.note || "").trim();
    row.color = draft.color || row.color;
    row.mark = mark;
    this.setState({ dirty: true });
  }
  cancelEditRow() { this.setState({ editingRow: null, rowDraft: {} }); }
  deleteRow(key) {
    const isThread = this.state.view === "thread";
    const rows = isThread ? this.threads : this.characters;
    const row = (rows || []).find((r) => r.key === key);
    if (!row) return;
    if (!window.confirm(`Delete "${row.label}"? Any moments on this ${isThread ? "thread" : "arc"} are kept but moved to an Unassigned row until you re-home them.`))
      return;
    this.pushUndo();
    const idx = rows.findIndex((r) => r.key === key);
    if (idx > -1) rows.splice(idx, 1);
    // Orphan the moments homed here (they keep their other axis) and strip the
    // key from every co-appearance list.
    (this.moments || []).forEach((m) => {
      if (isThread) {
        if (m.thread === key) m.thread = null;
        if (Array.isArray(m.coThreads)) m.coThreads = m.coThreads.filter((k) => k !== key);
      } else {
        if (m.char === key) m.char = null;
        if (Array.isArray(m.coChars)) m.coChars = m.coChars.filter((k) => k !== key);
      }
    });
    this.setState({ editingRow: null, rowDraft: {}, selected: null, dirty: true });
  }

  // --- chapters (columns) --------------------------------------------------
  // `n` is both identity (moment.ch) and sort order, so it stays canonical
  // 1..N in array order; every structural change reorders the array then calls
  // renumberChapters(), which reassigns n and remaps every moment.ch.
  renumberChapters() {
    const map = {};
    this.chapters.forEach((c, i) => { map[c.n] = i + 1; });
    this.chapters.forEach((c, i) => { c.n = i + 1; });
    (this.moments || []).forEach((m) => { if (map[m.ch] != null) m.ch = map[m.ch]; });
    this.recomputeAutoLabels();
  }
  // Regenerate labels for auto-labelled chapters only. Prologue chapters read
  // "Prologue" and are skipped by the running counter, so numbered chapters
  // count from 1 after a prologue. Manual labels are never touched.
  recomputeAutoLabels() {
    let k = 0;
    this.chapters.forEach((c) => {
      if (!c.labelAuto) return;
      if (c.prologue) { c.label = "Prologue"; return; }
      k += 1;
      c.label = "Ch " + k;
    });
  }
  addChapter() { this.insertChapter(this.chapters.length); }
  insertChapter(atIndex) {
    this.pushUndo();
    const at = Math.max(0, Math.min(atIndex, this.chapters.length));
    this.chapters.splice(at, 0, { n: 0, label: "", title: "", labelAuto: true });
    this.renumberChapters();
    const c = this.chapters[at];
    this.setState({ editingChapter: c.n, chapterDraft: { label: c.label, title: c.title }, dirty: true });
  }
  deleteChapter(n) {
    if (this.chapters.length <= 1) { window.alert("A board needs at least one chapter."); return; }
    const idx = this.chapters.findIndex((c) => c.n === n);
    if (idx === -1) return;
    const inCh = (this.moments || []).filter((m) => m.ch === n).length;
    if (inCh > 0 && !window.confirm(`Delete this chapter? Its ${inCh} moment${inCh === 1 ? "" : "s"} will move to the ${idx === 0 ? "next" : "previous"} chapter.`))
      return;
    this.pushUndo();
    // Re-home this chapter's moments onto a neighbour before removing it.
    const neighbourN = idx === 0 ? this.chapters[1].n : this.chapters[idx - 1].n;
    (this.moments || []).forEach((m) => { if (m.ch === n) m.ch = neighbourN; });
    this.chapters.splice(idx, 1);
    this.renumberChapters();
    this.setState({ editingChapter: null, chapterDraft: {}, dirty: true });
  }
  moveChapter(n, dir) {
    const idx = this.chapters.findIndex((c) => c.n === n);
    const j = idx + dir;
    if (idx === -1 || j < 0 || j >= this.chapters.length) return;
    this.pushUndo();
    const [c] = this.chapters.splice(idx, 1);
    this.chapters.splice(j, 0, c);
    this.renumberChapters();
    this.setState({ editingChapter: c.n, dirty: true }); // n changed; keep editor on it
  }
  startEditChapter(n) {
    const c = this.chapters.find((x) => x.n === n);
    if (!c) return;
    this.setState({ editingChapter: n, chapterDraft: { label: c.label, title: c.title || "" } });
  }
  onChapterDraft(field, value) { this.setState((s) => ({ chapterDraft: { ...s.chapterDraft, [field]: value } })); }
  commitEditChapter() {
    const n = this.state.editingChapter;
    const draft = this.state.chapterDraft || {};
    const c = this.chapters.find((x) => x.n === n);
    this.setState({ editingChapter: null, chapterDraft: {} });
    if (!c) return;
    this.pushUndo();
    const label = (draft.label || "").trim();
    // A hand-typed label takes the chapter off auto-numbering; a blank label
    // leaves the current one untouched.
    if (label && label !== c.label) { c.label = label; c.labelAuto = false; }
    c.title = (draft.title || "").trim();
    this.setState({ dirty: true });
  }
  cancelEditChapter() { this.setState({ editingChapter: null, chapterDraft: {} }); }
  toggleChapterPrologue(n) {
    const c = this.chapters.find((x) => x.n === n);
    if (!c) return;
    this.pushUndo();
    c.prologue = !c.prologue;
    if (c.prologue) c.labelAuto = true; // "Prologue" is an auto label
    this.recomputeAutoLabels();
    this.setState((s) => ({ dirty: true, chapterDraft: { ...s.chapterDraft, label: c.label } }));
  }
  resetChapterAuto(n) {
    const c = this.chapters.find((x) => x.n === n);
    if (!c) return;
    this.pushUndo();
    c.labelAuto = true;
    this.recomputeAutoLabels();
    this.setState((s) => ({ dirty: true, chapterDraft: { ...s.chapterDraft, label: c.label } }));
  }

  nowLabel() { const d = new Date(); return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); }
  pushUndo() {
    this.markSave();
    this.undoStack = this.undoStack || [];
    this.undoStack.push({ moments: JSON.parse(JSON.stringify(this.moments)), written: Array.from(this.written || []) });
    if (this.undoStack.length > 60) this.undoStack.shift();
  }
  undo() {
    if (!this.undoStack || !this.undoStack.length) return;
    this.markSave();
    const snap = this.undoStack.pop();
    this.moments = JSON.parse(JSON.stringify(snap.moments));
    this.written = new Set(snap.written);
    this.setState((s) => ({ selected: null, connectMode: false, connectFrom: null, dirty: true, undoTick: (s.undoTick || 0) + 1 }));
  }
  toggleMenu() {
    const opening = !this.state.menuOpen;
    this.setState({ menuOpen: opening });
    // Snapshots live in a subcollection and are fetched on demand (ADR 0001).
    if (opening && !this.state.versionsLoaded && !this.state.versionsBusy) {
      this.loadVersions();
    }
  }
  loadVersions() {
    if (!this.projectId) { this.setState({ versionsLoaded: true }); return; }
    this.setState({ versionsBusy: true });
    listSnapshots(this.projectId)
      .then((rows) => this.setState({ versions: rows, versionsLoaded: true, versionsBusy: false }))
      .catch((err) => {
        console.warn("PlotBoard: could not load snapshots", err);
        this.setState({ versionsBusy: false, versionsLoaded: true });
      });
  }
  onDraftName(e) { const v = e.target.value; this.setState({ draftName: v }); }
  snapshot() {
    if (!this.projectId) return;
    const name = (this.state.draftName || "").trim() || "Draft " + (this.state.versions.length + 1);
    const snap = {
      name, when: this.nowLabel(),
      moments: JSON.parse(JSON.stringify(this.moments)), written: Array.from(this.written || []),
    };
    // Optimistic local insert, then persist to the subcollection.
    const tempId = "pending-" + Date.now();
    this.setState((s) => ({
      versions: [{ id: tempId, ...snap }, ...s.versions],
      draftName: "", dirty: false, lastVerName: name,
    }));
    this.markSave(); // lastVerName is part of the project doc
    this.persist();
    addSnapshot(this.projectId, snap)
      .then((saved) => this.setState((s) => ({
        versions: s.versions.map((v) => (v.id === tempId ? saved : v)),
      })))
      .catch((err) => {
        console.warn("PlotBoard: snapshot failed to save", err);
        this.setState((s) => ({ versions: s.versions.filter((v) => v.id !== tempId) }));
      });
  }
  revertTo(id) {
    const v = this.state.versions.find((x) => x.id === id);
    if (!v) return;
    this.pushUndo();
    this.moments = JSON.parse(JSON.stringify(v.moments));
    this.written = new Set(v.written);
    this.setState({ selected: null, connectMode: false, connectFrom: null, dirty: false, lastVerName: v.name, menuOpen: false });
  }
  deleteVersion(id) {
    this.setState((s) => ({ versions: s.versions.filter((x) => x.id !== id) }));
    if (this.projectId && !String(id).startsWith("pending-")) {
      deleteSnapshot(this.projectId, id).catch((err) =>
        console.warn("PlotBoard: could not delete snapshot", err)
      );
    }
  }
  // --- project name (inline rename in the board header) ---
  startRenameProject() { this.setState({ editingName: true, nameDraft: this.state.name }); }
  onNameDraft(e) { this.setState({ nameDraft: e.target.value }); }
  commitRenameProject() {
    const name = (this.state.nameDraft || "").trim();
    this.setState({ editingName: false });
    if (!name || name === this.state.name) return;
    this.setState({ name });
    if (this.projectId) {
      renameProject(this.projectId, name).catch((err) =>
        console.warn("PlotBoard: rename failed to save", err)
      );
    }
  }
  cancelRenameProject() { this.setState({ editingName: false }); }
  exit() {
    if (this._needSave) this.flushSave();
    if (this.props.onExit) this.props.onExit();
  }
  // --- block text (inline edit in the sidebar) ----------------------------
  startEditText() {
    const m = (this.moments || []).find((x) => x.id === this.state.selected);
    if (!m) return;
    this.setState({ editingText: true, textDraft: m.text || "", blockMenu: false });
  }
  onTextDraft(e) { const v = e.target.value; this.setState({ textDraft: v }); }
  commitEditText() {
    const m = (this.moments || []).find((x) => x.id === this.state.selected);
    this.setState({ editingText: false });
    if (!m) return;
    const text = (this.state.textDraft || "").trim();
    if (!text || text === m.text) return; // blank keeps the current text
    this.pushUndo();
    m.text = text;
    this.setState({ dirty: true });
  }
  cancelEditText() { this.setState({ editingText: false }); }
  deleteBlock(id) {
    if (!this.moments) return;
    this.pushUndo();
    this.moments = this.moments.filter((m) => m.id !== id);
    this.moments.forEach((m) => { m.deps = m.deps.filter((d) => d !== id); });
    if (this.written) this.written.delete(id);
    this.setState({ selected: null, connectMode: false, connectFrom: null, dirty: true });
  }

  lineage(id, moments) {
    const byId = {}; moments.forEach((m) => (byId[m.id] = m));
    const up = new Set(), down = new Set();
    const goUp = (i) => (byId[i] ? byId[i].deps : []).forEach((d) => { if (byId[d] && !up.has(d)) { up.add(d); goUp(d); } });
    const goDown = (i) => moments.filter((m) => m.deps.includes(i)).forEach((c) => { if (!down.has(c.id)) { down.add(c.id); goDown(c.id); } });
    goUp(id); goDown(id);
    return new Set([id, ...up, ...down]);
  }

  onDragStart(id) {
    return (e) => { this.dragId = id; if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(id)); } };
  }
  onDragEnd() { return () => { this.dragId = null; if (this.root) this.root.querySelectorAll(".cell.drophot").forEach((c) => c.classList.remove("drophot")); }; }
  makeDrop(ch, rk) {
    return (e) => {
      e.preventDefault();
      e.currentTarget.classList.remove("drophot");
      const m = (this.moments || []).find((x) => x.id === this.dragId);
      if (!m) return;
      if (this.rowKeyOf(m) !== rk) return;
      if (m.ch === ch) return;
      this.pushUndo();
      m.ch = ch; this.dragId = null; this.setState({ dirty: true });
    };
  }
  makeDragEnter(ch, rk) {
    return (e) => {
      const m = (this.moments || []).find((x) => x.id === this.dragId);
      if (m && this.rowKeyOf(m) === rk) e.currentTarget.classList.add("drophot");
    };
  }
  onDragLeave() { return (e) => { e.currentTarget.classList.remove("drophot"); }; }

  stubStyle(m, r, related, broken) {
    const ed = this.ed();
    const sel = this.state.selected === m.id;
    const dim = related && !related.has(m.id);
    let s;
    if (ed === "weave") {
      s = "position:relative;z-index:3;display:flex;align-items:center;gap:7px;max-width:138px;background:#fbf7e6;border:1px solid #c9b98a;border-radius:16px;padding:5px 11px 5px 6px;font-size:11px;color:#233029;cursor:grab;transition:opacity .2s,box-shadow .15s;";
    } else {
      s = "position:relative;z-index:3;background:#f7f2de;border:1px solid #c9b98a;border-radius:2px;padding:8px 10px 7px;font-size:12px;line-height:1.3;color:#233029;cursor:grab;box-shadow:0 1px 0 #c9b98a;transition:box-shadow .15s,opacity .2s;";
    }
    if (!this.isWritten(m.id)) s += "border-style:dashed;";
    if (this.isWritten(m.id)) s += "background:#ece2c2;border-color:#a98f5f;";
    if (broken) s += "border-color:#b23a2e;box-shadow:0 0 0 1.5px #b23a2e;";
    if (sel) s += "border-color:#2f6e62;box-shadow:0 0 0 2px #2f6e62;background:#fffdf3;";
    if (this.state.connectMode && this.state.connectFrom === m.id) s += "border-color:#b58a2e;box-shadow:0 0 0 2px #b58a2e;";
    if (this.state.connectMode) s += "cursor:crosshair;";
    if (dim) s += "opacity:.24;";
    return s;
  }
  markStyle(color, broken) {
    const bg = broken ? "#b23a2e" : color;
    if (this.ed() === "weave")
      return "flex:0 0 auto;width:18px;height:18px;border-radius:50%;background:" + bg + ";color:#f6f2e2;font-family:'IBM Plex Mono',monospace;font-size:9px;display:flex;align-items:center;justify-content:center;";
    return "position:absolute;top:-7px;right:-7px;width:19px;height:19px;border-radius:50%;background:" + bg + ";color:#f6f2e2;font-family:'IBM Plex Mono',monospace;font-size:9.5px;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 2px rgba(0,0,0,.3);z-index:4;";
  }
  refItemStyle(broken) {
    let s = "display:flex;gap:9px;align-items:flex-start;padding:8px 0;border-bottom:1px solid rgba(110,74,46,.16);cursor:pointer;";
    if (broken) s += "background:rgba(178,58,46,.06);";
    return s;
  }
  chChip(broken, tight) {
    const c = broken ? "#b23a2e" : tight ? "#b58a2e" : "#5c6b5f";
    return "flex:0 0 auto;font-family:'IBM Plex Mono',monospace;font-size:9px;color:#f6f2e2;background:" + c + ";padding:2px 5px;border-radius:2px;margin-top:1px;";
  }

  detailVal(sel, moments) {
    const byId = {}; moments.forEach((m) => (byId[m.id] = m));
    const m = byId[sel]; if (!m) return null;
    const rowsList = this.state.view === "thread" ? this.threads : this.characters;
    const r = rowsList.find((x) => x.key === this.rowKeyOf(m));
    // The edge is stored on the dependent block's deps array: for an upstream
    // link that's the selected block; for a downstream link it's the other one.
    const up = m.deps.map((d) => byId[d]).filter(Boolean).map((dm) => {
      const broken = dm.ch > m.ch, tight = dm.ch === m.ch;
      return { ch: this.chShort(dm.ch), text: dm.text, style: this.refItemStyle(broken), chStyle: this.chChip(broken, tight), onClick: () => this.select(dm.id), onRemove: () => this.removeDependency(sel, dm.id), removeTitle: "Remove this connection" };
    });
    const down = moments.filter((x) => x.deps.includes(sel)).map((x) => {
      const broken = m.ch > x.ch, tight = m.ch === x.ch;
      return { ch: this.chShort(x.ch), text: x.text, style: this.refItemStyle(broken), chStyle: this.chChip(broken, tight), onClick: () => this.select(x.id), onRemove: () => this.removeDependency(x.id, sel), removeTitle: "Remove this connection" };
    });
    const hasBreak = up.some((u) => u.style.indexOf("178,58,46") > -1) || down.some((d) => d.style.indexOf("178,58,46") > -1);
    const written = this.isWritten(sel);
    const coRows = this.coKeys(m).map((k) => rowsList.find((x) => x.key === k)).filter(Boolean);
    // Editable cast: every row on this axis becomes a chip. The home row is
    // filled and fixed; the rest toggle the block's mirror in/out of that row.
    const homeKey = r ? this.rowKeyOf(m) : null;
    const coSet = new Set(this.coKeys(m));
    const chipBase = "display:inline-flex;align-items:center;gap:6px;padding:4px 10px 4px 5px;border-radius:12px;font-family:'IBM Plex Mono',monospace;font-size:10px;line-height:1;transition:opacity .15s;";
    const markBase = "flex:0 0 auto;width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:8px;";
    const castChips = rowsList.map((x) => {
      const isHome = x.key === homeKey;
      const filled = isHome || coSet.has(x.key);
      let style = chipBase;
      if (filled) style += "background:" + x.color + ";color:#f6f2e2;border:1px solid " + x.color + ";";
      else style += "background:transparent;color:#5c6b5f;border:1px dashed " + x.color + ";";
      style += isHome ? "cursor:default;font-weight:500;" : "cursor:pointer;";
      const markStyle = markBase + (filled
        ? "background:#f6f2e2;color:" + x.color + ";"
        : "background:" + x.color + ";color:#f6f2e2;");
      return {
        key: x.key, mark: x.mark, label: x.label, style, markStyle, isHome,
        title: isHome ? "Home row" : coSet.has(x.key) ? "Mirrored here — tap to remove" : "Tap to mirror this moment here",
        onClick: isHome ? null : () => this.toggleCoRow(sel, x.key),
      };
    });
    const homeRowMark = r ? { mark: r.mark, color: r.color } : null;
    return {
      chLabel: this.chInfo(m.ch),
      rowLabel: (this.state.view === "thread" ? "Thread · " : "Arc · ") + (r ? r.label : "Unassigned"),
      text: m.text, upstream: up, downstream: down,
      // --- inline text editing ----------------------------------------------
      editingText: !!this.state.editingText,
      textDraft: this.state.textDraft || "",
      onStartEditText: () => this.startEditText(),
      onTextDraft: (e) => this.onTextDraft(e),
      onCommitText: () => this.commitEditText(),
      onCancelText: () => this.cancelEditText(),
      noUp: up.length === 0, noDown: down.length === 0,
      hasBreak,
      breakMsg: "This lands before something it relies on — the reader won't have that yet. Move it later, or move the setup earlier.",
      // --- status: one boolean, shown as a Planned | Written segment ---------
      statusSegWrap: "display:flex;border:1px solid #b99a6b;border-radius:3px;overflow:hidden;margin:0 0 4px;",
      statusSegs: [
        {
          key: "planned", label: "◇ Planned",
          style: "flex:1 1 0;text-align:center;padding:8px 6px;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.02em;cursor:pointer;border:none;" + (!written ? "background:#eadfbe;color:#6f5a1e;font-weight:500;" : "background:transparent;color:#5c6b5f;"),
          onClick: () => this.setWritten(sel, false),
        },
        {
          key: "written", label: "✓ Written",
          style: "flex:1 1 0;text-align:center;padding:8px 6px;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.02em;cursor:pointer;border:none;border-left:1px solid #b99a6b;" + (written ? "background:#c9ded4;color:#1f4a41;font-weight:500;" : "background:transparent;color:#5c6b5f;"),
          onClick: () => this.setWritten(sel, true),
        },
      ],
      // --- placement: home line (reassignable) + mirror chips ----------------
      rowKey: r ? this.rowKeyOf(m) : "",
      homeUnassigned: !r,
      homeMark: homeRowMark,
      homeDotStyle: homeRowMark ? "flex:0 0 auto;width:11px;height:11px;border-radius:50%;background:" + homeRowMark.color + ";" : "",
      homeSelectStyle: "flex:1 1 auto;font-family:'IBM Plex Mono',monospace;font-size:11px;color:#233029;background:transparent;border:none;cursor:pointer;padding:0;",
      homeLineStyle: "display:flex;align-items:center;gap:9px;padding:9px 11px;border:1px solid #b99a6b;border-radius:2px;background:#fbf7e6;margin:0 0 11px;",
      rowOptions: rowsList.map((x) => ({ key: x.key, label: x.label })),
      onAssign: (e) => this.assignRow(sel, e.target.value),
      mirrorChips: castChips.filter((c) => !c.isHome),
      mirrorLabel: this.state.view === "thread" ? "Also mirrored in" : "Also on the page",
      // --- overflow (⋯) menu: connect + delete -------------------------------
      blockMenuOpen: !!this.state.blockMenu,
      onToggleBlockMenu: () => this.toggleBlockMenu(),
      connectActive: this.state.connectMode && this.state.connectFrom === sel,
      connectLabel: this.state.connectMode && this.state.connectFrom === sel ? "Now click the block that depends on this…" : "⤳ Connect from this block",
      onConnectFrom: () => { this.setState({ blockMenu: false }); this.startConnect(sel); },
      onDelete: () => { this.setState({ blockMenu: false }); this.deleteBlock(sel); },
    };
  }

  drawArrows() {
    const root = this.root; if (!root) return;
    const svg = root.querySelector("svg.arrows");
    const wrap = root.querySelector(".rows-wrap");
    if (!svg || !wrap) return;
    const ed = this.ed();
    if (wrap.scrollWidth === 0) { clearTimeout(this._retry); this._retry = setTimeout(() => this.drawArrows(), 130); return; }
    const wr = wrap.getBoundingClientRect();
    svg.setAttribute("width", wrap.scrollWidth);
    svg.setAttribute("height", wrap.scrollHeight);
    const soft = ed === "weave" ? "#a7c3ba" : "#89b3a8";
    svg.innerHTML =
      "<defs>" +
      '<marker id="ah-' + ed + '" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto"><path d="M0,0 L5,3 L0,6 Z" fill="' + soft + '"></path></marker>' +
      '<marker id="ahon-' + ed + '" markerWidth="8" markerHeight="8" refX="5" refY="3" orient="auto"><path d="M0,0 L5,3 L0,6 Z" fill="#2f6e62"></path></marker>' +
      '<marker id="ahred-' + ed + '" markerWidth="8" markerHeight="8" refX="5" refY="3" orient="auto"><path d="M0,0 L5,3 L0,6 Z" fill="#b23a2e"></path></marker>' +
      "</defs>";
    const moments = this.curMoments();
    const idset = new Set(moments.map((m) => m.id));
    const byId = {}; moments.forEach((m) => (byId[m.id] = m));
    const els = {};
    root.querySelectorAll(".stub").forEach((s) => (els[s.dataset.mid] = s));
    const sel = this.state.selected;
    const related = sel ? this.lineage(sel, moments) : null;
    moments.forEach((m) => m.deps.forEach((depId) => {
      if (!idset.has(depId)) return;
      const from = els[depId], to = els[m.id];
      if (!from || !to) return;
      const fr = from.getBoundingClientRect(), tr = to.getBoundingClientRect();
      const x1 = fr.right - wr.left, y1 = fr.top - wr.top + fr.height / 2;
      const x2 = tr.left - wr.left, y2 = tr.top - wr.top + tr.height / 2;
      const dm = byId[depId];
      const broken = dm.ch > m.ch, tight = dm.ch === m.ch;
      let d;
      if (ed === "weave") {
        const dx = Math.max(28, Math.abs(x2 - x1) * 0.5);
        d = "M " + x1 + " " + y1 + " C " + (x1 + dx) + " " + y1 + ", " + (x2 - dx) + " " + y2 + ", " + (x2 - 6) + " " + y2;
      } else {
        const sL = fr.left - wr.left, sR = fr.right - wr.left, sT = fr.top - wr.top, sB = fr.bottom - wr.top;
        const tL = tr.left - wr.left, tR = tr.right - wr.left, tT = tr.top - wr.top, tB = tr.bottom - wr.top;
        const scx = (sL + sR) / 2, scy = (sT + sB) / 2, tcx = (tL + tR) / 2, tcy = (tT + tB) / 2;
        const sameCol = Math.abs(scx - tcx) < 70;
        if (sameCol) {
          // cascading blocks stacked in one cell: exit the right side, run down the rail, hook into the target's edge
          const gx = Math.max(sR, tR) + 14;
          if (tcy >= scy) {
            const preY = tT - 5;
            d = "M " + sR + " " + scy + " L " + gx + " " + scy + " L " + gx + " " + preY + " L " + tcx + " " + preY + " L " + tcx + " " + (tT + 1);
          } else {
            const preY = tB + 5;
            d = "M " + sR + " " + scy + " L " + gx + " " + scy + " L " + gx + " " + preY + " L " + tcx + " " + preY + " L " + tcx + " " + (tB - 1);
          }
        } else {
          const midX = Math.max(x1 + 10, Math.min(x2 - 10, x1 + (x2 - x1) * 0.45));
          d = "M " + x1 + " " + y1 + " L " + midX + " " + y1 + " L " + midX + " " + y2 + " L " + (x2 - 6) + " " + y2;
        }
      }
      const active = related && related.has(depId) && related.has(m.id);
      const p = document.createElementNS(PlotBoard.NS, "path");
      p.setAttribute("d", d);
      p.setAttribute("fill", "none");
      let color = broken ? "#b23a2e" : tight ? "#b58a2e" : soft;
      if (active && !broken) color = "#2f6e62";
      p.setAttribute("stroke", color);
      p.setAttribute("stroke-width", broken ? 2 : active ? 1.9 : 1.2);
      if (broken) p.setAttribute("stroke-dasharray", "2 4");
      p.setAttribute("marker-end", broken ? "url(#ahred-" + ed + ")" : active ? "url(#ahon-" + ed + ")" : "url(#ah-" + ed + ")");
      p.style.opacity = sel ? (active ? "1" : "0.07") : broken ? "0.92" : "0.5";
      svg.appendChild(p);
    }));
  }

  renderVals() {
    const setRoot = (el) => { this.root = el; };
    const ed = this.ed();
    const isLedger = ed === "ledger", isWeave = ed === "weave";
    const view = this.state.view;
    const moments = this.curMoments();
    const rows = view === "thread" ? this.threads : this.characters;
    // Moments whose home row was deleted keep their block but land in a
    // synthetic "Unassigned" row, shown only when at least one exists.
    const validKeys = new Set(rows.map((r) => r.key));
    const hasOrphans = moments.some((m) => !validKeys.has(this.rowKeyOf(m)));
    const unassignedRow = {
      key: "__unassigned", label: "Unassigned",
      note: view === "thread" ? "no thread — reassign these" : "no arc — reassign these",
      color: "#8a7a5a", mark: "?", unassigned: true,
    };
    const renderRows = hasOrphans ? rows.concat([unassignedRow]) : rows;
    const byId = {}; moments.forEach((m) => (byId[m.id] = m));

    // continuity
    let breakCount = 0;
    const brokenStubs = new Set();
    moments.forEach((m) => m.deps.forEach((d) => {
      const dm = byId[d]; if (!dm) return;
      if (dm.ch > m.ch) { breakCount++; brokenStubs.add(m.id); brokenStubs.add(d); }
    }));

    const sel = this.state.selected;
    const related = sel ? this.lineage(sel, moments) : null;

    const outCount = {}; moments.forEach((m) => m.deps.forEach((d) => { outCount[d] = (outCount[d] || 0) + 1; }));

    const rowVals = renderRows.map((r, idx) => {
      const inThisRow = (m) => r.unassigned ? !validKeys.has(this.rowKeyOf(m)) : this.rowKeyOf(m) === r.key;
      const bg = r.unassigned ? "rgba(178,58,46,.05)" : idx % 2 ? "rgba(110,74,46,.05)" : "transparent";
      const labelBg = r.unassigned ? "#e7d9c2" : idx % 2 ? "#e6ddc2" : "#eae3cc";
      const pipStyle = (color, dimmed) => "flex:0 0 auto;width:15px;height:15px;border-radius:50%;background:" + color + ";color:#f6f2e2;font-family:'IBM Plex Mono',monospace;font-size:8px;display:flex;align-items:center;justify-content:center;" + (dimmed ? "opacity:.85;" : "");
      const cells = this.chapters.map((c) => {
        const list = moments.filter((m) => inThisRow(m) && m.ch === c.n).map((m) => {
          const broken = brokenStubs.has(m.id) && m.deps.some((d) => byId[d] && byId[d].ch > m.ch);
          const anyBroken = m.deps.some((d) => byId[d] && byId[d].ch > m.ch) || moments.some((x) => x.deps.includes(m.id) && x.ch < m.ch);
          const coRows = this.coKeys(m).map((k) => rows.find((x) => x.key === k)).filter(Boolean);
          return {
            id: m.id, drag: true,
            isLedger, isWeave,
            planned: !this.isWritten(m.id), plannedBg: bg === "transparent" ? "#f7f2de" : "#f2ead0",
            written: this.isWritten(m.id),
            style: this.stubStyle(m, r, related, anyBroken),
            markStyle: this.markStyle(r.color, anyBroken),
            mark: r.mark, text: m.text,
            short: m.text.length > 26 ? m.text.slice(0, 24).trim() + "…" : m.text,
            inCount: m.deps.length, outCount: outCount[m.id] || 0,
            showBroken: anyBroken,
            hasMeta: this.isWritten(m.id) || anyBroken,
            hasPips: coRows.length > 0,
            pips: coRows.map((cr) => ({ mark: cr.mark, name: cr.label, style: pipStyle(cr.color) })),
            onClick: () => this.select(m.id),
            onDragStart: this.onDragStart(m.id),
            onDragEnd: this.onDragEnd(),
          };
        });
        const echoes = moments.filter((m) => this.rowKeyOf(m) !== r.key && this.coKeys(m).includes(r.key) && m.ch === c.n).map((m) => {
          const homeRow = rows.find((x) => x.key === this.rowKeyOf(m));
          const col = homeRow ? homeRow.color : "#8a7a5a";
          const isSel = sel === m.id;
          const dimmed = related && !related.has(m.id);
          let s = "display:flex;align-items:center;gap:6px;padding:3px 8px;border:1px dashed " + col + ";border-radius:11px;background:rgba(247,242,222,.4);color:#5c6b5f;font-size:10px;font-family:'IBM Plex Mono',monospace;cursor:pointer;z-index:3;transition:opacity .2s;";
          if (isSel) s += "border-style:solid;background:#fffdf3;color:#233029;";
          if (dimmed) s += "opacity:.22;";
          return {
            id: m.id,
            text: (isWeave ? "" : "↳ ") + (m.text.length > 24 ? m.text.slice(0, 22).trim() + "…" : m.text),
            full: m.text + "  ·  home: " + (homeRow ? homeRow.label : ""),
            dotStyle: "flex:0 0 auto;width:11px;height:11px;border-radius:50%;background:" + col + ";",
            style: s,
            onClick: () => this.select(m.id),
          };
        });
        // Placement mode: a faint tint follows the hovered column, and the one
        // hovered cell borrows the same green outline as the drag drop helper
        // (see .cell.drophot in index.html) plus a ＋. Orphan/unassigned rows
        // can't hold a home block, so they're not placement targets.
        const placing = this.state.placing;
        const canPlace = placing && !r.unassigned;
        const colHot = canPlace && this.state.placingCh === c.n;
        const cellHot = colHot && this.state.placingRk === r.key;
        let placeStyle = "position:absolute;inset:0;z-index:6;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background .12s;";
        if (colHot) placeStyle += "background:rgba(47,110,98,.05);";
        if (cellHot) placeStyle += "background:rgba(47,110,98,.10);box-shadow:inset 0 0 0 1.5px #2f6e62;";
        const placePlus = "font-family:'IBM Plex Mono',monospace;display:flex;align-items:center;justify-content:center;width:28px;height:28px;font-size:16px;border-radius:50%;background:#2f6e62;color:#f6f2e2;box-shadow:0 2px 7px rgba(47,110,98,.35);";
        return {
          ch: c.n, rk: r.key,
          style: "width:184px;flex:0 0 184px;border-left:1px solid #b99a6b;padding:10px 22px;display:flex;flex-direction:column;gap:8px;justify-content:center;min-height:104px;position:relative;background:" + bg + ";",
          moments: list,
          echoes,
          onDrop: this.makeDrop(c.n, r.key),
          onDragOver: (e) => e.preventDefault(),
          onDragEnter: this.makeDragEnter(c.n, r.key),
          onDragLeave: this.onDragLeave(),
          canPlace, cellHot, placeStyle, placePlus,
          onPlaceEnter: () => this.hoverPlace(c.n, r.key),
          onPlace: () => this.placeBlock(c.n, r.key),
        };
      });
      const count = moments.filter((m) => inThisRow(m)).length;
      return {
        key: r.key, label: r.label, note: r.note, hasNote: !!r.note,
        unassigned: !!r.unassigned, color: r.color, mark: r.mark,
        editing: this.state.editingRow === r.key,
        tally: count + (count === 1 ? " entry" : " entries"),
        showThread: isWeave,
        labelStyle: "width:190px;flex:0 0 190px;padding:12px 14px 12px 12px;display:flex;flex-direction:column;justify-content:center;border-right:2px solid #6e4a2e;position:sticky;left:0;z-index:4;background:" + labelBg + ";",
        cells,
      };
    });

    const entries = moments.length;
    const tagline = isWeave ? "story map · threads crossing chapter by chapter" : "continuity book · what the reader must already know";
    const writtenCount = moments.filter((m) => this.isWritten(m.id)).length;
    const editionSub = tagline + "   ·   " + entries + " moments  ·  " + writtenCount + "/" + entries + " written";

    const clear = breakCount === 0;
    const contStyle = "font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.02em;padding:6px 11px;border-radius:2px;border:1px solid " +
      (clear ? "#2f6e62;color:#2f6e62;background:rgba(47,110,98,.08);" : "#b23a2e;color:#b23a2e;background:rgba(178,58,46,.09);");
    const contLabel = clear ? "✓ Continuity clear" : breakCount === 1 ? "1 continuity break" : breakCount + " continuity breaks";

    const tBase = "font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.03em;padding:8px 14px;cursor:pointer;border:none;";
    const threadBtn = tBase + "border-right:1px solid #6e4a2e;" + (view === "thread" ? "background:#2f6e62;color:#f6f2e2;" : "background:#f7f2de;color:#233029;");
    const charBtn = tBase + (view === "character" ? "background:#2f6e62;color:#f6f2e2;" : "background:#f7f2de;color:#233029;");
    const ledgerBtn = tBase + "border-right:1px solid #6e4a2e;" + (isLedger ? "background:#6e4a2e;color:#f6f2e2;" : "background:#f7f2de;color:#233029;");
    const weaveBtn = tBase + (isWeave ? "background:#6e4a2e;color:#f6f2e2;" : "background:#f7f2de;color:#233029;");
    const addRowLabel = view === "thread" ? "＋ Add story thread" : "＋ Add character";

    const detail = sel ? this.detailVal(sel, moments) : null;

    const connectMode = this.state.connectMode, connectFrom = this.state.connectFrom;
    const toolBtn = "display:flex;align-items:center;gap:6px;font-family:'IBM Plex Mono',monospace;font-size:10.5px;letter-spacing:.02em;padding:6px 12px;border-radius:2px;cursor:pointer;border:1px solid #6e4a2e;";
    const addBtn = toolBtn + (this.state.placing ? "background:#b58a2e;color:#f6f2e2;border-color:#b58a2e;" : "background:#2f6e62;color:#f6f2e2;border-color:#2f6e62;");
    const connectBtn = toolBtn + (connectMode ? "background:#b58a2e;color:#f6f2e2;border-color:#b58a2e;" : "background:#f7f2de;color:#233029;");
    const canUndo = !!(this.undoStack && this.undoStack.length);
    const undoBtn = toolBtn + (canUndo ? "background:#f7f2de;color:#233029;" : "background:#f7f2de;color:#b0a487;border-color:#c9b98a;cursor:default;");
    const connectHint = connectMode
      ? connectFrom == null ? "Click the setup block first" : "Now click the block that depends on it"
      : "";

    const dirty = this.state.dirty;
    const menuOpen = this.state.menuOpen;
    const lastVerName = this.state.lastVerName || "Working draft";
    const menuBtn = "position:relative;display:flex;align-items:center;gap:7px;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.03em;padding:8px 13px;cursor:pointer;border:1px solid #6e4a2e;border-radius:2px;" +
      (menuOpen ? "background:#233029;color:#f6f2e2;" : "background:#f7f2de;color:#233029;");
    const versionList = this.state.versions.map((v) => ({
      id: v.id, name: v.name, when: v.when,
      isCurrent: !dirty && v.name === this.state.lastVerName,
      rowStyle: "display:flex;align-items:center;gap:8px;padding:9px 10px;border:1px solid " +
        (!dirty && v.name === this.state.lastVerName ? "#2f6e62;background:#e6efe9;" : "#c9b98a;background:#fbf7e6;") + "border-radius:2px;",
      onRevert: () => this.revertTo(v.id),
      onDelete: () => this.deleteVersion(v.id),
      canDelete: true,
    }));

    const boardBg = isWeave ? "#e6ddc2" : "#eae3cc";

    return {
      setRoot,
      boardBg,
      editionTitle: isWeave ? "Weave" : "Ledger",
      editionSub,
      projectName: this.state.name,
      editingName: this.state.editingName,
      nameDraft: this.state.nameDraft,
      onStartRename: () => this.startRenameProject(),
      onNameDraft: (e) => this.onNameDraft(e),
      onCommitName: () => this.commitRenameProject(),
      onCancelName: () => this.cancelRenameProject(),
      onExit: () => this.exit(),
      contStyle, contLabel,
      threadBtn, charBtn, ledgerBtn, weaveBtn, addRowLabel,
      addBtn, connectBtn, connectHint, connectMode, undoBtn, canUndo, noUndo: !canUndo,
      onUndo: () => this.undo(),
      menuBtn, menuOpen, dirty, lastVerName, versionList,
      versionsBusy: this.state.versionsBusy,
      noVersions: this.state.versionsLoaded && !this.state.versionsBusy && versionList.length === 0,
      draftName: this.state.draftName,
      onToggleMenu: () => this.toggleMenu(),
      onDraftName: (e) => this.onDraftName(e),
      onSnapshot: () => this.snapshot(),
      placing: this.state.placing,
      addBlockLabel: this.state.placing ? "✕ Cancel placement" : "＋ Add block",
      placeHint: this.state.placing ? "Pick a cell — click the ＋ where the block should go  ·  Esc to cancel" : "",
      onAddBlock: () => this.startPlacing(),
      onToggleConnect: () => this.toggleConnect(),
      onLedger: () => this.setEdition("ledger"),
      onWeave: () => this.setEdition("weave"),
      onThread: () => this.setView("thread"),
      onChar: () => this.setView("character"),
      clearSel: () => this.setState({ selected: null, marginHidden: true }),
      // row (thread / character) editing
      onAddRow: () => this.addRow(),
      rowDraft: this.state.rowDraft || {},
      rowPalette: ROW_PALETTE,
      onStartEditRow: (key) => this.startEditRow(key),
      onRowDraft: (field, value) => this.onRowDraft(field, value),
      onCommitRow: () => this.commitEditRow(),
      onCancelRow: () => this.cancelEditRow(),
      onDeleteRow: (key) => this.deleteRow(key),
      // chapter (column) editing
      chapters: this.chapters.map((c, i) => ({
        n: c.n, label: c.label, title: c.title || "",
        prologue: !!c.prologue, labelAuto: !!c.labelAuto,
        index: i, editing: this.state.editingChapter === c.n,
      })),
      chapterDraft: this.state.chapterDraft || {},
      canDeleteChapter: this.chapters.length > 1,
      chapterCount: this.chapters.length,
      onAddChapter: () => this.addChapter(),
      onInsertChapter: (i) => this.insertChapter(i),
      onStartEditChapter: (n) => this.startEditChapter(n),
      onChapterDraft: (f, val) => this.onChapterDraft(f, val),
      onCommitChapter: () => this.commitEditChapter(),
      onCancelChapter: () => this.cancelEditChapter(),
      onDeleteChapter: (n) => this.deleteChapter(n),
      onMoveChapter: (n, dir) => this.moveChapter(n, dir),
      onToggleChapterPrologue: (n) => this.toggleChapterPrologue(n),
      onResetChapterAuto: (n) => this.resetChapterAuto(n),
      rowVals,
      hasDetail: !!detail, noDetail: !detail,
      showMargin: !!detail || !this.state.marginHidden,
      detail: detail || {},
    };
  }

  render() {
    const v = this.renderVals();
    const d = v.detail;
    return (
      <div ref={v.setRoot} style={sty(`width:100%;height:100%;display:flex;flex-direction:column;background:${v.boardBg};font-family:'Source Serif 4',serif;color:#233029;overflow:hidden;`)}>
        <header style={sty("display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:15px 20px 11px;border-bottom:3px double #6e4a2e;flex:0 0 auto;")}>
          <div>
            <div style={sty("display:flex;align-items:center;gap:9px;margin-bottom:4px;")}>
              <button onClick={v.onExit} title="Back to your projects" style={sty("font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.02em;padding:4px 9px;cursor:pointer;border:1px solid #6e4a2e;border-radius:2px;background:#f7f2de;color:#233029;")}>← Projects</button>
              <span style={sty("font-family:'IBM Plex Mono',monospace;font-size:10px;color:#8a7a5a;")}>·</span>
              <span style={sty("font-family:'IBM Plex Mono',monospace;font-size:10px;color:#5c6b5f;")}>{v.editionTitle}</span>
            </div>
            {v.editingName ? (
              <input
                autoFocus
                value={v.nameDraft}
                onChange={v.onNameDraft}
                onBlur={v.onCommitName}
                onKeyDown={(e) => { if (e.key === "Enter") v.onCommitName(); if (e.key === "Escape") v.onCancelName(); }}
                style={sty("font-family:'Sorts Mill Goudy',serif;font-weight:400;font-size:25px;letter-spacing:.3px;color:#233029;background:#fffdf3;border:1px solid #2f6e62;border-radius:2px;padding:0 6px;outline:none;")}
              />
            ) : (
              <h1 onClick={v.onStartRename} title="Click to rename this project" style={sty("font-family:'Sorts Mill Goudy',serif;font-weight:400;font-size:25px;margin:0;letter-spacing:.3px;cursor:text;")}>{v.projectName}</h1>
            )}
            <p style={sty("margin:3px 0 0;font-family:'IBM Plex Mono',monospace;font-size:10.5px;color:#5c6b5f;letter-spacing:.02em;")}>{v.editionSub}</p>
          </div>
          <div style={sty("display:flex;align-items:center;gap:13px;flex-wrap:wrap;")}>
            <div style={sty(v.contStyle)}>{v.contLabel}</div>
            <div style={sty("display:flex;border:1px solid #6e4a2e;border-radius:2px;overflow:hidden;")}>
              <button onClick={v.onLedger} style={sty(v.ledgerBtn)}>Ledger</button>
              <button onClick={v.onWeave} style={sty(v.weaveBtn)}>Weave</button>
            </div>
            <div style={sty("display:flex;border:1px solid #6e4a2e;border-radius:2px;overflow:hidden;")}>
              <button onClick={v.onThread} style={sty(v.threadBtn)}>Story Threads</button>
              <button onClick={v.onChar} style={sty(v.charBtn)}>Character Arcs</button>
            </div>
            <div style={sty("position:relative;")}>
              <button onClick={v.onToggleMenu} style={sty(v.menuBtn)}>
                <span>◷ Versions</span>
                {v.dirty && <span style={sty("width:7px;height:7px;border-radius:50%;background:#b58a2e;display:inline-block;")}></span>}
              </button>
              {v.menuOpen && (
                <div style={sty("position:absolute;right:0;top:calc(100% + 8px);z-index:30;width:306px;background:#efe8d0;border:1px solid #6e4a2e;border-radius:3px;box-shadow:0 18px 44px rgba(60,40,20,.30);padding:15px 15px 16px;")}>
                  <div style={sty("display:flex;justify-content:space-between;align-items:baseline;margin-bottom:11px;")}>
                    <span style={sty("font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#5c6b5f;")}>Version history</span>
                  </div>
                  <div style={sty("display:flex;align-items:center;gap:9px;margin-bottom:13px;padding:9px 11px;border:1px solid #b99a6b;border-radius:2px;background:#fbf7e6;")}>
                    <span style={sty("font-family:'IBM Plex Mono',monospace;font-size:10px;color:#233029;")}>Now:</span>
                    <span style={sty("font-family:'Sorts Mill Goudy',serif;font-size:16px;font-weight:400;color:#233029;flex:1;")}>{v.lastVerName}</span>
                    {v.dirty && <span style={sty("font-family:'IBM Plex Mono',monospace;font-size:9px;color:#b58a2e;")}>edited</span>}
                  </div>
                  <div style={sty("display:flex;gap:7px;margin-bottom:14px;")}>
                    <input value={v.draftName} onChange={v.onDraftName} placeholder="Name this snapshot…" style={sty("flex:1;font-family:'IBM Plex Mono',monospace;font-size:11px;color:#233029;background:#fffdf3;border:1px solid #b99a6b;border-radius:2px;padding:8px 9px;outline:none;")} />
                    <button onClick={v.onSnapshot} style={sty("font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.02em;padding:8px 13px;cursor:pointer;border:1px solid #2f6e62;border-radius:2px;background:#2f6e62;color:#f6f2e2;white-space:nowrap;")}>Snapshot</button>
                  </div>
                  <div style={sty("display:flex;flex-direction:column;gap:7px;max-height:240px;overflow:auto;")}>
                    {v.versionsBusy && <div style={sty("font-family:'IBM Plex Mono',monospace;font-size:10px;color:#5c6b5f;padding:6px 2px;")}>Loading snapshots…</div>}
                    {v.noVersions && <div style={sty("font-family:'Source Serif 4',serif;font-size:12.5px;color:#5c6b5f;font-style:italic;padding:6px 2px;line-height:1.4;")}>No snapshots yet. Name the current board above to take your first checkpoint.</div>}
                    {v.versionList.map((ver) => (
                      <div key={ver.id} style={sty(ver.rowStyle)}>
                        <div style={sty("flex:1;min-width:0;")}>
                          <div style={sty("display:flex;align-items:center;gap:6px;")}>
                            <span style={sty("font-family:'Sorts Mill Goudy',serif;font-size:16px;font-weight:400;color:#233029;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;")}>{ver.name}</span>
                            {ver.isCurrent && <span style={sty("font-family:'IBM Plex Mono',monospace;font-size:8px;letter-spacing:.05em;color:#2f6e62;border:1px solid #2f6e62;border-radius:2px;padding:1px 4px;")}>CURRENT</span>}
                          </div>
                          <div style={sty("font-family:'IBM Plex Mono',monospace;font-size:9px;color:#5c6b5f;margin-top:2px;")}>{ver.when}</div>
                        </div>
                        <button onClick={ver.onRevert} style={sty("font-family:'IBM Plex Mono',monospace;font-size:10px;padding:5px 9px;cursor:pointer;border:1px solid #6e4a2e;border-radius:2px;background:transparent;color:#6e4a2e;white-space:nowrap;")}>Revert</button>
                        {ver.canDelete && <button onClick={ver.onDelete} style={sty("border:none;background:transparent;color:#a08a6a;cursor:pointer;font-size:13px;line-height:1;padding:2px 4px;")}>✕</button>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <div style={sty("display:flex;align-items:center;gap:10px;padding:8px 20px;border-bottom:1px solid #b99a6b;background:#efe8d0;flex:0 0 auto;")}>
          <button onClick={v.onAddBlock} style={sty(v.addBtn)}>{v.addBlockLabel}</button>
          <button onClick={v.onAddChapter} style={sty(v.connectBtn)}>＋ Add chapter</button>
          <button onClick={v.onToggleConnect} style={sty(v.connectBtn)}>⤳ Connect blocks</button>
          <button onClick={v.onUndo} disabled={v.noUndo} style={sty(v.undoBtn)}>↶ Undo</button>
          <span style={sty("font-family:'IBM Plex Mono',monospace;font-size:10px;color:#8a6a1e;")}>{v.placeHint || v.connectHint}</span>
          <span style={sty("margin-left:auto;font-family:'IBM Plex Mono',monospace;font-size:9.5px;color:#8a7a5a;")}>drag a block to re-chapter · select one to assign, connect or flag it</span>
        </div>

        <div style={sty("flex:1;display:flex;min-height:0;")}>
          <div style={sty("flex:1;overflow:auto;min-width:0;")}>
            <div style={sty("min-width:max-content;")}>
              <div style={sty("display:flex;position:sticky;top:0;z-index:7;")}>
                <div style={sty("width:190px;flex:0 0 190px;position:sticky;left:0;z-index:8;background:#eae3cc;border-right:2px solid #6e4a2e;border-bottom:2px solid #6e4a2e;")}></div>
                {v.chapters.map((col) => (
                  <div key={col.n} style={sty("width:184px;flex:0 0 184px;padding:8px 22px 9px;font-family:'IBM Plex Mono',monospace;font-size:10px;color:#5c6b5f;border-left:1px solid #b99a6b;border-bottom:2px solid #6e4a2e;background:#eae3cc;position:relative;")}>
                    <div onClick={() => v.onStartEditChapter(col.n)} title="Edit chapter" style={sty("cursor:pointer;")}>
                      <b style={sty("display:block;color:#233029;font-size:11.5px;font-weight:500;")}>
                        {col.label}
                        {col.prologue && <span style={sty("margin-left:5px;font-weight:400;font-size:8px;letter-spacing:.04em;color:#8a6a1e;border:1px solid #b58a2e;border-radius:2px;padding:0 3px;")}>PRO</span>}
                      </b>
                      {col.title || <span style={sty("color:#a89877;font-style:italic;")}>untitled</span>}
                    </div>
                    {col.editing && (
                      <div style={sty("position:absolute;left:0;top:calc(100% + 4px);z-index:40;width:232px;background:#efe8d0;border:1px solid #6e4a2e;border-radius:3px;box-shadow:0 14px 34px rgba(60,40,20,.28);padding:12px;display:flex;flex-direction:column;gap:9px;")}>
                        <div style={sty("display:flex;flex-direction:column;gap:3px;")}>
                          <span style={sty("font-family:'IBM Plex Mono',monospace;font-size:8.5px;letter-spacing:.05em;text-transform:uppercase;color:#5c6b5f;")}>Label</span>
                          <input
                            autoFocus
                            value={v.chapterDraft.label || ""}
                            onChange={(e) => v.onChapterDraft("label", e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") v.onCommitChapter(); if (e.key === "Escape") v.onCancelChapter(); }}
                            placeholder="e.g. Ch 1"
                            style={sty("font-family:'IBM Plex Mono',monospace;font-size:11px;color:#233029;background:#fffdf3;border:1px solid #b99a6b;border-radius:2px;padding:5px 7px;outline:none;")}
                          />
                        </div>
                        <div style={sty("display:flex;flex-direction:column;gap:3px;")}>
                          <span style={sty("font-family:'IBM Plex Mono',monospace;font-size:8.5px;letter-spacing:.05em;text-transform:uppercase;color:#5c6b5f;")}>Title</span>
                          <input
                            value={v.chapterDraft.title || ""}
                            onChange={(e) => v.onChapterDraft("title", e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") v.onCommitChapter(); if (e.key === "Escape") v.onCancelChapter(); }}
                            placeholder="Chapter title"
                            style={sty("font-family:'Source Serif 4',serif;font-size:12.5px;color:#233029;background:#fffdf3;border:1px solid #b99a6b;border-radius:2px;padding:5px 7px;outline:none;")}
                          />
                        </div>
                        <label style={sty("display:flex;align-items:center;gap:7px;font-family:'IBM Plex Mono',monospace;font-size:10px;color:#233029;cursor:pointer;")}>
                          <input type="checkbox" checked={col.prologue} onChange={() => v.onToggleChapterPrologue(col.n)} />
                          Prologue (not numbered)
                        </label>
                        {!col.labelAuto && (
                          <button onClick={() => v.onResetChapterAuto(col.n)} style={sty("align-self:flex-start;font-family:'IBM Plex Mono',monospace;font-size:9px;padding:2px 6px;cursor:pointer;border:1px dashed #6e4a2e;border-radius:2px;background:transparent;color:#6e4a2e;")}>↺ Auto-number this</button>
                        )}
                        <div style={sty("display:flex;gap:6px;")}>
                          <button onClick={() => v.onInsertChapter(col.index)} style={sty("flex:1;font-family:'IBM Plex Mono',monospace;font-size:9px;padding:4px 5px;cursor:pointer;border:1px solid #6e4a2e;border-radius:2px;background:#f7f2de;color:#233029;")}>＋ Before</button>
                          <button onClick={() => v.onInsertChapter(col.index + 1)} style={sty("flex:1;font-family:'IBM Plex Mono',monospace;font-size:9px;padding:4px 5px;cursor:pointer;border:1px solid #6e4a2e;border-radius:2px;background:#f7f2de;color:#233029;")}>After ＋</button>
                        </div>
                        <div style={sty("display:flex;gap:6px;align-items:center;")}>
                          <button onClick={() => v.onMoveChapter(col.n, -1)} disabled={col.index === 0} style={sty("font-family:'IBM Plex Mono',monospace;font-size:11px;padding:4px 9px;cursor:pointer;border:1px solid #6e4a2e;border-radius:2px;background:#f7f2de;color:" + (col.index === 0 ? "#b0a487" : "#233029") + ";")}>◂</button>
                          <button onClick={() => v.onMoveChapter(col.n, 1)} disabled={col.index === v.chapterCount - 1} style={sty("font-family:'IBM Plex Mono',monospace;font-size:11px;padding:4px 9px;cursor:pointer;border:1px solid #6e4a2e;border-radius:2px;background:#f7f2de;color:" + (col.index === v.chapterCount - 1 ? "#b0a487" : "#233029") + ";")}>▸</button>
                          <button onClick={() => v.onDeleteChapter(col.n)} disabled={!v.canDeleteChapter} style={sty("margin-left:auto;font-family:'IBM Plex Mono',monospace;font-size:9px;padding:4px 8px;cursor:pointer;border:1px solid #b23a2e;border-radius:2px;background:transparent;color:" + (v.canDeleteChapter ? "#b23a2e" : "#d0a89e") + ";")}>✕ Delete</button>
                        </div>
                        <div style={sty("display:flex;gap:6px;border-top:1px solid #d8ceb0;padding-top:9px;")}>
                          <button onClick={v.onCommitChapter} style={sty("flex:1;font-family:'IBM Plex Mono',monospace;font-size:10px;padding:5px 6px;cursor:pointer;border:1px solid #2f6e62;border-radius:2px;background:#2f6e62;color:#f6f2e2;")}>Done</button>
                          <button onClick={v.onCancelChapter} style={sty("font-family:'IBM Plex Mono',monospace;font-size:10px;padding:5px 9px;cursor:pointer;border:1px solid #b99a6b;border-radius:2px;background:transparent;color:#5c6b5f;")}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="rows-wrap" style={sty("position:relative;")}>
                <svg className="arrows" style={sty("position:absolute;inset:0;z-index:2;overflow:visible;pointer-events:none;")}></svg>
                {v.rowVals.map((row) => (
                  <div key={row.key} style={sty("display:flex;border-bottom:1px solid #b99a6b;position:relative;z-index:1;")}>
                    <div style={sty(row.labelStyle)}>
                      {row.editing ? (
                        <div style={sty("display:flex;flex-direction:column;gap:6px;")}>
                          <input
                            autoFocus
                            value={v.rowDraft.label || ""}
                            onChange={(e) => v.onRowDraft("label", e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") v.onCommitRow(); if (e.key === "Escape") v.onCancelRow(); }}
                            placeholder="Name"
                            style={sty("font-family:'Sorts Mill Goudy',serif;font-size:16px;color:#233029;background:#fffdf3;border:1px solid #2f6e62;border-radius:2px;padding:3px 6px;outline:none;")}
                          />
                          <div style={sty("display:flex;gap:6px;align-items:flex-start;")}>
                            <input
                              value={v.rowDraft.mark || ""}
                              onChange={(e) => v.onRowDraft("mark", e.target.value.slice(0, 3))}
                              onKeyDown={(e) => { if (e.key === "Enter") v.onCommitRow(); if (e.key === "Escape") v.onCancelRow(); }}
                              placeholder="Aa"
                              style={sty("width:38px;flex:0 0 auto;text-align:center;font-family:'IBM Plex Mono',monospace;font-size:11px;color:#233029;background:#fffdf3;border:1px solid #b99a6b;border-radius:2px;padding:3px 4px;outline:none;")}
                            />
                            <div style={sty("display:flex;flex-wrap:wrap;gap:3px;")}>
                              {v.rowPalette.map((c) => (
                                <button
                                  key={c}
                                  onClick={() => v.onRowDraft("color", c)}
                                  title={c}
                                  style={sty("width:15px;height:15px;border-radius:50%;cursor:pointer;padding:0;background:" + c + ";border:" + (v.rowDraft.color === c ? "2px solid #233029" : "1px solid rgba(0,0,0,.2)") + ";")}
                                />
                              ))}
                            </div>
                          </div>
                          <input
                            value={v.rowDraft.note || ""}
                            onChange={(e) => v.onRowDraft("note", e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") v.onCommitRow(); if (e.key === "Escape") v.onCancelRow(); }}
                            placeholder="Note (optional)"
                            style={sty("font-family:'IBM Plex Mono',monospace;font-size:9.5px;color:#5c6b5f;background:#fffdf3;border:1px solid #b99a6b;border-radius:2px;padding:3px 5px;outline:none;")}
                          />
                          <div style={sty("display:flex;gap:6px;")}>
                            <button onClick={v.onCommitRow} style={sty("flex:1;font-family:'IBM Plex Mono',monospace;font-size:10px;padding:4px 6px;cursor:pointer;border:1px solid #2f6e62;border-radius:2px;background:#2f6e62;color:#f6f2e2;")}>Done</button>
                            <button onClick={v.onCancelRow} style={sty("font-family:'IBM Plex Mono',monospace;font-size:10px;padding:4px 8px;cursor:pointer;border:1px solid #b99a6b;border-radius:2px;background:transparent;color:#5c6b5f;")}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <b style={sty("font-family:'Sorts Mill Goudy',serif;font-weight:400;font-size:18px;line-height:1.05;" + (row.unassigned ? "font-style:italic;color:#8a5a3a;" : ""))}>{row.label}</b>
                          {row.hasNote && <small style={sty("font-family:'IBM Plex Mono',monospace;font-size:9.5px;color:#5c6b5f;margin-top:2px;")}>{row.note}</small>}
                          <span style={sty("margin-top:4px;font-family:'IBM Plex Mono',monospace;font-size:9.5px;color:#2f6e62;")}>{row.tally}</span>
                          {!row.unassigned && (
                            <div style={sty("display:flex;gap:6px;margin-top:6px;")}>
                              <button onClick={() => v.onStartEditRow(row.key)} title="Edit row" style={sty("font-family:'IBM Plex Mono',monospace;font-size:9px;padding:3px 7px;cursor:pointer;border:1px solid #6e4a2e;border-radius:2px;background:transparent;color:#6e4a2e;")}>✎ Edit</button>
                              <button onClick={() => v.onDeleteRow(row.key)} title="Delete row" style={sty("font-family:'IBM Plex Mono',monospace;font-size:9px;padding:3px 7px;cursor:pointer;border:1px solid #b23a2e;border-radius:2px;background:transparent;color:#b23a2e;")}>✕</button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    <div style={sty("display:flex;position:relative;")}>
                      {row.showThread && <div style={sty("position:absolute;left:0;right:0;top:50%;height:0;border-top:1.5px dotted #c9b98a;pointer-events:none;z-index:0;")}></div>}
                      {row.cells.map((cell, ci) => (
                        <div key={ci} className="cell" data-ch={cell.ch} data-row={cell.rk} onDrop={cell.onDrop} onDragOver={cell.onDragOver} onDragEnter={cell.onDragEnter} onDragLeave={cell.onDragLeave} style={sty(cell.style)}>
                          {cell.moments.map((item) => (
                            <div key={item.id} className="stub" data-mid={item.id} draggable={item.drag} style={sty(item.style)} onClick={item.onClick} onDragStart={item.onDragStart} onDragEnd={item.onDragEnd}>
                              {item.isLedger && (
                                <>
                                  <span style={sty(item.markStyle)}>{item.mark}</span>
                                  {item.planned && <span style={sty(`position:absolute;top:-6px;left:8px;font-family:'IBM Plex Mono',monospace;font-size:8px;letter-spacing:.06em;color:#5c6b5f;background:${item.plannedBg};padding:0 3px;`)}>PLANNED</span>}
                                  <div style={sty("padding-right:6px;")}>{item.text}</div>
                                  {item.hasMeta && (
                                    <div style={sty("margin-top:5px;font-family:'IBM Plex Mono',monospace;font-size:9px;color:#5c6b5f;display:flex;gap:9px;flex-wrap:wrap;align-items:center;")}>
                                      {item.written && <span style={sty("color:#6e4a2e;")}>✓ written</span>}
                                      {item.showBroken && <span style={sty("color:#b23a2e;font-weight:500;")}>out of order</span>}
                                    </div>
                                  )}
                                  {item.hasPips && (
                                    <div style={sty("margin-top:6px;display:flex;align-items:center;gap:4px;")}>
                                      <span style={sty("font-family:'IBM Plex Mono',monospace;font-size:8px;letter-spacing:.04em;color:#8a7a5a;")}>ALSO</span>
                                      {item.pips.map((pp, pi) => <span key={pi} style={sty(pp.style)} title={pp.name}>{pp.mark}</span>)}
                                    </div>
                                  )}
                                </>
                              )}
                              {item.isWeave && (
                                <>
                                  <span style={sty(item.markStyle)}>{item.mark}</span>
                                  <span style={sty("white-space:nowrap;overflow:hidden;text-overflow:ellipsis;")}>{item.short}</span>
                                  {item.hasPips && item.pips.map((pp, pi) => <span key={pi} style={sty(pp.style)} title={pp.name}>{pp.mark}</span>)}
                                  {item.written && <span style={sty("flex:0 0 auto;color:#6e4a2e;font-size:10px;")}>✓</span>}
                                  {item.showBroken && <span style={sty("flex:0 0 auto;color:#b23a2e;font-size:11px;font-weight:600;")}>!</span>}
                                </>
                              )}
                            </div>
                          ))}
                          {cell.echoes.map((e) => (
                            <div key={"e" + e.id} className="echo" data-echo={e.id} onClick={e.onClick} style={sty(e.style)} title={e.full}>
                              <span style={sty(e.dotStyle)}></span>
                              <span style={sty("white-space:nowrap;overflow:hidden;text-overflow:ellipsis;")}>{e.text}</span>
                            </div>
                          ))}
                          {cell.canPlace && (
                            <div className="place-target" onMouseEnter={cell.onPlaceEnter} onClick={cell.onPlace} style={sty(cell.placeStyle)} title="Add a block here">
                              {cell.cellHot && <span style={sty(cell.placePlus)}>＋</span>}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <div style={sty("display:flex;position:relative;z-index:5;")}>
                  <div style={sty("width:190px;flex:0 0 190px;padding:10px 12px;position:sticky;left:0;background:#eae3cc;border-right:2px solid #6e4a2e;")}>
                    <button onClick={v.onAddRow} style={sty("width:100%;font-family:'IBM Plex Mono',monospace;font-size:10.5px;letter-spacing:.02em;color:#6e4a2e;background:transparent;border:1px dashed #6e4a2e;border-radius:2px;padding:8px 9px;cursor:pointer;text-align:left;")}>{v.addRowLabel}</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {v.showMargin && (
          <aside style={sty("width:292px;flex:0 0 292px;border-left:2px solid #6e4a2e;background:#efe8d0;display:flex;flex-direction:column;overflow:auto;")}>
            {v.noDetail && (
              <div style={sty("padding:22px 20px;")}>
                <div style={sty("font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.05em;color:#5c6b5f;text-transform:uppercase;")}>The Margin</div>
                <p style={sty("font-family:'Source Serif 4',serif;font-size:14px;line-height:1.5;color:#5c6b5f;margin:14px 0 0;")}>Select any moment to trace its lineage — what the reader must already know before it lands, and what it sets up later.</p>
                <p style={sty("font-family:'Source Serif 4',serif;font-size:14px;line-height:1.5;color:#5c6b5f;margin:14px 0 0;")}>Drag a moment left or right to move it between chapters. If it slides ahead of something it depends on, the tool flags the break.</p>
              </div>
            )}
            {v.hasDetail && (
              <div style={sty("padding:18px 20px 26px;")}>
                <div style={sty("display:flex;justify-content:space-between;align-items:flex-start;gap:10px;")}>
                  <div>
                    <div style={sty("font-family:'IBM Plex Mono',monospace;font-size:10px;color:#233029;font-weight:500;")}>{d.chLabel}</div>
                    <div style={sty("font-family:'IBM Plex Mono',monospace;font-size:10px;color:#2f6e62;margin-top:3px;")}>{d.rowLabel}</div>
                  </div>
                  <div style={sty("display:flex;gap:6px;flex:0 0 auto;")}>
                    <button onClick={d.onToggleBlockMenu} title="Block actions" style={sty("border:1px solid #b99a6b;width:24px;height:24px;border-radius:2px;cursor:pointer;font-size:14px;line-height:1;font-family:'IBM Plex Mono',monospace;" + (d.blockMenuOpen ? "background:#233029;color:#f6f2e2;" : "background:transparent;color:#5c6b5f;"))}>⋯</button>
                    <button onClick={v.clearSel} style={sty("border:1px solid #b99a6b;background:transparent;color:#5c6b5f;width:24px;height:24px;border-radius:2px;cursor:pointer;font-size:13px;line-height:1;")}>✕</button>
                  </div>
                </div>

                {d.blockMenuOpen && (
                  <div style={sty("margin:11px 0 0;border:1px solid #b99a6b;border-radius:3px;background:#fbf7e6;overflow:hidden;box-shadow:0 8px 20px -10px rgba(0,0,0,.35);")}>
                    <div style={sty("font-family:'IBM Plex Mono',monospace;font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:#a08a5e;padding:8px 12px 4px;")}>Block actions</div>
                    <button onClick={d.onConnectFrom} style={sty("display:block;width:100%;text-align:left;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.02em;padding:10px 12px;cursor:pointer;border:none;border-top:1px solid rgba(110,74,46,.14);" + (d.connectActive ? "background:#f1e7c9;color:#8a6a1e;" : "background:transparent;color:#233029;"))}>{d.connectLabel}</button>
                    <button onClick={d.onDelete} style={sty("display:block;width:100%;text-align:left;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.02em;padding:10px 12px;cursor:pointer;border:none;border-top:1px solid rgba(110,74,46,.14);background:transparent;color:#b23a2e;")}>✕ Delete block…</button>
                  </div>
                )}

                {d.editingText ? (
                  <div style={sty("margin:13px 0 15px;display:flex;flex-direction:column;gap:6px;")}>
                    <textarea
                      autoFocus
                      value={d.textDraft}
                      onChange={d.onTextDraft}
                      onKeyDown={(e) => { if (e.key === "Escape") d.onCancelText(); if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) d.onCommitText(); }}
                      rows={3}
                      placeholder="Describe what the reader learns in this moment…"
                      style={sty("font-family:'Sorts Mill Goudy',serif;font-weight:400;font-size:21px;line-height:1.28;color:#233029;background:#fffdf3;border:1px solid #2f6e62;border-radius:2px;padding:7px 9px;outline:none;resize:vertical;")}
                    />
                    <div style={sty("display:flex;gap:6px;align-items:center;")}>
                      <button onClick={d.onCommitText} style={sty("font-family:'IBM Plex Mono',monospace;font-size:10px;padding:5px 11px;cursor:pointer;border:1px solid #2f6e62;border-radius:2px;background:#2f6e62;color:#f6f2e2;")}>Done</button>
                      <button onClick={d.onCancelText} style={sty("font-family:'IBM Plex Mono',monospace;font-size:10px;padding:5px 9px;cursor:pointer;border:1px solid #b99a6b;border-radius:2px;background:transparent;color:#5c6b5f;")}>Cancel</button>
                      <span style={sty("margin-left:auto;font-family:'IBM Plex Mono',monospace;font-size:9px;color:#8a7a5a;")}>⌘↵ to save · esc to cancel</span>
                    </div>
                  </div>
                ) : (
                  <p onClick={d.onStartEditText} title="Click to edit this moment" style={sty("font-family:'Sorts Mill Goudy',serif;font-weight:400;font-size:21px;line-height:1.28;margin:13px 0 15px;color:#233029;cursor:text;")}>{d.text}</p>
                )}

                <div style={sty(d.statusSegWrap)}>
                  {d.statusSegs.map((s) => (
                    <button key={s.key} onClick={s.onClick} style={sty(s.style)}>{s.label}</button>
                  ))}
                </div>

                <div style={sty("margin:17px 0 0;")}>
                  <div style={sty("font-family:'IBM Plex Mono',monospace;font-size:9.5px;letter-spacing:.05em;text-transform:uppercase;color:#5c6b5f;margin-bottom:8px;")}>Placement</div>
                  <div style={sty(d.homeLineStyle)}>
                    {d.homeMark && <span style={sty(d.homeDotStyle)}></span>}
                    <span style={sty("font-family:'IBM Plex Mono',monospace;font-size:10px;color:#5c6b5f;")}>Home</span>
                    <select value={d.rowKey} onChange={d.onAssign} style={sty(d.homeSelectStyle + "margin-left:auto;text-align:right;")}>
                      {d.homeUnassigned && <option value="" disabled>— Unassigned —</option>}
                      {d.rowOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                    </select>
                  </div>
                  {d.mirrorChips.length > 0 && (
                    <div style={sty("font-family:'IBM Plex Mono',monospace;font-size:9px;letter-spacing:.05em;text-transform:uppercase;color:#7a8a7d;margin:0 0 7px;")}>{d.mirrorLabel}</div>
                  )}
                  <div style={sty("display:flex;flex-wrap:wrap;gap:6px;")}>
                    {d.mirrorChips.map((c) => (
                      <button key={c.key} onClick={c.onClick} title={c.title} style={sty(c.style)}>
                        <span style={sty(c.markStyle)}>{c.mark}</span>
                        <span>{c.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {d.hasBreak && (
                  <div style={sty("background:#f6e2dd;border:1px solid #b23a2e;border-radius:2px;padding:10px 11px;margin:16px 0 0;")}>
                    <div style={sty("font-family:'IBM Plex Mono',monospace;font-size:9.5px;letter-spacing:.05em;text-transform:uppercase;color:#b23a2e;font-weight:500;margin-bottom:4px;")}>Continuity break</div>
                    <div style={sty("font-size:12.5px;line-height:1.42;color:#7a2a20;")}>{d.breakMsg}</div>
                  </div>
                )}
                <div style={sty("font-family:'IBM Plex Mono',monospace;font-size:9.5px;letter-spacing:.05em;text-transform:uppercase;color:#5c6b5f;border-bottom:1px solid #b99a6b;padding-bottom:5px;margin:20px 0 2px;")}>Must be established first</div>
                {d.noUp && <div style={sty("font-size:12.5px;color:#5c6b5f;font-style:italic;padding:9px 0;")}>— nothing; this moment opens its own line.</div>}
                {(d.upstream || []).map((u, i) => (
                  <div key={i} onClick={u.onClick} style={sty(u.style)}>
                    <span style={sty(u.chStyle)}>{u.ch}</span>
                    <span style={sty("font-size:12.5px;line-height:1.34;flex:1 1 auto;")}>{u.text}</span>
                    <button onClick={(e) => { e.stopPropagation(); u.onRemove(); }} title={u.removeTitle} style={sty("flex:0 0 auto;border:none;background:transparent;color:#a08a5e;cursor:pointer;font-size:12px;line-height:1;padding:1px 2px;margin-top:1px;")}>✕</button>
                  </div>
                ))}
                <div style={sty("font-family:'IBM Plex Mono',monospace;font-size:9.5px;letter-spacing:.05em;text-transform:uppercase;color:#5c6b5f;border-bottom:1px solid #b99a6b;padding-bottom:5px;margin:18px 0 2px;")}>This sets up later</div>
                {d.noDown && <div style={sty("font-size:12.5px;color:#5c6b5f;font-style:italic;padding:9px 0;")}>— a payoff; nothing depends on it yet.</div>}
                {(d.downstream || []).map((dn, i) => (
                  <div key={i} onClick={dn.onClick} style={sty(dn.style)}>
                    <span style={sty(dn.chStyle)}>{dn.ch}</span>
                    <span style={sty("font-size:12.5px;line-height:1.34;flex:1 1 auto;")}>{dn.text}</span>
                    <button onClick={(e) => { e.stopPropagation(); dn.onRemove(); }} title={dn.removeTitle} style={sty("flex:0 0 auto;border:none;background:transparent;color:#a08a5e;cursor:pointer;font-size:12px;line-height:1;padding:1px 2px;margin-top:1px;")}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </aside>
          )}
        </div>
      </div>
    );
  }
}
