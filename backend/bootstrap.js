import { createFirebaseLocalLoopApi } from "./firebase/FirebaseLocalLoopApi.js";
import { createFirebaseRuntime, firebaseConfigFromEnvironment } from "./firebase/runtime.js";

/**
 * Application entry point for an eventual web, React Native, or Expo adapter.
 * Pass explicit build-time environment values; no credentials are hard-coded.
 */
export function bootstrapLocalLoopBackend(options = {}) {
  const firebaseConfig = options.firebaseConfig || firebaseConfigFromEnvironment(options.environment);
  const runtime = createFirebaseRuntime({
    firebaseConfig,
    functionsRegion: options.functionsRegion,
    appName: options.appName,
    emulator: options.emulator,
  });
  return createFirebaseLocalLoopApi(runtime);
}
