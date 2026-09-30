/**
 * Load a scan file into a list of rooms, through @mozu/scan-sdk's
 * `parseHomeScan`, which reads either format the SDK defines:
 *   - mozu.homescan/1: several rooms in one coordinate space, plus the
 *     connections saying which walls and doors they share
 *   - mozu.roomscan/1: a single room (shown as a one-room home)
 */
import { findConnections, parseHomeScan } from '@mozu/scan-sdk';
import type { RoomConnection, RoomScan } from '@mozu/scan-sdk';

export interface ViewerRoom {
  /** Unique within the home; falls back to the room's position in the file. */
  key: string;
  name: string;
  type?: string;
  scan: RoomScan;
}

export interface ViewerHome {
  rooms: ViewerRoom[];
  /**
   * Shared walls and doors between rooms: as the file records them, or worked
   * out from the rooms' geometry when it records none (the iPad doesn't send them).
   */
  connections: RoomConnection[];
  /** Things the SDK left out and why, e.g. a room without a usable outline. */
  warnings: string[];
}

export function loadHome(text: string): ViewerHome {
  const parsed = parseHomeScan(text);
  if (!parsed) {
    let schema: unknown;
    try {
      schema = (JSON.parse(text) as { schema?: unknown })?.schema;
    } catch {
      throw new Error('This file is not valid JSON.');
    }
    throw new Error(
      schema === undefined || schema === 'mozu.roomscan/1' || schema === 'mozu.homescan/1'
        ? 'This scan has no room with a usable outline (a room needs at least 3 corners).'
        : `Unsupported scan format "${String(schema)}".`,
    );
  }
  const rooms: ViewerRoom[] = [];
  parsed.home.rooms.forEach((scan, index) => {
    rooms.push({
      key: scan.id && !rooms.some((r) => r.key === scan.id) ? scan.id : `room-${index + 1}`,
      name: scan.name ?? `Room ${index + 1}`,
      type: scan.type,
      scan,
    });
  });
  const connections = parsed.home.connections ?? findConnections(parsed.home.rooms);
  return { rooms, connections, warnings: parsed.warnings };
}
