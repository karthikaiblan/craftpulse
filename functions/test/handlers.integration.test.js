'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

if (process.env.RUN_FUNCTIONS_INTEGRATION_TESTS !== 'true' || !process.env.FIRESTORE_EMULATOR_HOST) {
  test('Callable integration tests require an explicitly started Emulator Suite', {
    skip: 'Set RUN_FUNCTIONS_INTEGRATION_TESTS=true and FIRESTORE_EMULATOR_HOST with Firebase emulators running (Java 11+).',
  }, () => {});
} else {
  // This invokes the same callable handler functions Firebase exports, with
  // Firestore Admin pointed at the emulator. Auth tokens are represented by
  // callable request auth contexts because authorization is handler-owned.
  const { initializeApp, getApps, deleteApp } = require('firebase-admin/app');
  const { FieldValue, getFirestore } = require('firebase-admin/firestore');
  const { createCallableHandlers } = require('../src/handlers');

  const projectId = `localloop-handler-test-${Date.now()}`;
  const app = getApps().find((candidate) => candidate.name === projectId)
    || initializeApp({ projectId }, projectId);
  const db = getFirestore(app);
  const handlers = createCallableHandlers({ db, serverTimestamp: FieldValue.serverTimestamp });
  const ids = new Set();
  const hours = Array.from({ length: 7 }, () => ({ open: '09:00', close: '17:00' }));

  const request = (uid, data, name = uid) => ({
    auth: { uid, token: { email: `${uid}@example.test`, name } },
    data,
  });

  async function createUser(uid, name = uid) {
    ids.add(uid);
    return handlers.initializeUser(request(uid, { name }, name));
  }

  async function createProvider(uid, services) {
    await createUser(uid, 'Maker');
    await db.collection('categories').doc('tailoring').set({ name: 'Tailoring' });
    return handlers.completeOnboarding(request(uid, {
      shopName: 'Maker Shop', categoryId: 'tailoring', phone: '+919876543210',
      lat: 13.0322, lng: 80.2641, services, workingHours: hours, workers: 1,
    }));
  }

  async function createOrder(customerId, providerId, service) {
    await createUser(customerId, 'Customer');
    return handlers.createOrder(request(customerId, {
      providerId,
      service,
      details: { materialsBy: 'Maker', notes: 'Please help', dateNeeded: '2026-11-01' },
    }));
  }

  test('callable handlers initialize profiles, transact the workflow, and aggregate one review', async (t) => {
    const maker = 'maker-a';
    const customer = 'customer-a';
    await createProvider(maker, [
      { name: 'Fixed service', price: 400, avgTime: 60, unit: 'minutes' },
      { name: 'Custom service', price: null, avgTime: 2, unit: 'days' },
    ]);

    const fixed = await createOrder(customer, maker, 'Fixed service');
    assert.equal(fixed.order.status, 'Requested');
    assert.equal(fixed.order.serviceMinutes, 60);
    assert.equal(fixed.order.customerName, 'Customer');

    const accepted = await handlers.acceptFixedPrice(request(maker, { orderId: fixed.order.id }));
    assert.equal(accepted.order.status, 'Accepted');
    assert.ok(accepted.order.estReadyAt);
    assert.equal(accepted.provider.queueCount, 1);

    await assert.rejects(
      () => handlers.markReady(request(customer, { orderId: fixed.order.id })),
      (error) => error?.details?.appCode === 'permission-denied',
    );
    assert.equal((await handlers.startOrder(request(maker, { orderId: fixed.order.id }))).order.status, 'In progress');
    assert.equal((await handlers.markReady(request(maker, { orderId: fixed.order.id }))).order.status, 'Ready');
    assert.equal((await handlers.markCollected(request(maker, { orderId: fixed.order.id }))).order.status, 'Collected');

    const review = await handlers.createReview(request(customer, { orderId: fixed.order.id, rating: 5, text: 'Excellent' }));
    assert.equal(review.review.rating, 5);
    await assert.rejects(
      () => handlers.createReview(request(customer, { orderId: fixed.order.id, rating: 1 })),
      (error) => error?.details?.appCode === 'conflict',
    );
    const provider = (await db.collection('providers').doc(maker).get()).data();
    assert.equal(provider.ratingSum, 5);
    assert.equal(provider.ratingCount, 1);

    const quoted = await createOrder('customer-b', maker, 'Custom service');
    await assert.rejects(
      () => handlers.acceptFixedPrice(request(maker, { orderId: quoted.order.id })),
      (error) => error?.details?.appCode === 'conflict',
    );
    assert.equal((await handlers.sendQuote(request(maker, {
      orderId: quoted.order.id, quotePrice: 1800, quoteTime: { value: 2, unit: 'days' },
    }))).order.status, 'Quoted');
    assert.equal((await handlers.confirmQuote(request('customer-b', { orderId: quoted.order.id }))).order.status, 'Accepted');
    assert.equal((await handlers.cancelOrder(request('customer-b', { orderId: quoted.order.id }))).order.status, 'Cancelled');

    const rejected = await createOrder('customer-e', maker, 'Fixed service');
    assert.equal((await handlers.rejectOrder(request(maker, {
      orderId: rejected.order.id, rejectReason: 'No capacity today',
    }))).order.status, 'Rejected');
    const cancelledRequested = await createOrder('customer-f', maker, 'Fixed service');
    assert.equal((await handlers.cancelOrder(request('customer-f', { orderId: cancelledRequested.order.id }))).order.status, 'Cancelled');

    const [first, second] = await Promise.all([
      createOrder('customer-c', maker, 'Fixed service'),
      createOrder('customer-d', maker, 'Fixed service'),
    ]);
    await Promise.all([
      handlers.acceptFixedPrice(request(maker, { orderId: first.order.id })),
      handlers.acceptFixedPrice(request(maker, { orderId: second.order.id })),
    ]);
    const finalProvider = (await db.collection('providers').doc(maker).get()).data();
    assert.equal(finalProvider.queueCount, 2);
    assert.equal(finalProvider.estWaitMinutes, 120);
    const rebalanced = await handlers.updateProvider(request(maker, { workers: 2 }));
    assert.equal(rebalanced.provider.queueCount, 2);
    assert.equal(rebalanced.provider.estWaitMinutes, 60);

    await t.test('direct client writes remain a rules concern, not an Admin handler capability', () => {
      assert.equal(typeof db.runTransaction, 'function');
    });
  });

  test.after(async () => {
    // A fresh project ID isolates runs; this releases the Admin app cleanly.
    await deleteApp(app);
  });
}
