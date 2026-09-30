'use strict';

// Room labels, mozu.homescan/1 parsing, and shared-wall/door connections in
// the scan SDK, tested through the built file the page and server load.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const sdk = () => import(pathToFileURL(path.join(ROOT, 'packages/scan-sdk/dist/mozu-scan-sdk.js')).href);
const sample = (name) => fs.readFileSync(path.join(ROOT, 'samples', `${name}.roomscan.json`), 'utf8');
const twoBedroom = () => JSON.parse(sample('twobedroom'));
const sorted = (connections) => connections.map((c) => JSON.stringify(c)).sort();

test('parseScan keeps room id, name and type', async () => {
  const { parseScan } = await sdk();
  const room = twoBedroom().rooms[1];
  const parsed = parseScan(JSON.stringify(room));
  assert.equal(parsed.id, 'room-bedroom-a');
  assert.equal(parsed.name, 'Bedroom A');
  assert.equal(parsed.type, 'bedroom');
  const unlabelled = parseScan(JSON.stringify({ ...room, id: 7, name: '', type: null }));
  assert.ok(!('id' in unlabelled) && !('name' in unlabelled) && !('type' in unlabelled));
});

test('parseHomeScan reads the two-bedroom sample with its connections', async () => {
  const { parseHomeScan, HOMESCAN_SCHEMA } = await sdk();
  const { home, warnings } = parseHomeScan(sample('twobedroom'));
  assert.deepEqual(warnings, []);
  assert.equal(home.schema, HOMESCAN_SCHEMA);
  assert.deepEqual(home.rooms.map((r) => r.name), ['Hallway', 'Bedroom A', 'Bedroom B']);
  assert.equal(home.connections.length, 5);
  assert.deepEqual(sorted(home.connections), sorted(twoBedroom().connections));
});

test('parseHomeScan accepts a single-room scan as a one-room home', async () => {
  const { parseHomeScan } = await sdk();
  const { home, warnings } = parseHomeScan(sample('kitchen'));
  assert.deepEqual(warnings, []);
  assert.equal(home.rooms.length, 1);
  assert.equal(home.rooms[0].fixtures.length, 2);
  assert.ok(!('connections' in home));
});

test('parseHomeScan round-trips through serializeHomeScan', async () => {
  const { parseHomeScan, serializeHomeScan } = await sdk();
  const { home } = parseHomeScan(sample('twobedroom'));
  assert.deepEqual(parseHomeScan(serializeHomeScan(home)).home, home);
});

test('parseHomeScan rejects things that are not scans', async () => {
  const { parseHomeScan } = await sdk();
  assert.equal(parseHomeScan('not json'), null);
  assert.equal(parseHomeScan(JSON.stringify({ schema: 'other/1', rooms: [] })), null);
  assert.equal(parseHomeScan(JSON.stringify({ schema: 'mozu.homescan/1', rooms: [] })), null);
  assert.equal(parseHomeScan(JSON.stringify({ schema: 'mozu.homescan/1', rooms: [{ polygon: [null] }] })), null);
});

test('a room without an outline is left out, with the connections that point at it', async () => {
  const { parseHomeScan } = await sdk();
  const file = twoBedroom();
  file.rooms[2].polygon = [{ x: 0, z: 0 }];
  const { home, warnings } = parseHomeScan(JSON.stringify(file));
  assert.deepEqual(home.rooms.map((r) => r.name), ['Hallway', 'Bedroom A']);
  assert.ok(home.connections.every((c) => c.a.room !== 'room-bedroom-b' && c.b.room !== 'room-bedroom-b'));
  assert.equal(home.connections.length, 2);
  assert.match(warnings[0], /Room 3 has no usable outline/);
  assert.equal(warnings.length, 1 + 3); // the room, then its three connections
});

test('connections that do not point at real things are left out and explained', async () => {
  const { parseHomeScan } = await sdk();
  const file = twoBedroom();
  const H = 'room-hallway', A = 'room-bedroom-a';
  file.connections = [
    { type: 'opening', a: { room: H, opening: 'op-hall-to-a' }, b: { room: 'room-attic', opening: 'x' } },
    { type: 'opening', a: { room: H, opening: 'op-hall-to-a' }, b: { room: A, opening: 'no-such-door' } },
    { type: 'wall', a: { room: H, wall: 1 }, b: { room: A, wall: 6 } },
    { type: 'wall', a: { room: H, wall: 1 }, b: { room: H, wall: 3 } },
    { type: 'opening', a: { room: H, opening: 'op-hall-to-a' }, b: { room: A, opening: 'op-a-window' } },
    { type: 'stairs', a: { room: H }, b: { room: A } },
    { type: 'wall', a: { room: H, wall: 1 } },
    { type: 'wall', a: { room: H, wall: 1 }, b: { room: A, wall: 5 } },
    { type: 'wall', a: { room: A, wall: 5 }, b: { room: H, wall: 1 } }, // same pair, swapped
  ];
  const { home, warnings } = parseHomeScan(JSON.stringify(file));
  assert.deepEqual(home.connections, [{ type: 'wall', a: { room: H, wall: 1 }, b: { room: A, wall: 5 } }]);
  assert.deepEqual(warnings.map((w) => w.replace(/^Connection \d+ was left out: /, '')), [
    'it names a room that is not in this home.',
    'it names an opening the room does not have.',
    'it names a wall the room does not have.',
    'both ends are in the same room.',
    'one end is a door and the other a window.',
    'unknown type "stairs".',
    'it needs both ends, a and b.',
  ]);
});

test('rooms that share an id cannot be connected', async () => {
  const { parseHomeScan } = await sdk();
  const file = twoBedroom();
  file.rooms[2].id = 'room-bedroom-a';
  const { home, warnings } = parseHomeScan(JSON.stringify(file));
  assert.equal(home.rooms.length, 3);
  assert.ok(home.connections.every((c) => c.a.room !== 'room-bedroom-a' && c.b.room !== 'room-bedroom-a'));
  assert.match(warnings[0], /Two rooms share the id "room-bedroom-a"/);
});

test('findConnections finds the shared walls and doors in the sample', async () => {
  const { parseHomeScan, findConnections } = await sdk();
  const { home } = parseHomeScan(sample('twobedroom'));
  assert.deepEqual(sorted(findConnections(home.rooms)), sorted(home.connections));
});

/** Shift a room's outline and furniture; openings and fixtures are relative to walls, so they move with it. */
function shifted(room, dx, dz) {
  return {
    ...room,
    polygon: room.polygon.map((p) => ({ x: p.x + dx, z: p.z + dz })),
    objects: room.objects.map((o) => ({ ...o, center: { x: o.center.x + dx, z: o.center.z + dz } })),
  };
}

test('findConnections allows for wall thickness, up to maxGapMm', async () => {
  const { parseHomeScan, findConnections } = await sdk();
  const { home } = parseHomeScan(sample('twobedroom'));
  const [hall, a, b] = home.rooms;
  // A 150 mm wall between the hallway and both bedrooms: still the same links.
  const thick = [hall, shifted(a, 150, 0), shifted(b, 150, 0)];
  const links = findConnections(thick);
  assert.equal(links.filter((c) => c.type === 'wall').length, 3);
  assert.equal(links.filter((c) => c.type === 'opening').length, 2);
  // 400 mm apart is not one wall any more: only the bedrooms still touch.
  const apart = findConnections([hall, shifted(a, 400, 0), shifted(b, 400, 0)]);
  assert.deepEqual(apart, [{ type: 'wall', a: { room: 'room-bedroom-a', wall: 4 }, b: { room: 'room-bedroom-b', wall: 0 } }]);
  assert.equal(findConnections([hall, shifted(a, 400, 0)], { maxGapMm: 450 }).length, 2);
});

test('findConnections skips rooms without ids and rooms that do not touch', async () => {
  const { parseHomeScan, findConnections } = await sdk();
  const { home } = parseHomeScan(sample('twobedroom'));
  const [hall, a] = home.rooms;
  const { id, ...anonymous } = a;
  assert.deepEqual(findConnections([hall, anonymous]), []);
  assert.deepEqual(findConnections([hall, shifted(a, 5000, 5000)]), []);
});

test('findConnections does not link a room to an overlapping copy of itself', async () => {
  const { parseHomeScan, findConnections } = await sdk();
  const { home } = parseHomeScan(sample('twobedroom'));
  const hall = home.rooms[0];
  // The same hallway scanned twice, 100 mm apart: its walls face the same way as
  // the original's, so they are not two faces of one wall.
  const again = { ...shifted(hall, 0, -100), id: 'room-hallway-again' };
  assert.deepEqual(findConnections([hall, again]), []);
});
