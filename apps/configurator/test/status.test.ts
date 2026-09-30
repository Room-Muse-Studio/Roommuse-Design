import test from 'node:test';
import assert from 'node:assert/strict';
import { cardMeta, defaultProjectName, originText, sourceOf, statusText, subtitleText, timeAgo } from '../lib/status';
import { bbox, extentText } from '../lib/dimensions';

test('the save-status pill says what is happening', () => {
  assert.equal(statusText('idle', { guest: true }), 'Not saved · sign in to keep this');
  assert.equal(statusText('idle'), '');
  assert.equal(statusText('saved'), 'Saved');
  assert.match(statusText('saved', { savedAt: new Date(2026, 0, 1, 14, 32).getTime() }), /^Saved \d{1,2}.32/, 'the clock, in the locale’s format');
  assert.equal(statusText('dirty'), 'Unsaved changes');
  assert.equal(statusText('saving'), 'Saving…');
  assert.equal(statusText('offline'), 'Offline — changes kept in this tab');
  assert.equal(statusText('error', { error: 'Too big.' }), 'Too big.');
  assert.equal(statusText('signedout'), 'Signed out — sign in again to keep saving');
});

test('the subtitle names the rooms and where the scan came from', () => {
  assert.equal(subtitleText(2, { kind: 'code', code: 'b7k4m2' }), '2 rooms · from phone code B7K4M2');
  assert.equal(subtitleText(1, { kind: 'sample', name: 'twobedroom' }), '1 room · sample · two-bedroom');
  assert.equal(subtitleText(0, { kind: 'file', name: 'flat.json' }), 'file · flat.json');
  assert.equal(subtitleText(3, null), '3 rooms');
  // A project's source string, as the API stores what the guest flow sent.
  assert.equal(originText({ kind: 'project', source: sourceOf({ kind: 'code', code: 'B7K4M2' }) }), 'from phone code B7K4M2');
  assert.equal(originText({ kind: 'project', source: sourceOf({ kind: 'sample', name: 'kitchen' }) }), 'sample · kitchen');
  assert.equal(originText({ kind: 'project', source: 'phone-link' }), 'link from the phone');
  assert.equal(originText({ kind: 'project', source: 'imported' }), 'imported');
  assert.equal(originText({ kind: 'project', source: null }), '');
});

test('new projects get a sensible name', () => {
  assert.equal(defaultProjectName({ kind: 'code', code: 'b7k4m2' }, []), 'Scan B7K4M2');
  assert.equal(defaultProjectName({ kind: 'sample', name: 'twobedroom' }, []), 'Two-bedroom');
  assert.equal(defaultProjectName({ kind: 'file', name: 'flat.roomscan.json' }, []), 'flat');
  assert.equal(defaultProjectName({ kind: 'link' }, ['Kitchen']), 'Kitchen from the phone');
});

test('gallery cards say when they were edited', () => {
  const now = Date.UTC(2026, 8, 30, 12, 0, 0);
  assert.equal(timeAgo(now - 20_000, now), 'just now');
  assert.equal(timeAgo(now - 5 * 60_000, now), '5 min ago');
  assert.equal(timeAgo(new Date(now - 3 * 3_600_000).toISOString(), now), '3 h ago');
  assert.equal(timeAgo(now - 2 * 86_400_000, now), '2 d ago');
  assert.equal(cardMeta(now - 5 * 60_000, 2, now), 'Edited 5 min ago · 2 rooms');
  assert.equal(cardMeta(now - 5 * 60_000, 1, now), 'Edited 5 min ago · 1 room');
});

test('the summary card shows the box around the selected room, or the whole home', () => {
  const a = [{ x: 0, z: 0 }, { x: 4000, z: 0 }, { x: 4000, z: 3000 }, { x: 0, z: 3000 }];
  const b = [{ x: 4000, z: 0 }, { x: 6500, z: 0 }, { x: 6500, z: 3000 }, { x: 4000, z: 3000 }];
  assert.deepEqual(bbox([a]), { width: 4000, depth: 3000 });
  assert.deepEqual(bbox([a, b]), { width: 6500, depth: 3000 });
  assert.equal(bbox([]), null);
  assert.equal(extentText(bbox([a])), 'W 4000 × D 3000 mm');
  assert.equal(extentText(null), '—');
});
