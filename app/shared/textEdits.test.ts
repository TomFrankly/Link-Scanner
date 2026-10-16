// @ts-nocheck -- run by Node (`node --test`), which has no type defs installed for svelte-check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFixes } from './fixes.ts';
import { applyTextEdits, contains, editsFromHandEdit, splitLinkSwaps } from './textEdits.ts';

const identity = (text) => ({ text, origin: text.split('\n').map((_, i) => i) });
const all = (find, replace) => ({ find, replace, videos: null });

test('a changed line becomes a whole-line rule', () => {
  const src = 'Intro\nSponsor: try Old today\n\nThanks';
  const edits = editsFromHandEdit(src, identity(src), 'Intro\nSponsor: try New today\n\nThanks');
  assert.deepEqual(edits, [{ find: 'Sponsor: try Old today', replace: 'Sponsor: try New today' }]);
});

test('rules match whole lines only, ignoring spacing', () => {
  const rule = all('Sponsor: try Old today', 'Sponsor: try New today');
  assert.equal(applyTextEdits('  Sponsor:  try Old today \nmore', [rule], 'v', 'c').text, 'Sponsor: try New today\nmore');
  assert.equal(applyTextEdits('Note. Sponsor: try Old today', [rule], 'v', 'c').changed, 0);
  assert.equal(contains('a\n Sponsor: try Old today', rule.find), true);
});

test('replaces every occurrence, and a rule never matches its own output', () => {
  const r = applyTextEdits('x\nA\ny\nA', [all('A', 'A\nA')], 'v', 'c');
  assert.equal(r.text, 'x\nA\nA\ny\nA\nA');
  assert.equal(r.changed, 2);
});

test('limits a rule to its videos', () => {
  const rule = { find: 'A', replace: 'B', videos: ['one'] };
  assert.equal(applyTextEdits('A', [rule], 'one', 'c').text, 'B');
  assert.equal(applyTextEdits('A', [rule], 'two', 'c').text, 'A');
});

test('limits a rule to a channel', () => {
  const rule = { find: 'A', replace: 'B', videos: null, channelId: 'c1' };
  assert.equal(applyTextEdits('A', [rule], 'v', 'c1').text, 'B');
  assert.equal(applyTextEdits('A', [rule], 'v', 'c2').text, 'A');
});

test('deleting lines saves an empty replacement', () => {
  const src = 'Keep\nOld footer line\nKeep too';
  const edits = editsFromHandEdit(src, identity(src), 'Keep\nKeep too');
  assert.deepEqual(edits, [{ find: 'Old footer line', replace: '' }]);
  assert.equal(applyTextEdits(src, edits.map((e) => all(e.find, e.replace)), 'v', 'c').text, 'Keep\nKeep too');
});

test('an added line is anchored to the line above it', () => {
  const src = 'Title\nLinks:\nhttps://a.example';
  const edits = editsFromHandEdit(src, identity(src), 'Title\nLinks:\nNew line\nhttps://a.example');
  assert.deepEqual(edits, [{ find: 'Links:', replace: 'Links:\nNew line' }]);
});

test('a line added at the very top is anchored to the line below', () => {
  const src = 'First\nSecond';
  assert.deepEqual(editsFromHandEdit(src, identity(src), 'New\nFirst\nSecond'), [{ find: 'First', replace: 'New\nFirst' }]);
});

test('a rule never matches only blank lines', () => {
  const src = 'Para one\n\nPara two';
  // Typing into the blank line widens the rule to the line above.
  assert.deepEqual(editsFromHandEdit(src, identity(src), 'Para one\nhello\nPara two'), [{ find: 'Para one\n', replace: 'Para one\nhello' }]);
});

test('changes split only by blank lines become one rule', () => {
  const src = 'A\n\nB\nC';
  assert.deepEqual(editsFromHandEdit(src, identity(src), 'A2\n\nB2\nC'), [{ find: 'A\n\nB', replace: 'A2\n\nB2' }]);
});

test('separate changes become separate rules', () => {
  const src = 'A\nkeep\nB';
  assert.deepEqual(editsFromHandEdit(src, identity(src), 'A2\nkeep\nB2'), [
    { find: 'A', replace: 'A2' },
    { find: 'B', replace: 'B2' },
  ]);
});

test('spacing-only changes are not saved', () => {
  const src = 'A line';
  assert.deepEqual(editsFromHandEdit(src, identity(src), 'A line  '), []);
});

test('maps edits through link fixes back to the source text', () => {
  const src = 'Gear:\n→ https://a.example/x\nSponsor: Old\nhttps://b.example/y';
  const problems = [
    { url: 'https://a.example/x', category: 'broken' },
    { url: 'https://b.example/y', category: 'broken' },
  ];
  // The first link is removed (its line is dropped); the second has no plan, so it's marked.
  const shown = applyFixes(src, problems, { 'https://a.example/x': { action: 'remove' } });
  assert.equal(shown.text, 'Gear:\nSponsor: Old\n[FIX THIS: https://b.example/y (broken)]');
  const edited = 'Gear:\nSponsor: New\n[FIX THIS: https://b.example/y (broken)] (old)';
  assert.deepEqual(editsFromHandEdit(src, shown, edited), [
    // The marker is turned back into the plain link, so it never reaches an export.
    { find: 'Sponsor: Old\nhttps://b.example/y', replace: 'Sponsor: New\nhttps://b.example/y (old)' },
  ]);
});

test('a changed URL inside a line is a link swap', () => {
  const r = splitLinkSwaps({ find: 'Get it here: https://old.example/a (10% off)', replace: 'Get it here: https://new.example/b (10% off)' });
  assert.deepEqual(r.swaps.map((s) => [s.from, s.to]), [['https://old.example/a', 'https://new.example/b']]);
  assert.equal(r.rest, null);
});

test('other text changes stay a line edit, without the swapped lines', () => {
  const r = splitLinkSwaps({ find: 'Shop: https://old.example\nSponsor: Old', replace: 'Shop: https://new.example\nSponsor: New' });
  assert.equal(r.swaps.length, 1);
  assert.deepEqual(r.rest, { find: 'Shop: https://old.example\nSponsor: Old', replace: 'Shop: https://old.example\nSponsor: New' });
});

test('a line whose words changed too is not a swap', () => {
  const r = splitLinkSwaps({ find: 'Shop: https://old.example', replace: 'Store: https://new.example' });
  assert.deepEqual(r.swaps, []);
  assert.equal(r.rest.replace, 'Store: https://new.example');
});

test('adding or removing a link is not a swap', () => {
  assert.deepEqual(splitLinkSwaps({ find: 'A https://a.example', replace: 'A' }).swaps, []);
  assert.deepEqual(splitLinkSwaps({ find: 'A', replace: 'A\nB https://b.example' }).swaps, []);
});

test('only the URLs that changed are swapped, keeping trailing punctuation out', () => {
  const r = splitLinkSwaps({ find: 'See https://a.example/x, and https://b.example.', replace: 'See https://a.example/x, and https://c.example/new.' });
  assert.deepEqual(r.swaps.map((s) => [s.from, s.to]), [['https://b.example', 'https://c.example/new']]);
});
