// @ts-nocheck -- run by Node (`node --test`), which has no type defs installed for svelte-check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './core.ts';

const URL_ = 'https://www.example.com/me';
const rules = { accepted: [], redirectors: [], ignored: [], working: [] };
const result = (extra) => ({ url: URL_, outcome: 'final', status: 200, finalUrl: URL_, chain: [], parked: false, note: null, prevFinalUrl: null, checkedAt: '', ...extra });

test('a timeout is Could not verify, other request errors are Broken', () => {
  assert.equal(classify(result({ outcome: 'error', status: null, note: 'timeout' }), URL_, rules).category, 'unverifiable');
  assert.equal(classify(result({ outcome: 'error', status: null, note: 'network error (connection refused)' }), URL_, rules).category, 'broken');
});

test('a link marked as working is OK when the checker could not confirm it', () => {
  const marked = { ...rules, working: [URL_] };
  for (const r of [result({ outcome: 'error', status: null, note: 'timeout' }), result({ status: 403 }), result({ outcome: 'error', status: null, note: 'network error' })]) {
    const c = classify(r, URL_, marked);
    assert.equal(c.category, 'ok');
    assert.equal(c.working, true);
  }
});

test('a definite failure still shows on a link marked as working', () => {
  const marked = { ...rules, working: [URL_] };
  assert.equal(classify(result({ status: 404 }), URL_, marked).category, 'broken');
  assert.equal(classify(result({ parked: true }), URL_, marked).category, 'parked');
  // Only the exact link is covered.
  assert.equal(classify(result({ status: 403, url: `${URL_}/other` }), `${URL_}/other`, marked).category, 'unverifiable');
});
