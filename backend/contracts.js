import { validationError } from "./errors.js";

/**
 * Public domain constants. They intentionally contain display values from the
 * product specification, so a UI never needs to translate internal codes.
 */
export const ORDER_STATUSES = Object.freeze([
  "Requested",
  "Quoted",
  "Accepted",
  "In progress",
  "Ready",
  "Collected",
  "Rejected",
  "Cancelled",
]);

export const ORDER_ACTORS = Object.freeze({
  CUSTOMER: "customer",
  MAKER: "maker",
});

export const ORDER_TRANSITIONS = Object.freeze({
  Requested: Object.freeze([
    Object.freeze({ to: "Accepted", actor: ORDER_ACTORS.MAKER }),
    Object.freeze({ to: "Quoted", actor: ORDER_ACTORS.MAKER }),
    Object.freeze({ to: "Rejected", actor: ORDER_ACTORS.MAKER }),
    Object.freeze({ to: "Cancelled", actor: ORDER_ACTORS.CUSTOMER }),
  ]),
  Quoted: Object.freeze([
    Object.freeze({ to: "Accepted", actor: ORDER_ACTORS.CUSTOMER }),
    Object.freeze({ to: "Cancelled", actor: ORDER_ACTORS.CUSTOMER }),
  ]),
  Accepted: Object.freeze([
    Object.freeze({ to: "In progress", actor: ORDER_ACTORS.MAKER }),
    Object.freeze({ to: "Cancelled", actor: ORDER_ACTORS.CUSTOMER }),
  ]),
  "In progress": Object.freeze([
    Object.freeze({ to: "Ready", actor: ORDER_ACTORS.MAKER }),
  ]),
  Ready: Object.freeze([
    Object.freeze({ to: "Collected", actor: ORDER_ACTORS.MAKER }),
  ]),
  Collected: Object.freeze([]),
  Rejected: Object.freeze([]),
  Cancelled: Object.freeze([]),
});

export const ACTIVE_QUEUE_STATUSES = Object.freeze([
  "Accepted",
  "In progress",
]);

export const SERVICE_TIME_UNITS = Object.freeze(["minutes", "hours", "days"]);
export const MATERIALS_BY_VALUES = Object.freeze(["Customer", "Maker"]);
export const MAX_SAVED_MAKERS = 50;
export const MAX_REVIEW_LENGTH = 1000;

const MAX_TEXT_LENGTH = 1000;
const MAX_SHORT_TEXT_LENGTH = 240;
const MAX_LIST_LENGTH = 100;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isLegalOrderTransition(from, to, actor) {
  return (ORDER_TRANSITIONS[from] || []).some(
    (transition) => transition.to === to && transition.actor === actor,
  );
}

export function validateEmailPassword(input, { requireName = false } = {}) {
  const value = object(input, "credentials");
  allowOnly(value, requireName ? ["email", "password", "name", "phone", "language"] : ["email", "password"]);

  const result = {
    email: email(value.email),
    // Passwords are not trimmed: changing the supplied character sequence would
    // make a successful sign-in impossible to reproduce.
    password: password(value.password),
  };

  if (requireName) {
    result.name = text(value.name, "name", { maxLength: MAX_SHORT_TEXT_LENGTH });
    if (value.phone !== undefined) result.phone = optionalPhone(value.phone);
    if (value.language !== undefined) result.language = language(value.language);
  }

  return result;
}

export function validateUserProfile(input) {
  const value = object(input, "profile");
  allowOnly(value, ["name", "phone", "language"]);

  const result = {};
  if (value.name !== undefined) result.name = text(value.name, "name", { maxLength: MAX_SHORT_TEXT_LENGTH });
  if (value.phone !== undefined) result.phone = optionalPhone(value.phone);
  if (value.language !== undefined) result.language = language(value.language);
  if (Object.keys(result).length === 0) {
    throw invalid("Provide at least one profile field to update.");
  }
  return result;
}

export function validateSavedMakers(input) {
  const value = Array.isArray(input) ? { savedMakers: input } : object(input, "saved makers");
  allowOnly(value, ["savedMakers"]);
  const savedMakers = array(value.savedMakers, "savedMakers", { maxLength: MAX_SAVED_MAKERS })
    .map((providerId) => id(providerId, "savedMakers entry"));

  if (new Set(savedMakers).size !== savedMakers.length) {
    throw invalid("savedMakers must not contain duplicates.", { field: "savedMakers" });
  }

  return { savedMakers };
}

export function validateProvider(input, { partial = false } = {}) {
  const value = object(input, partial ? "provider update" : "provider onboarding");
  const allowed = [
    "shopName",
    "categoryId",
    "phone",
    "lat",
    "lng",
    "geohash",
    "services",
    "workingHours",
    "workers",
    "isPaused",
    "relocate",
  ];
  allowOnly(value, allowed);

  if (!partial) {
    requireKeys(value, [
      "shopName",
      "categoryId",
      "phone",
      "lat",
      "lng",
      "services",
      "workingHours",
      "workers",
    ]);
  } else if (Object.keys(value).length === 0) {
    throw invalid("Provide at least one provider field to update.");
  }

  const result = {};
  if (value.shopName !== undefined) result.shopName = text(value.shopName, "shopName", { maxLength: MAX_SHORT_TEXT_LENGTH });
  if (value.categoryId !== undefined) result.categoryId = id(value.categoryId, "categoryId");
  if (value.phone !== undefined) result.phone = phone(value.phone, "phone");
  if (value.lat !== undefined) result.lat = latitude(value.lat);
  if (value.lng !== undefined) result.lng = longitude(value.lng);
  if (value.services !== undefined) result.services = services(value.services);
  if (value.workingHours !== undefined) result.workingHours = workingHours(value.workingHours);
  if (value.workers !== undefined) result.workers = positiveInteger(value.workers, "workers");
  if (value.isPaused !== undefined) result.isPaused = boolean(value.isPaused, "isPaused");
  const relocating = value.relocate === undefined ? false : boolean(value.relocate, "relocate");

  const locationFields = ["lat", "lng"];
  const suppliedLocationFields = locationFields.filter((field) => value[field] !== undefined);
  if (suppliedLocationFields.length > 0 && suppliedLocationFields.length !== locationFields.length) {
    throw invalid("lat and lng must be updated together.", { field: "location" });
  }
  if (relocating) {
    if (suppliedLocationFields.length !== locationFields.length) {
      throw invalid("relocate requires a new lat and lng.", { field: "relocate" });
    }
    result.relocate = true;
  }
  if (partial && Object.keys(result).length === 0) {
    throw invalid("Provide at least one provider field to update.");
  }

  return result;
}

export function validateCreateOrder(input) {
  const value = object(input, "order request");
  allowOnly(value, ["providerId", "service", "details"]);

  return {
    providerId: id(value.providerId, "providerId"),
    service: text(value.service, "service", { maxLength: MAX_SHORT_TEXT_LENGTH }),
    details: orderDetails(value.details),
  };
}

export function validateOrderIdInput(input) {
  const value = typeof input === "string" ? { orderId: input } : object(input, "order command");
  allowOnly(value, ["orderId"]);
  return { orderId: id(value.orderId, "orderId") };
}

export function validateQuote(input) {
  const value = object(input, "quote");
  allowOnly(value, ["orderId", "quotePrice", "quoteTime"]);

  return {
    orderId: id(value.orderId, "orderId"),
    quotePrice: positiveNumber(value.quotePrice, "quotePrice"),
    quoteTime: duration(value.quoteTime, "quoteTime"),
  };
}

export function validateReject(input) {
  const value = object(input, "rejection");
  allowOnly(value, ["orderId", "rejectReason"]);

  return {
    orderId: id(value.orderId, "orderId"),
    rejectReason: text(value.rejectReason, "rejectReason", { maxLength: MAX_SHORT_TEXT_LENGTH }),
  };
}

export function validateReview(input) {
  const value = object(input, "review");
  allowOnly(value, ["orderId", "rating", "text"]);
  const result = {
    orderId: id(value.orderId, "orderId"),
    rating: integerInRange(value.rating, "rating", 1, 5),
  };
  if (value.text !== undefined) result.text = optionalText(value.text, "text", { maxLength: MAX_REVIEW_LENGTH });
  return result;
}

export function validateDiscoveryOptions(input = {}) {
  const value = object(input, "discovery options");
  allowOnly(value, ["categoryId", "limit"]);
  const result = {};
  if (value.categoryId !== undefined) result.categoryId = id(value.categoryId, "categoryId");
  if (value.limit !== undefined) result.limit = integerInRange(value.limit, "limit", 1, MAX_LIST_LENGTH);
  return result;
}

export function validateProviderId(input) {
  return id(input, "providerId");
}

export function assertSubscriptionCallbacks(onData, onError) {
  if (typeof onData !== "function") {
    throw invalid("A subscription requires an onData callback.", { field: "onData" });
  }
  if (typeof onError !== "function") {
    throw invalid("A subscription requires an onError callback.", { field: "onError" });
  }
}

function orderDetails(input) {
  const value = object(input, "order details");
  allowOnly(value, ["materialsBy", "notes", "size", "dateNeeded"]);

  const materialsBy = text(value.materialsBy, "details.materialsBy", { maxLength: 32 });
  if (!MATERIALS_BY_VALUES.includes(materialsBy)) {
    throw invalid("details.materialsBy must be Customer or Maker.", { field: "details.materialsBy" });
  }

  const result = { materialsBy };
  if (value.notes !== undefined) result.notes = optionalText(value.notes, "details.notes", { maxLength: 2_000 });
  if (value.size !== undefined) result.size = optionalText(value.size, "details.size", { maxLength: MAX_SHORT_TEXT_LENGTH });
  if (value.dateNeeded !== undefined) result.dateNeeded = date(value.dateNeeded, "details.dateNeeded");
  return result;
}

function services(input) {
  return array(input, "services", { minLength: 1, maxLength: MAX_LIST_LENGTH }).map((service, index) => {
    const value = object(service, `services[${index}]`);
    allowOnly(value, ["name", "price", "avgTime", "unit"]);
    const result = {
      name: text(value.name, `services[${index}].name`, { maxLength: MAX_SHORT_TEXT_LENGTH }),
      avgTime: positiveNumber(value.avgTime, `services[${index}].avgTime`),
      unit: serviceTimeUnit(value.unit, `services[${index}].unit`),
    };
    if (value.price === null) {
      result.price = null;
    } else {
      result.price = positiveNumber(value.price, `services[${index}].price`);
    }
    return result;
  });
}

function workingHours(input) {
  const hours = array(input, "workingHours", { minLength: 7, maxLength: 7 });
  return hours.map((entry, index) => {
    if (entry === null) return null;
    const value = object(entry, `workingHours[${index}]`);
    allowOnly(value, ["open", "close"]);
    const open = time(value.open, `workingHours[${index}].open`);
    const close = time(value.close, `workingHours[${index}].close`);
    if (minutesSinceMidnight(open) >= minutesSinceMidnight(close)) {
      throw invalid("Each working-hours close time must be after its open time.", {
        field: `workingHours[${index}]`,
      });
    }
    return { open, close };
  });
}

function duration(input, field) {
  const value = object(input, field);
  allowOnly(value, ["value", "unit"]);
  return {
    value: positiveNumber(value.value, `${field}.value`),
    unit: serviceTimeUnit(value.unit, `${field}.unit`),
  };
}

function object(value, name) {
  if (!isPlainObject(value)) {
    throw invalid(`${name} must be an object.`, { field: name });
  }
  return value;
}

function array(value, name, { minLength = 0, maxLength = Infinity } = {}) {
  if (!Array.isArray(value) || value.length < minLength || value.length > maxLength) {
    const range = minLength === maxLength ? `exactly ${minLength}` : `${minLength} to ${maxLength}`;
    throw invalid(`${name} must contain ${range} entries.`, { field: name });
  }
  return value;
}

function text(value, field, { maxLength = MAX_TEXT_LENGTH } = {}) {
  if (typeof value !== "string") {
    throw invalid(`${field} must be text.`, { field });
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw invalid(`${field} must be between 1 and ${maxLength} characters.`, { field });
  }
  return normalized;
}

function optionalText(value, field, { maxLength = MAX_TEXT_LENGTH } = {}) {
  if (typeof value !== "string") {
    throw invalid(`${field} must be text.`, { field });
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw invalid(`${field} must be at most ${maxLength} characters.`, { field });
  }
  return normalized;
}

function id(value, field) {
  return text(value, field, { maxLength: 256 });
}

function email(value) {
  const normalized = text(value, "email", { maxLength: 320 }).toLowerCase();
  // Firebase performs authoritative email parsing. This catches obvious UI
  // mistakes while avoiding a deliberately over-strict client-side grammar.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw invalid("email must be a valid email address.", { field: "email" });
  }
  return normalized;
}

function password(value) {
  if (typeof value !== "string" || value.length < 6 || value.length > 4096) {
    throw invalid("password must be between 6 and 4096 characters.", { field: "password" });
  }
  return value;
}

function phone(value, field) {
  const normalized = text(value, field, { maxLength: 64 });
  if (!/^[+()\d\s.-]+$/.test(normalized)) {
    throw invalid(`${field} contains unsupported characters.`, { field });
  }
  return normalized;
}

function optionalPhone(value) {
  if (value === null || value === "") return "";
  return phone(value, "phone");
}

function language(value) {
  const normalized = text(value, "language", { maxLength: 35 });
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(normalized)) {
    throw invalid("language must be a BCP 47-style language tag.", { field: "language" });
  }
  return normalized;
}

function latitude(value) {
  return numberInRange(value, "lat", -90, 90);
}

function longitude(value) {
  return numberInRange(value, "lng", -180, 180);
}

function geohash(value) {
  const normalized = text(value, "geohash", { maxLength: 22 }).toLowerCase();
  if (!/^[0123456789bcdefghjkmnpqrstuvwxyz]+$/.test(normalized)) {
    throw invalid("geohash is invalid.", { field: "geohash" });
  }
  return normalized;
}

function time(value, field) {
  const normalized = text(value, field, { maxLength: 5 });
  if (!TIME_PATTERN.test(normalized)) {
    throw invalid(`${field} must use HH:MM (24-hour) time.`, { field });
  }
  return normalized;
}

function date(value, field) {
  const normalized = text(value, field, { maxLength: 10 });
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (!DATE_PATTERN.test(normalized) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw invalid(`${field} must use YYYY-MM-DD date format.`, { field });
  }
  return normalized;
}

function serviceTimeUnit(value, field) {
  const normalized = text(value, field, { maxLength: 16 });
  if (!SERVICE_TIME_UNITS.includes(normalized)) {
    throw invalid(`${field} must be minutes, hours, or days.`, { field });
  }
  return normalized;
}

function positiveNumber(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw invalid(`${field} must be a positive number.`, { field });
  }
  return value;
}

function nonNegativeNumber(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw invalid(`${field} must be a non-negative number.`, { field });
  }
  return value;
}

function positiveInteger(value, field) {
  if (!Number.isInteger(value) || value < 1) {
    throw invalid(`${field} must be a positive integer.`, { field });
  }
  return value;
}

function integerInRange(value, field, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw invalid(`${field} must be an integer from ${min} to ${max}.`, { field });
  }
  return value;
}

function numberInRange(value, field, min, max) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw invalid(`${field} must be between ${min} and ${max}.`, { field });
  }
  return value;
}

function boolean(value, field) {
  if (typeof value !== "boolean") {
    throw invalid(`${field} must be true or false.`, { field });
  }
  return value;
}

function requireKeys(value, keys) {
  for (const key of keys) {
    if (value[key] === undefined) {
      throw invalid(`${key} is required.`, { field: key });
    }
  }
}

function allowOnly(value, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw invalid(`${key} is not supported by this operation.`, { field: key });
    }
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function minutesSinceMidnight(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function invalid(message, details) {
  return validationError(message, details);
}
