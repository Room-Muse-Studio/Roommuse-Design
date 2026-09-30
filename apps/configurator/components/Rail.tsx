'use client';

import { Icon } from './Icons';
import type { RailSection } from './ItemDrawer';

interface Props {
  sections: RailSection[];
  active: string | null;
  onPick: (id: string) => void;
}

/** The narrow column of libraries on the left; the active one has its drawer open. */
export default function Rail({ sections, active, onPick }: Props) {
  return (
    <nav className="rail" aria-label="Libraries">
      {sections.map((s) => (
        <button key={s.id} type="button" className={active === s.id ? 'rail-item on' : 'rail-item'} aria-pressed={active === s.id}
          onClick={() => onPick(s.id)} title={s.title}>
          <Icon name={s.icon} size={25} />
          <span>{s.label}</span>
          {active === s.id && <i className="rail-tick" aria-hidden="true">✓</i>}
        </button>
      ))}
    </nav>
  );
}
