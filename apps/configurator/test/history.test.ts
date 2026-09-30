import test from 'node:test';
import assert from 'node:assert/strict';
import { canRedo, canUndo, emptyHistory, HISTORY_CAP, record, redo, undo } from '../lib/history';

test('recording a change makes it undoable, and undoing it redoable', () => {
  let h = emptyHistory([1]);
  assert.ok(!canUndo(h) && !canRedo(h));
  h = record(h, [1, 2]);
  h = record(h, [1, 2, 3]);
  assert.ok(canUndo(h));
  const u = undo(h)!;
  assert.deepEqual(u.present, [1, 2]);
  assert.ok(canRedo(u));
  const uu = undo(u)!;
  assert.deepEqual(uu.present, [1]);
  assert.equal(undo(uu), null, 'nothing before the first state');
  const r = redo(uu)!;
  assert.deepEqual(r.present, [1, 2]);
  assert.deepEqual(redo(r)!.present, [1, 2, 3]);
  assert.equal(redo(redo(r)!), null);
});

test('a new change after undo clears what could have been redone', () => {
  let h = record(record(emptyHistory('a'), 'b'), 'c');
  h = undo(h)!;
  h = record(h, 'd');
  assert.ok(!canRedo(h));
  assert.deepEqual(undo(h)!.present, 'b');
});

test('the same content again is not a change; the past is capped', () => {
  let h = emptyHistory([{ uid: 1 }]);
  const same = record(h, [{ uid: 1 }]);
  assert.equal(same, h, 'an equal array (new reference) records nothing');
  for (let i = 0; i < HISTORY_CAP + 20; i++) h = record(h, [{ uid: i + 2 }]);
  assert.equal(h.past.length, HISTORY_CAP);
  assert.deepEqual(h.past[0], [{ uid: 21 }], 'the oldest states are dropped first');
});
