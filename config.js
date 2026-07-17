var PORT = process.env.PORT || 3459;
var IS_EMULATOR = !!process.env.XENOTE_EMU;

var FIREBASE_CONFIG = {
  apiKey: "AIzaSyBevvhXRHfpUxou_3A0TpPVw-611qbb3LE",
  authDomain: "xenote-app.firebaseapp.com",
  projectId: "xenote-app",
  storageBucket: "xenote-app.appspot.com",
  messagingSenderId: "929485212007",
  appId: "1:929485212007:web:f0a184c284180a07b4c7c2",
};

var EMULATOR_PORTS = {
  firestore: 5001,
  functions: 5002,
  auth: 5003,
  storage: 5004,
};

var XENOTE_AUTH_URL =
  process.env.XENOTE_AUTH_URL || "https://xenote.com/mcp-auth";

// Set this in deployed environments so OAuth metadata and callbacks never
// derive their public URL from an untrusted Host header.
var PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || null;

// Browser access is only needed from Xenote itself and local development.
// Deployments can add approved origins with a comma-separated environment var.
var CORS_ORIGINS = (process.env.CORS_ORIGINS ||
  "https://xenote.com,https://www.xenote.com,http://localhost:3000,http://localhost:3459")
  .split(",")
  .map(function (origin) { return origin.trim(); })
  .filter(Boolean);

module.exports = { PORT, IS_EMULATOR, FIREBASE_CONFIG, EMULATOR_PORTS, XENOTE_AUTH_URL, PUBLIC_BASE_URL, CORS_ORIGINS };
