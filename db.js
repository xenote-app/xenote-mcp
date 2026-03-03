var { initializeApp, deleteApp } = require("firebase/app");
var {
  getFirestore,
  connectFirestoreEmulator,
} = require("firebase/firestore");
var {
  getAuth,
  signInWithCustomToken,
  connectAuthEmulator,
} = require("firebase/auth");
var {
  getFunctions,
  connectFunctionsEmulator,
} = require("firebase/functions");
var { FIREBASE_CONFIG, IS_EMULATOR, EMULATOR_PORTS } = require("./config");

// Shared unauthenticated app — used only for the initial
// authenticateMCPTokenCall before we know the user.
var sharedApp = initializeApp(FIREBASE_CONFIG, "shared");
var sharedFunctions = getFunctions(sharedApp);

if (IS_EMULATOR) {
  connectFunctionsEmulator(
    sharedFunctions,
    "localhost",
    EMULATOR_PORTS.functions,
  );
}

/**
 * Create a per-session Firebase app, authenticated as the user.
 * Returns { db, functions, uid, cleanup }.
 */
async function createSessionApp(sessionId, customToken) {
  var app = initializeApp(FIREBASE_CONFIG, "session-" + sessionId);
  var auth = getAuth(app);
  var db = getFirestore(app);
  var functions = getFunctions(app);

  if (IS_EMULATOR) {
    connectAuthEmulator(auth, "http://localhost:" + EMULATOR_PORTS.auth);
    connectFirestoreEmulator(db, "localhost", EMULATOR_PORTS.firestore);
    connectFunctionsEmulator(
      functions,
      "localhost",
      EMULATOR_PORTS.functions,
    );
  }

  await signInWithCustomToken(auth, customToken);

  return {
    db: db,
    functions: functions,
    uid: auth.currentUser.uid,
    cleanup: function () {
      return deleteApp(app);
    },
  };
}

module.exports = { createSessionApp, sharedFunctions };
