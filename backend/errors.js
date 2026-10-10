/**
 * Error values exposed by the LocalLoop client boundary.
 *
 * UI code should branch on `error.code`, never on Firebase SDK error strings.
 */
export const ERROR_CODES = Object.freeze({
  CONFIGURATION: "configuration",
  SIGNED_OUT: "signed-out",
  PERMISSION_DENIED: "permission-denied",
  VALIDATION: "validation",
  NOT_FOUND: "not-found",
  CONFLICT: "conflict",
  UNAVAILABLE: "unavailable",
  UNKNOWN: "unknown",
});

const KNOWN_CODES = new Set(Object.values(ERROR_CODES));

const MESSAGE_BY_CODE = Object.freeze({
  [ERROR_CODES.CONFIGURATION]: "LocalLoop is not configured for Firebase.",
  [ERROR_CODES.SIGNED_OUT]: "Please sign in to continue.",
  [ERROR_CODES.PERMISSION_DENIED]: "You do not have permission to do that.",
  [ERROR_CODES.VALIDATION]: "Some information is missing or invalid.",
  [ERROR_CODES.NOT_FOUND]: "The requested record no longer exists.",
  [ERROR_CODES.CONFLICT]: "This record changed before your request could be completed.",
  [ERROR_CODES.UNAVAILABLE]: "LocalLoop is temporarily unavailable. Check your connection and try again.",
  [ERROR_CODES.UNKNOWN]: "Something went wrong. Please try again.",
});

/**
 * A serializable, SDK-independent application error.
 */
export class LocalLoopError extends Error {
  constructor(code, message, options = {}) {
    const normalizedCode = KNOWN_CODES.has(code) ? code : ERROR_CODES.UNKNOWN;
    super(message || MESSAGE_BY_CODE[normalizedCode]);
    this.name = "LocalLoopError";
    this.code = normalizedCode;
    this.details = toPlainDetails(options.details);

    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}

/**
 * Converts Firebase Auth, Firestore, Functions, browser-network, and local
 * validation failures into the small stable error vocabulary used by the API.
 */
export function normalizeError(error, fallbackCode = ERROR_CODES.UNKNOWN) {
  if (error instanceof LocalLoopError) {
    return error;
  }

  const sourceCode = String(error?.code || "").toLowerCase();
  const trustedAppCode = String(error?.details?.appCode || "").toLowerCase();
  const code = KNOWN_CODES.has(trustedAppCode)
    ? trustedAppCode
    : mapSdkErrorCode(sourceCode, error, fallbackCode);
  const message = safeMessage(error?.message, code);

  return new LocalLoopError(code, message, {
    cause: error,
    details: sourceCode ? { sourceCode } : undefined,
  });
}

/**
 * Throws a stable validation error. Kept here so contracts and Firebase code
 * use the same error type without depending on the Firebase SDK.
 */
export function validationError(message, details) {
  return new LocalLoopError(ERROR_CODES.VALIDATION, message, { details });
}

export function configurationError(message, details) {
  return new LocalLoopError(ERROR_CODES.CONFIGURATION, message, { details });
}

function mapSdkErrorCode(sourceCode, error, fallbackCode) {
  if (KNOWN_CODES.has(sourceCode)) {
    return sourceCode;
  }

  if (
    sourceCode === "auth/unauthenticated" ||
    sourceCode === "functions/unauthenticated" ||
    sourceCode === "unauthenticated"
  ) {
    return ERROR_CODES.SIGNED_OUT;
  }

  if (
    sourceCode === "auth/invalid-api-key" ||
    sourceCode === "auth/app-not-authorized" ||
    sourceCode === "auth/app-deleted" ||
    sourceCode === "auth/configuration-not-found" ||
    sourceCode === "functions/failed-precondition" && /configuration|app check/i.test(String(error?.message || ""))
  ) {
    return ERROR_CODES.CONFIGURATION;
  }

  if (
    sourceCode === "permission-denied" ||
    sourceCode === "firestore/permission-denied" ||
    sourceCode === "functions/permission-denied" ||
    sourceCode === "auth/operation-not-allowed"
  ) {
    return ERROR_CODES.PERMISSION_DENIED;
  }

  if (
    sourceCode === "not-found" ||
    sourceCode === "firestore/not-found" ||
    sourceCode === "functions/not-found" ||
    sourceCode === "auth/user-not-found"
  ) {
    return ERROR_CODES.NOT_FOUND;
  }

  if (
    sourceCode === "already-exists" ||
    sourceCode === "functions/already-exists" ||
    sourceCode === "auth/email-already-in-use" ||
    sourceCode === "auth/credential-already-in-use" ||
    sourceCode === "auth/requires-recent-login" ||
    sourceCode === "aborted" ||
    sourceCode === "firestore/aborted" ||
    sourceCode === "functions/aborted" ||
    sourceCode === "functions/failed-precondition"
  ) {
    return ERROR_CODES.CONFLICT;
  }

  if (
    sourceCode === "invalid-argument" ||
    sourceCode === "functions/invalid-argument" ||
    sourceCode === "firestore/invalid-argument" ||
    sourceCode === "functions/out-of-range" ||
    sourceCode === "auth/invalid-email" ||
    sourceCode === "auth/weak-password" ||
    sourceCode === "auth/wrong-password" ||
    sourceCode === "auth/invalid-credential" ||
    sourceCode === "auth/missing-password"
  ) {
    return ERROR_CODES.VALIDATION;
  }

  if (
    sourceCode === "unavailable" ||
    sourceCode === "firestore/unavailable" ||
    sourceCode === "functions/unavailable" ||
    sourceCode === "deadline-exceeded" ||
    sourceCode === "functions/deadline-exceeded" ||
    sourceCode === "auth/network-request-failed" ||
    error?.name === "NetworkError" ||
    error?.name === "AbortError"
  ) {
    return ERROR_CODES.UNAVAILABLE;
  }

  return KNOWN_CODES.has(fallbackCode) ? fallbackCode : ERROR_CODES.UNKNOWN;
}

function safeMessage(message, code) {
  // SDK messages can contain implementation details. Public application errors
  // should remain predictable, except for our own intentionally supplied text.
  if (code === ERROR_CODES.VALIDATION && typeof message === "string" && message.length > 0) {
    return message;
  }

  return MESSAGE_BY_CODE[code] || MESSAGE_BY_CODE[ERROR_CODES.UNKNOWN];
}

function toPlainDetails(value) {
  if (value === undefined) {
    return undefined;
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return undefined;
  }
}
