/**
 * The line icons of the rail and the toolbars (24×24, 1.6 stroke, round caps),
 * drawn inline so they take the button's colour, plus Material Symbols by name.
 */
const PATHS = {
  '2d': 'M3 5h18v14H3zM3 9h18M8 9v10',
  '3d': 'm12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10',
  undo: 'm8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12H6',
  redo: 'm16 4 5 5-5 5M21 9H10a6 6 0 0 0 0 12h8',
  duplicate: 'M8 2h13v16H8zM4 6H3v16h13v-1',
  delete: 'M3 6h18M9 6V3h6v3M6 6v15h12V6M10 10v7M14 10v7',
  dimensions: 'M2 7h20v10H2zM6 7v5M10 7v3M14 7v5M18 7v3',
  reset: 'm2 11 10-8 10 8M5 9v12h6M17 10V9M13 16a4 4 0 0 1 7-2l1 1M21 11v4h-4M21 18a4 4 0 0 1-7 2l-1-1M13 23v-4h4',
  kitchen: 'M3 10h18v11H3zM3 14h18M12 14v7M7 10V6a2 2 0 0 1 4 0M15 3h6v4h-6z',
  wardrobe: 'M4 3h16v18H4zM12 3v18M9 10v3M15 10v3',
  doors: 'M3 3h18v18H3zM12 3v18M10 11v2M14 11v2',
  rooms: 'M3 4h8v8H3zM11 4h10v16H11zM3 12h8v8H3z',
  ceiling: 'M3 10 12 4l9 6M5 9v11h14V9',
  collapse: 'm15 6-6 6 6 6',
  layers: 'm12 3 9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  chevron: 'm6 9 6 6 6-6',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 24, className = '' }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true" fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name]} />
    </svg>
  );
}

/** A Material Symbols Outlined glyph, by its name (the font comes from Google Fonts in the layout). */
export function Sym({ name, className = '' }: { name: string; className?: string }) {
  return <span className={`ic ${className}`.trim()} aria-hidden="true">{name}</span>;
}

/** The red rounded "M". */
export function Logo({ size = 40 }: { size?: number }) {
  return <span className="logo" style={{ width: size, height: size, fontSize: size * 0.55 }} aria-hidden="true">M</span>;
}
