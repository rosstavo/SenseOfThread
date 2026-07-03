import React, { useEffect, useState } from "react";
import {
  listProjects,
  createProject,
  renameProject,
  deleteProject,
} from "./storage.js";
import { buildOnboardedDoc } from "./seed.js";
import { signOut } from "./authService.js";
import NewProjectOnboarding from "./NewProjectOnboarding.jsx";

// The project shelf: every Project the User owns, newest-modified first, with
// create / rename / delete. Selecting a card opens that Project's board (App
// handles the transition via onOpen).

const ink = "#233029";
const brown = "#6e4a2e";
const green = "#2f6e62";
const border = "#b99a6b";
const mono = "'IBM Plex Mono',monospace";
const serif = "'Source Serif 4',serif";
const display = "'Sorts Mill Goudy',serif";

function fmtDate(ms) {
  if (!ms) return "just now";
  const d = new Date(ms);
  return (
    d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) +
    " · " +
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  );
}

export default function ProjectList({ user, onOpen }) {
  const [projects, setProjects] = useState(null); // null = loading
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(null); // project id
  const [renameText, setRenameText] = useState("");
  const [onboarding, setOnboarding] = useState(false); // new-project flow open
  const [onboardError, setOnboardError] = useState("");

  async function refresh() {
    setError("");
    try {
      const rows = await listProjects(user.uid);
      setProjects(rows);
    } catch (err) {
      console.error(err);
      setError("Could not load your projects. Check your connection and refresh.");
      setProjects([]);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.uid]);

  function openOnboarding() {
    setOnboardError("");
    setOnboarding(true);
  }

  // Called by the onboarding flow with the collected answers. Builds the
  // project doc, persists it, and opens the new board.
  async function onCreate(answers) {
    if (busy) return;
    setBusy(true);
    setOnboardError("");
    try {
      const id = await createProject(user.uid, buildOnboardedDoc(answers));
      onOpen(id);
    } catch (err) {
      console.error(err);
      setOnboardError("Could not create the project. Try again.");
      setBusy(false);
    }
  }

  async function commitRename(id) {
    const name = renameText.trim();
    setRenaming(null);
    if (!name) return;
    setProjects((ps) => ps.map((p) => (p.id === id ? { ...p, name } : p)));
    try {
      await renameProject(id, name);
    } catch (err) {
      console.error(err);
      setError("Rename failed to save. Refresh to see the current name.");
    }
  }

  async function onDelete(id, name) {
    if (!window.confirm(`Delete "${name}"? This removes the project and all its snapshots. This cannot be undone.`))
      return;
    setProjects((ps) => ps.filter((p) => p.id !== id));
    try {
      await deleteProject(id);
    } catch (err) {
      console.error(err);
      setError("Delete failed. Refresh and try again.");
      refresh();
    }
  }

  const loading = projects === null;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        overflow: "auto",
        background: "#d9cfb2",
        fontFamily: serif,
        color: ink,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          padding: "18px 26px 14px",
          borderBottom: "3px double " + brown,
          background: "#eae3cc",
        }}
      >
        <div>
          <h1 style={{ fontFamily: display, fontWeight: 400, fontSize: 26, margin: 0, letterSpacing: ".3px" }}>
            Your projects
          </h1>
          <p style={{ margin: "3px 0 0", fontFamily: mono, fontSize: 10.5, color: "#5c6b5f" }}>
            {user.email}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={openOnboarding}
            disabled={busy}
            style={{
              fontFamily: mono,
              fontSize: 12,
              letterSpacing: ".02em",
              padding: "9px 15px",
              cursor: "pointer",
              border: "1px solid " + green,
              borderRadius: 2,
              background: green,
              color: "#f6f2e2",
              opacity: busy ? 0.6 : 1,
            }}
          >
            ＋ New project
          </button>
          <button
            onClick={() => signOut()}
            style={{
              fontFamily: mono,
              fontSize: 11,
              padding: "9px 13px",
              cursor: "pointer",
              border: "1px solid " + brown,
              borderRadius: 2,
              background: "#f7f2de",
              color: ink,
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      <div style={{ padding: "22px 26px 40px" }}>
        {error && (
          <div
            style={{
              fontFamily: mono,
              fontSize: 11,
              color: "#7a2a20",
              background: "#f6e2dd",
              border: "1px solid #b23a2e",
              borderRadius: 2,
              padding: "9px 11px",
              marginBottom: 18,
            }}
          >
            {error}
          </div>
        )}

        {loading && (
          <div style={{ fontFamily: mono, fontSize: 12, color: "#5c6b5f" }}>Loading your projects…</div>
        )}

        {!loading && projects.length === 0 && (
          <div style={{ fontFamily: serif, fontSize: 15, color: "#5c6b5f", maxWidth: 460, lineHeight: 1.5 }}>
            No projects yet. Create one to start mapping your novel — chapters across the top, story
            threads or character arcs down the side.
          </div>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 16,
            marginTop: loading ? 0 : 4,
          }}
        >
          {!loading &&
            projects.map((p) => {
              const total = p.momentCount || 0;
              const written = p.writtenCount || 0;
              const pct = total ? Math.round((written / total) * 100) : 0;
              const isRenaming = renaming === p.id;
              return (
                <div
                  key={p.id}
                  style={{
                    background: "#f7f2de",
                    border: "1px solid " + border,
                    borderRadius: 3,
                    boxShadow: "0 1px 0 " + border,
                    padding: "16px 16px 14px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                    cursor: isRenaming ? "default" : "pointer",
                  }}
                  onClick={() => {
                    if (!isRenaming) onOpen(p.id);
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                    {isRenaming ? (
                      <input
                        autoFocus
                        value={renameText}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setRenameText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename(p.id);
                          if (e.key === "Escape") setRenaming(null);
                        }}
                        onBlur={() => commitRename(p.id)}
                        style={{
                          flex: 1,
                          fontFamily: display,
                          fontSize: 19,
                          fontWeight: 400,
                          color: ink,
                          background: "#fffdf3",
                          border: "1px solid " + green,
                          borderRadius: 2,
                          padding: "2px 6px",
                          outline: "none",
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          fontFamily: display,
                          fontSize: 20,
                          fontWeight: 400,
                          lineHeight: 1.1,
                          color: ink,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {p.name}
                      </div>
                    )}
                  </div>

                  <div style={{ fontFamily: mono, fontSize: 9.5, color: "#5c6b5f" }}>
                    {fmtDate(p.updatedAt)}
                  </div>

                  <div>
                    <div style={{ fontFamily: mono, fontSize: 10, color: "#5c6b5f", marginBottom: 5 }}>
                      {written}/{total} moments written
                    </div>
                    <div style={{ height: 6, background: "#e0d6b8", borderRadius: 3, overflow: "hidden" }}>
                      <div
                        style={{
                          width: pct + "%",
                          height: "100%",
                          background: green,
                          transition: "width .2s",
                        }}
                      />
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 8, marginTop: 2 }} onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => {
                        setRenaming(p.id);
                        setRenameText(p.name);
                      }}
                      style={{
                        fontFamily: mono,
                        fontSize: 10,
                        padding: "5px 9px",
                        cursor: "pointer",
                        border: "1px solid " + brown,
                        borderRadius: 2,
                        background: "transparent",
                        color: brown,
                      }}
                    >
                      Rename
                    </button>
                    <button
                      onClick={() => onDelete(p.id, p.name)}
                      style={{
                        fontFamily: mono,
                        fontSize: 10,
                        padding: "5px 9px",
                        cursor: "pointer",
                        border: "1px solid #b23a2e",
                        borderRadius: 2,
                        background: "transparent",
                        color: "#b23a2e",
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {onboarding && (
        <NewProjectOnboarding
          busy={busy}
          error={onboardError}
          onCancel={() => {
            if (!busy) setOnboarding(false);
          }}
          onCreate={onCreate}
        />
      )}
    </div>
  );
}
