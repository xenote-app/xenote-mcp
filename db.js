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

  var sid = sessionId;

  // Debug: log initial token info
  var idTokenResult = await auth.currentUser.getIdTokenResult();
  console.log("[session-" + sid + "] initial sign-in, token expires:", idTokenResult.expirationTime);
  console.log("[session-" + sid + "] auth provider:", idTokenResult.signInProvider);

  // Debug: watch for auth state changes
  auth.onAuthStateChanged(function (user) {
    if (user) {
      console.log("[session-" + sid + "] onAuthStateChanged: signed in as", user.uid);
    } else {
      console.log("[session-" + sid + "] onAuthStateChanged: signed OUT");
    }
  });

  // Debug: watch for ID token changes (auto-refresh)
  auth.onIdTokenChanged(function (user) {
    if (user) {
      user.getIdTokenResult().then(function (result) {
        console.log("[session-" + sid + "] onIdTokenChanged: new token expires:", result.expirationTime);
      });
    } else {
      console.log("[session-" + sid + "] onIdTokenChanged: no user");
    }
  });

  return {
    db: db,
    functions: functions,
    uid: auth.currentUser.uid,
    getTokenDebug: async function () {
      var user = auth.currentUser;
      if (!user) return { status: "no user" };
      var result = await user.getIdTokenResult();
      var expiresAt = new Date(result.expirationTime).getTime();
      var now = Date.now();
      return {
        uid: user.uid,
        expires: result.expirationTime,
        expiresInMin: Math.round((expiresAt - now) / 60000),
        isExpired: now > expiresAt,
      };
    },
    refresh: function (newCustomToken) {
      console.log("[session-" + sid + "] refresh: signing in with new custom token");
      return signInWithCustomToken(auth, newCustomToken);
    },
    cleanup: function () {
      return deleteApp(app);
    },
  };
}

module.exports = { createSessionApp, sharedFunctions };
