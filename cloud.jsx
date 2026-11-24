// cloud.jsx — Firebase Auth + Firestore wrapper.
// Exposes window.useCloud() — a React hook returning:
//   {
//     mode:    "loading" | "local" | "signedOut" | "signedIn",
//     user:    { email, name, photoURL } | null,
//     signIn:  () => void,
//     signOut: () => void,
//     data:    { areas, cities } | null,   // live; tasks attached from the collection
//     save:    (data) => void,             // shim: does NOT write the legacy blob
//     status:  "synced" | "saving" | "offline" | "error",
//     readLegacyBlob, writesEnabled,
//     createTask, updateTaskDoc, deleteTaskDoc, updateTeamState,
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
  const fbRef = cUseRef(null);          // { app, auth, db, googleProvider, fb }
  const teamStateRef = cUseRef(null);
  const tasksRef = cUseRef([]);
  const userRef = cUseRef(null);

  const readLegacy = () => !!(window.TM && window.TM.FLAGS && window.TM.FLAGS.readLegacyBlob);
  // Signed-in users can always write. The flag only chooses the path:
  // legacy blob (transactional, surgical) vs per-task documents.
  const writesEnabled = mode === "signedIn";

  cUseEffect(() => { userRef.current = user; }, [user]);

  const publish = cUseCallback(() => {
    const assembled = window.TM.assembleData({
      teamState: teamStateRef.current,
      tasks: tasksRef.current,
      readLegacyBlob: readLegacy(),
    });
    setData(assembled);
  }, []);

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
          await new Promise((res) => {
            const tick = () => window.__fb ? res() : setTimeout(tick, 50);
            tick();
          });
        }
        const fb = window.__fb;
        const app = fb.initializeApp(window.FIREBASE_CONFIG);
        const auth = fb.getAuth(app);
        const db   = fb.getFirestore(app);
        try {
          await fb.enableIndexedDbPersistence(db);
        } catch (e) { /* multi-tab or unsupported — ignore */ }
        const googleProvider = new fb.GoogleAuthProvider();
        fbRef.current = { fb, app, auth, db, googleProvider };

        fb.onAuthStateChanged(auth, (u) => {
          if (cancelled) return;
          if (u) {
            setUser({ email: u.email, name: u.displayName, photoURL: u.photoURL, uid: u.uid });
            setMode("signedIn");
          } else {
            setUser(null);
            setData(null);
            teamStateRef.current = null;
            tasksRef.current = [];
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

  // ── once signed in, listen on the team doc and (unless rolling back) the tasks collection ──
  cUseEffect(() => {
    if (mode !== "signedIn" || !fbRef.current) return;
    const { fb, db } = fbRef.current;
    const { collection: col, id } = window.FIREBASE_TEAM_DOC;
    const teamRef = fb.doc(db, col, id);
    const unsubs = [];

    setStatus("synced");

    unsubs.push(fb.onSnapshot(
      teamRef,
      (snap) => {
        const remote = snap.exists() ? snap.data() : null;
        const payload = remote && remote.state ? remote.state : remote;
        if (payload && (payload.cities || payload.areas)) {
          teamStateRef.current = payload;
        } else if (!snap.exists()) {
          teamStateRef.current = { areas: [], cities: [] };
        } else {
          teamStateRef.current = { areas: [], cities: [] };
        }
        if (readLegacy()) tasksRef.current = [];
        publish();
        setStatus("synced");
      },
      (err) => {
        console.error("Firestore listener error:", err);
        setStatus("error");
      }
    ));

    if (!readLegacy() && fb.collection) {
      const tasksCol = fb.collection(db, col, id, "tasks");
      unsubs.push(fb.onSnapshot(
        tasksCol,
        (snap) => {
          const list = [];
          snap.forEach((docSnap) => {
            const t = docSnap.data() || {};
            list.push({ ...t, id: t.id || docSnap.id });
          });
          tasksRef.current = list;
          publish();
          setStatus("synced");
        },
        (err) => {
          console.error("Firestore tasks listener error:", err);
          setStatus("error");
        }
      ));
    }

    return () => unsubs.forEach((u) => u && u());
  }, [mode, publish]);

  const teamDocRef = () => {
    const { fb, db } = fbRef.current;
    const { collection: col, id } = window.FIREBASE_TEAM_DOC;
    return { fb, db, ref: fb.doc(db, col, id), col, id };
  };

  const taskDocRef = (taskId) => {
    const { fb, db, col, id } = teamDocRef();
    return { fb, db, ref: fb.doc(db, col, id, "tasks", taskId) };
  };

  const writeTeamFromTx = (tx, fb, ref, snap, state) => {
    const meta = {
      updatedAt: fb.serverTimestamp(),
      updatedBy: userRef.current?.email || null,
    };
    // setDoc merge:true only when the doc does not exist (checked in this transaction).
    // Never setDoc over an existing doc — even with merge:true.
    if (!snap.exists()) {
      tx.set(ref, { state, ...meta }, { merge: true });
    } else {
      tx.update(ref, { state, ...meta });
    }
  };

  // Legacy path: re-read teams/main.state in a transaction, apply only the
  // requested patch, write the merged state back. Concurrent bot edits to
  // other tasks are kept because we start from the latest snapshot.
  const runLegacyTx = async (op) => {
    if (mode !== "signedIn" || !fbRef.current) return { ok: false, error: { code: "disabled" } };
    setStatus("saving");
    try {
      const { fb, db, ref } = teamDocRef();
      await fb.runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const remote = snap.exists() ? snap.data() : null;
        const current = remote && remote.state ? remote.state : (remote || { areas: [], cities: [] });
        const result = window.TM.applyLegacyBlobMutation(current, op);
        if (!result.ok) throw result.error;
        writeTeamFromTx(tx, fb, ref, snap, result.state);
      });
      setStatus("synced");
      return { ok: true };
    } catch (err) {
      console.error("Firestore legacy blob write error:", err);
      setStatus("error");
      return { ok: false, error: err };
    }
  };

  // Per-task path: field-level team update. setDoc merge:true only if missing.
  const updateTeamState = cUseCallback(async (partial) => {
    if (mode !== "signedIn" || !fbRef.current) return { ok: false, error: { code: "disabled" } };
    if (readLegacy()) {
      return runLegacyTx({ kind: "team", areas: partial.areas, cities: partial.cities });
    }
    setStatus("saving");
    try {
      const { fb, db, ref } = teamDocRef();
      await fb.runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const meta = {
          updatedAt: fb.serverTimestamp(),
          updatedBy: userRef.current?.email || null,
        };
        if (!snap.exists()) {
          const state = {};
          if (partial.areas) state.areas = partial.areas;
          if (partial.cities) state.cities = partial.cities;
          tx.set(ref, { state, ...meta }, { merge: true });
        } else {
          const payload = { ...meta };
          if (partial.areas) payload["state.areas"] = partial.areas;
          if (partial.cities) payload["state.cities"] = partial.cities;
          tx.update(ref, payload);
        }
      });
      setStatus("synced");
      return { ok: true };
    } catch (err) {
      console.error("Firestore team update error:", err);
      setStatus("error");
      return { ok: false, error: err };
    }
  }, [mode]);

  const runTaskTx = async (taskId, op) => {
    if (mode !== "signedIn" || !fbRef.current) return { ok: false, error: { code: "disabled" } };
    if (readLegacy()) {
      return runLegacyTx({ kind: "task", type: op.type, task: op.task, taskId, fields: op.fields });
    }
    setStatus("saving");
    try {
      const { fb, db, ref } = taskDocRef(taskId);
      await fb.runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const existing = snap.exists() ? snap.data() : null;
        const result = window.TM.applyTaskMutation(existing, op);
        if (!result.ok) throw result.error;
        if (result.deleted) {
          tx.delete(ref);
        } else {
          tx.set(ref, Object.assign(window.TM.omitUndefined(result.doc), {
            updatedAt: fb.serverTimestamp(),
          }));
        }
      });
      setStatus("synced");
      return { ok: true };
    } catch (err) {
      console.error("Firestore task write error:", err);
      setStatus("error");
      return { ok: false, error: err };
    }
  };

  const createTask = cUseCallback((task) => runTaskTx(task.id, { type: "create", task }), [mode]);
  const updateTaskDoc = cUseCallback((taskId, fields, expectedVersion) =>
    runTaskTx(taskId, { type: "update", fields, expectedVersion }), [mode]);
  const moveTaskDoc = cUseCallback((taskId, targetProjectId) => {
    if (readLegacy()) {
      return runLegacyTx({ kind: "task", type: "move", taskId, targetProjectId });
    }
    const tree = window.TM.assembleData({
      teamState: teamStateRef.current,
      tasks: tasksRef.current,
      readLegacyBlob: false,
    });
    const plan = window.TM.moveTaskInState(tree, taskId, targetProjectId);
    if (!plan.ok || !plan.moved) return plan.ok ? { ok: true } : plan;
    return runTaskTx(taskId, {
      type: "update",
      fields: plan.fields,
      expectedVersion: plan.task.version,
    });
  }, [mode]);
  const deleteTaskDoc = cUseCallback((taskId, expectedVersion) =>
    runTaskTx(taskId, { type: "delete", expectedVersion }), [mode]);

  // Shim: previously this setDoc'd the entire state blob (merge: false).
  // That path is gone. Callers use createTask / updateTaskDoc / deleteTaskDoc /
  // updateTeamState, which pick the legacy or per-task path from the flag.
  const save = cUseCallback((_nextData) => {
    if (mode !== "signedIn") return;
    console.warn("useCloud().save() no longer writes the team blob; use per-document writes.");
  }, [mode]);

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

  return {
    mode, user, data, save, status, signIn, signOut,
    readLegacyBlob: readLegacy(),
    writesEnabled,
    createTask, updateTaskDoc, moveTaskDoc, deleteTaskDoc, updateTeamState,
  };
}

window.useCloud = useCloud;
