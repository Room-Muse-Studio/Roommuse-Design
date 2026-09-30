/**
 * Words for the top bar: the save-status pill, the subtitle under the project
 * name, and "Edited 5 min ago" on the gallery cards. Pure.
 */

export type SyncState =
  | 'idle'      // guest, or nothing to save yet
  | 'loading'
  | 'saved'
  | 'dirty'
  | 'saving'
  | 'offline'
  | 'retrying'
  | 'conflict'
  | 'signedout'
  | 'error';

export const clock = (at: number | string | Date) =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function statusText(state: SyncState, opts: { savedAt?: number | string | null; error?: string; guest?: boolean } = {}): string {
  switch (state) {
    case 'idle': return opts.guest ? 'Not saved · sign in to keep this' : '';
    case 'loading': return 'Opening…';
    case 'saved': return opts.savedAt ? `Saved ${clock(opts.savedAt)}` : 'Saved';
    case 'dirty': return 'Unsaved changes';
    case 'saving': return 'Saving…';
    case 'offline': return 'Offline — changes kept in this tab';
    case 'retrying': return 'Couldn’t save — retrying…';
    case 'conflict': return 'Changed elsewhere — choose which version to keep';
    case 'signedout': return 'Signed out — sign in again to keep saving';
    case 'error': return opts.error || 'Couldn’t save';
  }
}

/** Where the scan came from, for the eyebrow under the project name. */
export type Origin =
  | { kind: 'code'; code: string }
  | { kind: 'sample'; name: string }
  | { kind: 'file'; name: string }
  | { kind: 'link' }
  | { kind: 'project'; source?: string | null };

const roomsText = (n: number) => `${n} ${n === 1 ? 'room' : 'rooms'}`;

const prettySample = (name: string) => name.replace(/^twobedroom$/i, 'two-bedroom').replace(/_+/g, ' ');

export function originText(origin: Origin): string {
  switch (origin.kind) {
    case 'code': return `from phone code ${origin.code.toUpperCase()}`;
    case 'sample': return `sample · ${prettySample(origin.name)}`;
    case 'file': return `file · ${origin.name}`;
    case 'link': return 'link from the phone';
    case 'project': {
      const s = (origin.source ?? '').trim();
      if (!s) return '';
      const code = /^(?:code|scan)[:\s-]*([A-Z0-9]{6})$/i.exec(s);
      if (code) return `from phone code ${code[1].toUpperCase()}`;
      const sample = /^sample[:\s-]*(.+)$/i.exec(s);
      if (sample) return `sample · ${prettySample(sample[1])}`;
      const file = /^file[:\s-]*(.+)$/i.exec(s);
      if (file) return `file · ${file[1]}`;
      if (/^(phone-)?link$/i.test(s)) return 'link from the phone';
      return s;
    }
  }
}

/** "2 rooms · from phone code B7K4M2" (the top bar sets it in capitals). */
export function subtitleText(rooms: number, origin: Origin | null): string {
  return [rooms ? roomsText(rooms) : '', origin ? originText(origin) : ''].filter(Boolean).join(' · ');
}

/** A source string for a project made from a guest's scan (what `originText` reads back). */
export function sourceOf(origin: Origin): string | undefined {
  switch (origin.kind) {
    case 'code': return `code:${origin.code.toUpperCase()}`;
    case 'sample': return `sample:${origin.name}`;
    case 'file': return `file:${origin.name}`;
    case 'link': return 'phone-link';
    case 'project': return origin.source ?? undefined;
  }
}

/** A name for a project made from a guest's scan. */
export function defaultProjectName(origin: Origin, roomNames: string[]): string {
  switch (origin.kind) {
    case 'code': return `Scan ${origin.code.toUpperCase()}`;
    case 'sample': return prettySample(origin.name).replace(/^\w/, (c) => c.toUpperCase());
    case 'file': return origin.name.replace(/\.roomscan\.json$|\.json$/i, '') || 'Scanned room';
    case 'link': return roomNames[0] ? `${roomNames[0]} from the phone` : 'Scanned room';
    case 'project': return 'Project';
  }
}

export function timeAgo(at: number | string | Date, now = Date.now()): string {
  const ms = new Date(at).getTime();
  if (!Number.isFinite(ms)) return '';
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Date(ms).toLocaleDateString();
}

/** "Edited 5 min ago · 2 rooms" */
export const cardMeta = (updatedAt: number | string, rooms: number, now = Date.now()) =>
  [`Edited ${timeAgo(updatedAt, now)}`, rooms ? roomsText(rooms) : ''].filter(Boolean).join(' · ');
