import { getApp, getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
import { configurationError } from "../errors.js";

const REQUIRED_CONFIG_KEYS = Object.freeze([
  "apiKey",
  "authDomain",
  "projectId",
  "appId",
]);
const emulatorConnected = new WeakSet();

/**
 * Creates the Firebase SDK runtime used by the transport adapter. It contains
 * no UI state and never falls back to browser storage or demo data.
 */
export function createFirebaseRuntime(options = {}) {
  const {
    firebaseConfig,
    functionsRegion = "asia-south1",
    appName,
    emulator,
  } = options;
  assertFirebaseConfig(firebaseConfig);

  const name = appName || "[DEFAULT]";
  const app = getApps().some((existing) => existing.name === name)
    ? getApp(name)
    : initializeApp(firebaseConfig, appName);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const functions = getFunctions(app, functionsRegion);

  if (emulator?.enabled) connectEmulators({ auth, db, functions, emulator });
  return Object.freeze({ app, auth, db, functions, functionsRegion });
}

/** Converts supplied runtime env values into Firebase’s browser config shape. */
export function firebaseConfigFromEnvironment(environment) {
  const source = environment || {};
  const config = {
    apiKey: source.FIREBASE_API_KEY,
    authDomain: source.FIREBASE_AUTH_DOMAIN,
    projectId: source.FIREBASE_PROJECT_ID,
    storageBucket: source.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: source.FIREBASE_MESSAGING_SENDER_ID,
    appId: source.FIREBASE_APP_ID,
    measurementId: source.FIREBASE_MEASUREMENT_ID,
  };
  assertFirebaseConfig(config);
  return config;
}

function assertFirebaseConfig(config) {
  if (!config || typeof config !== "object") {
    throw configurationError("Firebase configuration is required.");
  }
  const missing = REQUIRED_CONFIG_KEYS.filter((key) => typeof config[key] !== "string" || !config[key].trim());
  if (missing.length) {
    throw configurationError(`Firebase configuration is missing: ${missing.join(", ")}.`, { missing });
  }
}

function connectEmulators({ auth, db, functions, emulator }) {
  const host = typeof emulator.host === "string" && emulator.host ? emulator.host : "127.0.0.1";
  const authPort = port(emulator.authPort, "authPort", 9099);
  const firestorePort = port(emulator.firestorePort, "firestorePort", 8080);
  const functionsPort = port(emulator.functionsPort, "functionsPort", 5001);

  // A runtime is created once during application startup. Calling the Firebase
  // emulator connectors more than once causes SDK warnings, so mark it.
  if (!emulatorConnected.has(auth)) {
    connectAuthEmulator(auth, `http://${host}:${authPort}`, { disableWarnings: true });
    emulatorConnected.add(auth);
  }
  if (!emulatorConnected.has(db)) {
    connectFirestoreEmulator(db, host, firestorePort);
    emulatorConnected.add(db);
  }
  if (!emulatorConnected.has(functions)) {
    connectFunctionsEmulator(functions, host, functionsPort);
    emulatorConnected.add(functions);
  }
}

function port(value, name, fallback) {
  const resolved = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > 65535) {
    throw configurationError(`${name} must be a valid TCP port.`);
  }
  return resolved;
}
