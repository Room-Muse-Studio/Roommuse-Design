'use client';

/**
 * Keep a project's design saved in the account.
 *
 * Opening a project fetches its scan and design (the viewer shows them through
 * `onLoad`, then tells us the starting items with `markLoaded`). Every change
 * is saved 2 s after the last one (10 s at most), and on the way out of the
 * tab. Saves carry the revision we loaded: a 409 means another tab or device
 * saved first, and the person picks a version. Offline, changes are kept in
 * the tab and retried with backoff; signed out, the page goes read-only until
 * they sign in again. A picture of the view goes up after a save, at most
 * every 30 s.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Item } from '@/lib/items';
import { ApiError, getProject, putThumbnail, type ProjectMeta, type ProjectRecord } from '@/lib/api';
import type { SyncState } from '@/lib/status';

const SAVE_DELAY_MS = 2000;
const SAVE_MAX_WAIT_MS = 10000;
const RETRY_MIN_MS = 5000;
const RETRY_MAX_MS = 60000;
const KEEPALIVE_MAX_BYTES = 60000;
const THUMBNAIL_EVERY_MS = 30000;

export interface Conflict {
  rev: number;
  updatedAt: string | number;
}

interface Options {
  projectId: string | null;
  items: Item[];
  /** The project arrived (on open, or "Reload their version"): show its scan and design. */
  onLoad: (record: ProjectRecord) => void;
  /** A picture of the view for the project card, or null when there's nothing to show. */
  capture: () => string | null;
}

export function useProjectSync({ projectId, items, onLoad, capture }: Options) {
  const [state, setState] = useState<SyncState>('idle');
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState<string | number | null>(null);
  const [project, setProject] = useState<ProjectMeta | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [loadError, setLoadError] = useState<{ message: string; status: number } | null>(null);

  // What the account holds, as far as this tab knows: the revision, and the
  // items it holds (serialised), so an unchanged list isn't saved again.
  const rev = useRef(0);
  const stored = useRef<string | null>(null);
  const dirty = useRef(false);
  const saving = useRef(false);
  const readOnly = useRef(false);
  const conflictRef = useRef<Conflict | null>(null);
  const timers = useRef<{ debounce?: number; max?: number; retry?: number }>({});
  const retryDelay = useRef(RETRY_MIN_MS);
  const lastThumbnail = useRef(0);
  const idRef = useRef(projectId);
  idRef.current = projectId;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;
  const captureRef = useRef(capture);
  captureRef.current = capture;

  const clearTimers = () => {
    const t = timers.current;
    window.clearTimeout(t.debounce);
    window.clearTimeout(t.max);
    window.clearTimeout(t.retry);
    timers.current = {};
  };

  const sendThumbnail = (id: string) => {
    if (Date.now() - lastThumbnail.current < THUMBNAIL_EVERY_MS) return;
    lastThumbnail.current = Date.now();
    let picture: string | null = null;
    try {
      picture = captureRef.current();
    } catch {
      picture = null;
    }
    if (picture) putThumbnail(id, picture).catch(() => { /* the card keeps its old picture */ });
  };

  const scheduleSave = useCallback(() => {
    const t = timers.current;
    window.clearTimeout(t.debounce);
    t.debounce = window.setTimeout(() => void saveRef.current(), SAVE_DELAY_MS);
    if (!t.max) t.max = window.setTimeout(() => void saveRef.current(), SAVE_MAX_WAIT_MS);
  }, []);

  const save = useCallback(async (opts: { keepalive?: boolean } = {}): Promise<boolean> => {
    clearTimers();
    const id = idRef.current;
    if (!id || readOnly.current || conflictRef.current || stored.current === null) return false;
    if (saving.current) return false; // the finally block below schedules another save if needed
    const list = itemsRef.current;
    const json = JSON.stringify(list);
    if (json === stored.current) {
      dirty.current = false;
      setState('saved');
      return true;
    }
    saving.current = true;
    setState('saving');
    const body = JSON.stringify({ rev: rev.current, design: { items: list } });
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
        method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body,
        ...(opts.keepalive && body.length < KEEPALIVE_MAX_BYTES ? { keepalive: true } : {}),
      });
      const out = (await res.json().catch(() => ({}))) as { rev?: number; updatedAt?: string | number; error?: string };
      if (res.status === 409) {
        const c = { rev: out.rev ?? rev.current, updatedAt: out.updatedAt ?? Date.now() };
        conflictRef.current = c;
        setConflict(c);
        setState('conflict');
        return false;
      }
      if (res.status === 401) {
        readOnly.current = true;
        setState('signedout');
        return false;
      }
      if (res.status === 413 || res.status === 400 || res.status === 403 || res.status === 404) {
        readOnly.current = true;
        setError(out.error || 'This project could not be saved.');
        setState('error');
        return false;
      }
      if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);
      rev.current = out.rev ?? rev.current + 1;
      stored.current = json;
      retryDelay.current = RETRY_MIN_MS;
      const at = out.updatedAt ?? Date.now();
      setSavedAt(at);
      setProject((p) => (p ? { ...p, rev: rev.current, updatedAt: at } : p));
      dirty.current = JSON.stringify(itemsRef.current) !== json;
      setState(dirty.current ? 'dirty' : 'saved');
      sendThumbnail(id);
      return true;
    } catch {
      const offline = typeof navigator.onLine === 'boolean' && !navigator.onLine;
      setState(offline ? 'offline' : 'retrying');
      timers.current.retry = window.setTimeout(() => void saveRef.current(), retryDelay.current);
      retryDelay.current = Math.min(retryDelay.current * 2, RETRY_MAX_MS);
      return false;
    } finally {
      saving.current = false;
      if (dirty.current && !conflictRef.current && !readOnly.current && !timers.current.retry) scheduleSave();
    }
  }, [scheduleSave]);
  const saveRef = useRef(save);
  saveRef.current = save;

  // Opening a project: fetch it, show it, and wait for `markLoaded`.
  useEffect(() => {
    clearTimers();
    rev.current = 0;
    stored.current = null;
    dirty.current = false;
    readOnly.current = false;
    conflictRef.current = null;
    retryDelay.current = RETRY_MIN_MS;
    setConflict(null);
    setError('');
    setLoadError(null);
    setProject(null);
    setSavedAt(null);
    if (!projectId) {
      setState('idle');
      return;
    }
    let cancelled = false;
    setState('loading');
    getProject(projectId)
      .then((record) => {
        if (cancelled) return;
        rev.current = record.project.rev;
        setProject(record.project);
        setSavedAt(record.project.updatedAt ?? null);
        onLoadRef.current(record);
      })
      .catch((e: ApiError) => {
        if (cancelled) return;
        setLoadError({ message: e.message, status: e.status });
        setState(e.status === 401 ? 'signedout' : 'error');
      });
    return () => {
      cancelled = true;
      clearTimers();
    };
  }, [projectId]);

  /** The items the project opened with: from here on, changes are saved. */
  const markLoaded = useCallback((list: Item[]) => {
    stored.current = JSON.stringify(list);
    dirty.current = false;
    if (!readOnly.current) setState('saved');
  }, []);

  // Every change: save it a moment later.
  useEffect(() => {
    if (!idRef.current || stored.current === null || readOnly.current) return;
    const json = JSON.stringify(items);
    if (json === stored.current) {
      if (dirty.current && !saving.current) {
        dirty.current = false;
        clearTimers();
        setState('saved');
      }
      return;
    }
    dirty.current = true;
    if (!saving.current && !conflictRef.current) {
      setState('dirty');
      scheduleSave();
    }
  }, [items, scheduleSave]);

  // Leaving the tab (or hiding it) with a change not yet saved: send it on the way out.
  useEffect(() => {
    if (!projectId) return;
    const onHide = () => {
      if (dirty.current && !saving.current) void saveRef.current({ keepalive: true });
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onHide();
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current || saving.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const onOnline = () => {
      if (dirty.current && !saving.current) void saveRef.current();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onHide);
    window.addEventListener('beforeunload', onUnload);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('beforeunload', onUnload);
      window.removeEventListener('online', onOnline);
    };
  }, [projectId]);

  /** Save now, if there's anything to; resolves when the save is over (or after 5 s). */
  const flush = useCallback(async (): Promise<void> => {
    if (dirty.current && !saving.current) {
      await saveRef.current();
      return;
    }
    const until = Date.now() + 5000;
    while (saving.current && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
  }, []);

  /** Conflict: save this tab's version over the other one. */
  const keepMine = useCallback(() => {
    const c = conflictRef.current;
    if (!c) return;
    rev.current = c.rev;
    conflictRef.current = null;
    setConflict(null);
    dirty.current = true;
    void saveRef.current();
  }, []);

  /** Conflict: drop this tab's changes and show what was saved elsewhere. */
  const reloadTheirs = useCallback(async () => {
    const id = idRef.current;
    if (!id) return;
    setState('loading');
    try {
      const record = await getProject(id);
      if (idRef.current !== id) return;
      rev.current = record.project.rev;
      conflictRef.current = null;
      setConflict(null);
      setProject(record.project);
      setSavedAt(record.project.updatedAt ?? null);
      stored.current = null; // `markLoaded` sets the new baseline
      dirty.current = false;
      onLoadRef.current(record);
    } catch (e) {
      setError((e as Error).message || 'Couldn’t load the other version. Try again, or keep yours.');
      setState('conflict');
    }
  }, []);

  /** After signing in again (in another tab): try saving once more. */
  const retry = useCallback(() => {
    readOnly.current = false;
    setError('');
    dirty.current = true;
    void saveRef.current();
  }, []);

  return {
    state, error, savedAt, project, setProject, conflict, loadError,
    readOnly: state === 'signedout' || (state === 'error' && readOnly.current),
    markLoaded, flush, keepMine, reloadTheirs, retry,
  };
}
