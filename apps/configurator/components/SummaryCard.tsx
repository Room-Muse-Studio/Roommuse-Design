'use client';

import { useState } from 'react';
import { extentText, type Extent } from '@/lib/dimensions';
import type { Item } from '@/lib/items';
import { Icon } from './Icons';

interface Props {
  title: string;
  extent: Extent | null;
  items: Item[];
  roomName: (key: string) => string;
}

/** Top-right of the canvas: the room (or home) and its size, and how many items stand in it. */
export default function SummaryCard({ title, extent, items, roomName }: Props) {
  const [open, setOpen] = useState(false);
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.name, (counts.get(i.name) ?? 0) + 1);
  return (
    <div className="summary">
      <div className="summary-row">
        <div className="summary-room">
          <p className="eyebrow">{title || 'No scan'}</p>
          <strong>{extentText(extent)}</strong>
        </div>
        <button type="button" className="summary-items" aria-expanded={open} onClick={() => setOpen((v) => !v)} title="What stands here">
          <span>Items</span>
          <strong>{items.length} <Icon name="chevron" size={16} className={open ? 'flip' : ''} /></strong>
        </button>
      </div>
      {open && (
        <ul className="summary-list">
          {items.length === 0 && <li className="hint">Nothing here yet.</li>}
          {[...counts.entries()].map(([name, n]) => (
            <li key={name}><span>{name}</span><small>× {n}</small></li>
          ))}
          {items.length > 0 && (
            <li className="hint">
              {[...new Set(items.map((i) => i.roomKey))].map(roomName).join(', ')}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
