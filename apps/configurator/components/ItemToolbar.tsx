'use client';

import { forwardRef, useEffect, useState } from 'react';
import { editableSlots, familyName, slotNames, type Item, type Slot } from '@/lib/items';
import {
  PATTERNS, SHEENS, SWATCHES, SWATCH_FAMILIES, customFinish, finishPreview,
  type Finish, type Pattern, type Sheen,
} from '@/lib/finishes';
import { sizeText } from './ItemDrawer';

interface Props {
  item: Item;
  roomName: string;
  message: string;
  onRotate: (degrees: number) => void;
  onFinish: (slot: Slot, finish: Finish, everywhere: boolean) => void;
  onRemove: () => void;
  onClose: () => void;
}

const CUSTOM = 'Custom';

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
// A clockwise arrow, a palette, a bin, a cross.
const ROTATE = 'M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5';
const PALETTE = 'M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4.1-4-7.4-9-7.4ZM7.5 11.5h.01M10 7.5h.01M14.5 7.5h.01M17 11h.01';
const BIN = 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3';
const CLOSE = 'M6 6l12 12M18 6 6 18';

/**
 * The edit menu for the selected item, floating just above it in the 3D view.
 * The viewer positions it every frame through the forwarded ref.
 */
const ItemToolbar = forwardRef<HTMLDivElement, Props>(function ItemToolbar(
  { item, roomName, message, onRotate, onFinish, onRemove, onClose }, ref,
) {
  const [open, setOpen] = useState(false);
  const [slot, setSlot] = useState<Slot>('primary');
  const [family, setFamily] = useState(item.finishes.primary.family);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  useEffect(() => setPreviews(Object.fromEntries(SWATCHES.map((s) => [s.id, finishPreview(s)]))), []);
  // A different item: start from its main finish's family.
  useEffect(() => {
    setSlot('primary');
    setFamily(item.finishes.primary.family);
  }, [item.uid]); // not on every finish change
  const names = slotNames(item.builder);
  const slots = editableSlots(item.builder);
  const finish = item.finishes[slot];
  const setCustom = (change: Partial<Pick<Finish, 'color' | 'pattern' | 'sheen'>>) => {
    const next = { color: finish.color, pattern: finish.pattern, sheen: finish.sheen, ...change };
    onFinish(slot, customFinish(next.color, next.pattern, next.sheen), false);
  };

  return (
    <div ref={ref} className="item-toolbar" role="dialog" aria-label={`Edit ${item.name}`}>
      <div className="toolbar-row">
        <div className="toolbar-title">
          <strong>{item.name}</strong>
          <small>{roomName} · {sizeText(item)} mm</small>
        </div>
        <div className="toolbar-actions">
          <button type="button" className="tool" title="Rotate clockwise (R · Shift for 15°)" aria-label="Rotate clockwise"
            onClick={(e) => onRotate(e.shiftKey ? 15 : 90)}>
            <Icon d={ROTATE} />
          </button>
          <button type="button" className={open ? 'tool on' : 'tool'} title="Colour & texture" aria-label="Colour and texture" aria-expanded={open}
            onClick={() => setOpen((v) => !v)}>
            <Icon d={PALETTE} />
          </button>
          <button type="button" className="tool danger" title="Remove (Delete)" aria-label="Remove" onClick={onRemove}>
            <Icon d={BIN} />
          </button>
          <button type="button" className="tool" title="Close (Esc)" aria-label="Close" onClick={onClose}>
            <Icon d={CLOSE} />
          </button>
        </div>
      </div>
      {message && <p className="toolbar-message" role="status">{message}</p>}

      {open && (
        <div className="toolbar-finish">
          {slots.length > 1 && (
            <div className="tabs" role="tablist" aria-label="Part">
              {slots.map((s) => (
                <button key={s} type="button" role="tab" aria-selected={slot === s} className={slot === s ? 'on' : ''}
                  onClick={() => { setSlot(s); setFamily(item.finishes[s].family); }}>
                  <i style={{ backgroundColor: item.finishes[s].color, backgroundImage: `url(${finishPreview(item.finishes[s])})` }} />
                  {names[s]}
                </button>
              ))}
            </div>
          )}
          <p className="current-finish">{finish.name} <small>· {finish.family}</small></p>
          <div className="pills small" role="tablist" aria-label="Finish family">
            {[...SWATCH_FAMILIES, CUSTOM].map((f) => (
              <button key={f} type="button" role="tab" aria-selected={family === f} className={family === f ? 'pill on' : 'pill'} onClick={() => setFamily(f)}>
                {f}
              </button>
            ))}
          </div>
          {family === CUSTOM ? (
            <div className="custom">
              <label><span>Colour</span><input type="color" value={finish.color} onChange={(e) => setCustom({ color: e.target.value })} /></label>
              <label>
                <span>Texture</span>
                <select value={finish.pattern} onChange={(e) => setCustom({ pattern: e.target.value as Pattern })}>
                  {PATTERNS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </label>
              <label>
                <span>Sheen</span>
                <select value={finish.sheen} onChange={(e) => setCustom({ sheen: e.target.value as Sheen })}>
                  {SHEENS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </label>
            </div>
          ) : (
            <div className="swatches">
              {SWATCHES.filter((s) => s.family === family).map((s) => (
                <button key={s.id} type="button" title={s.name} aria-label={s.name} aria-pressed={s.id === finish.id}
                  className={s.id === finish.id ? 'swatch on' : 'swatch'}
                  style={{ backgroundColor: s.color, backgroundImage: previews[s.id] ? `url(${previews[s.id]})` : undefined }}
                  onClick={() => onFinish(slot, s, false)} />
              ))}
            </div>
          )}
          <button type="button" className="link" onClick={() => onFinish(slot, finish, true)}>
            Use on every {familyName(item)}
          </button>
        </div>
      )}
    </div>
  );
});

export default ItemToolbar;
