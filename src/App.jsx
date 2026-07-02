import React, { useEffect, useState } from "react";
import { onAuthChange } from "./authService.js";
import { ensureSeed, loadProject } from "./storage.js";
import AuthScreen from "./AuthScreen.jsx";
import ProjectList from "./ProjectList.jsx";
import PlotBoard from "./PlotBoard.jsx";

// Top-level router. Three states, gated by Firebase auth:
//   1. logged out                 -> AuthScreen
//   2. logged in, no project open -> ProjectList (seeds R&J on first login)
//   3. a project open             -> PlotBoard for that project
//
// There is no URL router (MVP): navigation is plain component state.

const mono = "'IBM Plex Mono',monospace";

function Splash({ text }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#d9cfb2",
        fontFamily: mono,
        fontSize: 12,
        color: "#5c6b5f",
      }}
    >
      {text}
    </div>
  );
}

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState(null);
  const [seeding, setSeeding] = useState(false);

  const [openId, setOpenId] = useState(null);
  const [openProject, setOpenProject] = useState(null); // loaded doc
  const [openError, setOpenError] = useState("");

  // Watch auth state for the life of the app.
  useEffect(() => {
    return onAuthChange((u) => {
      setUser(u);
      setAuthReady(true);
      // Leaving any open board when the user changes (e.g. sign out).
      setOpenId(null);
      setOpenProject(null);
    });
  }, []);

  // First-login seed: when a user appears, make sure they have at least the
  // Romeo & Juliet demo before the project list renders.
  useEffect(() => {
    let cancelled = false;
    if (!user) return;
    setSeeding(true);
    ensureSeed(user.uid)
      .catch((err) => console.error("seed failed", err))
      .finally(() => {
        if (!cancelled) setSeeding(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Load a project's full board doc when one is opened.
  useEffect(() => {
    let cancelled = false;
    if (!openId) {
      setOpenProject(null);
      return;
    }
    setOpenError("");
    setOpenProject(null);
    loadProject(openId)
      .then((doc) => {
        if (cancelled) return;
        if (!doc) {
          setOpenError("That project could not be found.");
          setOpenId(null);
        } else {
          setOpenProject(doc);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        console.error(err);
        setOpenError("Could not open that project. Try again.");
        setOpenId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [openId]);

  if (!authReady) return <Splash text="Loading…" />;
  if (!user) return <AuthScreen />;
  if (seeding) return <Splash text="Setting up your workspace…" />;

  if (openId) {
    if (!openProject) return <Splash text="Opening project…" />;
    return (
      <PlotBoard
        key={openProject.id}
        user={user}
        project={openProject}
        onExit={() => setOpenId(null)}
      />
    );
  }

  return (
    <>
      {openError && (
        <div
          style={{
            position: "fixed",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 50,
            fontFamily: mono,
            fontSize: 11,
            color: "#7a2a20",
            background: "#f6e2dd",
            border: "1px solid #b23a2e",
            borderRadius: 2,
            padding: "8px 12px",
          }}
        >
          {openError}
        </div>
      )}
      <ProjectList user={user} onOpen={(id) => setOpenId(id)} />
    </>
  );
}
