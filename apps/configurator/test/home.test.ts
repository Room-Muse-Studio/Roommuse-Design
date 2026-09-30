import test from 'node:test';
import assert from 'node:assert/strict';
import { loadHome } from '../lib/home';
import { sampleText } from './fixtures';

test('the two-bedroom sample loads with names and shared walls and doors', () => {
  const home = loadHome(sampleText('twobedroom'));
  assert.deepEqual(home.rooms.map((r) => `${r.key}=${r.name}`), ['room-hallway=Hallway', 'room-bedroom-a=Bedroom A', 'room-bedroom-b=Bedroom B']);
  assert.equal(home.connections.length, 5);
  assert.deepEqual(home.warnings, []);
});

test('a single-room scan loads as a one-room home', () => {
  const home = loadHome(sampleText('kitchen'));
  assert.equal(home.rooms.length, 1);
  assert.equal(home.rooms[0].name, 'Room 1');
});

test('bad files explain themselves', () => {
  assert.throws(() => loadHome('nope'), /not valid JSON/);
  assert.throws(() => loadHome('{"schema":"other/1"}'), /Unsupported scan format "other\/1"/);
  assert.throws(() => loadHome('{"schema":"mozu.roomscan/1","polygon":[{"x":0,"z":0}]}'), /usable outline/);
});

test('a home sent without connections (as the iPad sends it) gets them from its geometry', () => {
  const home = JSON.parse(sampleText('twobedroom'));
  const withLinks = loadHome(JSON.stringify(home)).connections;
  delete home.connections;
  const worked = loadHome(JSON.stringify(home)).connections;
  assert.equal(worked.length, 5);
  assert.deepEqual(worked.map((c) => JSON.stringify(c)).sort(), withLinks.map((c) => JSON.stringify(c)).sort());
});
