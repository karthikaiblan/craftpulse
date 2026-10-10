import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
} from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  assertSubscriptionCallbacks,
  validateCreateOrder,
  validateDiscoveryOptions,
  validateEmailPassword,
  validateOrderIdInput,
  validateProvider,
  validateProviderId,
  validateQuote,
  validateReject,
  validateReview,
  validateSavedMakers,
  validateUserProfile,
} from "../contracts.js";
import { ERROR_CODES, LocalLoopError, normalizeError } from "../errors.js";
import {
  mapCallableData,
  mapDocument,
  mapDocuments,
  mapOrder,
  mapProvider,
  mapReview,
  mapSession,
  mapUser,
} from "./mappers.js";

/**
 * The sole browser/mobile-facing LocalLoop data API. UI code only receives
 * serializable domain objects and unsubscribe functions from this boundary.
 */
export function createFirebaseLocalLoopApi(runtime) {
  const { auth, db, functions } = assertRuntime(runtime);
  const invoke = (name, data) => httpsCallable(functions, name)(data);

  async function call(name, data) {
    try {
      return mapCallableData(await invoke(name, data));
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async function requireCurrentUid() {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new LocalLoopError(ERROR_CODES.SIGNED_OUT);
    return uid;
  }

  function documentSubscription(reference, mapper, onData, onError) {
    assertSubscriptionCallbacks(onData, onError);
    try {
      return onSnapshot(
        reference,
        (snapshot) => onData(mapDocument(snapshot, mapper)),
        (error) => onError(normalizeError(error)),
      );
    } catch (error) {
      onError(normalizeError(error));
      return () => {};
    }
  }

  function listSubscription(reference, mapper, onData, onError) {
    assertSubscriptionCallbacks(onData, onError);
    try {
      return onSnapshot(
        reference,
        (snapshot) => onData(mapDocuments(snapshot, mapper)),
        (error) => onError(normalizeError(error)),
      );
    } catch (error) {
      onError(normalizeError(error));
      return () => {};
    }
  }

  return Object.freeze({
    auth: Object.freeze({
      observeSession(onData, onError) {
        assertSubscriptionCallbacks(onData, onError);
        try {
          return onAuthStateChanged(
            auth,
            (user) => onData(mapSession(user)),
            (error) => onError(normalizeError(error)),
          );
        } catch (error) {
          onError(normalizeError(error));
          return () => {};
        }
      },

      async signUpEmail(input) {
        const credentials = validateEmailPassword(input, { requireName: true });
        try {
          const result = await createUserWithEmailAndPassword(auth, credentials.email, credentials.password);
          const initialized = await call("initializeUser", {
            name: credentials.name,
            ...(credentials.phone === undefined ? {} : { phone: credentials.phone }),
            ...(credentials.language === undefined ? {} : { language: credentials.language }),
          });
          return { session: mapSession(result.user), user: mapUser(initialized.user, initialized.user?.id) };
        } catch (error) {
          throw normalizeError(error);
        }
      },

      async signInEmail(input) {
        const credentials = validateEmailPassword(input);
        try {
          const result = await signInWithEmailAndPassword(auth, credentials.email, credentials.password);
          const initialized = await call("initializeUser", {});
          return { session: mapSession(result.user), user: mapUser(initialized.user, initialized.user?.id) };
        } catch (error) {
          throw normalizeError(error);
        }
      },

      async signInGoogle(input = {}) {
        try {
          // Browser hosts can use Firebase's popup. Native hosts obtain an ID
          // token with their platform provider, then pass it here instead.
          const result = typeof input?.idToken === "string" && input.idToken
            ? await signInWithCredential(
              auth,
              GoogleAuthProvider.credential(input.idToken, typeof input.accessToken === "string" ? input.accessToken : undefined),
            )
            : await signInWithPopup(auth, new GoogleAuthProvider());
          const initialized = await call("initializeUser", {});
          return { session: mapSession(result.user), user: mapUser(initialized.user, initialized.user?.id) };
        } catch (error) {
          throw normalizeError(error);
        }
      },

      async signOut() {
        try {
          await firebaseSignOut(auth);
        } catch (error) {
          throw normalizeError(error);
        }
      },
    }),

    users: Object.freeze({
      async getMine() {
        const uid = await requireCurrentUid();
        try {
          const snapshot = await getDoc(doc(db, "users", uid));
          const user = mapDocument(snapshot, mapUser);
          if (!user) throw new LocalLoopError(ERROR_CODES.NOT_FOUND, "Your LocalLoop profile was not found.");
          return user;
        } catch (error) {
          throw normalizeError(error);
        }
      },

      async updateMine(input) {
        const profile = validateUserProfile(input);
        const result = await call("updateMine", profile);
        return mapUser(result.user, result.user?.id);
      },

      async updateSavedMakers(input) {
        const value = validateSavedMakers(input);
        const result = await call("updateSavedMakers", value);
        return mapUser(result.user, result.user?.id);
      },
    }),

    providers: Object.freeze({
      async completeOnboarding(input) {
        const provider = validateProvider(input);
        const result = await call("completeOnboarding", provider);
        return mapProvider(result.provider, result.provider?.id);
      },

      async get(providerId) {
        const id = validateProviderId(providerId);
        await requireCurrentUid();
        try {
          const snapshot = await getDoc(doc(db, "providers", id));
          const provider = mapDocument(snapshot, mapProvider);
          if (!provider) throw new LocalLoopError(ERROR_CODES.NOT_FOUND, "That provider was not found.");
          return provider;
        } catch (error) {
          throw normalizeError(error);
        }
      },

      subscribe(providerId, onData, onError) {
        const id = validateProviderId(providerId);
        return documentSubscription(doc(db, "providers", id), mapProvider, onData, onError);
      },

      async update(input) {
        const provider = validateProvider(input, { partial: true });
        const result = await call("updateProvider", provider);
        return mapProvider(result.provider, result.provider?.id);
      },
    }),

    discovery: Object.freeze({
      async list(input = {}) {
        const options = validateDiscoveryOptions(input);
        await requireCurrentUid();
        try {
          return mapDocuments(await getDocs(discoveryQuery(db, options)), mapProvider);
        } catch (error) {
          throw normalizeError(error);
        }
      },

      subscribe(input = {}, onData, onError) {
        const options = validateDiscoveryOptions(input);
        return listSubscription(discoveryQuery(db, options), mapProvider, onData, onError);
      },
    }),

    orders: Object.freeze({
      async create(input) {
        const order = validateCreateOrder(input);
        const result = await call("createOrder", order);
        return mapOrder(result.order, result.order?.id);
      },

      subscribeOne(orderId, onData, onError) {
        const id = validateOrderIdInput(orderId).orderId;
        return documentSubscription(doc(db, "orders", id), mapOrder, onData, onError);
      },

      subscribeCustomerOrders(onData, onError) {
        assertSubscriptionCallbacks(onData, onError);
        const uid = auth.currentUser?.uid;
        if (!uid) return emitSignedOut(onError);
        return listSubscription(
          query(collection(db, "orders"), where("customerId", "==", uid), orderBy("createdAt", "desc")),
          mapOrder,
          onData,
          onError,
        );
      },

      subscribeMakerOrders(onData, onError) {
        assertSubscriptionCallbacks(onData, onError);
        const uid = auth.currentUser?.uid;
        if (!uid) return emitSignedOut(onError);
        return listSubscription(
          query(collection(db, "orders"), where("providerId", "==", uid), orderBy("createdAt", "desc")),
          mapOrder,
          onData,
          onError,
        );
      },

      async acceptFixedPrice(orderId) { return callOrder("acceptFixedPrice", orderId, call); },
      async sendQuote(input) { return callOrder("sendQuote", validateQuote(input), call); },
      async confirmQuote(orderId) { return callOrder("confirmQuote", orderId, call); },
      async cancel(orderId) { return callOrder("cancelOrder", orderId, call); },
      async reject(input) { return callOrder("rejectOrder", validateReject(input), call); },
      async start(orderId) { return callOrder("startOrder", orderId, call); },
      async markReady(orderId) { return callOrder("markReady", orderId, call); },
      async markCollected(orderId) { return callOrder("markCollected", orderId, call); },
    }),

    reviews: Object.freeze({
      async create(input) {
        const review = validateReview(input);
        const result = await call("createReview", review);
        return mapReview(result.review, result.review?.id);
      },

      subscribeForProvider(providerId, onData, onError) {
        const id = validateProviderId(providerId);
        return listSubscription(
          query(collection(db, "reviews"), where("providerId", "==", id), orderBy("createdAt", "desc")),
          mapReview,
          onData,
          onError,
        );
      },
    }),
  });
}

function assertRuntime(runtime) {
  if (!runtime?.auth || !runtime?.db || !runtime?.functions) {
    throw new LocalLoopError(ERROR_CODES.CONFIGURATION, "A Firebase runtime is required.");
  }
  return runtime;
}

function discoveryQuery(db, options) {
  const clauses = [collection(db, "providers")];
  if (options.categoryId) clauses.push(where("categoryId", "==", options.categoryId));
  clauses.push(orderBy("geohash", "asc"));
  if (options.limit) clauses.push(limit(options.limit));
  return query(...clauses);
}

async function callOrder(name, input, call) {
  const payload = typeof input === "string" ? validateOrderIdInput(input) : input;
  const result = await call(name, payload);
  return mapOrder(result.order, result.order?.id);
}

function emitSignedOut(onError) {
  if (typeof onError === "function") onError(new LocalLoopError(ERROR_CODES.SIGNED_OUT));
  else throw new LocalLoopError(ERROR_CODES.SIGNED_OUT);
  return () => {};
}
