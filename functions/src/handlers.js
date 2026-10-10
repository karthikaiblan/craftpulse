'use strict';

const { HttpsError } = require('firebase-functions/v2/https');
const {
  DomainError,
  assertTransition,
  encodeGeohash,
  estimateWait,
  readyAtAcceptance,
  serviceToMinutes,
  validateCreateOrder,
  validateCreateReview,
  validateOrderId,
  validateProviderProfile,
  validateRejectOrder,
  validateSavedMakers,
  validateSendQuote,
  validateUserPatch,
} = require('./domain');

const ACTIVE_STATUSES = ['Accepted', 'In progress'];

/**
 * Builds the handlers independently of Firebase app initialization. That makes
 * transaction behaviour integration-testable against the Emulator Suite.
 */
function createCallableHandlers({ db, serverTimestamp }) {
  if (!db || typeof db.collection !== 'function' || typeof db.runTransaction !== 'function') {
    throw new Error('A Firestore Admin database is required.');
  }
  if (typeof serverTimestamp !== 'function') {
    throw new Error('A serverTimestamp factory is required.');
  }

  const users = () => db.collection('users');
  const providers = () => db.collection('providers');
  const orders = () => db.collection('orders');
  const reviews = () => db.collection('reviews');
  const categories = () => db.collection('categories');

  async function initializeUser(request) {
    return execute(async () => {
      const auth = requireAuth(request);
      const input = plainObjectOrEmpty(request.data, 'profile initialization');
      assertKeys(input, ['name', 'phone', 'language'], 'profile initialization');
      const ref = users().doc(auth.uid);
      await db.runTransaction(async (transaction) => {
        const existing = await transaction.get(ref);
        if (existing.exists) return;

        const name = pickInitialName(input, auth);
        const profile = validateUserPatch({
          name,
          ...(input.phone === undefined ? {} : { phone: input.phone }),
          ...(input.language === undefined ? { language: 'en' } : { language: input.language }),
        });
        const email = requireAuthEmail(auth);
        transaction.create(ref, {
          ...profile,
          email,
          createdAt: serverTimestamp(),
          isProvider: false,
          savedMakers: [],
        });
      });
      return { user: await readPlain(ref) };
    });
  }

  async function updateMine(request) {
    return execute(async () => {
      const auth = requireAuth(request);
      const patch = validateUserPatch(request.data);
      const ref = users().doc(auth.uid);
      await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        requireSnapshot(snapshot, 'User profile');
        transaction.update(ref, patch);
      });
      return { user: await readPlain(ref) };
    });
  }

  async function updateSavedMakers(request) {
    return execute(async () => {
      const auth = requireAuth(request);
      const savedMakers = validateSavedMakers(request.data);
      const userRef = users().doc(auth.uid);
      const providerRefs = savedMakers.map((id) => providers().doc(id));
      await db.runTransaction(async (transaction) => {
        const snapshots = await Promise.all([
          transaction.get(userRef),
          ...providerRefs.map((ref) => transaction.get(ref)),
        ]);
        requireSnapshot(snapshots[0], 'User profile');
        for (const provider of snapshots.slice(1)) requireSnapshot(provider, 'Saved provider');
        transaction.update(userRef, { savedMakers });
      });
      return { user: await readPlain(userRef) };
    });
  }

  async function completeOnboarding(request) {
    return execute(async () => {
      const auth = requireAuth(request);
      const profile = validateProviderProfile(request.data);
      const providerRef = providers().doc(auth.uid);
      const userRef = users().doc(auth.uid);
      const categoryRef = categories().doc(profile.categoryId);
      await db.runTransaction(async (transaction) => {
        const [user, existingProvider, category] = await Promise.all([
          transaction.get(userRef),
          transaction.get(providerRef),
          transaction.get(categoryRef),
        ]);
        requireSnapshot(user, 'User profile');
        if (existingProvider.exists) throw domainConflict('A provider profile already exists.');
        requireSnapshot(category, 'Category');
        transaction.create(providerRef, {
          ...profile,
          geohash: encodeGeohash(profile.lat, profile.lng),
          isPaused: false,
          queueCount: 0,
          queueClearsAt: null,
          estWaitMinutes: 0,
          ratingSum: 0,
          ratingCount: 0,
          plan: 'free',
          updatedAt: serverTimestamp(),
        });
        transaction.update(userRef, { isProvider: true });
      });
      return { provider: await readPlain(providerRef) };
    });
  }

  async function updateProvider(request) {
    return execute(async () => {
      const auth = requireAuth(request);
      const profile = validateProviderProfile(request.data, { partial: true });
      const providerRef = providers().doc(auth.uid);
      await db.runTransaction(async (transaction) => {
        const provider = await transaction.get(providerRef);
        requireSnapshot(provider, 'Provider profile');
        const current = provider.data();
        if (profile.categoryId !== undefined) {
          const category = await transaction.get(categories().doc(profile.categoryId));
          requireSnapshot(category, 'Category');
        }

        const patch = { ...profile, updatedAt: serverTimestamp() };
        if (profile.lat !== undefined) {
          patch.geohash = encodeGeohash(profile.lat, profile.lng);
          if (profile.relocate) {
            patch.movedFrom = { lat: current.lat, lng: current.lng };
            patch.movedAt = serverTimestamp();
          }
        }
        delete patch.relocate;
        if (profile.workers !== undefined || profile.workingHours !== undefined) {
          const activeSnapshot = await transaction.get(
            orders()
              .where('providerId', '==', auth.uid)
              .where('status', 'in', ACTIVE_STATUSES),
          );
          const activeOrders = activeSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }));
          const queue = estimateWait({ ...current, ...profile }, activeOrders, new Date());
          patch.queueCount = queue.queueCount;
          patch.estWaitMinutes = queue.estWaitMinutes;
          patch.queueClearsAt = queue.queueClearsAt;
        }
        transaction.update(providerRef, patch);
      });
      return { provider: await readPlain(providerRef) };
    });
  }

  async function createOrder(request) {
    return execute(async () => {
      const auth = requireAuth(request);
      const input = validateCreateOrder(request.data);
      if (input.providerId === auth.uid) {
        throw domainValidation('You cannot create an order for your own shop.');
      }

      const orderRef = orders().doc();
      const providerRef = providers().doc(input.providerId);
      const customerRef = users().doc(auth.uid);
      await db.runTransaction(async (transaction) => {
        const [customer, provider] = await Promise.all([
          transaction.get(customerRef),
          transaction.get(providerRef),
        ]);
        requireSnapshot(customer, 'Customer profile');
        requireSnapshot(provider, 'Provider');
        const providerData = provider.data();
        if (providerData.isPaused) throw domainConflict('This provider is not accepting requests.');
        const service = findService(providerData.services, input.service);
        if (!service) throw domainValidation('The selected service is no longer offered.');
        const serviceMinutes = serviceToMinutes(service, providerData.workingHours);
        const customerData = customer.data();
        transaction.create(orderRef, {
          customerId: auth.uid,
          providerId: input.providerId,
          // Explicit product decision: immutable contact snapshots let a maker
          // fulfil an order without reading a customer’s private user document.
          customerName: customerData.name,
          customerPhone: customerData.phone || '',
          service: service.name,
          serviceMinutes,
          details: input.details,
          status: 'Requested',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });
      return { order: await readPlain(orderRef) };
    });
  }

  async function acceptFixedPrice(request) {
    return changeActiveOrder(request, 'acceptFixedPrice', async ({ order, provider, activeOrders, now }) => {
      const service = findService(provider.services, order.service);
      if (!service || service.price === null) {
        throw domainConflict('Only an offered fixed-price service can be accepted directly.');
      }
      const estReadyAt = readyAtAcceptance(provider, activeOrders, order, now);
      return {
        orderPatch: { status: 'Accepted', estReadyAt, updatedAt: serverTimestamp() },
        queuedOrder: { ...order, status: 'Accepted' },
      };
    });
  }

  async function sendQuote(request) {
    return execute(async () => {
      const auth = requireAuth(request);
      const input = validateSendQuote(request.data);
      const orderRef = orders().doc(input.orderId);
      await db.runTransaction(async (transaction) => {
        const orderSnapshot = await transaction.get(orderRef);
        const order = requireSnapshot(orderSnapshot, 'Order');
        requireProviderOwnership(order, auth.uid);
        assertTransition('sendQuote', order.status, 'provider');
        const providerSnapshot = await transaction.get(providers().doc(auth.uid));
        const provider = requireSnapshot(providerSnapshot, 'Provider profile');
        const service = findService(provider.services, order.service);
        if (!service || service.price !== null) {
          throw domainConflict('Quotes are only permitted for an offered price-on-request service.');
        }
        transaction.update(orderRef, {
          status: 'Quoted',
          quotePrice: input.quotePrice,
          quoteTime: input.quoteTime,
          updatedAt: serverTimestamp(),
        });
      });
      return { order: await readPlain(orderRef) };
    });
  }

  async function confirmQuote(request) {
    return changeActiveOrder(request, 'confirmQuote', async ({ order, provider, activeOrders, now }) => {
      if (!order.quoteTime || typeof order.quotePrice !== 'number') {
        throw domainConflict('A complete maker quote is required before it can be accepted.');
      }
      const estReadyAt = readyAtAcceptance(provider, activeOrders, order, now);
      return {
        orderPatch: { status: 'Accepted', estReadyAt, updatedAt: serverTimestamp() },
        queuedOrder: { ...order, status: 'Accepted' },
      };
    });
  }

  async function cancelOrder(request) {
    return changeActiveOrder(request, 'cancelOrder', async ({ order, activeOrders }) => ({
      orderPatch: { status: 'Cancelled', updatedAt: serverTimestamp() },
      queuedOrder: null,
      // An Accepted order belongs to the active query, so omit it before
      // recalculating the persisted queue values.
      activeOrders: activeOrders.filter((active) => active.id !== order.id),
    }));
  }

  async function rejectOrder(request) {
    return execute(async () => {
      const auth = requireAuth(request);
      const input = validateRejectOrder(request.data);
      const orderRef = orders().doc(input.orderId);
      await db.runTransaction(async (transaction) => {
        const orderSnapshot = await transaction.get(orderRef);
        const order = requireSnapshot(orderSnapshot, 'Order');
        requireProviderOwnership(order, auth.uid);
        assertTransition('rejectOrder', order.status, 'provider');
        transaction.update(orderRef, {
          status: 'Rejected',
          rejectReason: input.rejectReason,
          updatedAt: serverTimestamp(),
        });
      });
      return { order: await readPlain(orderRef) };
    });
  }

  async function startOrder(request) {
    return changeActiveOrder(request, 'startOrder', async ({ order, activeOrders, now }) => ({
      orderPatch: { status: 'In progress', startedAt: serverTimestamp(), updatedAt: serverTimestamp() },
      queuedOrder: { ...order, status: 'In progress', startedAt: now },
      activeOrders: activeOrders.map((active) => active.id === order.id
        ? { ...active, status: 'In progress', startedAt: now }
        : active),
    }));
  }

  async function markReady(request) {
    return changeActiveOrder(request, 'markReady', async ({ order, activeOrders }) => ({
      orderPatch: { status: 'Ready', readyAt: serverTimestamp(), updatedAt: serverTimestamp() },
      queuedOrder: null,
      activeOrders: activeOrders.filter((active) => active.id !== order.id),
    }));
  }

  async function markCollected(request) {
    return execute(async () => {
      const auth = requireAuth(request);
      const orderId = validateOrderId(request.data, 'mark collected request');
      const orderRef = orders().doc(orderId);
      await db.runTransaction(async (transaction) => {
        const order = requireSnapshot(await transaction.get(orderRef), 'Order');
        requireProviderOwnership(order, auth.uid);
        assertTransition('markCollected', order.status, 'provider');
        transaction.update(orderRef, {
          status: 'Collected',
          collectedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });
      return { order: await readPlain(orderRef) };
    });
  }

  async function createReview(request) {
    return execute(async () => {
      const auth = requireAuth(request);
      const input = validateCreateReview(request.data);
      const orderRef = orders().doc(input.orderId);
      const reviewRef = reviews().doc(input.orderId);
      await db.runTransaction(async (transaction) => {
        const [orderSnapshot, reviewSnapshot] = await Promise.all([
          transaction.get(orderRef),
          transaction.get(reviewRef),
        ]);
        const order = requireSnapshot(orderSnapshot, 'Order');
        if (order.customerId !== auth.uid) {
          throw domainPermission('Only the customer who placed this order may review it.');
        }
        if (order.status !== 'Collected') {
          throw domainConflict('Reviews unlock only after collection.');
        }
        if (reviewSnapshot.exists) {
          throw domainConflict('This order already has a review.');
        }
        const providerRef = providers().doc(order.providerId);
        const providerSnapshot = await transaction.get(providerRef);
        const provider = requireSnapshot(providerSnapshot, 'Provider');
        transaction.create(reviewRef, {
          providerId: order.providerId,
          customerId: auth.uid,
          rating: input.rating,
          ...(input.text ? { text: input.text } : {}),
          createdAt: serverTimestamp(),
        });
        transaction.update(providerRef, {
          ratingSum: finiteAggregate(provider.ratingSum) + input.rating,
          ratingCount: finiteAggregate(provider.ratingCount) + 1,
          updatedAt: serverTimestamp(),
        });
      });
      return { review: await readPlain(reviewRef) };
    });
  }

  /** Common transactional path for commands that affect queue aggregates. */
  async function changeActiveOrder(request, action, buildPatch) {
    return execute(async () => {
      const auth = requireAuth(request);
      const orderId = validateOrderId(request.data, `${action} request`);
      const orderRef = orders().doc(orderId);
      let providerRef;
      await db.runTransaction(async (transaction) => {
        const orderSnapshot = await transaction.get(orderRef);
        const order = requireSnapshot(orderSnapshot, 'Order');
        const actor = action === 'confirmQuote' || action === 'cancelOrder' ? 'customer' : 'provider';
        if (actor === 'customer') requireCustomerOwnership(order, auth.uid);
        else requireProviderOwnership(order, auth.uid);
        assertTransition(action, order.status, actor);

        providerRef = providers().doc(order.providerId);
        const activeQuery = orders()
          .where('providerId', '==', order.providerId)
          .where('status', 'in', ACTIVE_STATUSES);
        const [providerSnapshot, activeSnapshot] = await Promise.all([
          transaction.get(providerRef),
          transaction.get(activeQuery),
        ]);
        const provider = requireSnapshot(providerSnapshot, 'Provider');
        const activeOrders = activeSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }));
        const now = new Date();
        const change = await buildPatch({ order: { id: orderSnapshot.id, ...order }, provider, activeOrders, now });
        const recalculatedOrders = change.activeOrders || activeOrders;
        if (change.queuedOrder && !recalculatedOrders.some((active) => active.id === orderSnapshot.id)) {
          recalculatedOrders.push({ id: orderSnapshot.id, ...change.queuedOrder });
        }
        const queue = estimateWait(provider, recalculatedOrders, now);
        transaction.update(orderRef, change.orderPatch);
        transaction.update(providerRef, {
          queueCount: queue.queueCount,
          estWaitMinutes: queue.estWaitMinutes,
          queueClearsAt: queue.queueClearsAt,
          updatedAt: serverTimestamp(),
        });
      });
      return { order: await readPlain(orderRef), provider: await readPlain(providerRef) };
    });
  }

  async function readPlain(ref) {
    const snapshot = await ref.get();
    const data = requireSnapshot(snapshot, 'Record');
    return { id: snapshot.id, ...toPlainValue(data) };
  }

  return {
    initializeUser,
    updateMine,
    updateSavedMakers,
    completeOnboarding,
    updateProvider,
    createOrder,
    acceptFixedPrice,
    sendQuote,
    confirmQuote,
    cancelOrder,
    rejectOrder,
    startOrder,
    markReady,
    markCollected,
    createReview,
  };
}

function requireAuth(request) {
  if (!request || !request.auth || typeof request.auth.uid !== 'string' || !request.auth.uid) {
    throw domainSignedOut();
  }
  return request.auth;
}

function requireAuthEmail(auth) {
  const email = auth.token && auth.token.email;
  if (typeof email !== 'string' || !email.trim()) {
    throw domainValidation('An email-backed Firebase account is required.');
  }
  return email.trim().toLowerCase();
}

function pickInitialName(input, auth) {
  if (input.name !== undefined) return input.name;
  const displayName = auth.token && auth.token.name;
  if (typeof displayName === 'string' && displayName.trim()) return displayName;
  const email = requireAuthEmail(auth);
  return email.slice(0, email.indexOf('@')) || 'LocalLoop customer';
}

function requireSnapshot(snapshot, label) {
  if (!snapshot || !snapshot.exists) throw domainNotFound(`${label} was not found.`);
  return snapshot.data();
}

function requireProviderOwnership(order, uid) {
  if (order.providerId !== uid) throw domainPermission('Only this order’s maker may perform that action.');
}

function requireCustomerOwnership(order, uid) {
  if (order.customerId !== uid) throw domainPermission('Only this order’s customer may perform that action.');
}

function findService(services, requestedName) {
  if (!Array.isArray(services)) return null;
  const normalized = requestedName.trim().toLocaleLowerCase('en-US');
  return services.find((service) => typeof service?.name === 'string'
    && service.name.trim().toLocaleLowerCase('en-US') === normalized) || null;
}

function finiteAggregate(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function plainObjectOrEmpty(value, label) {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw domainValidation(`${label} must be an object.`);
  return value;
}

function assertKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw domainValidation(`${label} contains an unsupported field: ${key}.`);
  }
}

function toPlainValue(value) {
  if (value === undefined || value === null) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toDate === 'function') return toPlainValue(value.toDate());
  if (Array.isArray(value)) return value.map(toPlainValue);
  if (typeof value === 'object') {
    const result = {};
    for (const [key, nested] of Object.entries(value)) result[key] = toPlainValue(nested);
    return result;
  }
  return value;
}

function domainValidation(message) { return new DomainError('validation', message); }
function domainConflict(message) { return new DomainError('conflict', message); }
function domainPermission(message) { return new DomainError('permission-denied', message); }
function domainSignedOut() { return new DomainError('signed-out', 'Sign in to continue.'); }
function domainNotFound(message) { return new DomainError('not-found', message); }

async function execute(callback) {
  try {
    return await callback();
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    if (error instanceof DomainError) {
      const codes = {
        configuration: 'failed-precondition',
        'signed-out': 'unauthenticated',
        'permission-denied': 'permission-denied',
        validation: 'invalid-argument',
        'not-found': 'not-found',
        conflict: 'failed-precondition',
        unavailable: 'unavailable',
        unknown: 'internal',
      };
      throw new HttpsError(codes[error.code] || 'internal', error.message, {
        appCode: error.code,
        ...(error.details === undefined ? {} : { details: error.details }),
      });
    }
    console.error('Unexpected LocalLoop callable failure', error);
    throw new HttpsError('internal', 'LocalLoop could not complete that request.', { appCode: 'unknown' });
  }
}

module.exports = { createCallableHandlers };
