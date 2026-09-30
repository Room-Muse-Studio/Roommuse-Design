/**
 * Sample modules for the configurator: standard-sized cabinets and storage,
 * grouped the way a kitchen/wardrobe catalogue is. Geometry is generated from
 * these specs (lib/moduleMesh.ts), so a module is data, not a model file.
 *
 * Sizes are common real-world dimensions, not a specific supplier's range.
 * Millimetres throughout.
 */

export type ModuleGroupId = 'kitchen-base' | 'kitchen-wall' | 'kitchen-tall' | 'wardrobe' | 'living';

/**
 * One horizontal band of the front, listed bottom to top. `height` is mm of
 * the front above the plinth; the last band takes whatever is left.
 */
export interface FrontRow {
  kind: 'door' | 'drawer' | 'open' | 'appliance';
  /** Side-by-side fronts in this band (e.g. 2 for a pair of doors). */
  columns?: number;
  height?: number;
  /** Shelves inside an open band. */
  shelves?: number;
}

export interface ModuleSpec {
  id: string;
  group: ModuleGroupId;
  name: string;
  width: number;
  height: number;
  depth: number;
  /** Bottom of the module above the floor: 0 for floor units, ~1450 for kitchen wall units. */
  elevation: number;
  /** Recessed kick board under floor units. */
  plinth: number;
  fronts: FrontRow[];
}

export const MODULE_GROUPS: { id: ModuleGroupId; name: string }[] = [
  { id: 'kitchen-base', name: 'Kitchen · Base' },
  { id: 'kitchen-wall', name: 'Kitchen · Wall' },
  { id: 'kitchen-tall', name: 'Kitchen · Tall' },
  { id: 'wardrobe', name: 'Wardrobes' },
  { id: 'living', name: 'Living & storage' },
];

const BASE = { group: 'kitchen-base', height: 870, depth: 580, elevation: 0, plinth: 100 } as const;
const WALL = { group: 'kitchen-wall', height: 720, depth: 330, elevation: 1450, plinth: 0 } as const;
const TALL = { group: 'kitchen-tall', height: 2200, depth: 580, elevation: 0, plinth: 100 } as const;
const WARDROBE = { group: 'wardrobe', height: 2350, depth: 600, elevation: 0, plinth: 80 } as const;

export const MODULES: ModuleSpec[] = [
  { ...BASE, id: 'base-450-door', name: 'Base cabinet, 1 door', width: 450, fronts: [{ kind: 'door' }] },
  { ...BASE, id: 'base-600-drawers', name: 'Drawer unit, 3 drawers', width: 600, fronts: [{ kind: 'drawer', height: 330 }, { kind: 'drawer', height: 260 }, { kind: 'drawer' }] },
  { ...BASE, id: 'base-900-doors', name: 'Base cabinet, 2 doors', width: 900, fronts: [{ kind: 'door', columns: 2 }] },
  { ...BASE, id: 'base-900-sink', name: 'Sink base, 2 doors', width: 900, fronts: [{ kind: 'door', columns: 2, height: 600 }, { kind: 'drawer' }] },

  { ...WALL, id: 'wall-450-door', name: 'Wall cabinet, 1 door', width: 450, fronts: [{ kind: 'door' }] },
  { ...WALL, id: 'wall-900-doors', name: 'Wall cabinet, 2 doors', width: 900, fronts: [{ kind: 'door', columns: 2 }] },
  { ...WALL, id: 'wall-600-open', name: 'Open shelf unit', width: 600, fronts: [{ kind: 'open', shelves: 2 }] },

  { ...TALL, id: 'tall-600-pantry', name: 'Pantry, 2 doors', width: 600, fronts: [{ kind: 'door', height: 1300 }, { kind: 'door' }] },
  {
    ...TALL, id: 'tall-600-oven', name: 'Oven housing', width: 600,
    fronts: [{ kind: 'drawer', height: 300 }, { kind: 'drawer', height: 300 }, { kind: 'appliance', height: 600 }, { kind: 'door' }],
  },

  { ...WARDROBE, id: 'wardrobe-450-door', name: 'Wardrobe, 1 door', width: 450, fronts: [{ kind: 'door' }] },
  { ...WARDROBE, id: 'wardrobe-900-doors', name: 'Wardrobe, 2 doors', width: 900, fronts: [{ kind: 'door', columns: 2 }] },
  {
    ...WARDROBE, id: 'wardrobe-900-drawers', name: 'Wardrobe, doors over drawers', width: 900,
    fronts: [{ kind: 'drawer', height: 260 }, { kind: 'drawer', height: 260 }, { kind: 'door', columns: 2 }],
  },

  { id: 'tv-1800', group: 'living', name: 'TV console', width: 1800, height: 450, depth: 400, elevation: 0, plinth: 60, fronts: [{ kind: 'drawer', columns: 3 }] },
  { id: 'shoe-900', group: 'living', name: 'Shoe cabinet', width: 900, height: 1000, depth: 350, elevation: 0, plinth: 60, fronts: [{ kind: 'door', columns: 2 }] },
  { id: 'shelf-800-open', group: 'living', name: 'Open bookshelf', width: 800, height: 1800, depth: 320, elevation: 0, plinth: 60, fronts: [{ kind: 'open', shelves: 4 }] },
];

export const moduleById = (id: string) => MODULES.find((m) => m.id === id);
