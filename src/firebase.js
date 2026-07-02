// Firebase bootstrap. Config comes from Vite env vars (VITE_FIREBASE_*) so no
// secrets live in source — copy .env.example to .env.local and fill in the
// values from your Firebase console (Project settings → Your apps → SDK setup).
//
// Auth persistence is LOCAL (per ADR 0001): a personal daily-use tool should
// not force re-login on every browser restart.

import { initializeApp } from "firebase/app";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  // Fail loud and early rather than surfacing a cryptic auth/internal error
  // deep inside a sign-in call.
  console.error(
    "PlotBoard: missing Firebase config. Copy .env.example to .env.local " +
      "and fill in your project's VITE_FIREBASE_* values."
  );
}

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Fire-and-forget: keep the user signed in across browser restarts.
setPersistence(auth, browserLocalPersistence).catch((err) =>
  console.warn("PlotBoard: could not set auth persistence", err)
);
