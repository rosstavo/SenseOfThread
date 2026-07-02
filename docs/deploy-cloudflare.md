# Deploying PlotBoard to Cloudflare Pages

PlotBoard is a static Vite SPA that talks to Firebase (Auth + Firestore) entirely
from the browser. Cloudflare Pages only needs to serve the built static files —
the backend lives in Firebase and is unaffected by where the frontend is hosted.

## Prerequisites

A working Firebase project (see `docs/adr/0001-firebase-firestore-persistence.md`):

1. Firebase project created.
2. **Authentication → Sign-in method →** Email/Password enabled.
3. **Firestore** database created.
4. Security rules deployed — this is independent of Cloudflare and always goes
   through the Firebase CLI:
   ```sh
   firebase deploy --only firestore:rules
   ```

## Cloudflare Pages build settings

Connect the repo in the Cloudflare dashboard (**Workers & Pages → Create → Pages
→ Connect to Git**), or use `wrangler`. Configure:

| Setting                | Value           |
| ---------------------- | --------------- |
| Framework preset       | Vite            |
| Build command          | `npm run build` |
| Build output directory | `dist`          |
| Node version           | 18+             |

### Environment variables (required)

Add these under **Settings → Environment variables** for the Production (and
Preview) environments, using the values from Firebase console → Project settings
→ Your apps → SDK setup and config:

```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
```

> ⚠️ Vite **inlines** `VITE_*` vars at build time, so they must be set in
> Cloudflare's build environment — not injected at runtime. They end up embedded
> in the JS bundle, which is expected: Firebase web API keys are public and are
> not secrets (access is controlled by Firestore rules + Auth, not key secrecy).

## Firebase authorized domains

In **Firebase console → Authentication → Settings → Authorized domains**, add:

- your `*.pages.dev` deployment domain, and
- any custom domain you attach to the Pages project.

Email/password sign-in itself is lenient here, but password-reset action links
and any OAuth providers you add later require the domain to be authorized.

## SPA routing

`public/_redirects` ships a catch-all fallback (`/*  /index.html  200`). Existing
static files (the JS bundle, assets) are served directly; anything else resolves
to `index.html`, so deep links and client-side navigation don't 404. Vite copies
it from `public/` into `dist/` at build time.

## Local production preview

Verify the production build before pushing:

```sh
npm run build     # emits dist/
npm run preview   # serves dist/ locally
```

## Notes

- `firebase.json`'s `hosting` block is **only** used by Firebase Hosting and is
  dead config on Cloudflare Pages — harmless to leave. The `firestore` block
  (rules) stays relevant.
- No Cloudflare Workers/Functions are required: there is no server-side code.
