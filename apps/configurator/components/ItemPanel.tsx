'use client';

import { useEffect, useState } from 'react';
import { ITEM_GROUPS, ITEM_SPECS, type Item } from '@/lib/items';
import { itemThumbnail } from '@/lib/thumbnails';

interface Props {
  rooms: { key: string; name: string }[];
  targetRoom: string;
  onTargetRoom: (key: string) => void;
  onAdd: (specId: string) => void;
  items: Item[];
  selected: number | null;
  onSelect: (uid: number | null) => void;
  onRemove: (uid: number) => void;
  message: string;
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

export default function ItemPanel(p: Props) {
  const [group, setGroup] = useState(ITEM_GROUPS[0].id);
  // Library pictures are rendered with WebGL, so only in the browser, after the first paint.
  const [library, setLibrary] = useState<Record<string, string>>({});
  useEffect(() => setLibrary(Object.fromEntries(ITEM_SPECS.map((s) => [s.id, itemThumbnail(s)]))), []);
  const pictures = useItemPictures(p.items);
  const roomName = (key: string) => p.rooms.find((r) => r.key === key)?.name ?? key;
  const disabled = !p.rooms.length;

  return (
    <section className="panel panel-right" aria-label="Items">
      <header className="panel-head">
        <h2>Add items</h2>
        <label className="inline-select">
          <span>to</span>
          <select value={p.targetRoom} onChange={(e) => p.onTargetRoom(e.target.value)} disabled={disabled}>
            {p.rooms.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
          </select>
        </label>
      </header>

      <div className="pills" role="tablist" aria-label="Groups">
        {ITEM_GROUPS.map((g) => (
          <button key={g.id} type="button" role="tab" aria-selected={group === g.id} className={group === g.id ? 'pill on' : 'pill'} onClick={() => setGroup(g.id)}>
            {g.short}
          </button>
        ))}
      </div>
      <p className="group-name">{ITEM_GROUPS.find((g) => g.id === group)?.name}</p>

      <div className="cards">
        {ITEM_SPECS.filter((s) => s.group === group).map((s) => (
          <button key={s.id} type="button" className="card" onClick={() => p.onAdd(s.id)} disabled={disabled} title={`Add ${s.name.toLowerCase()} to ${roomName(p.targetRoom)}`}>
            <span className="thumb">
              {library[s.id] ? <img src={library[s.id]} alt="" /> : <span className="thumb-wait" />}
              <span className="add">+ Add</span>
            </span>
            <span className="card-name">{s.name}</span>
            <small>{s.size.width} × {s.size.depth} × {s.size.height}</small>
            {s.size.elevation > 0 && <small>Hung at {s.size.elevation}</small>}
          </button>
        ))}
      </div>
      {p.message && <p className="notice" role="status">{p.message}</p>}

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
              <button type="button" className="remove" aria-label={`Remove ${i.name}`} onClick={() => p.onRemove(i.uid)}>×</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">Pick something above to add it to the room.</p>
      )}
      {p.items.length > 0 && <p className="hint">Click an item in the room to edit it. Drag it to move it; drop it on another item to swap them.</p>}
    </section>
  );
}
