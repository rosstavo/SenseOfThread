import { useState } from "react";
import {
    authErrorMessage,
    resetPassword,
    signIn,
    signUp,
} from "./authService.js";
import { ensureUserDoc } from "./storage.js";

// Sign in / sign up / password reset. On success the auth-state listener in
// App picks up the new user and swaps this screen out — so this component only
// has to drive the three form flows and surface errors.

const ink = "#233029";
const brown = "#6e4a2e";
const green = "#2f6e62";
const border = "#b99a6b";

const mono = "'IBM Plex Mono',monospace";
const serif = "'Source Serif 4',serif";
const display = "'Sorts Mill Goudy',serif";

const label = {
    fontFamily: mono,
    fontSize: 10,
    letterSpacing: ".06em",
    textTransform: "uppercase",
    color: "#5c6b5f",
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
    marginBottom: 14,
};
const primaryBtn = {
    width: "100%",
    fontFamily: mono,
    fontSize: 12,
    letterSpacing: ".03em",
    padding: "11px 14px",
    cursor: "pointer",
    border: "1px solid " + green,
    borderRadius: 2,
    background: green,
    color: "#f6f2e2",
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

export default function AuthScreen() {
    const [mode, setMode] = useState("signin"); // signin | signup | reset
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    function switchMode(next) {
        setMode(next);
        setError("");
        setNotice("");
        setPassword("");
    }

    async function onSubmit(e) {
        e.preventDefault();
        if (busy) return;
        setError("");
        setNotice("");
        setBusy(true);
        try {
            if (mode === "signin") {
                await signIn(email.trim(), password);
            } else if (mode === "signup") {
                const cred = await signUp(email.trim(), password);
                // Best-effort profile record; failure here shouldn't block sign-up.
                ensureUserDoc(cred.user.uid, cred.user.email).catch(() => {});
            } else if (mode === "reset") {
                await resetPassword(email.trim());
                setNotice("Password reset email sent — check your inbox.");
            }
        } catch (err) {
            setError(authErrorMessage(err));
        } finally {
            setBusy(false);
        }
    }

    const title =
        mode === "signup"
            ? "Create your account"
            : mode === "reset"
              ? "Reset password"
              : "Welcome back";
    const submitLabel =
        mode === "signup"
            ? "Sign up"
            : mode === "reset"
              ? "Send reset link"
              : "Sign in";

    return (
        <div
            style={{
                width: "100%",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                background: "#d9cfb2",
                fontFamily: serif,
                color: ink,
                padding: 20,
            }}
        >
            <div
                style={{
                    flex: 1,
                    minHeight: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                }}
            >
                <div
                    style={{
                        width: 380,
                        maxWidth: "100%",
                        background: "#efe8d0",
                        border: "1px solid " + brown,
                        borderRadius: 4,
                        boxShadow: "0 18px 44px rgba(60,40,20,.22)",
                        padding: "30px 30px 26px",
                    }}
                >
                    <div style={{ textAlign: "center", marginBottom: 22 }}>
                        <div
                            style={{
                                fontFamily: display,
                                fontWeight: 400,
                                fontSize: 30,
                                letterSpacing: ".4px",
                                lineHeight: 1.05,
                            }}
                        >
                            Sense of Thread
                        </div>
                        <div
                            style={{
                                fontFamily: mono,
                                fontSize: 10,
                                color: "#5c6b5f",
                                marginTop: 5,
                            }}
                        >
                            fiction plotting · continuity board
                        </div>
                    </div>

                    <h2
                        style={{
                            fontFamily: display,
                            fontWeight: 400,
                            fontSize: 20,
                            margin: "0 0 16px",
                            borderBottom: "1px solid " + border,
                            paddingBottom: 10,
                        }}
                    >
                        {title}
                    </h2>

                    <form onSubmit={onSubmit}>
                        <label style={label} htmlFor="auth-email">
                            Email
                        </label>
                        <input
                            id="auth-email"
                            type="email"
                            autoComplete="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            style={input}
                            placeholder="you@example.com"
                        />

                        {mode !== "reset" && (
                            <>
                                <label style={label} htmlFor="auth-password">
                                    Password
                                </label>
                                <input
                                    id="auth-password"
                                    type="password"
                                    autoComplete={
                                        mode === "signup"
                                            ? "new-password"
                                            : "current-password"
                                    }
                                    value={password}
                                    onChange={(e) =>
                                        setPassword(e.target.value)
                                    }
                                    style={input}
                                    placeholder={
                                        mode === "signup"
                                            ? "at least 6 characters"
                                            : "••••••••"
                                    }
                                />
                            </>
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
                                    marginBottom: 14,
                                    lineHeight: 1.4,
                                }}
                            >
                                {error}
                            </div>
                        )}
                        {notice && (
                            <div
                                style={{
                                    fontFamily: mono,
                                    fontSize: 11,
                                    color: green,
                                    background: "rgba(47,110,98,.08)",
                                    border: "1px solid " + green,
                                    borderRadius: 2,
                                    padding: "8px 10px",
                                    marginBottom: 14,
                                    lineHeight: 1.4,
                                }}
                            >
                                {notice}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={busy}
                            style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}
                        >
                            {busy ? "…" : submitLabel}
                        </button>
                    </form>

                    <div
                        style={{
                            display: "flex",
                            justifyContent: "space-between",
                            marginTop: 18,
                            gap: 10,
                            flexWrap: "wrap",
                        }}
                    >
                        {mode === "signin" && (
                            <>
                                <button
                                    style={linkBtn}
                                    onClick={() => switchMode("reset")}
                                >
                                    Forgot password?
                                </button>
                                <button
                                    style={linkBtn}
                                    onClick={() => switchMode("signup")}
                                >
                                    Create an account
                                </button>
                            </>
                        )}
                        {mode === "signup" && (
                            <button
                                style={linkBtn}
                                onClick={() => switchMode("signin")}
                            >
                                Already have an account? Sign in
                            </button>
                        )}
                        {mode === "reset" && (
                            <button
                                style={linkBtn}
                                onClick={() => switchMode("signin")}
                            >
                                Back to sign in
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <footer
                style={{
                    flex: "0 0 auto",
                    textAlign: "center",
                    fontFamily: mono,
                    fontSize: 10,
                    lineHeight: 1.5,
                    color: "#5c6b5f",
                    padding: "14px 12px 4px",
                    maxWidth: 460,
                    margin: "0 auto",
                }}
            >
                <div>
                    This app was built with the help of AI. There are no AI
                    features in this app. Writing is a sacred pursuit and takes
                    effort, and if you want to shortcut that with AI, then maybe
                    pick a different hobby. Lots of love, Ross ❤️
                </div>
                <div style={{ marginTop: 6 }}>
                    <a
                        href="https://github.com/rosstavo/SenseOfThread"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: brown, textDecoration: "underline" }}
                    >
                        View the source on GitHub
                    </a>
                </div>
            </footer>
        </div>
    );
}
