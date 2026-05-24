// firebase-config.js
// ─────────────────────────────────────────────────────────────────────────────
// PASTE YOUR FIREBASE CONFIG HERE.
// While these placeholders remain, the app runs in offline / local-only mode
// (data saved in this browser's localStorage). Once you replace them with real
// values from your Firebase project, the app switches to live cloud sync.
//
// See SETUP.md for the step-by-step (3 minutes).
// ─────────────────────────────────────────────────────────────────────────────

window.FIREBASE_CONFIG = {
  apiKey:            "AIzaSyC9yVP32SdMpGIPAFkR56GnauHrrnl1rHY",
  authDomain:        "task-manager-51cd0.firebaseapp.com",
  projectId:         "task-manager-51cd0",
  storageBucket:     "task-manager-51cd0.firebasestorage.app",
  messagingSenderId: "65028802293",
  appId:             "1:65028802293:web:9a130c686c17275cfa27bc",
};

// The Firestore document where the shared team data lives.
// Default: /teams/main — one shared doc, simple for small teams.
window.FIREBASE_TEAM_DOC = { collection: "teams", id: "main" };

// Helper for the rest of the app — true when real values are present.
window.isFirebaseConfigured = function () {
  const c = window.FIREBASE_CONFIG || {};
  return c.apiKey && !c.apiKey.startsWith("REPLACE")
      && c.projectId && !c.projectId.startsWith("REPLACE");
};
