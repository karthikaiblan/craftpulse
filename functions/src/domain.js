'use strict';

/**
 * Pure LocalLoop domain logic.
 *
 * This module deliberately has no Firebase imports.  It is shared by callable
 * handlers and can be tested with ordinary Node.js tests.  All timestamps can
 * be Dates, ISO strings, or Firestore Timestamp-like values with `toDate()`.
 */

const MINUTE = 60 * 1000;
const SEARCH_DAYS = 15;
const MAX_SAVED_MAKERS = 50;
const MAX_SERVICE_MINUTES = 365 * 24 * 60;
const SERVICE_UNITS = Object.freeze(['minutes', 'hours', 'days']);
const STATUSES = Object.freeze([
  'Requested',
  'Quoted',
  'Accepted',
  'In progress',
  'Ready',
  'Collected',
  'Rejected',
  'Cancelled',
]);
const ACTIVE_STATUSES = new Set(['Accepted', 'In progress']);
const APP_ERROR_CODES = new Set([
  'configuration',
  'signed-out',
  'permission-denied',
  'validation',
  'not-found',
  'conflict',
  'unavailable',
  'unknown',
]);

class DomainError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'DomainError';
    this.code = APP_ERROR_CODES.has(code) ? code : 'unknown';
    this.details = details;
  }
}

function domainError(code, message, details) {
  return new DomainError(code, message, details);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) {
    throw domainError('validation', `${label} must be an object.`);
  }
  return value;
}

function assertAllowedKeys(value, allowedKeys, label) {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw domainError('validation', `${label} contains an unsupported field: ${key}.`);
    }
  }
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function requiredString(value, label, options = {}) {
  const {
    min = 1,
    max = 500,
    pattern,
    trim = true,
  } = options;

  if (typeof value !== 'string') {
    throw domainError('validation', `${label} must be a string.`);
  }
  const normalized = trim ? value.trim() : value;
  if (normalized.length < min || normalized.length > max) {
    throw domainError('validation', `${label} must be between ${min} and ${max} characters.`);
  }
  if (pattern && !pattern.test(normalized)) {
    throw domainError('validation', `${label} has an invalid format.`);
  }
  return normalized;
}

function optionalString(value, label, options = {}) {
  if (value === undefined || value === null) {
    return undefined;
  }
  return requiredString(value, label, options);
}

function finiteNumber(value, label, options = {}) {
  const { min = -Infinity, max = Infinity, integer = false } = options;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw domainError('validation', `${label} must be a finite number.`);
  }
  if ((integer && !Number.isInteger(value)) || value < min || value > max) {
    throw domainError('validation', `${label} is outside the permitted range.`);
  }
  return value;
}

function requiredBoolean(value, label) {
  if (typeof value !== 'boolean') {
    throw domainError('validation', `${label} must be true or false.`);
  }
  return value;
}

function validateTime(value, label) {
  const time = requiredString(value, label, { min: 5, max: 5, pattern: /^(?:[01]\d|2[0-3]):[0-5]\d$/ });
  const [hours, minutes] = time.split(':').map(Number);
  return { time, minutes: (hours * 60) + minutes };
}

function validateWorkingHours(hours) {
  if (!Array.isArray(hours) || hours.length !== 7) {
    throw domainError('validation', 'workingHours must contain exactly seven Sunday-first entries.');
  }

  return hours.map((entry, index) => {
    if (entry === null) {
      return null;
    }
    assertPlainObject(entry, `workingHours[${index}]`);
    assertAllowedKeys(entry, ['open', 'close'], `workingHours[${index}]`);
    const open = validateTime(entry.open, `workingHours[${index}].open`);
    const close = validateTime(entry.close, `workingHours[${index}].close`);
    if (close.minutes <= open.minutes) {
      throw domainError('validation', `workingHours[${index}] must close after it opens.`);
    }
    return { open: open.time, close: close.time };
  });
}

function validateCustomFields(value, label) {
  if (value === undefined) {
    return undefined;
  }
  assertPlainObject(value, label);
  const entries = Object.entries(value);
  if (entries.length > 20) {
    throw domainError('validation', `${label} can contain at most 20 fields.`);
  }

  const result = {};
  for (const [key, fieldValue] of entries) {
    const fieldName = requiredString(key, `${label} key`, { max: 64 });
    if (
      fieldValue !== null
      && typeof fieldValue !== 'string'
      && typeof fieldValue !== 'number'
      && typeof fieldValue !== 'boolean'
    ) {
      throw domainError('validation', `${label}.${fieldName} must be a string, number, boolean, or null.`);
    }
    if (typeof fieldValue === 'string' && fieldValue.length > 500) {
      throw domainError('validation', `${label}.${fieldName} is too long.`);
    }
    if (typeof fieldValue === 'number' && !Number.isFinite(fieldValue)) {
      throw domainError('validation', `${label}.${fieldName} must be finite.`);
    }
    result[fieldName] = fieldValue;
  }
  return result;
}

function validateService(service, label = 'service') {
  assertPlainObject(service, label);
  assertAllowedKeys(service, ['name', 'price', 'avgTime', 'unit', 'customFields'], label);

  const name = requiredString(service.name, `${label}.name`, { max: 120 });
  const price = service.price === null
    ? null
    : finiteNumber(service.price, `${label}.price`, { min: Number.EPSILON, max: 1_000_000_000 });
  const avgTime = finiteNumber(service.avgTime, `${label}.avgTime`, { min: Number.EPSILON, max: MAX_SERVICE_MINUTES });
  const unit = requiredString(service.unit, `${label}.unit`, { max: 10 });
  if (!SERVICE_UNITS.includes(unit)) {
    throw domainError('validation', `${label}.unit must be minutes, hours, or days.`);
  }

  const customFields = validateCustomFields(service.customFields, `${label}.customFields`);
  return customFields === undefined
    ? { name, price, avgTime, unit }
    : { name, price, avgTime, unit, customFields };
}

function validateServices(services) {
  if (!Array.isArray(services) || services.length < 1 || services.length > 100) {
    throw domainError('validation', 'services must contain between 1 and 100 services.');
  }
  const names = new Set();
  return services.map((service, index) => {
    const normalized = validateService(service, `services[${index}]`);
    const key = normalized.name.toLocaleLowerCase('en-US');
    if (names.has(key)) {
      throw domainError('validation', 'Service names must be unique.');
    }
    names.add(key);
    return normalized;
  });
}

function validatePhone(value, label = 'phone') {
  const phone = requiredString(value, label, { min: 3, max: 32 });
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 3) {
    throw domainError('validation', `${label} must include at least three digits.`);
  }
  return phone;
}

function validateCoordinates(lat, lng) {
  return {
    lat: finiteNumber(lat, 'lat', { min: -90, max: 90 }),
    lng: finiteNumber(lng, 'lng', { min: -180, max: 180 }),
  };
}

function validateProviderProfile(input, options = {}) {
  const { partial = false } = options;
  assertPlainObject(input, 'provider');
  assertAllowedKeys(input, [
    'shopName',
    'categoryId',
    'phone',
    'lat',
    'lng',
    'geohash',
    'services',
    'workingHours',
    'workers',
    'isPaused',
    'relocate',
  ], 'provider');

  const required = ['shopName', 'categoryId', 'phone', 'lat', 'lng', 'services', 'workingHours', 'workers'];
  if (!partial) {
    for (const field of required) {
      if (!hasOwn(input, field)) {
        throw domainError('validation', `provider.${field} is required.`);
      }
    }
  }

  const patch = {};
  if (hasOwn(input, 'shopName')) patch.shopName = requiredString(input.shopName, 'shopName', { max: 160 });
  if (hasOwn(input, 'categoryId')) patch.categoryId = requiredString(input.categoryId, 'categoryId', { max: 64 });
  if (hasOwn(input, 'phone')) patch.phone = validatePhone(input.phone);
  if (hasOwn(input, 'services')) patch.services = validateServices(input.services);
  if (hasOwn(input, 'workingHours')) patch.workingHours = validateWorkingHours(input.workingHours);
  if (hasOwn(input, 'workers')) patch.workers = finiteNumber(input.workers, 'workers', { min: 1, max: 1_000, integer: true });
  if (hasOwn(input, 'isPaused')) patch.isPaused = requiredBoolean(input.isPaused, 'isPaused');
  const relocating = hasOwn(input, 'relocate')
    ? requiredBoolean(input.relocate, 'relocate')
    : false;

  const hasLat = hasOwn(input, 'lat');
  const hasLng = hasOwn(input, 'lng');
  if (hasLat !== hasLng) {
    throw domainError('validation', 'lat and lng must be updated together.');
  }
  if (hasLat) {
    Object.assign(patch, validateCoordinates(input.lat, input.lng));
  }
  if (relocating) {
    if (!hasLat) {
      throw domainError('validation', 'relocate requires a new lat and lng.');
    }
    patch.relocate = true;
  }

  // Geohashes are derived from coordinates on the server.  Accepting this
  // legacy-shaped field keeps a caller from failing solely because it sends it,
  // but the submitted value is intentionally never persisted.
  if (hasOwn(input, 'geohash')) {
    requiredString(input.geohash, 'geohash', { max: 32 });
  }

  if (partial && Object.keys(patch).length === 0) {
    throw domainError('validation', 'At least one mutable provider field is required.');
  }
  return patch;
}

function validateUserPatch(input, options = {}) {
  const { allowEmpty = false } = options;
  assertPlainObject(input, 'user');
  assertAllowedKeys(input, ['name', 'phone', 'language'], 'user');
  const patch = {};

  if (hasOwn(input, 'name')) patch.name = requiredString(input.name, 'name', { max: 120 });
  if (hasOwn(input, 'phone')) {
    if (input.phone === null || input.phone === '') {
      patch.phone = null;
    } else {
      patch.phone = validatePhone(input.phone);
    }
  }
  if (hasOwn(input, 'language')) {
    patch.language = requiredString(input.language, 'language', { min: 2, max: 20, pattern: /^[A-Za-z0-9-]+$/ });
  }

  if (!allowEmpty && Object.keys(patch).length === 0) {
    throw domainError('validation', 'At least one profile field is required.');
  }
  return patch;
}

function validateSavedMakers(input) {
  assertPlainObject(input, 'saved makers request');
  assertAllowedKeys(input, ['savedMakers'], 'saved makers request');
  if (!Array.isArray(input.savedMakers) || input.savedMakers.length > MAX_SAVED_MAKERS) {
    throw domainError('validation', `savedMakers must contain at most ${MAX_SAVED_MAKERS} maker IDs.`);
  }
  const seen = new Set();
  return input.savedMakers.map((value, index) => {
    const id = requiredString(value, `savedMakers[${index}]`, { max: 128 });
    if (seen.has(id)) {
      throw domainError('validation', 'savedMakers cannot contain duplicates.');
    }
    seen.add(id);
    return id;
  });
}

function validateDetails(details) {
  assertPlainObject(details, 'details');
  assertAllowedKeys(details, ['materialsBy', 'notes', 'size', 'dateNeeded'], 'details');
  const materialsBy = requiredString(details.materialsBy, 'details.materialsBy', { max: 16 });
  if (!['Customer', 'Maker'].includes(materialsBy)) {
    throw domainError('validation', 'details.materialsBy must be Customer or Maker.');
  }
  const notes = optionalString(details.notes, 'details.notes', { min: 0, max: 2_000 }) || '';
  const size = optionalString(details.size, 'details.size', { min: 0, max: 500 }) || '';
  const dateNeeded = optionalString(details.dateNeeded, 'details.dateNeeded', {
    min: 10,
    max: 10,
    pattern: /^\d{4}-\d{2}-\d{2}$/,
  }) || '';
  if (dateNeeded) {
    const parsedDate = new Date(`${dateNeeded}T00:00:00.000Z`);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== dateNeeded) {
      throw domainError('validation', 'details.dateNeeded must be a real ISO date.');
    }
  }
  return { materialsBy, notes, size, dateNeeded };
}

function validateCreateOrder(input) {
  assertPlainObject(input, 'order request');
  assertAllowedKeys(input, ['providerId', 'service', 'details'], 'order request');
  return {
    providerId: requiredString(input.providerId, 'providerId', { max: 128 }),
    service: requiredString(input.service, 'service', { max: 120 }),
    details: validateDetails(input.details),
  };
}

function validateOrderId(input, label = 'order command') {
  assertPlainObject(input, label);
  assertAllowedKeys(input, ['orderId'], label);
  return requiredString(input.orderId, 'orderId', { max: 128 });
}

function validateRejectOrder(input) {
  assertPlainObject(input, 'reject order request');
  assertAllowedKeys(input, ['orderId', 'rejectReason'], 'reject order request');
  return {
    orderId: requiredString(input.orderId, 'orderId', { max: 128 }),
    rejectReason: requiredString(input.rejectReason, 'rejectReason', { max: 1_000 }),
  };
}

function validateQuoteTime(value) {
  assertPlainObject(value, 'quoteTime');
  assertAllowedKeys(value, ['value', 'unit'], 'quoteTime');
  const amount = finiteNumber(value.value, 'quoteTime.value', { min: Number.EPSILON, max: MAX_SERVICE_MINUTES });
  const unit = requiredString(value.unit, 'quoteTime.unit', { max: 10 });
  if (!SERVICE_UNITS.includes(unit)) {
    throw domainError('validation', 'quoteTime.unit must be minutes, hours, or days.');
  }
  return { value: amount, unit };
}

function validateSendQuote(input) {
  assertPlainObject(input, 'quote request');
  assertAllowedKeys(input, ['orderId', 'quotePrice', 'quoteTime'], 'quote request');
  return {
    orderId: requiredString(input.orderId, 'orderId', { max: 128 }),
    quotePrice: finiteNumber(input.quotePrice, 'quotePrice', { min: Number.EPSILON, max: 1_000_000_000 }),
    quoteTime: validateQuoteTime(input.quoteTime),
  };
}

function validateCreateReview(input) {
  assertPlainObject(input, 'review request');
  assertAllowedKeys(input, ['orderId', 'rating', 'text'], 'review request');
  const text = input.text === undefined || input.text === null
    ? ''
    : requiredString(input.text, 'text', { min: 0, max: 1_000 });
  return {
    orderId: requiredString(input.orderId, 'orderId', { max: 128 }),
    rating: finiteNumber(input.rating, 'rating', { min: 1, max: 5, integer: true }),
    text,
  };
}

const TRANSITIONS = Object.freeze({
  acceptFixedPrice: Object.freeze({ from: 'Requested', to: 'Accepted', actor: 'provider' }),
  sendQuote: Object.freeze({ from: 'Requested', to: 'Quoted', actor: 'provider' }),
  rejectOrder: Object.freeze({ from: 'Requested', to: 'Rejected', actor: 'provider' }),
  confirmQuote: Object.freeze({ from: 'Quoted', to: 'Accepted', actor: 'customer' }),
  cancelOrder: Object.freeze({ from: ['Requested', 'Quoted', 'Accepted'], to: 'Cancelled', actor: 'customer' }),
  startOrder: Object.freeze({ from: 'Accepted', to: 'In progress', actor: 'provider' }),
  markReady: Object.freeze({ from: 'In progress', to: 'Ready', actor: 'provider' }),
  markCollected: Object.freeze({ from: 'Ready', to: 'Collected', actor: 'provider' }),
});

function assertTransition(action, currentStatus, actor) {
  const transition = TRANSITIONS[action];
  if (!transition) {
    throw domainError('validation', `Unsupported order action: ${action}.`);
  }
  if (transition.actor !== actor) {
    throw domainError('permission-denied', 'This order action is not permitted for this actor.');
  }
  const validFrom = Array.isArray(transition.from) ? transition.from : [transition.from];
  if (!validFrom.includes(currentStatus)) {
    throw domainError('conflict', `Cannot ${action} while an order is ${currentStatus}.`);
  }
  return transition.to;
}

function isActiveStatus(status) {
  return ACTIVE_STATUSES.has(status);
}

function toDate(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }
  if (typeof value.toDate === 'function') {
    return toDate(value.toDate());
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function dateOrThrow(value, label) {
  const date = toDate(value);
  if (!date) {
    throw domainError('validation', `${label} must be a valid date.`);
  }
  return date;
}

function timeToMinutes(value) {
  return validateTime(value, 'time').minutes;
}

function dayWindow(date, hours) {
  const current = dateOrThrow(date, 'date');
  const entry = hours && hours[current.getDay()];
  if (!entry) {
    return null;
  }
  const open = timeToMinutes(entry.open);
  const close = timeToMinutes(entry.close);
  if (close <= open) {
    throw domainError('validation', 'Working hours must close after they open.');
  }
  const start = new Date(current);
  start.setHours(0, open, 0, 0);
  const end = new Date(current);
  end.setHours(0, close, 0, 0);
  return { start, end };
}

function startOfNextDay(date) {
  const next = dateOrThrow(date, 'date');
  next.setDate(next.getDate() + 1);
  next.setHours(0, 0, 0, 0);
  return next;
}

/** First instant on or after `time` at which the maker is open. */
function nextOpen(time, hours) {
  let current = dateOrThrow(time, 'time');
  for (let index = 0; index < SEARCH_DAYS; index += 1) {
    const window = dayWindow(current, hours);
    if (window && current < window.start) {
      return window.start;
    }
    if (window && current < window.end) {
      return current;
    }
    current = startOfNextDay(current);
  }
  return null;
}

/** Move ahead by working minutes, skipping closed days and out-of-hours time. */
function addWorkingMinutes(start, minutes, hours) {
  let current = nextOpen(start, hours);
  let remaining = finiteNumber(minutes, 'minutes', { min: 0, max: MAX_SERVICE_MINUTES * 2 });
  while (current && remaining > 0) {
    const window = dayWindow(current, hours);
    const available = (window.end.getTime() - current.getTime()) / MINUTE;
    if (remaining <= available) {
      return new Date(current.getTime() + (remaining * MINUTE));
    }
    remaining -= available;
    current = nextOpen(startOfNextDay(window.end), hours);
  }
  return current;
}

/** Working minutes elapsed between two instants, excluding closed hours. */
function workingMinutesBetween(start, end, hours) {
  const first = toDate(start);
  const last = toDate(end);
  if (!first || !last || first >= last) {
    return 0;
  }
  let current = nextOpen(first, hours);
  let total = 0;
  while (current && current < last) {
    const window = dayWindow(current, hours);
    total += Math.max(0, (Math.min(last.getTime(), window.end.getTime()) - current.getTime()) / MINUTE);
    current = nextOpen(startOfNextDay(window.end), hours);
  }
  return total;
}

function averageWorkingDayMinutes(hours) {
  if (!Array.isArray(hours)) {
    throw domainError('validation', 'workingHours must be an array.');
  }
  const openDays = hours.filter(Boolean);
  if (openDays.length === 0) {
    return 480;
  }
  return openDays.reduce((sum, entry) => sum + timeToMinutes(entry.close) - timeToMinutes(entry.open), 0) / openDays.length;
}

function serviceToMinutes(service, hours) {
  const normalized = validateService(service);
  let minutes = normalized.avgTime;
  if (normalized.unit === 'days') {
    minutes *= averageWorkingDayMinutes(hours);
  } else if (normalized.unit === 'hours') {
    minutes *= 60;
  }
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > MAX_SERVICE_MINUTES) {
    throw domainError('validation', 'Service duration is outside the permitted range.');
  }
  return minutes;
}

function remainingMinutes(order, now, hours) {
  assertPlainObject(order, 'order');
  const total = finiteNumber(order.serviceMinutes, 'order.serviceMinutes', { min: Number.EPSILON, max: MAX_SERVICE_MINUTES });
  if (order.status !== 'In progress') {
    return total;
  }
  const worked = workingMinutesBetween(order.startedAt, now, hours);
  return Math.max(total * 0.1, total - worked);
}

function estimateWait(provider, activeOrders, now = new Date()) {
  assertPlainObject(provider, 'provider');
  if (!Array.isArray(activeOrders)) {
    throw domainError('validation', 'activeOrders must be an array.');
  }
  const hours = validateWorkingHours(provider.workingHours);
  const workers = Math.max(1, finiteNumber(provider.workers || 1, 'provider.workers', { min: 1, max: 1_000 }));
  const active = activeOrders.filter((order) => isActiveStatus(order.status));
  const backlog = active.reduce((sum, order) => sum + remainingMinutes(order, now, hours), 0);
  const waitMinutes = backlog / workers;
  return {
    queueCount: active.length,
    estWaitMinutes: Math.round(waitMinutes),
    queueClearsAt: addWorkingMinutes(now, waitMinutes, hours),
  };
}

function estimateReady(provider, from, minutes) {
  if (!from) {
    return null;
  }
  assertPlainObject(provider, 'provider');
  return addWorkingMinutes(from, minutes, validateWorkingHours(provider.workingHours));
}

function readyAtAcceptance(provider, otherActiveOrders, order, now = new Date()) {
  assertPlainObject(order, 'order');
  const queue = estimateWait(provider, otherActiveOrders, now);
  return estimateReady(provider, queue.queueClearsAt, finiteNumber(order.serviceMinutes, 'order.serviceMinutes', {
    min: Number.EPSILON,
    max: MAX_SERVICE_MINUTES,
  }));
}

/**
 * A server-side implementation so untrusted clients cannot place documents in
 * a false geohash range. The precision matches typical nearby-search use.
 */
function encodeGeohash(lat, lng, precision = 9) {
  const coordinates = validateCoordinates(lat, lng);
  const length = finiteNumber(precision, 'precision', { min: 1, max: 12, integer: true });
  const alphabet = '0123456789bcdefghjkmnpqrstuvwxyz';
  let latitude = [-90, 90];
  let longitude = [-180, 180];
  let evenBit = true;
  let bit = 0;
  let character = 0;
  let result = '';

  while (result.length < length) {
    if (evenBit) {
      const midpoint = (longitude[0] + longitude[1]) / 2;
      if (coordinates.lng >= midpoint) {
        character = (character << 1) + 1;
        longitude[0] = midpoint;
      } else {
        character <<= 1;
        longitude[1] = midpoint;
      }
    } else {
      const midpoint = (latitude[0] + latitude[1]) / 2;
      if (coordinates.lat >= midpoint) {
        character = (character << 1) + 1;
        latitude[0] = midpoint;
      } else {
        character <<= 1;
        latitude[1] = midpoint;
      }
    }
    evenBit = !evenBit;
    bit += 1;
    if (bit === 5) {
      result += alphabet[character];
      bit = 0;
      character = 0;
    }
  }
  return result;
}

/** Maps Firebase/callable errors to the stable frontend error vocabulary. */
function normalizeApplicationError(error) {
  const rawCode = error && (error.appCode || error.code);
  if (APP_ERROR_CODES.has(rawCode)) {
    return rawCode;
  }
  const canonical = {
    'invalid-argument': 'validation',
    'out-of-range': 'validation',
    unauthenticated: 'signed-out',
    'permission-denied': 'permission-denied',
    'not-found': 'not-found',
    'already-exists': 'conflict',
    aborted: 'conflict',
    'failed-precondition': 'conflict',
    unavailable: 'unavailable',
    'deadline-exceeded': 'unavailable',
  };
  return canonical[rawCode] || 'unknown';
}

module.exports = {
  ACTIVE_STATUSES,
  APP_ERROR_CODES,
  DomainError,
  MAX_SAVED_MAKERS,
  SERVICE_UNITS,
  STATUSES,
  TRANSITIONS,
  addWorkingMinutes,
  assertTransition,
  averageWorkingDayMinutes,
  dayWindow,
  domainError,
  encodeGeohash,
  estimateReady,
  estimateWait,
  isActiveStatus,
  nextOpen,
  normalizeApplicationError,
  readyAtAcceptance,
  remainingMinutes,
  serviceToMinutes,
  startOfNextDay,
  toDate,
  validateCreateOrder,
  validateCreateReview,
  validateOrderId,
  validateProviderProfile,
  validateQuoteTime,
  validateRejectOrder,
  validateSavedMakers,
  validateSendQuote,
  validateUserPatch,
  validateWorkingHours,
  workingMinutesBetween,
};
