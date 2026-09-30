'use client';

import { useEffect, useState } from 'react';
import { ITEM_GROUPS, ITEM_SPECS, type Item } from '@/lib/items';
import { itemThumbnail } from '@/lib/thumbnails';
import { Icon, type IconName } from './Icons';

/** What the rail offers: each section groups one or more item groups. */
export interface RailSection {
  id: string;
  label: string;
  icon: IconName;
  eyebrow: string;
  title: string;
  description: string;
  tabs: { id: string; label: string }[];
}

export const RAIL_SECTIONS: RailSection[] = [
  {
    id: 'kitchen', label: 'Kitchen', icon: 'kitchen', eyebrow: 'Kitchen / modules', title: 'Kitchen',
    description: 'Base, wall and tall cabinets. They start against a wall; drag them where you want them.',
    tabs: [{ id: 'kitchen-base', label: 'Base' }, { id: 'kitchen-wall', label: 'Wall' }, { id: 'kitchen-tall', label: 'Tall' }],
  },
  {
    id: 'wardrobe', label: 'Wardrobes', icon: 'wardrobe', eyebrow: 'Wardrobes / modules', title: 'Wardrobes',
    description: 'Hinged and sliding wardrobes, floor to ceiling.',
    tabs: [{ id: 'wardrobe', label: 'All' }],
  },
  {
    id: 'living', label: 'Living', icon: 'living', eyebrow: 'Living / modules', title: 'Living & storage',
    description: 'Sideboards, shelving and media units for living rooms.',
    tabs: [{ id: 'living', label: 'All' }],
  },
  {
    id: 'furniture', label: 'Furniture', icon: 'furniture', eyebrow: 'Furniture / loose', title: 'Furniture',
    description: 'Beds, sofas, tables and chairs, placed on the open floor.',
    tabs: [{ id: 'furniture', label: 'All' }],
  },
];

interface Props {
  section: RailSection;
  rooms: { key: string; name: string }[];
  targetRoom: string;
  onTargetRoom: (key: string) => void;
  onAdd: (specId: string) => void;
  items: Item[];
  selected: number | null;
  onSelect: (uid: number | null) => void;
  onRemove: (uid: number) => void;
  onCollapse: () => void;
}

export const sizeText = (i: Pick<Item, 'size'>) =>
  `${Math.round(i.size.width)} × ${Math.round(i.size.depth)} × ${Math.round(i.size.height)}`;

/** Pictures of items with their current finishes, once the browser can draw them. */
export function useItemPictures(items: Item[]) {
  const [pictures, setPictures] = useState<Record<number, string>>({});
  // Keyed on what the pictures show, not on the array: callers may build a new array every render.
  const key = items.map((i) => [i.uid, JSON.stringify(i.builder), i.size.width, i.size.depth, i.size.height,
    i.finishes.primary.color, i.finishes.primary.pattern, i.finishes.primary.sheen,
    i.finishes.secondary.color, i.finishes.secondary.pattern, i.finishes.secondary.sheen].join(':')).join('|');
  useEffect(() => {
    setPictures(Object.fromEntries(items.map((i) => [i.uid, itemThumbnail(i)])));
  }, [key]); // `items` changes that matter are captured by `key`
  return pictures;
}

/** The drawer beside the rail: the library of one section, and what's in the home. */
export default function ItemDrawer(p: Props) {
  const [tab, setTab] = useState(p.section.tabs[0].id);
  useEffect(() => setTab(p.section.tabs[0].id), [p.section.id]);
  // Library pictures are rendered with WebGL, so only in the browser, after the first paint.
  const [library, setLibrary] = useState<Record<string, string>>({});
  useEffect(() => setLibrary(Object.fromEntries(ITEM_SPECS.map((s) => [s.id, itemThumbnail(s)]))), []);
  const pictures = useItemPictures(p.items);
  const roomName = (key: string) => p.rooms.find((r) => r.key === key)?.name ?? key;
  const disabled = !p.rooms.length;
  const group = ITEM_GROUPS.find((g) => g.id === tab);

  return (
    <aside className="drawer" aria-label={`${p.section.title} library`}>
      <header className="drawer-head">
        <div>
          <p className="eyebrow">{p.section.eyebrow}</p>
          <h2>{p.section.title}</h2>
          <p className="drawer-desc">{p.section.description}</p>
        </div>
        <button type="button" className="drawer-collapse" onClick={p.onCollapse} aria-label="Collapse the library" title="Collapse">
          <Icon name="collapse" size={20} />
        </button>
      </header>

      <div className="drawer-sub">
        <label className="add-to">
          <span>Add to</span>
          <select value={p.targetRoom} onChange={(e) => p.onTargetRoom(e.target.value)} disabled={disabled} aria-label="Room to add to">
            {p.rooms.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
          </select>
        </label>
      </div>

      {p.section.tabs.length > 1 && (
        <div className="cat-tabs" role="tablist" aria-label="Categories">
          {p.section.tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      )}
      {group && p.section.tabs.length > 1 && <p className="group-name">{group.name}</p>}

      <div className="lib-grid">
        {ITEM_SPECS.filter((s) => s.group === tab).map((s) => (
          <button key={s.id} type="button" className="lib-card" onClick={() => p.onAdd(s.id)} disabled={disabled}
            title={disabled ? 'Open a scan first' : `Add ${s.name.toLowerCase()} to ${roomName(p.targetRoom)}`}>
            <span className="lib-well">
              {library[s.id] ? <img src={library[s.id]} alt="" /> : <span className="thumb-wait" />}
              <span className="lib-add">+ Add</span>
            </span>
            <span className="lib-name">{s.name}</span>
            <small>{s.size.width} × {s.size.depth} × {s.size.height}</small>
            {s.size.elevation > 0 && <small>Hung at {s.size.elevation}</small>}
          </button>
        ))}
      </div>

      <div className="placed-head">
        <span>In this home</span>
        <small>{p.items.length ? `${p.items.length} item${p.items.length === 1 ? '' : 's'}` : 'Nothing yet'}</small>
      </div>
      {p.items.length > 0 ? (
        <ul className="placed">
          {p.items.map((i) => (
            <li key={i.uid} className={i.uid === p.selected ? 'on' : ''}>
              <button type="button" className="placed-main" onClick={() => p.onSelect(i.uid === p.selected ? null : i.uid)}>
                {pictures[i.uid] ? <img src={pictures[i.uid]} alt="" /> : <span className="thumb-wait small" />}
                <span>
                  {i.name}
                  <small>{roomName(i.roomKey)}{i.fromScan ? ' · from the scan' : ''}</small>
                </span>
              </button>
              <button type="button" className="remove" aria-label={`Remove ${i.name}`} title="Remove" onClick={() => p.onRemove(i.uid)}>×</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">Pick something above to add it to the room.</p>
      )}
      {p.items.length > 0 && <p className="hint">Click an item in the room to edit it. Drag it to move it; drop it on another item to swap them.</p>}
    </aside>
  );
}
