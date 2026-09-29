// cloud.jsx — Firebase Auth + Firestore wrapper.
// Exposes window.useCloud() — a React hook returning:
//   {
//     mode:    "loading" | "local" | "signedOut" | "signedIn",
//     user:    { email, name, photoURL } | null,
//     signIn:  () => void,
//     signOut: () => void,
//     // when mode === "signedIn":
//     data:    { cities: [...] } | null,   // live, updates via onSnapshot
//     save:    (data) => void,             // pushes to Firestore (debounced)
//     status:  "synced" | "saving" | "offline" | "error",
//   }
//
// In "local" mode (Firebase not configured) the rest of the app falls back
// to localStorage as before.

const { useState: cUseState, useEffect: cUseEffect, useRef: cUseRef, useCallback: cUseCallback } = React;

function useCloud() {
  const [mode, setMode]       = cUseState("loading");
  const [user, setUser]       = cUseState(null);
  const [data, setData]       = cUseState(null);
  const [status, setStatus]   = cUseState("synced");
  const fbRef = cUseRef(null);          // { app, auth, db, googleProvider }
  const saveTimer = cUseRef(null);
  const lastRemoteJson = cUseRef("");

  // ── initialize Firebase once ──
  cUseEffect(() => {
    if (window.IS_DEV) {
      setUser(window.DEV_USER);
      setMode("local");
      return;
    }
    if (!window.isFirebaseConfigured || !window.isFirebaseConfigured()) {
      setMode("local");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const F = window.__fb;
        if (!F) {
          // SDK not yet loaded — wait briefly
          await new Promise((res) => {
            const tick = () => window.__fb ? res() : setTimeout(tick, 50);
            tick();
          });
        }
        const fb = window.__fb;
        const app = fb.initializeApp(window.FIREBASE_CONFIG);
        const auth = fb.getAuth(app);
        const db   = fb.getFirestore(app);
        // Enable offline persistence (best-effort)
        try {
          await fb.enableIndexedDbPersistence(db);
        } catch (e) { /* multi-tab or unsupported — ignore */ }
        const googleProvider = new fb.GoogleAuthProvider();
        fbRef.current = { fb, app, auth, db, googleProvider };

        // Auth state listener
        fb.onAuthStateChanged(auth, (u) => {
          if (cancelled) return;
          if (u) {
            setUser({ email: u.email, name: u.displayName, photoURL: u.photoURL, uid: u.uid });
            setMode("signedIn");
          } else {
            setUser(null);
            setData(null);
            setMode("signedOut");
          }
        });
      } catch (err) {
        console.error("Firebase init failed:", err);
        setMode("local");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── once signed in, listen on the team doc ──
  cUseEffect(() => {
    if (mode !== "signedIn" || !fbRef.current) return;
    const { fb, db } = fbRef.current;
    const { collection, id } = window.FIREBASE_TEAM_DOC;
    const ref = fb.doc(db, collection, id);

    setStatus("synced");
    const unsub = fb.onSnapshot(
      ref,
      (snap) => {
        const remote = snap.exists() ? snap.data() : null;
        // Snapshot stores data under .state to leave room for metadata
        const payload = remote && remote.state ? remote.state : remote;
        if (payload && payload.cities) {
          lastRemoteJson.current = JSON.stringify(payload);
          setData(payload);
        } else if (!snap.exists()) {
          // Doc doesn't exist yet — seed with empty workspace.
          // Don't auto-write; let user create their first area.
          lastRemoteJson.current = JSON.stringify({ cities: [] });
          setData({ cities: [] });
        }
        setStatus("synced");
      },
      (err) => {
        console.error("Firestore listener error:", err);
        setStatus("error");
      }
    );
    return () => unsub();
  }, [mode]);

  // ── save() with debounce ──
  const save = cUseCallback((nextData) => {
    if (mode !== "signedIn" || !fbRef.current) return;
    // Skip if identical to last known remote (prevents echo loops)
    const json = JSON.stringify(nextData);
    if (json === lastRemoteJson.current) return;

    setStatus("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const { fb, db } = fbRef.current;
        const { collection, id } = window.FIREBASE_TEAM_DOC;
        const ref = fb.doc(db, collection, id);
        await fb.setDoc(ref, {
          state: nextData,
          updatedAt: fb.serverTimestamp(),
          updatedBy: user?.email || null,
        }, { merge: false });
        lastRemoteJson.current = json;
        setStatus("synced");
      } catch (err) {
        console.error("Firestore save error:", err);
        setStatus("error");
      }
    }, 400);
  }, [mode, user]);

  // ── auth actions ──
  const signIn = cUseCallback(async () => {
    if (!fbRef.current) return;
    const { fb, auth, googleProvider } = fbRef.current;
    try {
      await fb.signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error("Sign-in failed:", err);
      alert("ההתחברות נכשלה: " + (err.message || err.code || "אנא נסה שוב"));
    }
  }, []);

  const signOut = cUseCallback(async () => {
    if (!fbRef.current) return;
    await fbRef.current.fb.signOut(fbRef.current.auth);
  }, []);

  return { mode, user, data, save, status, signIn, signOut };
}

window.useCloud = useCloud;
