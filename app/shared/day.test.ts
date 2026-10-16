// @ts-nocheck -- run by Node (`node --test`), which has no type defs installed for svelte-check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pacificDay, pacificDayStart } from './day.ts';

test('the day changes at midnight Pacific, not UTC (summer, PDT = UTC-7)', () => {
  assert.equal(pacificDay(new Date('2026-07-15T06:59:59Z')), '2026-07-14'); // 23:59:59 PDT
  assert.equal(pacificDay(new Date('2026-07-15T07:00:00Z')), '2026-07-15'); // 00:00:00 PDT
  assert.equal(pacificDay(new Date('2026-07-15T02:00:00Z')), '2026-07-14'); // already the 15th in UTC
  assert.equal(pacificDayStart(new Date('2026-07-15T20:00:00Z')), '2026-07-15T07:00:00.000Z');
});

test('winter uses PST = UTC-8', () => {
  assert.equal(pacificDay(new Date('2026-01-10T07:59:59Z')), '2026-01-09');
  assert.equal(pacificDay(new Date('2026-01-10T08:00:00Z')), '2026-01-10');
  assert.equal(pacificDayStart(new Date('2026-01-10T08:00:00Z')), '2026-01-10T08:00:00.000Z');
});

test('daylight-saving switch days start at the right midnight', () => {
  // 2026-03-08: clocks spring forward at 2am, so the day began at PST midnight (08:00 UTC).
  assert.equal(pacificDayStart(new Date('2026-03-08T20:00:00Z')), '2026-03-08T08:00:00.000Z');
  assert.equal(pacificDay(new Date('2026-03-09T06:59:59Z')), '2026-03-08'); // 23:59:59 PDT
  assert.equal(pacificDay(new Date('2026-03-09T07:00:00Z')), '2026-03-09');
  // 2026-11-01: clocks fall back at 2am, so the day began at PDT midnight (07:00 UTC) and lasts 25 hours.
  assert.equal(pacificDayStart(new Date('2026-11-01T20:00:00Z')), '2026-11-01T07:00:00.000Z');
  assert.equal(pacificDay(new Date('2026-11-02T07:59:59Z')), '2026-11-01'); // 23:59:59 PST
  assert.equal(pacificDay(new Date('2026-11-02T08:00:00Z')), '2026-11-02');
});
