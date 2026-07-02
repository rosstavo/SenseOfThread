import React from "react";
import {
  saveProject,
  listSnapshots,
  addSnapshot,
  deleteSnapshot,
  renameProject,
} from "./storage.js";
import { signOut } from "./authService.js";

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
      writeTick: 0,
      connectMode: false,
      connectFrom: null,
      menuOpen: false,
      versions: [],
      versionsLoaded: false,
      versionsBusy: false,
      dirty: false,
      draftName: "",
      lastVerName: p.lastVerName || "",
      editingName: false,
      nameDraft: "",
    };
  }

  componentDidMount() {
    this._draw = () => this.drawArrows();
    window.addEventListener("resize", this._draw);
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
    this.setState((s) => ({ selected: s.selected === id ? null : id }));
  }
  toggleConnect() { this.setState((s) => ({ connectMode: !s.connectMode, connectFrom: null })); }
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
  addBlock() {
    const firstThread = this.threads[0];
    const firstChar = this.characters[0];
    if (!firstThread || !firstChar) return; // need at least one row of each axis
    const firstCh = this.chapters[0] ? this.chapters[0].n : 1;
    const rowsList = this.state.view === "thread" ? this.threads : this.characters;
    const firstRow = rowsList[0];
    const nextId = Math.max(0, ...(this.moments || []).map((m) => m.id)) + 1;
    const nm = {
      id: nextId, ch: firstCh,
      thread: this.state.view === "thread" ? firstRow.key : firstThread.key,
      char: this.state.view === "character" ? firstRow.key : firstChar.key,
      text: "New moment — describe what the reader learns here.",
      deps: [], planned: true, coChars: [], coThreads: [],
    };
    this.pushUndo();
    (this.moments || (this.moments = [])).push(nm);
    this.setState({ selected: nextId, dirty: true });
  }
  assignRow(id, key) {
    const m = (this.moments || []).find((x) => x.id === id);
    if (!m) return;
    const cur = this.state.view === "thread" ? m.thread : m.char;
    if (cur === key) return;
    this.pushUndo();
    if (this.state.view === "thread") m.thread = key; else m.char = key;
    this.setState({ dirty: true });
  }
  togglePlanned(id) {
    const m = (this.moments || []).find((x) => x.id === id);
    if (!m) return;
    this.pushUndo();
    m.planned = !m.planned;
    this.setState({ dirty: true });
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
    const up = m.deps.map((d) => byId[d]).filter(Boolean).map((dm) => {
      const broken = dm.ch > m.ch, tight = dm.ch === m.ch;
      return { ch: this.chShort(dm.ch), text: dm.text, style: this.refItemStyle(broken), chStyle: this.chChip(broken, tight), onClick: () => this.select(dm.id) };
    });
    const down = moments.filter((x) => x.deps.includes(sel)).map((x) => {
      const broken = m.ch > x.ch, tight = m.ch === x.ch;
      return { ch: this.chShort(x.ch), text: x.text, style: this.refItemStyle(broken), chStyle: this.chChip(broken, tight), onClick: () => this.select(x.id) };
    });
    const hasBreak = up.some((u) => u.style.indexOf("178,58,46") > -1) || down.some((d) => d.style.indexOf("178,58,46") > -1);
    const written = this.isWritten(sel);
    const coRows = this.coKeys(m).map((k) => rowsList.find((x) => x.key === k)).filter(Boolean);
    const cast = [r].concat(coRows).filter(Boolean).map((x) => ({
      mark: x.mark,
      style: "flex:0 0 auto;width:18px;height:18px;border-radius:50%;background:" + x.color + ";color:#f6f2e2;font-family:'IBM Plex Mono',monospace;font-size:8.5px;display:flex;align-items:center;justify-content:center;",
    }));
    return {
      chLabel: this.chInfo(m.ch),
      rowLabel: (this.state.view === "thread" ? "Thread · " : "Arc · ") + (r ? r.label : ""),
      text: m.text, upstream: up, downstream: down,
      noUp: up.length === 0, noDown: down.length === 0,
      hasBreak,
      breakMsg: "This lands before something it relies on — the reader won't have that yet. Move it later, or move the setup earlier.",
      hasCast: coRows.length > 0,
      castLabel: this.state.view === "thread" ? "THREADS" : "ON PAGE",
      cast,
      written,
      writtenLabel: written ? "Written" : "Mark as written",
      checkMark: written ? "✓" : "",
      writtenRowBg: written ? "#dfeae2" : "transparent",
      checkStyle: "flex:0 0 auto;width:18px;height:18px;border-radius:3px;border:1.5px solid " + (written ? "#2f6e62" : "#6e4a2e") + ";display:flex;align-items:center;justify-content:center;font-size:12px;line-height:1;color:#2f6e62;background:" + (written ? "#c9ded4" : "transparent") + ";",
      onToggleWritten: () => this.toggleWritten(sel),
      // --- block controls ---
      rowKey: this.rowKeyOf(m),
      assignLabel: this.state.view === "thread" ? "Assign thread" : "Assign character arc",
      rowOptions: rowsList.map((x) => ({ key: x.key, label: x.label })),
      selectStyle: "width:100%;font-family:'IBM Plex Mono',monospace;font-size:11px;color:#233029;background:#fbf7e6;border:1px solid #b99a6b;border-radius:2px;padding:7px 9px;cursor:pointer;",
      onAssign: (e) => this.assignRow(sel, e.target.value),
      planned: !!m.planned,
      plannedLabel: m.planned ? "Planned" : "Mark planned",
      plannedMark: m.planned ? "✓" : "",
      plannedRowBg: m.planned ? "#f1e7c9" : "transparent",
      plannedCheckStyle: "flex:0 0 auto;width:18px;height:18px;border-radius:3px;border:1.5px dashed " + (m.planned ? "#a1863c" : "#6e4a2e") + ";display:flex;align-items:center;justify-content:center;font-size:12px;line-height:1;color:#a1863c;background:" + (m.planned ? "#e9dcb0" : "transparent") + ";",
      onTogglePlanned: () => this.togglePlanned(sel),
      connectLabel: this.state.connectMode && this.state.connectFrom === sel ? "Now click the block that depends on this…" : "⤳ Connect from this block",
      connectBtnStyle: "width:100%;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.02em;padding:9px 11px;border-radius:2px;cursor:pointer;text-align:left;border:1px solid " + (this.state.connectMode && this.state.connectFrom === sel ? "#b58a2e;color:#8a6a1e;background:#f1e7c9;" : "#6e4a2e;color:#233029;background:#fbf7e6;"),
      onConnectFrom: () => this.startConnect(sel),
      deleteBtnStyle: "width:100%;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.02em;padding:9px 11px;border-radius:2px;cursor:pointer;text-align:left;border:1px solid #b23a2e;color:#b23a2e;background:transparent;",
      onDelete: () => this.deleteBlock(sel),
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

    const rowVals = rows.map((r, idx) => {
      const bg = idx % 2 ? "rgba(110,74,46,.05)" : "transparent";
      const labelBg = idx % 2 ? "#e6ddc2" : "#eae3cc";
      const pipStyle = (color, dimmed) => "flex:0 0 auto;width:15px;height:15px;border-radius:50%;background:" + color + ";color:#f6f2e2;font-family:'IBM Plex Mono',monospace;font-size:8px;display:flex;align-items:center;justify-content:center;" + (dimmed ? "opacity:.85;" : "");
      const cells = this.chapters.map((c) => {
        const list = moments.filter((m) => this.rowKeyOf(m) === r.key && m.ch === c.n).map((m) => {
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
        return {
          ch: c.n, rk: r.key,
          style: "width:184px;flex:0 0 184px;border-left:1px solid #b99a6b;padding:10px 22px;display:flex;flex-direction:column;gap:8px;justify-content:center;min-height:104px;position:relative;background:" + bg + ";",
          moments: list,
          echoes,
          onDrop: this.makeDrop(c.n, r.key),
          onDragOver: (e) => e.preventDefault(),
          onDragEnter: this.makeDragEnter(c.n, r.key),
          onDragLeave: this.onDragLeave(),
        };
      });
      const count = moments.filter((m) => this.rowKeyOf(m) === r.key).length;
      return {
        key: r.key, label: r.label, note: r.note, hasNote: !!r.note,
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
    const addBtn = toolBtn + "background:#2f6e62;color:#f6f2e2;border-color:#2f6e62;";
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
      onSignOut: () => signOut(),
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
      onAddBlock: () => this.addBlock(),
      onToggleConnect: () => this.toggleConnect(),
      onLedger: () => this.setEdition("ledger"),
      onWeave: () => this.setEdition("weave"),
      onThread: () => this.setView("thread"),
      onChar: () => this.setView("character"),
      clearSel: () => this.setState({ selected: null }),
      chapters: this.chapters.map((c) => ({ label: c.label, title: c.title })),
      rowVals,
      hasDetail: !!detail, noDetail: !detail,
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
                style={sty("font-family:'Cormorant Garamond',serif;font-weight:600;font-size:25px;letter-spacing:.3px;color:#233029;background:#fffdf3;border:1px solid #2f6e62;border-radius:2px;padding:0 6px;outline:none;")}
              />
            ) : (
              <h1 onClick={v.onStartRename} title="Click to rename this project" style={sty("font-family:'Cormorant Garamond',serif;font-weight:600;font-size:25px;margin:0;letter-spacing:.3px;cursor:text;")}>{v.projectName}</h1>
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
                    <span style={sty("font-family:'Cormorant Garamond',serif;font-size:16px;font-weight:600;color:#233029;flex:1;")}>{v.lastVerName}</span>
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
                            <span style={sty("font-family:'Cormorant Garamond',serif;font-size:16px;font-weight:600;color:#233029;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;")}>{ver.name}</span>
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
            <button onClick={v.onSignOut} title="Sign out" style={sty("font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.03em;padding:8px 13px;cursor:pointer;border:1px solid #6e4a2e;border-radius:2px;background:#f7f2de;color:#233029;")}>Sign out</button>
          </div>
        </header>

        <div style={sty("display:flex;align-items:center;gap:10px;padding:8px 20px;border-bottom:1px solid #b99a6b;background:#efe8d0;flex:0 0 auto;")}>
          <button onClick={v.onAddBlock} style={sty(v.addBtn)}>＋ Add block</button>
          <button onClick={v.onToggleConnect} style={sty(v.connectBtn)}>⤳ Connect blocks</button>
          <button onClick={v.onUndo} disabled={v.noUndo} style={sty(v.undoBtn)}>↶ Undo</button>
          <span style={sty("font-family:'IBM Plex Mono',monospace;font-size:10px;color:#8a6a1e;")}>{v.connectHint}</span>
          <span style={sty("margin-left:auto;font-family:'IBM Plex Mono',monospace;font-size:9.5px;color:#8a7a5a;")}>drag a block to re-chapter · select one to assign, connect or flag it</span>
        </div>

        <div style={sty("flex:1;display:flex;min-height:0;")}>
          <div style={sty("flex:1;overflow:auto;min-width:0;")}>
            <div style={sty("min-width:max-content;")}>
              <div style={sty("display:flex;position:sticky;top:0;z-index:7;")}>
                <div style={sty("width:190px;flex:0 0 190px;position:sticky;left:0;z-index:8;background:#eae3cc;border-right:2px solid #6e4a2e;border-bottom:2px solid #6e4a2e;")}></div>
                {v.chapters.map((col, i) => (
                  <div key={i} style={sty("width:184px;flex:0 0 184px;padding:8px 22px 9px;font-family:'IBM Plex Mono',monospace;font-size:10px;color:#5c6b5f;border-left:1px solid #b99a6b;border-bottom:2px solid #6e4a2e;background:#eae3cc;")}>
                    <b style={sty("display:block;color:#233029;font-size:11.5px;font-weight:500;")}>{col.label}</b>{col.title}
                  </div>
                ))}
              </div>
              <div className="rows-wrap" style={sty("position:relative;")}>
                <svg className="arrows" style={sty("position:absolute;inset:0;z-index:2;overflow:visible;pointer-events:none;")}></svg>
                {v.rowVals.map((row) => (
                  <div key={row.key} style={sty("display:flex;border-bottom:1px solid #b99a6b;position:relative;z-index:1;")}>
                    <div style={sty(row.labelStyle)}>
                      <b style={sty("font-family:'Cormorant Garamond',serif;font-weight:600;font-size:18px;line-height:1.05;")}>{row.label}</b>
                      {row.hasNote && <small style={sty("font-family:'IBM Plex Mono',monospace;font-size:9.5px;color:#5c6b5f;margin-top:2px;")}>{row.note}</small>}
                      <span style={sty("margin-top:4px;font-family:'IBM Plex Mono',monospace;font-size:9.5px;color:#2f6e62;")}>{row.tally}</span>
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
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <div style={sty("display:flex;position:relative;z-index:5;")}>
                  <div style={sty("width:190px;flex:0 0 190px;padding:10px 12px;position:sticky;left:0;background:#eae3cc;border-right:2px solid #6e4a2e;")}>
                    <button style={sty("width:100%;font-family:'IBM Plex Mono',monospace;font-size:10.5px;letter-spacing:.02em;color:#6e4a2e;background:transparent;border:1px dashed #6e4a2e;border-radius:2px;padding:8px 9px;cursor:pointer;text-align:left;")}>{v.addRowLabel}</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

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
                  <button onClick={v.clearSel} style={sty("border:1px solid #b99a6b;background:transparent;color:#5c6b5f;width:24px;height:24px;border-radius:2px;cursor:pointer;font-size:13px;line-height:1;flex:0 0 auto;")}>✕</button>
                </div>
                <p style={sty("font-family:'Cormorant Garamond',serif;font-weight:500;font-size:21px;line-height:1.28;margin:13px 0 13px;color:#233029;")}>{d.text}</p>
                {d.hasCast && (
                  <div style={sty("display:flex;align-items:center;gap:6px;margin:0 0 13px;flex-wrap:wrap;font-family:'IBM Plex Mono',monospace;font-size:9.5px;color:#5c6b5f;")}>
                    <span>{d.castLabel}</span>
                    {d.cast.map((cm, i) => <span key={i} style={sty(cm.style)}>{cm.mark}</span>)}
                  </div>
                )}
                <div onClick={d.onToggleWritten} style={sty(`display:flex;align-items:center;gap:9px;cursor:pointer;margin:0 0 17px;padding:9px 11px;border:1px solid #b99a6b;border-radius:2px;background:${d.writtenRowBg};user-select:none;`)}>
                  <span style={sty(d.checkStyle)}>{d.checkMark}</span>
                  <span style={sty("font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.02em;color:#233029;")}>{d.writtenLabel}</span>
                </div>

                <div style={sty("display:flex;flex-direction:column;gap:10px;margin:0 0 17px;padding:13px 12px;border:1px solid #b99a6b;border-radius:2px;background:rgba(110,74,46,.045);")}>
                  <div style={sty("font-family:'IBM Plex Mono',monospace;font-size:9.5px;letter-spacing:.05em;text-transform:uppercase;color:#5c6b5f;")}>{d.assignLabel}</div>
                  <select value={d.rowKey} onChange={d.onAssign} style={sty(d.selectStyle)}>
                    {d.rowOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                  </select>
                  <button onClick={d.onConnectFrom} style={sty(d.connectBtnStyle)}>{d.connectLabel}</button>
                  <button onClick={d.onDelete} style={sty(d.deleteBtnStyle)}>✕ Delete block</button>
                </div>

                {d.hasBreak && (
                  <div style={sty("background:#f6e2dd;border:1px solid #b23a2e;border-radius:2px;padding:10px 11px;margin:0 0 16px;")}>
                    <div style={sty("font-family:'IBM Plex Mono',monospace;font-size:9.5px;letter-spacing:.05em;text-transform:uppercase;color:#b23a2e;font-weight:500;margin-bottom:4px;")}>Continuity break</div>
                    <div style={sty("font-size:12.5px;line-height:1.42;color:#7a2a20;")}>{d.breakMsg}</div>
                  </div>
                )}
                <div style={sty("font-family:'IBM Plex Mono',monospace;font-size:9.5px;letter-spacing:.05em;text-transform:uppercase;color:#5c6b5f;border-bottom:1px solid #b99a6b;padding-bottom:5px;margin-bottom:2px;")}>Must be established first</div>
                {d.noUp && <div style={sty("font-size:12.5px;color:#5c6b5f;font-style:italic;padding:9px 0;")}>— nothing; this moment opens its own line.</div>}
                {(d.upstream || []).map((u, i) => (
                  <div key={i} onClick={u.onClick} style={sty(u.style)}>
                    <span style={sty(u.chStyle)}>{u.ch}</span>
                    <span style={sty("font-size:12.5px;line-height:1.34;")}>{u.text}</span>
                  </div>
                ))}
                <div style={sty("font-family:'IBM Plex Mono',monospace;font-size:9.5px;letter-spacing:.05em;text-transform:uppercase;color:#5c6b5f;border-bottom:1px solid #b99a6b;padding-bottom:5px;margin:18px 0 2px;")}>This sets up later</div>
                {d.noDown && <div style={sty("font-size:12.5px;color:#5c6b5f;font-style:italic;padding:9px 0;")}>— a payoff; nothing depends on it yet.</div>}
                {(d.downstream || []).map((dn, i) => (
                  <div key={i} onClick={dn.onClick} style={sty(dn.style)}>
                    <span style={sty(dn.chStyle)}>{dn.ch}</span>
                    <span style={sty("font-size:12.5px;line-height:1.34;")}>{dn.text}</span>
                  </div>
                ))}
              </div>
            )}
          </aside>
        </div>
      </div>
    );
  }
}
