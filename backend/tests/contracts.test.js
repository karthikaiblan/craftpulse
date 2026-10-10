import assert from "node:assert/strict";
import test from "node:test";
import {
  ORDER_ACTORS,
  ORDER_STATUSES,
  assertSubscriptionCallbacks,
  isLegalOrderTransition,
  validateCreateOrder,
  validateEmailPassword,
  validateProvider,
  validateSavedMakers,
  validateUserProfile,
} from "../contracts.js";
import { ERROR_CODES, LocalLoopError, normalizeError } from "../errors.js";

const hours = Array.from({ length: 7 }, () => ({ open: "09:00", close: "18:00" }));

test("contract validators return a small, safe payload", () => {
  assert.deepEqual(validateEmailPassword({
    name: "  Priya  ",
    email: " PRIYA@example.test ",
    password: "long-enough-password",
    phone: "+91 98765 43210",
    language: "en-IN",
  }, { requireName: true }), {
    name: "Priya",
    email: "priya@example.test",
    password: "long-enough-password",
    phone: "+91 98765 43210",
    language: "en-IN",
  });

  const provider = validateProvider({
    shopName: "Priya Repairs",
    categoryId: "footwear",
    phone: "+91 98765 43210",
    lat: 13.03,
    lng: 80.25,
    // Legacy callers may include this, but the facade deliberately does not
    // send it because the trusted backend derives the persisted geohash.
    geohash: "tf3c1",
    services: [{ name: "Sole repair", price: 250, avgTime: 90, unit: "minutes" }],
    workingHours: hours,
    workers: 2,
  });
  assert.equal(provider.geohash, undefined);
  assert.equal(provider.services[0].price, 250);
});

test("order-request validation permits optional detail fields but rejects extra input", () => {
  assert.deepEqual(validateCreateOrder({
    providerId: "maker",
    service: "Alteration",
    details: { materialsBy: "Customer" },
  }), {
    providerId: "maker",
    service: "Alteration",
    details: { materialsBy: "Customer" },
  });

  assert.throws(
    () => validateCreateOrder({ providerId: "maker", service: "Alteration", details: { materialsBy: "Customer", exploit: true } }),
    (error) => error instanceof LocalLoopError && error.code === ERROR_CODES.VALIDATION,
  );
});

test("the public transition matrix has no skipped, backwards, or terminal moves", () => {
  const legal = new Set([
    "Requested|Accepted|maker",
    "Requested|Quoted|maker",
    "Requested|Rejected|maker",
    "Requested|Cancelled|customer",
    "Quoted|Accepted|customer",
    "Quoted|Cancelled|customer",
    "Accepted|In progress|maker",
    "Accepted|Cancelled|customer",
    "In progress|Ready|maker",
    "Ready|Collected|maker",
  ]);
  const actors = [ORDER_ACTORS.CUSTOMER, ORDER_ACTORS.MAKER];
  for (const from of ORDER_STATUSES) {
    for (const to of ORDER_STATUSES) {
      for (const actor of actors) {
        assert.equal(isLegalOrderTransition(from, to, actor), legal.has(`${from}|${to}|${actor}`));
      }
    }
  }
});

test("profile, saved-maker, and subscription boundary checks are explicit", () => {
  assert.deepEqual(validateUserProfile({ phone: "" }), { phone: "" });
  assert.throws(() => validateUserProfile({}), /at least one/i);
  assert.throws(() => validateSavedMakers(Array.from({ length: 51 }, (_, index) => `maker-${index}`)), /0 to 50/i);
  assert.throws(() => assertSubscriptionCallbacks(() => {}, null), /onError/i);
});

test("normalizes Firebase and callable error codes to the API vocabulary", () => {
  assert.equal(normalizeError({ code: "functions/unauthenticated" }).code, ERROR_CODES.SIGNED_OUT);
  assert.equal(normalizeError({ code: "functions/permission-denied" }).code, ERROR_CODES.PERMISSION_DENIED);
  assert.equal(normalizeError({ code: "functions/failed-precondition", details: { appCode: "configuration" } }).code, ERROR_CODES.CONFIGURATION);
  assert.equal(normalizeError({ code: "auth/network-request-failed" }).code, ERROR_CODES.UNAVAILABLE);
});
