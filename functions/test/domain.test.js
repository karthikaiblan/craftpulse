'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  DomainError,
  TRANSITIONS,
  addWorkingMinutes,
  assertTransition,
  encodeGeohash,
  estimateWait,
  readyAtAcceptance,
  serviceToMinutes,
  validateCreateOrder,
  validateProviderProfile,
} = require('../src/domain');

const sevenDays = Array.from({ length: 7 }, () => ({ open: '09:00', close: '17:00' }));

test('the exact order transition matrix accepts every legal move and no shortcut', () => {
  for (const [action, transition] of Object.entries(TRANSITIONS)) {
    const from = Array.isArray(transition.from) ? transition.from : [transition.from];
    for (const status of from) {
      assert.equal(assertTransition(action, status, transition.actor), transition.to);
    }
  }
  assert.throws(
    () => assertTransition('markReady', 'Accepted', 'provider'),
    (error) => error instanceof DomainError && error.code === 'conflict',
  );
  assert.throws(
    () => assertTransition('confirmQuote', 'Quoted', 'provider'),
    (error) => error instanceof DomainError && error.code === 'permission-denied',
  );
});

test('service durations use minutes, hours, and average open working days', () => {
  assert.equal(serviceToMinutes({ name: 'Quick', price: 1, avgTime: 45, unit: 'minutes' }, sevenDays), 45);
  assert.equal(serviceToMinutes({ name: 'Hourly', price: 1, avgTime: 2, unit: 'hours' }, sevenDays), 120);
  assert.equal(serviceToMinutes({ name: 'Daily', price: 1, avgTime: 2, unit: 'days' }, sevenDays), 960);
});

test('working-time queue skips closed hours and preserves ten percent in-progress work', () => {
  const now = new Date(2026, 0, 5, 16, 0, 0); // local Monday 4 PM
  const provider = { workers: 1, workingHours: sevenDays };
  const active = [
    { id: 'accepted', status: 'Accepted', serviceMinutes: 120 },
    { id: 'started', status: 'In progress', serviceMinutes: 100, startedAt: new Date(2026, 0, 5, 9, 0, 0) },
  ];
  const wait = estimateWait(provider, active, now);
  // 120 accepted + max(10, 100 - 420 worked) = 130 working minutes.
  assert.equal(wait.queueCount, 2);
  assert.equal(wait.estWaitMinutes, 130);
  assert.deepEqual(wait.queueClearsAt, new Date(2026, 0, 6, 10, 10, 0));
  assert.deepEqual(addWorkingMinutes(now, 120, sevenDays), new Date(2026, 0, 6, 10, 0, 0));
});

test('ready time is calculated before the newly accepted job joins its queue', () => {
  const now = new Date(2026, 0, 5, 10, 0, 0);
  const provider = { workers: 1, workingHours: sevenDays };
  const incoming = { serviceMinutes: 60 };
  const ready = readyAtAcceptance(provider, [{ status: 'Accepted', serviceMinutes: 30 }], incoming, now);
  assert.deepEqual(ready, new Date(2026, 0, 5, 11, 30, 0));
});

test('provider validation derives a deterministic server-side geohash', () => {
  const profile = validateProviderProfile({
    shopName: 'Asha Stitch House', categoryId: 'tailoring', phone: '+91 9876543210',
    lat: 13.0322, lng: 80.2641,
    services: [{ name: 'Blouse stitching', price: 450, avgTime: 90, unit: 'minutes' }],
    workingHours: sevenDays, workers: 2,
  });
  assert.equal(profile.geohash, undefined);
  assert.match(encodeGeohash(profile.lat, profile.lng), /^[0123456789bcdefghjkmnpqrstuvwxyz]{9}$/);
});

test('order payload validation prohibits a client-provided duration snapshot', () => {
  assert.throws(
    () => validateCreateOrder({ providerId: 'maker', service: 'Blouse', serviceMinutes: 1, details: { materialsBy: 'Maker' } }),
    (error) => error instanceof DomainError && error.code === 'validation',
  );
});
