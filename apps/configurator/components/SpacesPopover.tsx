'use client';

import { useEffect, useRef } from 'react';
import { Icon } from './Icons';

export const ALL_ROOMS = 'all';

interface Props {
  open: boolean;
  onOpen: (open: boolean) => void;
  rooms: { key: string; name: string; items: number }[];
  selected: string;
  onSelect: (key: string) => void;
  ceilings: boolean;
  onCeilings: (on: boolean) => void;
}

/** The `layers` button in the canvas corner and its "Spaces" popover. */
export default function SpacesPopover(p: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!p.open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) p.onOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') p.onOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [p.open]);

  const total = p.rooms.reduce((n, r) => n + r.items, 0);
  return (
    <div className="spaces" ref={ref}>
      <button type="button" className={p.open ? 'corner-btn on' : 'corner-btn'} aria-expanded={p.open} aria-haspopup="dialog"
        title="Spaces" aria-label="Spaces" onClick={() => p.onOpen(!p.open)}>
        <Icon name="layers" />
      </button>
      {p.open && (
        <div className="popover spaces-pop" role="dialog" aria-label="Spaces">
          <p className="eyebrow">Spaces</p>
          <ul className="space-list" role="listbox" aria-label="Rooms">
            <li>
              <button type="button" role="option" aria-selected={p.selected === ALL_ROOMS} className={p.selected === ALL_ROOMS ? 'on' : ''}
                onClick={() => p.onSelect(ALL_ROOMS)}>
                <span>All rooms</span><small>{p.rooms.length} · {total} items</small>
              </button>
            </li>
            {p.rooms.map((r) => (
              <li key={r.key}>
                <button type="button" role="option" aria-selected={p.selected === r.key} className={p.selected === r.key ? 'on' : ''}
                  onClick={() => p.onSelect(r.key)}>
                  <span>{r.name}</span><small>{r.items} {r.items === 1 ? 'item' : 'items'}</small>
                </button>
              </li>
            ))}
          </ul>
          <label className="check">
            <input type="checkbox" checked={p.ceilings} onChange={(e) => p.onCeilings(e.target.checked)} />
            Show ceilings
          </label>
        </div>
      )}
    </div>
  );
}
