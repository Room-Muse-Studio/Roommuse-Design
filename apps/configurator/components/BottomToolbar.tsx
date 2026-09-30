'use client';

import { Icon, type IconName } from './Icons';

export type ViewMode = '2d' | '3d';

interface Props {
  view: ViewMode;
  onView: (v: ViewMode) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canEdit: boolean;
  onDuplicate: () => void;
  onDelete: () => void;
  roomsOpen: boolean;
  onRooms: () => void;
  ceilings: boolean;
  onCeilings: () => void;
  onReset: () => void;
}

const Tool = ({ icon, label, title, on, disabled, onClick }: {
  icon: IconName; label: string; title: string; on?: boolean; disabled?: boolean; onClick: () => void;
}) => (
  <button type="button" className={on ? 'tb-btn on' : 'tb-btn'} aria-pressed={on} disabled={disabled} title={title} onClick={onClick}>
    <Icon name={icon} />
    <span>{label}</span>
  </button>
);

const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

/** The white bar along the bottom of the canvas: view, edits, spaces, reset. */
export default function BottomToolbar(p: Props) {
  return (
    <div className="toolbar" role="toolbar" aria-label="Editor tools">
      <div className="seg" role="group" aria-label="View">
        <button type="button" className={p.view === '2d' ? 'on' : ''} aria-pressed={p.view === '2d'} title="Plan view from above" onClick={() => p.onView('2d')}>
          <Icon name="2d" size={20} /><span>2D</span>
        </button>
        <button type="button" className={p.view === '3d' ? 'on' : ''} aria-pressed={p.view === '3d'} title="3D view" onClick={() => p.onView('3d')}>
          <Icon name="3d" size={20} /><span>3D</span>
        </button>
      </div>
      <i className="tb-div" />
      <Tool icon="undo" label="Undo" title={`Undo (${mod}Z)`} disabled={!p.canUndo} onClick={p.onUndo} />
      <Tool icon="redo" label="Redo" title={`Redo (⇧${mod}Z)`} disabled={!p.canRedo} onClick={p.onRedo} />
      <Tool icon="duplicate" label="Duplicate" title="Duplicate the selected item" disabled={!p.canEdit} onClick={p.onDuplicate} />
      <Tool icon="delete" label="Delete" title="Delete the selected item (Delete)" disabled={!p.canEdit} onClick={p.onDelete} />
      <i className="tb-div" />
      <Tool icon="rooms" label="Rooms" title="Show one room or all of them" on={p.roomsOpen} onClick={p.onRooms} />
      <Tool icon="ceiling" label="Ceilings" title="Show ceilings" on={p.ceilings} onClick={p.onCeilings} />
      <i className="tb-div" />
      <Tool icon="reset" label="Reset view" title="Frame everything again" onClick={p.onReset} />
    </div>
  );
}
