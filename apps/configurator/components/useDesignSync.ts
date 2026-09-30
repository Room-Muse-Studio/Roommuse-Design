'use client';

/**
 * Keep the items in the rooms saved under the scan's code, in the database the
 * code lives in (Redis on Vercel), for good.
 *
 * Anyone with the code can edit, several people at once: every change is saved
 * a moment after it's made (the latest save wins), and every few seconds the
 * page picks up changes someone else saved, unless it has unsaved changes of
 * its own. A scan opened from a sample or a file has no code until "Save & get
 * a code" uploads it.
 */
import { useEffect, useRef, useState } from 'react';
import type { HomeScan } from '@mozu/scan-sdk';
import type { Item } from '@/lib/items';
import type { ViewerHome } from '@/lib/home';

const SAVE_DELAY_MS = 700;
const POLL_MS = 4000;

export type SyncStatus = 'off' | 'loading' | 'saving' | 'saved' | 'error';

interface Saved {
  version: number;
  items: Item[];
  savedAt: string;
}

interface Options {
  /** The code the open scan was loaded from, or null (sample, file, phone link). */
  code: string | null;
  home: ViewerHome | null;
  items: Item[];
  /** Replace every item (a saved design, or someone else's changes). */
  replaceItems: (items: Item[]) => void;
  /** After "Save & get a code": the new code. */
  onCode: (code: string) => void;
}

const designUrl = (code: string) => `/api/design?code=${encodeURIComponent(code)}`;

async function fetchDesign(code: string): Promise<Saved | null> {
  const res = await fetch(designUrl(code), { cache: 'no-store' });
  const body = (await res.json().catch(() => ({}))) as { design?: Saved | null; error?: string };
  if (!res.ok) throw new Error(body.error || `Could not load the design (HTTP ${res.status}).`);
  return body.design ?? null;
}

async function putDesign(code: string, items: Item[]): Promise<{ version: number; savedAt: string }> {
  const res = await fetch(designUrl(code), {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items }),
  });
  const body = (await res.json().catch(() => ({}))) as { version?: number; savedAt?: string; error?: string };
  if (!res.ok || body.version === undefined) throw new Error(body.error || `Could not save (HTTP ${res.status}).`);
  return { version: body.version, savedAt: body.savedAt ?? new Date().toISOString() };
}

export function useDesignSync({ code, home, items, replaceItems, onCode }: Options) {
  const [status, setStatus] = useState<SyncStatus>('off');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // What the database has, as far as this page knows: its version, and the items
  // that version holds (serialised), so an unchanged list isn't saved again.
  const version = useRef(0);
  const stored = useRef<string | null>(null);
  const saving = useRef(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const replaceRef = useRef(replaceItems);
  replaceRef.current = replaceItems;

  // Opening a code: load its design (or start from the scan's own furniture).
  useEffect(() => {
    version.current = 0;
    stored.current = null;
    setNotice('');
    setError('');
    if (!code || !home) {
      setStatus('off');
      setSavedAt(null);
      return;
    }
    let cancelled = false;
    setStatus('loading');
    fetchDesign(code)
      .then((saved) => {
        if (cancelled) return;
        if (saved) {
          version.current = saved.version;
          stored.current = JSON.stringify(saved.items);
          replaceRef.current(saved.items);
          setSavedAt(saved.savedAt);
        } else {
          // Nothing saved yet: the scan's furniture is the starting point, saved on the first edit.
          stored.current = JSON.stringify(itemsRef.current);
          setSavedAt(null);
        }
        setStatus('saved');
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setStatus('error');
        setError(e.message);
      });
    return () => { cancelled = true; };
  }, [code, home]);

  // Every change: save it a moment later.
  useEffect(() => {
    if (!code || stored.current === null) return;
    const json = JSON.stringify(items);
    if (json === stored.current) return;
    const timer = setTimeout(async () => {
      saving.current = true;
      setStatus('saving');
      try {
        const result = await putDesign(code, items);
        version.current = result.version;
        stored.current = json;
        setSavedAt(result.savedAt);
        setStatus('saved');
        setError('');
      } catch (e) {
        setStatus('error');
        setError((e as Error).message);
      } finally {
        saving.current = false;
      }
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [items, code]);

  // Every few seconds: pick up what others saved, unless this page has changes of its own to save.
  useEffect(() => {
    if (!code) return;
    const timer = setInterval(async () => {
      if (saving.current || stored.current === null || JSON.stringify(itemsRef.current) !== stored.current) return;
      try {
        const saved = await fetchDesign(code);
        if (!saved || saved.version <= version.current || saving.current) return;
        if (JSON.stringify(itemsRef.current) !== stored.current) return; // edited while we were asking
        version.current = saved.version;
        stored.current = JSON.stringify(saved.items);
        replaceRef.current(saved.items);
        setSavedAt(saved.savedAt);
        setNotice('Updated with changes saved by someone else.');
      } catch {
        // Offline for a moment: try again next time round.
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [code]);

  // Closing the page with a change not yet saved: send it on the way out.
  useEffect(() => {
    if (!code) return;
    const flush = () => {
      if (stored.current === null) return;
      const json = JSON.stringify(itemsRef.current);
      if (json === stored.current) return;
      fetch(designUrl(code), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: `{"items":${json}}`, keepalive: true });
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [code]);

  /** A sample or file has no code: upload the scan to get one, then save the design under it. */
  const saveAndGetCode = async () => {
    if (!home) return;
    setStatus('saving');
    setError('');
    try {
      const scan: HomeScan = {
        schema: 'mozu.homescan/1',
        rooms: home.rooms.map((r) => r.scan),
        capturedAt: home.rooms[0]?.scan.capturedAt ?? new Date().toISOString(),
        ...(home.connections.length ? { connections: home.connections } : {}),
      };
      const res = await fetch('/api/scan-handoff', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(scan),
      });
      const body = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
      if (!res.ok || !body.code) throw new Error(body.error || `Could not create a code (HTTP ${res.status}).`);
      // Save first, so opening the new code finds this design rather than the scan's furniture.
      await putDesign(body.code, itemsRef.current);
      onCode(body.code);
    } catch (e) {
      setStatus('error');
      setError(e instanceof TypeError ? 'Could not reach the scan service. Check the connection and try again.' : (e as Error).message);
    }
  };

  return { status, savedAt, error, notice, saveAndGetCode };
}
