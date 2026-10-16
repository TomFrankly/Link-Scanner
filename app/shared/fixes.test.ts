// @ts-nocheck -- run by Node (`node --test`), which has no type defs installed for svelte-check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFixes, highlightRanges, markForFixing, removeLinks, updateRedirects } from './fixes.ts';

const broken = { url: 'https://a.com/x', category: 'broken' };
const longer = { url: 'https://a.com/xyz', category: 'parked' };
const moved = { url: 'https://old.com/p', category: 'domain-changed', finalUrl: 'https://www.notion.com/p' };
const home = { url: 'https://shop.com/item', category: 'homepage', finalUrl: 'https://shop.com/' };

test('marks problem links with a reason', () => {
  const r = markForFixing('Gear: https://a.com/x\nNotes: https://old.com/p', [broken, moved]);
  assert.equal(
    r.text,
    'Gear: [FIX THIS: https://a.com/x (broken)]\nNotes: [FIX THIS: https://old.com/p (redirects to notion.com)]',
  );
  assert.equal(r.changed, 2);
  assert.equal(r.parts.map((p) => p.text).join(''), r.text);
  assert.deepEqual(r.parts.filter((p) => p.hl).length, 2);
});

test('a URL that is a prefix of another leaves the longer one alone', () => {
  const r = markForFixing('https://a.com/xyz and https://a.com/x', [broken]);
  assert.equal(r.text, 'https://a.com/xyz and [FIX THIS: https://a.com/x (broken)]');
  assert.equal(r.changed, 1);
  const both = markForFixing('https://a.com/xyz https://a.com/x', [broken, longer]);
  assert.equal(both.text, '[FIX THIS: https://a.com/xyz (parked domain)] [FIX THIS: https://a.com/x (broken)]');
});

test('keeps trailing punctuation and parentheses', () => {
  const r = updateRedirects('See https://old.com/p. Or (https://old.com/p), done!', [moved]);
  assert.equal(r.text, 'See https://www.notion.com/p. Or (https://www.notion.com/p), done!');
  assert.equal(r.changed, 2);
});

test('replaces every occurrence', () => {
  const r = markForFixing('https://a.com/x\nhttps://a.com/x https://a.com/x', [broken]);
  assert.equal(r.changed, 3);
  assert.equal(r.text.match(/FIX THIS/g).length, 3);
});

test('updateRedirects only touches redirect categories', () => {
  const r = updateRedirects('https://a.com/x https://shop.com/item https://old.com/p', [broken, home, moved]);
  assert.equal(r.text, 'https://a.com/x https://shop.com/ https://www.notion.com/p');
  assert.equal(r.changed, 2);
});

test('removeLinks drops emptied lines but keeps paragraph breaks', () => {
  const desc = [
    'Intro paragraph.',
    '',
    'Links:',
    '👉 https://a.com/x',
    '- https://old.com/p',
    'Gear: https://a.com/x',
    'Site: https://a.com/x  and more',
    '',
    'Outro https://ok.com.',
  ].join('\n');
  const r = removeLinks(desc, [broken, moved]);
  assert.equal(r.text, ['Intro paragraph.', '', 'Links:', 'Gear:', 'Site: and more', '', 'Outro https://ok.com.'].join('\n'));
  assert.equal(r.changed, 4);
});

test('removeLinks does not leave a double gap where a whole paragraph was a link', () => {
  const r = removeLinks('One\n\nhttps://a.com/x\n\nTwo', [broken]);
  assert.equal(r.text, 'One\n\nTwo');
});

test('no-op when nothing matches', () => {
  const desc = 'Nothing to see at https://fine.com/a\n\n\nBye';
  for (const fn of [markForFixing, removeLinks, updateRedirects]) {
    const r = fn(desc, [broken, moved]);
    assert.equal(r.text, desc);
    assert.equal(r.changed, 0);
  }
  assert.equal(markForFixing(desc, []).text, desc);
});

test('applyFixes mixes replace, remove and markers in one description', () => {
  const desc = ['Gear: https://a.com/x', '👉 https://old.com/p', '', 'Shop https://shop.com/item and https://a.com/x.'].join('\n');
  const r = applyFixes(
    desc,
    [broken, moved, home],
    {
      'https://a.com/x': { action: 'replace', replacement: 'https://new.com/gear' },
      'https://old.com/p': { action: 'remove' },
    },
    { mark: true },
  );
  assert.equal(r.text, ['Gear: https://new.com/gear', '', 'Shop [FIX THIS: https://shop.com/item (goes to homepage)] and https://new.com/gear.'].join('\n'));
  assert.equal(r.changed, 4);
  assert.equal(r.parts.map((p) => p.text).join(''), r.text);
  // Lines without a removal keep their per-link highlights.
  assert.deepEqual(r.parts.filter((p) => p.hl).map((p) => p.text), [
    'https://new.com/gear',
    '[FIX THIS: https://shop.com/item (goes to homepage)]',
    'https://new.com/gear',
  ]);
});

test('applyFixes tidies a line that has both a removal and a replacement', () => {
  const r = applyFixes('Links: https://a.com/x  https://old.com/p', [broken, moved], {
    'https://a.com/x': { action: 'remove' },
    'https://old.com/p': { action: 'replace', replacement: 'https://www.notion.com/p' },
  });
  assert.equal(r.text, 'Links: https://www.notion.com/p');
  assert.equal(r.changed, 2);
});

test('applyFixes with a replacement that is a prefix of another URL in the text', () => {
  const r = applyFixes('https://a.com/x https://a.com/xyz', [broken], { 'https://a.com/x': { action: 'replace', replacement: 'https://a.com/xy' } });
  assert.equal(r.text, 'https://a.com/xy https://a.com/xyz');
  assert.equal(r.changed, 1);
});

test('applyFixes with no decisions matches markForFixing, and a replace without a URL falls back to the marker', () => {
  const desc = 'Gear: https://a.com/x\nNotes: https://old.com/p';
  assert.equal(applyFixes(desc, [broken, moved], {}, { mark: true }).text, markForFixing(desc, [broken, moved]).text);
  const r = applyFixes(desc, [broken], { 'https://a.com/x': { action: 'replace', replacement: null } }, { mark: true });
  assert.equal(r.text, markForFixing(desc, [broken]).text);
});

test('applyFixes without `mark` leaves undecided links as they are', () => {
  const desc = 'Gear: https://a.com/x\nNotes: https://old.com/p';
  const r = applyFixes(desc, [broken, moved], { 'https://old.com/p': { action: 'replace', replacement: 'https://www.notion.com/p' } });
  assert.equal(r.text, 'Gear: https://a.com/x\nNotes: https://www.notion.com/p');
  assert.equal(r.changed, 1);
});

test('applyFixes removal matches removeLinks', () => {
  const desc = 'One\n\nhttps://a.com/x\n\nTwo';
  assert.equal(applyFixes(desc, [broken], { 'https://a.com/x': { action: 'remove' } }).text, removeLinks(desc, [broken]).text);
});

test('highlightRanges finds every occurrence, sorted', () => {
  assert.deepEqual(highlightRanges('ab x ab', ['ab', 'x', '', 'zz']), [
    { start: 0, end: 2 },
    { start: 3, end: 4 },
    { start: 5, end: 7 },
  ]);
});

test('highlightRanges lets longer needles win on overlap', () => {
  const text = 'go https://a.com/xyz and https://a.com/x';
  assert.deepEqual(highlightRanges(text, ['https://a.com/x', 'https://a.com/xyz']), [
    { start: 3, end: 20 },
    { start: 25, end: 40 },
  ]);
  // Partly overlapping needles: the longer one keeps its span, the shorter is skipped there.
  assert.deepEqual(highlightRanges('abcde', ['cde', 'abcd']), [{ start: 0, end: 4 }]);
  assert.deepEqual(highlightRanges('aaa', ['aa']), [{ start: 0, end: 2 }]);
});
