/**
 * Firestore client-access tests.
 *
 * Run these against the Emulator Suite after installing development
 * dependencies and starting Firestore. In PowerShell:
 *   $env:RUN_FIRESTORE_RULES_TESTS = "true"
 *   $env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080"
 *   node --test backend/tests/firestore.rules.test.js
 *
 * The opt-in guard keeps the regular pure-test suite runnable on machines that
 * do not have the Emulator Suite (or Java 11+) available.
 */
import { readFileSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";

const runRulesTests = process.env.RUN_FIRESTORE_RULES_TESTS === "true";
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

let rulesUnitTesting;
let firestore;
let unavailableReason = "";

if (runRulesTests && emulatorHost) {
  try {
    [rulesUnitTesting, firestore] = await Promise.all([
      import("@firebase/rules-unit-testing"),
      import("firebase/firestore")
    ]);
  } catch (error) {
    unavailableReason =
      "Install @firebase/rules-unit-testing and firebase before running emulator rule tests: " +
      (error instanceof Error ? error.message : String(error));
  }
} else if (!runRulesTests) {
  unavailableReason =
    "Set RUN_FIRESTORE_RULES_TESTS=true after starting the Firebase Emulator Suite.";
} else {
  unavailableReason =
    "Set FIRESTORE_EMULATOR_HOST (for example 127.0.0.1:8080) for the Firebase Emulator Suite.";
}

if (!rulesUnitTesting || !firestore) {
  test("Firestore security rules emulator prerequisites", { skip: unavailableReason }, () => {});
} else {
  const { assertFails, assertSucceeds, initializeTestEnvironment } = rulesUnitTesting;
  const {
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    query,
    setDoc,
    updateDoc,
    where
  } = firestore;

  const rulesPath = fileURLToPath(new URL("../../firestore.rules", import.meta.url));
  const rules = readFileSync(rulesPath, "utf8");
  let testEnvironment;

  before(async () => {
    testEnvironment = await initializeTestEnvironment({
      projectId: "localloop-rules-test",
      firestore: { rules }
    });
  });

  beforeEach(async () => {
    await testEnvironment.clearFirestore();
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();

      await setDoc(doc(db, "users", "customer"), {
        name: "Customer",
        email: "customer@example.test"
      });
      await setDoc(doc(db, "users", "maker"), {
        name: "Maker",
        email: "maker@example.test"
      });
      await setDoc(doc(db, "providers", "maker"), {
        shopName: "Maker Shop",
        categoryId: "tailoring",
        geohash: "tdr1"
      });
      await setDoc(doc(db, "orders", "order-1"), {
        customerId: "customer",
        providerId: "maker",
        status: "Requested",
        createdAt: 1
      });
      await setDoc(doc(db, "reviews", "order-1"), {
        customerId: "customer",
        providerId: "maker",
        rating: 5,
        createdAt: 1
      });
      await setDoc(doc(db, "categories", "tailoring"), { name: "Tailoring" });
      await setDoc(doc(db, "private", "secret"), { value: true });
    });
  });

  after(async () => {
    await testEnvironment.cleanup();
  });

  test("unauthenticated Firestore reads are rejected", async () => {
    const db = testEnvironment.unauthenticatedContext().firestore();

    await assertFails(getDoc(doc(db, "users", "customer")));
    await assertFails(getDoc(doc(db, "providers", "maker")));
    await assertFails(getDoc(doc(db, "orders", "order-1")));
    await assertFails(getDoc(doc(db, "reviews", "order-1")));
    await assertFails(getDoc(doc(db, "categories", "tailoring")));
  });

  test("a user can read only their own private user document", async () => {
    const customerDb = testEnvironment.authenticatedContext("customer").firestore();

    await assertSucceeds(getDoc(doc(customerDb, "users", "customer")));
    await assertFails(getDoc(doc(customerDb, "users", "maker")));
  });

  test("signed-in users can read discoverable providers, reviews, and categories", async () => {
    const strangerDb = testEnvironment.authenticatedContext("stranger").firestore();

    await assertSucceeds(getDoc(doc(strangerDb, "providers", "maker")));
    await assertSucceeds(getDoc(doc(strangerDb, "reviews", "order-1")));
    await assertSucceeds(getDoc(doc(strangerDb, "categories", "tailoring")));
  });

  test("only an order customer or maker can read it, including collection queries", async () => {
    const customerDb = testEnvironment.authenticatedContext("customer").firestore();
    const makerDb = testEnvironment.authenticatedContext("maker").firestore();
    const strangerDb = testEnvironment.authenticatedContext("stranger").firestore();

    await assertSucceeds(getDoc(doc(customerDb, "orders", "order-1")));
    await assertSucceeds(getDoc(doc(makerDb, "orders", "order-1")));
    await assertFails(getDoc(doc(strangerDb, "orders", "order-1")));

    await assertSucceeds(
      getDocs(query(collection(customerDb, "orders"), where("customerId", "==", "customer")))
    );
    await assertSucceeds(
      getDocs(query(collection(makerDb, "orders"), where("providerId", "==", "maker")))
    );
    await assertFails(getDocs(collection(customerDb, "orders")));
    await assertFails(getDocs(query(collection(strangerDb, "orders"), where("customerId", "==", "customer"))));
  });

  test("all direct client writes are rejected", async () => {
    const customerDb = testEnvironment.authenticatedContext("customer").firestore();
    const writeAttempts = [
      () => setDoc(doc(customerDb, "users", "new-user"), { name: "No client writes" }),
      () => setDoc(doc(customerDb, "providers", "new-provider"), { shopName: "No client writes" }),
      () => setDoc(doc(customerDb, "orders", "new-order"), { customerId: "customer" }),
      () => setDoc(doc(customerDb, "reviews", "new-review"), { rating: 5 }),
      () => setDoc(doc(customerDb, "categories", "new-category"), { name: "No client writes" }),
      () => updateDoc(doc(customerDb, "users", "customer"), { name: "Changed" }),
      () => updateDoc(doc(customerDb, "providers", "maker"), { shopName: "Changed" }),
      () => updateDoc(doc(customerDb, "orders", "order-1"), { status: "Accepted" }),
      () => updateDoc(doc(customerDb, "reviews", "order-1"), { rating: 1 }),
      () => updateDoc(doc(customerDb, "categories", "tailoring"), { name: "Changed" }),
      () => deleteDoc(doc(customerDb, "users", "customer")),
      () => deleteDoc(doc(customerDb, "providers", "maker")),
      () => deleteDoc(doc(customerDb, "orders", "order-1")),
      () => deleteDoc(doc(customerDb, "reviews", "order-1")),
      () => deleteDoc(doc(customerDb, "categories", "tailoring"))
    ];

    for (const writeAttempt of writeAttempts) {
      await assertFails(writeAttempt());
    }
  });

  test("unknown collections are denied for both reads and writes", async () => {
    const customerDb = testEnvironment.authenticatedContext("customer").firestore();

    await assertFails(getDoc(doc(customerDb, "private", "secret")));
    await assertFails(setDoc(doc(customerDb, "unknown", "document"), { value: true }));
  });
}
