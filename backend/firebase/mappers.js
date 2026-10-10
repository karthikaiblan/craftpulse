/**
 * Converts Firebase-shaped values into serializable domain values. Nothing in
 * this module returns a Firestore snapshot, Timestamp, GeoPoint, or Auth user.
 */

export function mapDocument(snapshot, mapper) {
  if (!snapshot || typeof snapshot.exists !== "function" || !snapshot.exists()) {
    return null;
  }

  return mapper(snapshot.data(), snapshot.id);
}

export function mapDocuments(snapshot, mapper) {
  if (!snapshot || !Array.isArray(snapshot.docs)) return [];
  return snapshot.docs
    .filter((document) => document?.exists?.())
    .map((document) => mapper(document.data(), document.id));
}

export function mapCallableData(result) {
  // `httpsCallable` returns { data }, while tests and alternate transports can
  // pass the payload directly. Both enter the same plain-value conversion.
  const data = result && typeof result === "object" && "data" in result ? result.data : result;
  return toPlainValue(data);
}

export function mapSession(user) {
  if (!user) return null;
  return compact({
    uid: stringOrUndefined(user.uid),
    email: stringOrUndefined(user.email),
    displayName: stringOrUndefined(user.displayName),
    phoneNumber: stringOrUndefined(user.phoneNumber),
    emailVerified: typeof user.emailVerified === "boolean" ? user.emailVerified : undefined,
  });
}

export function mapUser(data, id) {
  const value = plainRecord(data);
  return compact({
    id: id || stringOrUndefined(value.id),
    name: stringOrUndefined(value.name),
    email: stringOrUndefined(value.email),
    createdAt: isoOrUndefined(value.createdAt),
    phone: stringOrUndefined(value.phone),
    isProvider: typeof value.isProvider === "boolean" ? value.isProvider : undefined,
    savedMakers: stringArray(value.savedMakers),
    language: stringOrUndefined(value.language),
  });
}

export function mapProvider(data, id) {
  const value = plainRecord(data);
  const providerId = id || stringOrUndefined(value.id);

  return compact({
    id: providerId,
    // Provider documents are owned by their document ID. Keeping ownerId here
    // preserves a useful frontend-facing invariant without leaking snapshots.
    ownerId: stringOrUndefined(value.ownerId) || providerId,
    shopName: stringOrUndefined(value.shopName),
    categoryId: stringOrUndefined(value.categoryId),
    phone: stringOrUndefined(value.phone),
    lat: finiteNumberOrUndefined(value.lat),
    lng: finiteNumberOrUndefined(value.lng),
    geohash: stringOrUndefined(value.geohash),
    services: Array.isArray(value.services) ? value.services.map(mapService) : [],
    workingHours: Array.isArray(value.workingHours) ? value.workingHours.map(mapWorkingHoursEntry) : [],
    workers: finiteNumberOrUndefined(value.workers),
    isPaused: typeof value.isPaused === "boolean" ? value.isPaused : undefined,
    queueCount: finiteNumberOrUndefined(value.queueCount),
    queueClearsAt: isoOrUndefined(value.queueClearsAt),
    estWaitMinutes: finiteNumberOrUndefined(value.estWaitMinutes),
    ratingSum: finiteNumberOrUndefined(value.ratingSum),
    ratingCount: finiteNumberOrUndefined(value.ratingCount),
    movedAt: isoOrUndefined(value.movedAt),
    movedFrom: mapCoordinates(value.movedFrom),
    plan: stringOrUndefined(value.plan),
    updatedAt: isoOrUndefined(value.updatedAt),
  });
}

export function mapOrder(data, id) {
  const value = plainRecord(data);
  return compact({
    id: id || stringOrUndefined(value.id),
    customerId: stringOrUndefined(value.customerId),
    providerId: stringOrUndefined(value.providerId),
    customerName: stringOrUndefined(value.customerName),
    customerPhone: stringOrUndefined(value.customerPhone),
    service: stringOrUndefined(value.service),
    serviceMinutes: finiteNumberOrUndefined(value.serviceMinutes),
    details: mapOrderDetails(value.details),
    status: stringOrUndefined(value.status),
    createdAt: isoOrUndefined(value.createdAt),
    updatedAt: isoOrUndefined(value.updatedAt),
    quotePrice: finiteNumberOrUndefined(value.quotePrice),
    quoteTime: mapDuration(value.quoteTime),
    rejectReason: stringOrUndefined(value.rejectReason),
    estReadyAt: isoOrUndefined(value.estReadyAt),
    startedAt: isoOrUndefined(value.startedAt),
    readyAt: isoOrUndefined(value.readyAt),
    collectedAt: isoOrUndefined(value.collectedAt),
  });
}

export function mapReview(data, id) {
  const value = plainRecord(data);
  return compact({
    id: id || stringOrUndefined(value.id),
    providerId: stringOrUndefined(value.providerId),
    customerId: stringOrUndefined(value.customerId),
    rating: finiteNumberOrUndefined(value.rating),
    text: stringOrUndefined(value.text),
    createdAt: isoOrUndefined(value.createdAt),
  });
}

export function mapCategory(data, id) {
  const value = plainRecord(data);
  return compact({
    id: id || stringOrUndefined(value.id),
    name: stringOrUndefined(value.name),
    orderFields: Array.isArray(value.orderFields) ? value.orderFields.map(toPlainValue) : undefined,
  });
}

export function toPlainValue(value) {
  if (value === undefined || value === null) return value;
  if (value instanceof Date) return value.toISOString();

  if (looksLikeTimestamp(value)) {
    return timestampToIso(value);
  }

  if (Array.isArray(value)) {
    return value.map(toPlainValue);
  }

  if (typeof value === "object") {
    if (looksLikeGeoPoint(value)) {
      return { latitude: value.latitude, longitude: value.longitude };
    }

    const result = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      if (nestedValue !== undefined) result[key] = toPlainValue(nestedValue);
    }
    return result;
  }

  return value;
}

export function toIsoString(value) {
  const converted = timestampToIso(value);
  return typeof converted === "string" ? converted : undefined;
}

function mapService(service) {
  const value = plainRecord(service);
  return compact({
    name: stringOrUndefined(value.name),
    price: value.price === null ? null : finiteNumberOrUndefined(value.price),
    avgTime: finiteNumberOrUndefined(value.avgTime),
    unit: stringOrUndefined(value.unit),
    customFields: value.customFields && typeof value.customFields === "object"
      ? toPlainValue(value.customFields)
      : undefined,
  });
}

function mapWorkingHoursEntry(entry) {
  if (entry === null) return null;
  const value = plainRecord(entry);
  return compact({
    open: stringOrUndefined(value.open),
    close: stringOrUndefined(value.close),
  });
}

function mapOrderDetails(details) {
  const value = plainRecord(details);
  if (Object.keys(value).length === 0) return undefined;
  return compact({
    materialsBy: stringOrUndefined(value.materialsBy),
    notes: stringOrUndefined(value.notes),
    size: stringOrUndefined(value.size),
    dateNeeded: stringOrUndefined(value.dateNeeded),
  });
}

function mapDuration(duration) {
  const value = plainRecord(duration);
  if (Object.keys(value).length === 0) return undefined;
  return compact({
    value: finiteNumberOrUndefined(value.value),
    unit: stringOrUndefined(value.unit),
  });
}

function mapCoordinates(coordinates) {
  if (!coordinates || typeof coordinates !== "object") return undefined;
  const plain = toPlainValue(coordinates);
  const lat = finiteNumberOrUndefined(plain.lat ?? plain.latitude);
  const lng = finiteNumberOrUndefined(plain.lng ?? plain.longitude);
  if (lat === undefined || lng === undefined) return undefined;
  return { lat, lng };
}

function timestampToIso(value) {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();

  if (value && typeof value.toDate === "function") {
    const date = value.toDate();
    if (date instanceof Date && !Number.isNaN(date.getTime())) return date.toISOString();
  }

  if (value && typeof value === "object") {
    const seconds = value.seconds ?? value._seconds;
    const nanoseconds = value.nanoseconds ?? value._nanoseconds ?? 0;
    if (typeof seconds === "number" && Number.isFinite(seconds) && typeof nanoseconds === "number") {
      const date = new Date(seconds * 1000 + nanoseconds / 1_000_000);
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
  }

  return undefined;
}

function looksLikeTimestamp(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      (typeof value.toDate === "function" ||
        typeof value.seconds === "number" ||
        typeof value._seconds === "number"),
  );
}

function looksLikeGeoPoint(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof value.latitude === "number" &&
      typeof value.longitude === "number",
  );
}

function plainRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, nestedValue]) => nestedValue !== undefined));
}

function stringOrUndefined(value) {
  return typeof value === "string" ? value : undefined;
}

function finiteNumberOrUndefined(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}
