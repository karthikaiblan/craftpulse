'use strict';

const { getApps, initializeApp } = require('firebase-admin/app');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');
const { onCall } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const { createCallableHandlers } = require('./src/handlers');

// Keep the callable deployment region aligned with the client runtime default
// and `.env.example`. Override during deployment only when every client uses
// the same explicit region.
setGlobalOptions({ region: process.env.FIREBASE_FUNCTIONS_REGION || 'asia-south1' });

if (!getApps().length) {
  initializeApp();
}

const handlers = createCallableHandlers({
  db: getFirestore(),
  serverTimestamp: FieldValue.serverTimestamp,
});

// Mutations are intentionally callable-only. Firestore rules deny every
// direct client write; these handlers authenticate, validate, authorize, and
// transact on the caller's behalf.
exports.initializeUser = onCall(handlers.initializeUser);
exports.updateMine = onCall(handlers.updateMine);
exports.updateSavedMakers = onCall(handlers.updateSavedMakers);
exports.completeOnboarding = onCall(handlers.completeOnboarding);
exports.updateProvider = onCall(handlers.updateProvider);
exports.createOrder = onCall(handlers.createOrder);
exports.acceptFixedPrice = onCall(handlers.acceptFixedPrice);
exports.sendQuote = onCall(handlers.sendQuote);
exports.confirmQuote = onCall(handlers.confirmQuote);
exports.cancelOrder = onCall(handlers.cancelOrder);
exports.rejectOrder = onCall(handlers.rejectOrder);
exports.startOrder = onCall(handlers.startOrder);
exports.markReady = onCall(handlers.markReady);
exports.markCollected = onCall(handlers.markCollected);
exports.createReview = onCall(handlers.createReview);
