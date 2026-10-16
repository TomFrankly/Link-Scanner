// @ts-nocheck -- run by Node (`node --test`), which has no type defs installed for svelte-check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appDefaults, DEFAULT_ACCEPTED, DEFAULT_REDIRECTORS, effectiveRules, parseAcceptedList } from './rules.ts';

test('parses from>to pairs, cleaning each domain', () => {
  assert.deepEqual(parseAcceptedList('old-brand.com>new-brand.com, https://www.Other.io/path > new-brand.com\nthird.app>third.tv'), [
    ['old-brand.com', 'new-brand.com'],
    ['other.io', 'new-brand.com'],
    ['third.app', 'third.tv'],
  ]);
});

test('skips malformed entries', () => {
  assert.deepEqual(parseAcceptedList(undefined), []);
  assert.deepEqual(parseAcceptedList(''), []);
  assert.deepEqual(parseAcceptedList('nope, a.com>, >b.com, a.com>b.com>c.com, same.com>same.com, not a domain>b.com, ok.com>fine.com,,'), [
    ['ok.com', 'fine.com'],
  ]);
});

test('app defaults add the extras to the built-in ones, without duplicates', () => {
  assert.deepEqual(appDefaults(), { accepted: DEFAULT_ACCEPTED, redirectors: DEFAULT_REDIRECTORS });
  const d = appDefaults('old-brand.com>new-brand.com, twitter.com>x.com');
  assert.deepEqual(d.accepted, [...DEFAULT_ACCEPTED, ['old-brand.com', 'new-brand.com']]);
});

test('effectiveRules uses the defaults it is given, minus disabled ones', () => {
  const defaults = appDefaults('old-brand.com>new-brand.com');
  const own = [{ id: 1, type: 'disabled', value: 'accepted', value2: 'twitter.com>x.com', note: null, addedBy: 'a', addedAt: '' }];
  assert.deepEqual(effectiveRules(own, defaults).accepted, [['old-brand.com', 'new-brand.com']]);
  // Without the server's defaults, only the built-in ones apply (backward compatible).
  assert.deepEqual(effectiveRules([]).accepted, DEFAULT_ACCEPTED);
});
