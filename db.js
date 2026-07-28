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
var {
  getStorage,
  connectStorageEmulator,
} = require("firebase/storage");
var { FIREBASE_CONFIG, IS_EMULATOR, EMULATOR_PORTS } = require("./config");

// Shared unauthenticated app — used before we know the user: the initial
// authenticateMCPTokenCall, and the OAuth client registry, which is public
// by design (a client_id is an identifier, not a credential).
var sharedApp = initializeApp(FIREBASE_CONFIG, "shared");
var sharedFunctions = getFunctions(sharedApp);
var sharedDb = getFirestore(sharedApp);

if (IS_EMULATOR) {
  connectFunctionsEmulator(
    sharedFunctions,
    "localhost",
    EMULATOR_PORTS.functions,
  );
  connectFirestoreEmulator(sharedDb, "localhost", EMULATOR_PORTS.firestore);
}

/**
 * Create a per-session Firebase app, authenticated as the user.
 * Returns { db, functions, uid, refresh, cleanup }.
 */
async function createSessionApp(sessionId, customToken) {
  var app = initializeApp(FIREBASE_CONFIG, "session-" + sessionId);
  var auth = getAuth(app);
  var db = getFirestore(app);
  var functions = getFunctions(app);
  var storage = getStorage(app);

  if (IS_EMULATOR) {
    connectAuthEmulator(auth, "http://localhost:" + EMULATOR_PORTS.auth);
    connectFirestoreEmulator(db, "localhost", EMULATOR_PORTS.firestore);
    connectFunctionsEmulator(
      functions,
      "localhost",
      EMULATOR_PORTS.functions,
    );
    connectStorageEmulator(storage, "localhost", EMULATOR_PORTS.storage);
  }

  await signInWithCustomToken(auth, customToken);

  return {
    db: db,
    functions: functions,
    storage: storage,
    uid: auth.currentUser.uid,
    refresh: function (newCustomToken) {
      return signInWithCustomToken(auth, newCustomToken);
    },
    cleanup: function () {
      return deleteApp(app);
    },
  };
}

module.exports = { createSessionApp, sharedFunctions, sharedDb };
