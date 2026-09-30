/**
 * A guest's work, parked in sessionStorage while they sign in: the scan, the
 * items, and where the scan came from. Read back once, in the editor, after
 * sign-in. Same tab only, and gone when the tab closes.
 */
import type { HomeScan, RoomScan } from '@mozu/scan-sdk';
import type { Item } from './items';
import type { Origin } from './status';

const KEY = 'mozu.guest-stash.v1';

export interface GuestStash {
  scan: HomeScan | RoomScan;
  items: Item[];
  origin: Origin;
  name: string;
}

export function stashGuestWork(stash: GuestStash): boolean {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(stash));
    return true;
  } catch {
    return false;
  }
}

export function hasGuestStash(): boolean {
  try {
    return window.sessionStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

/** Read the stash and clear it. */
export function takeGuestStash(): GuestStash | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as GuestStash;
    return s && s.scan && Array.isArray(s.items) && s.origin ? s : null;
  } catch {
    return null;
  }
}
