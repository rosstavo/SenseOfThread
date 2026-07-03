// Project templates. A Project's board structure (chapters/threads/characters)
// and content (moments/written) live in the Firestore project document — see
// ADR 0001. This module builds the two starting shapes:
//
//   buildSeedDoc()   — the Romeo & Juliet demo, seeded on first sign-up so a
//                      new User lands on a fully playable board.
//   buildBlankDoc(n) — an empty scaffold for "New project": a few generic
//                      chapters and starter rows, no moments yet.
//
// PlotBoard consumes whichever doc it is handed; it no longer hard-codes any of
// this.

const CHAPTERS = [
  { n: 1, label: "I.1", title: "Street Brawl" },
  { n: 2, label: "I.2", title: "Paris Proposes" },
  { n: 3, label: "I.5", title: "Capulet Feast" },
  { n: 4, label: "II.2", title: "Balcony" },
  { n: 5, label: "II.6", title: "Secret Marriage" },
  { n: 6, label: "III.1", title: "Duel & Death" },
  { n: 7, label: "III.2", title: "Banished" },
  { n: 8, label: "III.5", title: "Dawn Parting" },
  { n: 9, label: "IV.1", title: "The Plan" },
  { n: 10, label: "IV.3", title: "The Potion" },
  { n: 11, label: "V.1", title: "False News" },
  { n: 12, label: "V.3", title: "The Tomb" },
];

const THREADS = [
  { key: "feud", label: "The Feud", note: "Montague v. Capulet", color: "#8a4a3a", mark: "F" },
  { key: "romance", label: "The Romance", note: "Romeo & Juliet", color: "#a5645a", mark: "R" },
  { key: "fate", label: "Fate & Ill Fortune", note: "omens · timing · poison", color: "#2f6e62", mark: "O" },
  { key: "miscommunication", label: "Miscommunication", note: "messages gone wrong", color: "#a1863c", mark: "M" },
  { key: "authority", label: "Family Authority", note: "the arranged match", color: "#5b6b63", mark: "A" },
];

const CHARACTERS = [
  { key: "romeo", label: "Romeo", note: "", color: "#7c3b2c", mark: "Ro" },
  { key: "juliet", label: "Juliet", note: "", color: "#2f6e62", mark: "Ju" },
  { key: "mercutio", label: "Mercutio", note: "", color: "#a1863c", mark: "Me" },
  { key: "tybalt", label: "Tybalt", note: "", color: "#8a4a3a", mark: "Ty" },
  { key: "friar", label: "Friar Laurence", note: "", color: "#5b6b63", mark: "Fr" },
  { key: "nurse", label: "Nurse", note: "", color: "#a5645a", mark: "Nu" },
  { key: "paris", label: "Paris", note: "", color: "#6b6558", mark: "Pa" },
];

const MOMENTS = [
  { id: 1, ch: 1, thread: "feud", char: "tybalt", text: "Servants brawl in the street — the old grudge flares again.", deps: [] },
  { id: 2, ch: 1, thread: "authority", char: "paris", text: "Paris asks Capulet for Juliet's hand.", deps: [] },
  { id: 3, ch: 1, thread: "romance", char: "romeo", text: "Romeo moons over Rosaline, oblivious to the feud.", deps: [] },
  { id: 4, ch: 2, thread: "authority", char: "paris", text: "Capulet agrees — if Juliet consents, at the feast.", deps: [2] },
  { id: 5, ch: 2, thread: "romance", char: "nurse", text: "Nurse recalls raising Juliet; Juliet is coy about marriage.", deps: [] },
  { id: 6, ch: 3, thread: "romance", char: "romeo", text: "Romeo sneaks into the Capulet feast, hoping to see Rosaline.", deps: [3] },
  { id: 7, ch: 3, thread: "romance", char: "juliet", text: "Romeo and Juliet meet and fall for each other instantly.", deps: [6, 5] },
  { id: 8, ch: 3, thread: "feud", char: "tybalt", text: "Tybalt recognises Romeo's voice and vows revenge.", deps: [1, 6] },
  { id: 9, ch: 3, thread: "authority", char: "paris", text: "Juliet dances with Paris, unmoved.", deps: [4] },
  { id: 10, ch: 4, thread: "romance", char: "romeo", text: "Romeo lingers at the orchard wall after the feast.", deps: [7] },
  { id: 11, ch: 4, thread: "romance", char: "juliet", text: "Juliet confesses her love aloud, not knowing Romeo hears.", deps: [7] },
  { id: 12, ch: 4, thread: "fate", char: "friar", text: "Friar Laurence agrees to marry them, hoping to end the feud.", deps: [10, 11] },
  { id: 13, ch: 5, thread: "romance", char: "nurse", text: "Nurse carries messages, arranging the secret wedding.", deps: [12] },
  { id: 14, ch: 5, thread: "romance", char: "romeo", text: "Romeo and Juliet marry in secret.", deps: [12, 13] },
  { id: 15, ch: 6, thread: "feud", char: "tybalt", text: "Tybalt challenges Romeo to a duel, still enraged.", deps: [8] },
  { id: 16, ch: 6, thread: "feud", char: "mercutio", text: "Romeo refuses to fight his new kinsman; Mercutio is baffled.", deps: [14, 15] },
  { id: 17, ch: 6, thread: "feud", char: "mercutio", text: "Mercutio duels Tybalt in Romeo's place, and is fatally wounded.", deps: [16] },
  { id: 18, ch: 6, thread: "feud", char: "romeo", text: "Enraged by Mercutio's death, Romeo kills Tybalt.", deps: [17] },
  { id: 19, ch: 7, thread: "fate", char: "romeo", text: "Romeo is banished from Verona for the killing.", deps: [18] },
  { id: 20, ch: 7, thread: "romance", char: "juliet", text: "Juliet grieves, torn between husband and cousin.", deps: [18, 14] },
  { id: 21, ch: 8, thread: "romance", char: "romeo", text: "Romeo and Juliet share one secret night before dawn.", deps: [14, 19] },
  { id: 22, ch: 8, thread: "authority", char: "paris", text: "Capulet, misreading her grief, moves the Paris wedding forward.", deps: [9, 20] },
  { id: 23, ch: 9, thread: "fate", char: "friar", text: "Friar Laurence devises the sleeping-potion plan.", deps: [22], planned: true },
  { id: 24, ch: 9, thread: "romance", char: "juliet", text: "Desperate, Juliet agrees to fake her own death.", deps: [22, 23], planned: true },
  { id: 25, ch: 9, thread: "miscommunication", char: "friar", text: "Friar sends a letter to Romeo explaining the plan.", deps: [23], planned: true },
  { id: 26, ch: 10, thread: "romance", char: "juliet", text: "Juliet drinks the potion and is found 'dead' on her wedding morning.", deps: [24] },
  { id: 27, ch: 11, thread: "miscommunication", char: "romeo", text: "The letter never reaches Romeo — he hears only that Juliet is dead.", deps: [25, 26] },
  { id: 28, ch: 11, thread: "fate", char: "romeo", text: "Romeo buys poison, resolved to die at her side.", deps: [27] },
  { id: 29, ch: 12, thread: "fate", char: "paris", text: "Paris, mourning at the tomb, is killed by a grief-maddened Romeo.", deps: [28] },
  { id: 30, ch: 12, thread: "fate", char: "romeo", text: "Romeo drinks poison; Juliet wakes, finds him dead, and stabs herself.", deps: [28, 26] },
];

// co-stars: rows a moment ALSO touches beyond its home row (home = its POV
// character / primary thread). Folded into each moment as coChars/coThreads.
const CO = {
  7: { chars: ["romeo"], threads: ["feud"] },
  8: { chars: ["romeo"], threads: ["fate"] },
  12: { chars: ["romeo", "juliet"], threads: ["romance"] },
  13: { chars: ["juliet"], threads: [] },
  14: { chars: ["juliet", "friar"], threads: ["fate"] },
  16: { chars: ["romeo"], threads: [] },
  17: { chars: ["tybalt"], threads: ["fate"] },
  18: { chars: ["tybalt"], threads: [] },
  20: { chars: ["romeo"], threads: [] },
  21: { chars: ["juliet"], threads: [] },
  24: { chars: ["friar"], threads: [] },
  25: { chars: ["romeo"], threads: ["fate"] },
  27: { chars: ["juliet"], threads: ["fate"] },
  29: { chars: ["romeo"], threads: [] },
  30: { chars: ["juliet"], threads: [] },
};

const clone = (v) => JSON.parse(JSON.stringify(v));

// The Romeo & Juliet demo project, seeded on first sign-up.
export function buildSeedDoc() {
  const moments = MOMENTS.map((m) => ({
    planned: false,
    ...m,
    coChars: (CO[m.id] && CO[m.id].chars) || [],
    coThreads: (CO[m.id] && CO[m.id].threads) || [],
  }));
  return {
    name: "Romeo & Juliet",
    chapters: clone(CHAPTERS),
    threads: clone(THREADS),
    characters: clone(CHARACTERS),
    moments,
    written: [3, 6, 7, 8],
    view: "thread",
    edition: "ledger",
    lastVerName: "Opening draft",
  };
}

// Colour palette that auto-assigned rows cycle through (mirrors ROW_PALETTE in
// PlotBoard so onboarded rows sit alongside ones added later on the board).
const ONBOARD_PALETTE = [
  "#7c3b2c", "#2f6e62", "#a1863c", "#8a4a3a", "#5b6b63",
  "#a5645a", "#6b6558", "#3a6b5b", "#9a6a2c", "#4a5b8a",
];

// "The Feud" -> "TF", "Romeo" -> "Ro". Mirrors markFromLabel in PlotBoard;
// duplicated here so seeding can assign a pip badge without importing the board.
function markFromLabel(label) {
  const words = String(label || "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2);
  return (words[0][0] + words[1][0]).toUpperCase();
}

// Turn a list of typed names into board rows with a stable unique key and an
// auto-assigned colour + mark. Blank entries are dropped; duplicate keys get a
// numeric suffix so the board can address each row unambiguously.
function rowsFromNames(names) {
  const used = new Set();
  return (names || [])
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .map((label, i) => {
      let base =
        label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") ||
        "row-" + (i + 1);
      let key = base;
      let n = 2;
      while (used.has(key)) key = base + "-" + n++;
      used.add(key);
      return {
        key,
        label,
        note: "",
        color: ONBOARD_PALETTE[i % ONBOARD_PALETTE.length],
        mark: markFromLabel(label),
      };
    });
}

// Build a project from the new-project onboarding answers. Chapters are
// auto-numbered "Ch 1", "Ch 2", … (labelAuto, so the board re-numbers them as
// they're edited); an optional prologue is prepended as a labelAuto/prologue
// chapter that the running counter skips. Characters and threads come straight
// from the typed lists, with colours and marks assigned automatically. No
// moments yet — the User fills the board in.
export function buildOnboardedDoc({
  name,
  chapters: chapterCount,
  prologue,
  characters,
  threads,
} = {}) {
  const count = Math.max(1, Math.floor(Number(chapterCount) || 1));
  const chapters = [];
  if (prologue) {
    chapters.push({ n: 1, label: "Prologue", title: "", labelAuto: true, prologue: true });
  }
  for (let i = 0; i < count; i++) {
    chapters.push({ n: chapters.length + 1, label: "", title: "", labelAuto: true });
  }
  // Assign "Ch 1", "Ch 2", … to the numbered chapters (prologue is skipped).
  let k = 0;
  chapters.forEach((c) => {
    if (c.prologue) return;
    k += 1;
    c.label = "Ch " + k;
  });

  const threadRows = rowsFromNames(threads);
  const charRows = rowsFromNames(characters);

  return {
    name: String(name || "").trim() || "Untitled project",
    chapters,
    // A board needs at least one row in each view to be usable; fall back to a
    // single generic row only when the User listed none.
    threads: threadRows.length
      ? threadRows
      : [{ key: "main", label: "Main Plot", note: "the through-line", color: "#7c3b2c", mark: "A" }],
    characters: charRows.length
      ? charRows
      : [{ key: "protagonist", label: "Protagonist", note: "", color: "#7c3b2c", mark: "P1" }],
    moments: [],
    written: [],
    view: "thread",
    edition: "ledger",
    lastVerName: "",
  };
}

// An empty scaffold for a brand-new project: generic chapters + starter rows,
// no moments. Gives the User a board to build on without pre-filled content.
export function buildBlankDoc(name) {
  // labelAuto lets the board re-number these ("Ch 1", "Ch 2", …) as chapters
  // are added/removed or the first is marked a prologue. The seed R&J chapters
  // keep hand-authored labels (no labelAuto), so only new projects auto-number.
  const chapters = Array.from({ length: 6 }, (_, i) => ({
    n: i + 1,
    label: "Ch " + (i + 1),
    title: "",
    labelAuto: true,
  }));
  return {
    name: (name || "").trim() || "Untitled project",
    chapters,
    threads: [
      { key: "main", label: "Main Plot", note: "the through-line", color: "#7c3b2c", mark: "A" },
      { key: "subplot", label: "Subplot", note: "", color: "#2f6e62", mark: "B" },
    ],
    characters: [
      { key: "protagonist", label: "Protagonist", note: "", color: "#7c3b2c", mark: "P1" },
      { key: "antagonist", label: "Antagonist", note: "", color: "#8a4a3a", mark: "P2" },
    ],
    moments: [],
    written: [],
    view: "thread",
    edition: "ledger",
    lastVerName: "",
  };
}
