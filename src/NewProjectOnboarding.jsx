import React, { useState } from "react";

// New-project onboarding. Shown as an overlay when the User starts a new
// project from the shelf: a short guided flow that gathers the project's name,
// how many chapters/sections it has (and whether it opens with a prologue),
// its main characters, and its main story threads. Colours and pip marks are
// assigned automatically later (see buildOnboardedDoc), so this flow never
// asks about them. On finish it hands the collected answers back to the caller,
// which builds the project doc and opens the board.

const ink = "#233029";
const brown = "#6e4a2e";
const green = "#2f6e62";
const border = "#b99a6b";
const muted = "#5c6b5f";

const mono = "'IBM Plex Mono',monospace";
const serif = "'Source Serif 4',serif";
const display = "'Sorts Mill Goudy',serif";

const label = {
  fontFamily: mono,
  fontSize: 10,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: muted,
  marginBottom: 6,
  display: "block",
};
const input = {
  width: "100%",
  fontFamily: mono,
  fontSize: 13,
  color: ink,
  background: "#fffdf3",
  border: "1px solid " + border,
  borderRadius: 2,
  padding: "10px 11px",
  outline: "none",
};
const help = {
  fontFamily: serif,
  fontSize: 12.5,
  lineHeight: 1.5,
  color: muted,
  margin: "0 0 16px",
};
const primaryBtn = {
  fontFamily: mono,
  fontSize: 12,
  letterSpacing: ".03em",
  padding: "10px 18px",
  cursor: "pointer",
  border: "1px solid " + green,
  borderRadius: 2,
  background: green,
  color: "#f6f2e2",
};
const ghostBtn = {
  fontFamily: mono,
  fontSize: 11,
  padding: "10px 14px",
  cursor: "pointer",
  border: "1px solid " + brown,
  borderRadius: 2,
  background: "transparent",
  color: brown,
};
const linkBtn = {
  border: "none",
  background: "transparent",
  color: brown,
  fontFamily: mono,
  fontSize: 11,
  cursor: "pointer",
  padding: 0,
  textDecoration: "underline",
};

const STEPS = ["Name", "Structure", "Characters", "Threads"];

// A growable list of single-line text inputs. Used for both characters and
// threads: the User types names, and a fresh blank field is always available.
function NameList({ items, onChange, placeholder }) {
  function setAt(i, value) {
    const next = items.slice();
    next[i] = value;
    onChange(next);
  }
  function removeAt(i) {
    const next = items.slice();
    next.splice(i, 1);
    onChange(next.length ? next : [""]);
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map((val, i) => (
        <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            autoFocus={i === items.length - 1 && items.length > 1}
            value={val}
            placeholder={placeholder + " " + (i + 1)}
            onChange={(e) => setAt(i, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (i === items.length - 1 && val.trim()) onChange([...items, ""]);
              }
            }}
            style={{ ...input, flex: 1 }}
          />
          {items.length > 1 && (
            <button
              type="button"
              onClick={() => removeAt(i)}
              title="Remove"
              style={{
                fontFamily: mono,
                fontSize: 14,
                lineHeight: 1,
                color: muted,
                background: "transparent",
                border: "1px solid " + border,
                borderRadius: 2,
                cursor: "pointer",
                padding: "8px 10px",
              }}
            >
              ×
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, ""])}
        style={{ ...linkBtn, alignSelf: "flex-start", marginTop: 2 }}
      >
        ＋ Add another
      </button>
    </div>
  );
}

export default function NewProjectOnboarding({ busy, error, onCancel, onCreate }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [chapters, setChapters] = useState("12");
  const [prologue, setPrologue] = useState(false);
  const [characters, setCharacters] = useState([""]);
  const [threads, setThreads] = useState([""]);

  const nameOk = name.trim().length > 0;
  const last = step === STEPS.length - 1;

  function next() {
    if (step === 0 && !nameOk) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }
  function back() {
    setStep((s) => Math.max(s - 1, 0));
  }

  function submit() {
    if (busy || !nameOk) return;
    onCreate({
      name: name.trim(),
      chapters: chapters,
      prologue,
      characters: characters.map((c) => c.trim()).filter(Boolean),
      threads: threads.map((t) => t.trim()).filter(Boolean),
    });
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(40,28,14,.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        fontFamily: serif,
        color: ink,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        style={{
          width: 460,
          maxWidth: "100%",
          maxHeight: "100%",
          overflow: "auto",
          background: "#efe8d0",
          border: "1px solid " + brown,
          borderRadius: 4,
          boxShadow: "0 18px 44px rgba(60,40,20,.28)",
          padding: "26px 28px 24px",
        }}
      >
        <div style={{ marginBottom: 18 }}>
          <div
            style={{
              fontFamily: mono,
              fontSize: 10,
              letterSpacing: ".08em",
              textTransform: "uppercase",
              color: muted,
            }}
          >
            New project · step {step + 1} of {STEPS.length}
          </div>
          <h2
            style={{
              fontFamily: display,
              fontWeight: 400,
              fontSize: 24,
              margin: "6px 0 0",
            }}
          >
            {step === 0 && "Name your project"}
            {step === 1 && "How is it structured?"}
            {step === 2 && "Who are the main characters?"}
            {step === 3 && "What are the main threads?"}
          </h2>
          {/* progress dots */}
          <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
            {STEPS.map((_, i) => (
              <div
                key={i}
                style={{
                  height: 4,
                  flex: 1,
                  borderRadius: 2,
                  background: i <= step ? green : "#d8cdac",
                  transition: "background .2s",
                }}
              />
            ))}
          </div>
        </div>

        {step === 0 && (
          <div>
            <p style={help}>
              Give this story a working title. You can rename it any time from
              the board header.
            </p>
            <label style={label} htmlFor="ob-name">
              Title
            </label>
            <input
              id="ob-name"
              autoFocus
              value={name}
              placeholder="e.g. The Winter Between Us"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && nameOk) next();
              }}
              style={input}
            />
          </div>
        )}

        {step === 1 && (
          <div>
            <p style={help}>
              Roughly how many chapters or sections does your story have? A
              rough count is fine — you can add, remove, or rename them on the
              board later.
            </p>
            <label style={label} htmlFor="ob-chapters">
              Chapters / sections
            </label>
            <input
              id="ob-chapters"
              type="number"
              min="1"
              max="200"
              value={chapters}
              onChange={(e) => setChapters(e.target.value)}
              style={{ ...input, width: 120 }}
            />
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                marginTop: 18,
                cursor: "pointer",
                fontFamily: serif,
                fontSize: 14,
              }}
            >
              <input
                type="checkbox"
                checked={prologue}
                onChange={(e) => setPrologue(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: green, cursor: "pointer" }}
              />
              The story opens with a prologue
            </label>
          </div>
        )}

        {step === 2 && (
          <div>
            <p style={help}>
              List your main characters. If you're writing a multi-POV novel,
              these are usually best thought of as your point-of-view
              characters — the ones whose perspective the story is told
              through.
            </p>
            <NameList
              items={characters}
              onChange={setCharacters}
              placeholder="Character"
            />
          </div>
        )}

        {step === 3 && (
          <div>
            <p style={help}>
              List the main story threads — the plotlines, arcs, or through-lines
              you're weaving together. You'll be able to map moments onto these
              on the board.
            </p>
            <NameList items={threads} onChange={setThreads} placeholder="Thread" />
          </div>
        )}

        {error && (
          <div
            style={{
              fontFamily: mono,
              fontSize: 11,
              color: "#7a2a20",
              background: "#f6e2dd",
              border: "1px solid #b23a2e",
              borderRadius: 2,
              padding: "8px 10px",
              marginTop: 16,
              lineHeight: 1.4,
            }}
          >
            {error}
          </div>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            marginTop: 24,
          }}
        >
          <button
            type="button"
            style={{ ...linkBtn }}
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <div style={{ display: "flex", gap: 10 }}>
            {step > 0 && (
              <button type="button" style={ghostBtn} onClick={back} disabled={busy}>
                Back
              </button>
            )}
            {!last && (
              <button
                type="button"
                style={{ ...primaryBtn, opacity: step === 0 && !nameOk ? 0.5 : 1 }}
                onClick={next}
                disabled={step === 0 && !nameOk}
              >
                Next
              </button>
            )}
            {last && (
              <button
                type="button"
                style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}
                onClick={submit}
                disabled={busy}
              >
                {busy ? "Creating…" : "Create project"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
