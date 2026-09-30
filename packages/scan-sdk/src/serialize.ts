/**
 * Wire format for a {@link RoomScan}: a compact, URL-safe payload plus the
 * `/scan` deep link the native apps and extensions use to hand a measured room
 * to the MOZU web app. The `poly`/`h` params stay backward-compatible with the
 * existing web `/scan` route; `scan` carries the richer payload (openings,
 * objects) when present.
 */
import { HOMESCAN_SCHEMA, ROOMSCAN_SCHEMA } from './types';
import type { HomeScan, RoomConnection, RoomScan, ScanSource, UnitSystem, Vec2 } from './types';

const toBase64Url = (s: string): string => {
  const b64 =
    typeof btoa === 'function'
      ? btoa(unescape(encodeURIComponent(s)))
      : Buffer.from(s, 'utf8').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (s: string): string => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const text =
    typeof atob === 'function'
      ? decodeURIComponent(escape(atob(b64)))
      : Buffer.from(b64, 'base64').toString('utf8');
  return text;
};

/** Round-trippable JSON of a scan (millimetres preserved). */
export function serializeScan(scan: RoomScan): string {
  return JSON.stringify(scan);
}

/** Parse a serialized scan; returns null if it isn't a valid v1 RoomScan. */
export function parseScan(input: string): RoomScan | null {
  try {
    const raw = input.trim().startsWith('{') ? input : fromBase64Url(input);
    return normaliseRoom(JSON.parse(raw));
  } catch {
    return null;
  }
}

const label = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** Validate and normalise one room object; null if it has no usable outline. */
function normaliseRoom(value: unknown): RoomScan | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Partial<RoomScan>;
  if (!Array.isArray(data.polygon) || data.polygon.length < 3) return null;
  const polygon = data.polygon
    .map((p) => ({ x: Number(p?.x), z: Number(p?.z) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.z));
  if (polygon.length < 3) return null;
  // wallIds are positional, so they only mean anything if no corner was dropped.
  const wallIds =
    Array.isArray(data.wallIds) && data.wallIds.length === polygon.length && polygon.length === data.polygon.length
      ? data.wallIds.map((id) => (typeof id === 'string' ? id : null))
      : undefined;
  const id = label(data.id), name = label(data.name), type = label(data.type);
  return {
    schema: ROOMSCAN_SCHEMA,
    ...(id ? { id } : {}),
    ...(name ? { name } : {}),
    ...(type ? { type } : {}),
    polygon,
    ...(wallIds ? { wallIds } : {}),
    height: Number(data.height) || 2700,
    openings: Array.isArray(data.openings) ? data.openings : [],
    objects: Array.isArray(data.objects) ? data.objects : [],
    fixtures: Array.isArray(data.fixtures) ? data.fixtures : [],
    source: (data.source as ScanSource) ?? 'manual',
    unitSystem: (data.unitSystem as UnitSystem) ?? 'metric',
    confidence: typeof data.confidence === 'number' ? data.confidence : 0.8,
    capturedAt: typeof data.capturedAt === 'string' ? data.capturedAt : new Date().toISOString(),
  };
}

/** Round-trippable JSON of a home scan. */
export function serializeHomeScan(home: HomeScan): string {
  return JSON.stringify(home);
}

/** A parsed home, plus what had to be left out of it and why. */
export interface ParsedHomeScan {
  home: HomeScan;
  /** One sentence per dropped room or connection; empty when everything was used. */
  warnings: string[];
}

/**
 * Parse a home scan (`mozu.homescan/1`). A single-room `mozu.roomscan/1` is
 * accepted too and comes back as a one-room home, so a reader can take either.
 *
 * Each room is validated exactly as {@link parseScan} does. A room without a
 * usable outline is dropped, and so is any connection that doesn't point at a
 * real room, opening or wall; both are reported in `warnings` rather than
 * failing the whole home. Returns null when the input isn't a scan at all or no
 * room survives.
 */
export function parseHomeScan(input: string): ParsedHomeScan | null {
  let data: { schema?: unknown; rooms?: unknown; capturedAt?: unknown; connections?: unknown };
  try {
    const raw = input.trim().startsWith('{') ? input : fromBase64Url(input);
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

  const warnings: string[] = [];
  if (data.schema !== HOMESCAN_SCHEMA) {
    if (data.schema !== undefined && data.schema !== ROOMSCAN_SCHEMA) return null;
    const room = normaliseRoom(data);
    if (!room) return null;
    return { home: { schema: HOMESCAN_SCHEMA, rooms: [room], capturedAt: room.capturedAt }, warnings };
  }

  const rooms: RoomScan[] = [];
  (Array.isArray(data.rooms) ? data.rooms : []).forEach((value, i) => {
    const room = normaliseRoom(value);
    if (room) rooms.push(room);
    else warnings.push(`Room ${i + 1} has no usable outline (it needs at least 3 corners) and was left out.`);
  });
  if (!rooms.length) return null;

  const home: HomeScan = {
    schema: HOMESCAN_SCHEMA,
    rooms,
    capturedAt: typeof data.capturedAt === 'string' ? data.capturedAt : rooms[0].capturedAt,
  };
  if (Array.isArray(data.connections)) {
    home.connections = checkConnections(data.connections, rooms, warnings);
  }
  return { home, warnings };
}

/** Keep the connections that point at real things; explain the rest. */
function checkConnections(values: unknown[], rooms: RoomScan[], warnings: string[]): RoomConnection[] {
  // A connection names rooms by id, so an id used twice is ambiguous.
  const byId = new Map<string, RoomScan | null>();
  for (const room of rooms) if (room.id) byId.set(room.id, byId.has(room.id) ? null : room);
  for (const [id, room] of byId) if (!room) warnings.push(`Two rooms share the id "${id}", so connections to it were left out.`);

  const kept: RoomConnection[] = [];
  const seen = new Set<string>();
  values.forEach((value, i) => {
    const c = value as { type?: unknown; a?: Record<string, unknown>; b?: Record<string, unknown> } | null;
    const why = connectionProblem(c, byId);
    if (why) {
      warnings.push(`Connection ${i + 1} was left out: ${why}.`);
      return;
    }
    const conn = c as unknown as RoomConnection; // checked by connectionProblem above
    const ends = [conn.a, conn.b].map((e) => JSON.stringify([e.room, 'opening' in e ? e.opening : e.wall])).sort();
    const key = conn.type + ends.join('');
    if (seen.has(key)) return; // the same pair listed twice, perhaps a/b swapped
    seen.add(key);
    kept.push(
      conn.type === 'opening'
        ? { type: 'opening', a: { room: conn.a.room, opening: conn.a.opening }, b: { room: conn.b.room, opening: conn.b.opening } }
        : { type: 'wall', a: { room: conn.a.room, wall: conn.a.wall }, b: { room: conn.b.room, wall: conn.b.wall } },
    );
  });
  return kept;
}

function connectionProblem(
  c: { type?: unknown; a?: Record<string, unknown>; b?: Record<string, unknown> } | null,
  byId: Map<string, RoomScan | null>,
): string | null {
  if (!c || typeof c !== 'object' || !c.a || !c.b) return 'it needs both ends, a and b';
  if (c.type !== 'opening' && c.type !== 'wall') return `unknown type "${String(c.type)}"`;
  const [ra, rb] = [c.a.room, c.b.room].map((id) => (typeof id === 'string' ? byId.get(id) : undefined));
  if (!ra || !rb) return 'it names a room that is not in this home';
  if (ra === rb) return 'both ends are in the same room';
  if (c.type === 'wall') {
    const ok = (room: RoomScan, wall: unknown) => Number.isInteger(wall) && (wall as number) >= 0 && (wall as number) < room.polygon.length;
    return ok(ra, c.a.wall) && ok(rb, c.b.wall) ? null : 'it names a wall the room does not have';
  }
  const find = (room: RoomScan, id: unknown) => room.openings.find((o) => o?.id !== undefined && o.id === id);
  const oa = find(ra, c.a.opening), ob = find(rb, c.b.opening);
  if (!oa || !ob) return 'it names an opening the room does not have';
  if (oa.type !== ob.type) return `one end is a ${oa.type} and the other a ${ob.type}`;
  return null;
}

const polyParam = (polygon: Vec2[]): string =>
  polygon.map((p) => `${Math.round(p.x)},${Math.round(p.z)}`).join(';');

/**
 * Build the MOZU `/scan` deep link for a measured room.
 *   `…/scan?poly=0,0;4000,0;4000,3000;0,3000&h=2700`        (always)
 *   `…&scan=<base64url>`                                     (if openings/objects)
 */
export function handoffUrl(webBase: string, scan: RoomScan): string {
  const base = webBase.replace(/\/+$/, '');
  const params = new URLSearchParams();
  params.set('poly', polyParam(scan.polygon));
  params.set('h', String(Math.round(scan.height)));
  params.set('src', scan.source);
  if (scan.openings.length || scan.objects.length || scan.fixtures?.length) {
    params.set('scan', toBase64Url(serializeScan(scan)));
  }
  return `${base}/scan?${params.toString()}`;
}

/** Read a scan back from `/scan` URL params (the web route's ingest side). */
export function scanFromParams(search: string | URLSearchParams): RoomScan | null {
  const p = typeof search === 'string' ? new URLSearchParams(search) : search;
  const rich = p.get('scan');
  if (rich) {
    const parsed = parseScan(rich);
    if (parsed) return parsed;
  }
  const height = Number(p.get('h')) || 2700;
  const unitSystem: UnitSystem = 'metric';
  const source = (p.get('src') as ScanSource) ?? 'manual';
  const poly = p.get('poly');
  if (poly) {
    const polygon = poly
      .split(';')
      .map((s) => {
        const [x, z] = s.split(',').map(Number);
        return { x, z };
      })
      .filter((v) => Number.isFinite(v.x) && Number.isFinite(v.z));
    if (polygon.length >= 3) {
      return {
        schema: ROOMSCAN_SCHEMA,
        polygon,
        height,
        openings: [],
        objects: [],
        source,
        unitSystem,
        confidence: 0.9,
        capturedAt: new Date().toISOString(),
      };
    }
  }
  const w = Number(p.get('w'));
  const d = Number(p.get('d'));
  if (w > 0 && d > 0) {
    return {
      schema: ROOMSCAN_SCHEMA,
      polygon: [
        { x: 0, z: 0 },
        { x: w, z: 0 },
        { x: w, z: d },
        { x: 0, z: d },
      ],
      height,
      openings: [],
      objects: [],
      source,
      unitSystem,
      confidence: 0.85,
      capturedAt: new Date().toISOString(),
    };
  }
  return null;
}
