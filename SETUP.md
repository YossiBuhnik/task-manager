# מנהל פרויקטים — Setup Guide

This is the **one-time setup** to get the dashboard running as a real shared app for your team, installable on phones and desktops, with live cloud sync via Firebase.

Total time: ~15–20 minutes the first time.

---

## What you'll end up with

1. **A public URL** (e.g. `https://yourname.github.io/task-manager/`) you can open on any device.
2. **Installable as an app** on Android, Chrome desktop, and iOS (Add to Home Screen).
3. **Live shared data** across you and your co-workers — everyone sees the same dashboard, in real time.
4. **Google sign-in** so only authorized people can read or write.
5. **Free**, on the Firebase Spark plan — well within free quotas for a 2–3 person team.

> **Heads-up about privacy:** the Firestore config (`firebase-config.js`) is public — it ends up in the bundle. Security comes from **Firestore security rules** that restrict access to your team's email addresses (Step 5 below). Don't skip that step.

---

## Step 1 — Create a Firebase project

1. Go to <https://console.firebase.google.com>.
2. Click **Add project** → name it e.g. `task-manager` → continue (Google Analytics not needed; skip it).
3. Wait ~30 seconds for provisioning.

## Step 2 — Enable Google sign-in

1. In the left sidebar → **Build → Authentication** → **Get started**.
2. Click **Sign-in method** tab → **Google** → toggle **Enable** → set a support email → **Save**.

## Step 3 — Create the Firestore database

1. Left sidebar → **Build → Firestore Database** → **Create database**.
2. Choose **Start in production mode** (we'll set the rules in step 5).
3. Pick a region close to Israel (e.g. `eur3 (europe-west)`). **This cannot be changed later.**
4. Click **Enable**.

## Step 4 — Register the web app & grab the config

1. Project home → click the **`</>`** (Web) icon to add a web app.
2. Nickname: `task-manager-web`. **Don't** check "set up Firebase Hosting." → **Register app**.
3. Firebase shows you a `firebaseConfig` block. Copy the values.
4. Open `firebase-config.js` in this project and paste them in — replacing every `REPLACE_ME`. It should look like:

   ```js
   window.FIREBASE_CONFIG = {
     apiKey:            "AIzaSy…",
     authDomain:        "task-manager-12345.firebaseapp.com",
     projectId:         "task-manager-12345",
     storageBucket:     "task-manager-12345.appspot.com",
     messagingSenderId: "1234567890",
     appId:             "1:1234567890:web:abc123…",
   };
   ```

## Step 5 — Lock down access with security rules ⚠️ DO NOT SKIP

In Firestore Database → **Rules** tab → replace the contents with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Allowed team members — edit this list!
    function allowedEmails() {
      return [
        "you@example.com",
        "coworker1@example.com",
        "coworker2@example.com"
      ];
    }

    match /teams/{teamId} {
      allow read, write:
        if request.auth != null
        && request.auth.token.email in allowedEmails();
    }
  }
}
```

Replace the emails with your team's actual Google account emails. Click **Publish**.

> Anyone whose email is NOT on this list will be able to sign in but will see a "permissions" error and no data. To add someone later, just edit this rules file in the Firebase console.

## Step 6 — Authorize your eventual GitHub Pages domain

In Authentication → **Settings → Authorized domains** → **Add domain** → enter:

```
yourname.github.io
```

(Replace `yourname` with your actual GitHub username. You can do this now or after Step 8 — sign-in won't work from the deployed URL until you do.)

---

## Step 7 — Push to GitHub

If you've never used Git before:

1. Install [GitHub Desktop](https://desktop.github.com/) (easiest).
2. Open GitHub Desktop → **File → Add local repository** → pick this project folder.
3. It'll offer to **create a new repository** — accept. Name it `task-manager`. **Public** is fine (your data is not in the repo, only the app code).
4. Click **Publish repository** → uncheck "Keep this code private" if you want Pages free → publish.

Or, in a terminal:

```bash
cd path/to/project
git init
git add .
git commit -m "Initial commit"
gh repo create task-manager --public --source=. --push
```

## Step 8 — Enable GitHub Pages

1. On <https://github.com> → your `task-manager` repo → **Settings → Pages**.
2. **Source:** Deploy from a branch → **Branch:** `main` → **Folder:** `/ (root)` → **Save**.
3. Wait ~1 minute → refresh. You'll see the URL near the top, e.g.
   `https://yourname.github.io/task-manager/`
4. Open it. The first time you load, you'll see the sign-in screen. Sign in with Google.
5. Go back to Firebase **Authorized domains** (Step 6) and add the domain if you haven't.

---

## Step 9 — Install on your phone / desktop

### Android (Chrome)
- Open the URL in Chrome → tap the **⋮** menu → **Install app** (or **Add to Home Screen**).
- The app gets a real icon on your home screen and opens full-screen with no browser chrome.

### Desktop (Chrome / Edge)
- Open the URL → there's a small **install icon** (⊕) in the address bar, OR **⋮ menu → Install מנהל פרויקטים**.
- You'll get a standalone window and an app-launcher entry.

### iOS (Safari)
- Open the URL in Safari → **Share** → **Add to Home Screen**.
- iOS PWAs work, with minor limitations (no install prompt, no push notifications).

---

## Step 10 — Invite your co-workers

1. Send them the URL (e.g. `https://yourname.github.io/task-manager/`).
2. They sign in with their Google account.
3. Make sure their email is in `allowedEmails()` in your Firestore rules (Step 5). Re-publish if you added someone.
4. They install the app on their phone (Step 9).
5. Everyone now sees the same data. Edits propagate live.

---

## Updating the app later

When you make changes (or I do):

1. Save the files.
2. In GitHub Desktop: **Commit to main** → **Push origin**. (Or `git add . && git commit -m "..." && git push`.)
3. GitHub Pages redeploys automatically in ~1 minute.
4. On your installed apps, the service worker will pick up the new version on the next launch.

To **force-refresh** the app right now (skip the SW cache), open it and press **Ctrl/Cmd+Shift+R**.

---

## Privacy: shared vs private תחומים

Each תחום (top-level area) has a visibility setting in the edit modal:

- **משותף עם הצוות** (default) — everyone on the allowlist sees it
- **פרטי** — only the creator sees it in their UI

> **Caveat:** because the whole team shares a single Firestore document, "private" is **soft privacy** — it hides items from the UI, but a tech-savvy teammate with allowlist access could read the raw doc via browser DevTools and see all data. For a small team of partners who already trust each other, this is the practical tradeoff for keeping the architecture simple. If you need cryptographic privacy (e.g. confidential client work that even allowlisted teammates shouldn't see), tell me and I'll switch the model to per-user Firestore collections.

---

## Troubleshooting

**"Sign-in failed: permission denied"** — your email isn't in the Firestore rules allowlist. Fix it in the Firebase console → Firestore → Rules → Publish.

**"auth/unauthorized-domain"** — you haven't added `yourname.github.io` to Firebase Authorized domains (Step 6).

**App says "מצב מקומי" (local mode) instead of "מסונכרן"** — `firebase-config.js` still has placeholders, or there's a typo. Re-check Step 4.

**Co-worker doesn't see your data** — confirm both of you are signed in with the email on the allowlist, and that your Firestore rules were Published (the "Publish" button, not just saved).

**Old version keeps showing up after a deploy** — service worker is caching. Open DevTools → Application → Service Workers → **Unregister**, then reload. Or in the app, full-refresh with Ctrl/Cmd+Shift+R.

**localStorage data from before Firebase setup** — that data lives only in your local browser; it's not auto-uploaded. To migrate: in local mode, click **ייצוא JSON** → sign in to the cloud version → click **ייבוא JSON**.

---

## Costs

Firebase **Spark plan (free)**:
- 50,000 reads / 20,000 writes / 1 GiB stored per day
- A team of 2–3 with normal use is well below 1% of these limits.

GitHub Pages: free for public repos. No payment method needed.

If you ever need more, both have pay-as-you-go upgrades. For this app's use case, you won't need them.
