/**
 * Undo history for the items in the rooms: a stack of past states, the present
 * one, and the states undone (redo). Pure; the viewer keeps one in a ref.
 */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export const HISTORY_CAP = 50;

export const emptyHistory = <T>(present: T): History<T> => ({ past: [], present, future: [] });

/** A change: the present goes onto the past (at most HISTORY_CAP kept), redo is cleared. Same content → same history. */
export function record<T>(h: History<T>, next: T, same: (a: T, b: T) => boolean = jsonSame): History<T> {
  if (same(h.present, next)) return h;
  const past = [...h.past, h.present];
  if (past.length > HISTORY_CAP) past.splice(0, past.length - HISTORY_CAP);
  return { past, present: next, future: [] };
}

export function undo<T>(h: History<T>): History<T> | null {
  if (!h.past.length) return null;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> | null {
  if (!h.future.length) return null;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}

export const canUndo = <T>(h: History<T>) => h.past.length > 0;
export const canRedo = <T>(h: History<T>) => h.future.length > 0;

const jsonSame = <T>(a: T, b: T) => a === b || JSON.stringify(a) === JSON.stringify(b);
