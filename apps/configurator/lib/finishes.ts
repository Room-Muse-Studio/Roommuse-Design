/**
 * Finishes: what a module's fronts and carcass are made of.
 *
 * A finish is a colour, a surface pattern and a sheen. The swatches are MOZU's
 * surface range (names and representative colours from the iPad catalogue,
 * apps/ios/MozuScanner/Design/Model/MozuFinishes.swift). The real texture scans
 * aren't in this repo, so wood, fabric and leather are patterns generated here
 * and tinted with the swatch's colour: right family and tone, not the actual
 * product texture.
 */
import * as THREE from 'three';

export type Pattern = 'smooth' | 'wood' | 'fabric' | 'leather';
export type Sheen = 'matte' | 'satin' | 'gloss' | 'metallic';

export interface Finish {
  /** A swatch id, or 'custom' for a colour/texture picked by hand. */
  id: string;
  name: string;
  family: string;
  /** sRGB hex, e.g. '#c1a185'. */
  color: string;
  pattern: Pattern;
  sheen: Sheen;
}

export const PATTERNS: { id: Pattern; name: string }[] = [
  { id: 'smooth', name: 'Smooth' },
  { id: 'wood', name: 'Wood grain' },
  { id: 'fabric', name: 'Fabric' },
  { id: 'leather', name: 'Leather' },
];

export const SHEENS: { id: Sheen; name: string }[] = [
  { id: 'matte', name: 'Matte' },
  { id: 'satin', name: 'Satin' },
  { id: 'gloss', name: 'Gloss' },
  { id: 'metallic', name: 'Metallic' },
];

export const SWATCHES: Finish[] = [
  { id: 'wood_ash_01', name: 'Ash 01', family: 'Wood', color: '#8d7463', pattern: 'wood', sheen: 'matte' },
  { id: 'wood_cherry_01', name: 'Cherry 01', family: 'Wood', color: '#d9a16a', pattern: 'wood', sheen: 'matte' },
  { id: 'wood_oak_01', name: 'Oak 01', family: 'Wood', color: '#c1a185', pattern: 'wood', sheen: 'matte' },
  { id: 'wood_oak_02', name: 'Oak 02', family: 'Wood', color: '#3f302e', pattern: 'wood', sheen: 'matte' },
  { id: 'wood_oak_03', name: 'Oak 03', family: 'Wood', color: '#d8a269', pattern: 'wood', sheen: 'matte' },
  { id: 'wood_oak_04', name: 'Oak 04', family: 'Wood', color: '#ac8d67', pattern: 'wood', sheen: 'matte' },
  { id: 'wood_oak_05', name: 'Oak 05', family: 'Wood', color: '#5b473c', pattern: 'wood', sheen: 'matte' },
  { id: 'wood_oak_06', name: 'Oak 06', family: 'Wood', color: '#b59571', pattern: 'wood', sheen: 'matte' },
  { id: 'wood_oak_07', name: 'Oak 07', family: 'Wood', color: '#383838', pattern: 'wood', sheen: 'matte' },
  { id: 'wood_oak_08', name: 'Oak 08', family: 'Wood', color: '#cda880', pattern: 'wood', sheen: 'matte' },
  { id: 'wood_oak_09', name: 'Oak 09', family: 'Wood', color: '#896e58', pattern: 'wood', sheen: 'matte' },
  { id: 'wood_walnut_01', name: 'Walnut 01', family: 'Wood', color: '#b7997a', pattern: 'wood', sheen: 'matte' },
  { id: 'wood_walnut_02', name: 'Walnut 02', family: 'Wood', color: '#7d6353', pattern: 'wood', sheen: 'matte' },
  { id: 'wood_walnut_03', name: 'Walnut 03', family: 'Wood', color: '#765742', pattern: 'wood', sheen: 'matte' },
  { id: 'wood_wenge_01', name: 'Wenge 01', family: 'Wood', color: '#92837e', pattern: 'wood', sheen: 'matte' },
  { id: 'glossy_01', name: 'Glossy 01', family: 'Glossy', color: '#ededeb', pattern: 'smooth', sheen: 'gloss' },
  { id: 'glossy_02', name: 'Glossy 02', family: 'Glossy', color: '#e0dfdd', pattern: 'smooth', sheen: 'gloss' },
  { id: 'glossy_03', name: 'Glossy 03', family: 'Glossy', color: '#d9d1c7', pattern: 'smooth', sheen: 'gloss' },
  { id: 'glossy_04', name: 'Glossy 04', family: 'Glossy', color: '#584f46', pattern: 'smooth', sheen: 'gloss' },
  { id: 'glossy_05', name: 'Glossy 05', family: 'Glossy', color: '#4e5255', pattern: 'smooth', sheen: 'gloss' },
  { id: 'glossy_6', name: 'Glossy 6', family: 'Glossy', color: '#543733', pattern: 'smooth', sheen: 'gloss' },
  { id: 'hue_1_1', name: 'Hue 1-1', family: 'Hue', color: '#faf7f6', pattern: 'smooth', sheen: 'matte' },
  { id: 'hue_2_1', name: 'Hue 2-1', family: 'Hue', color: '#f6eee4', pattern: 'smooth', sheen: 'matte' },
  { id: 'hue_2_4', name: 'Hue 2-4', family: 'Hue', color: '#d5c8bc', pattern: 'smooth', sheen: 'matte' },
  { id: 'hue_2_5', name: 'Hue 2-5', family: 'Hue', color: '#baaa9c', pattern: 'smooth', sheen: 'matte' },
  { id: 'hue_4_1', name: 'Hue 4-1', family: 'Hue', color: '#4f4f4f', pattern: 'smooth', sheen: 'matte' },
  { id: 'hue_4_2', name: 'Hue 4-2', family: 'Hue', color: '#282829', pattern: 'smooth', sheen: 'matte' },
  { id: 'hue_5_1', name: 'Hue 5-1', family: 'Hue', color: '#542e2b', pattern: 'smooth', sheen: 'matte' },
  { id: 'hue_leather_01_01', name: 'Hue Leather 01-01', family: 'Hue', color: '#c0bab4', pattern: 'leather', sheen: 'satin' },
  { id: 'hue_leather_01_02', name: 'Hue Leather 01-02', family: 'Hue', color: '#5d5553', pattern: 'leather', sheen: 'satin' },
  { id: 'hue_metalic_01_02', name: 'Hue Metalic 01-02', family: 'Hue', color: '#7a6852', pattern: 'smooth', sheen: 'metallic' },
  { id: 'hue_metalic_1_1', name: 'Hue Metalic 1-1', family: 'Hue', color: '#947848', pattern: 'smooth', sheen: 'metallic' },
  { id: 'touch_01', name: 'Touch 01', family: 'Touch', color: '#e0dfdd', pattern: 'smooth', sheen: 'satin' },
  { id: 'touch_02', name: 'Touch 02', family: 'Touch', color: '#d9d1c7', pattern: 'smooth', sheen: 'satin' },
  { id: 'touch_03', name: 'Touch 03', family: 'Touch', color: '#afa28f', pattern: 'smooth', sheen: 'satin' },
  { id: 'touch_04', name: 'Touch 04', family: 'Touch', color: '#584f46', pattern: 'smooth', sheen: 'satin' },
  { id: 'touch_05', name: 'Touch 05', family: 'Touch', color: '#4e5255', pattern: 'smooth', sheen: 'satin' },
  { id: 'fabric_01', name: 'Fabric 01', family: 'Fabric', color: '#c4c1b7', pattern: 'fabric', sheen: 'matte' },
  { id: 'fabric_02', name: 'Fabric 02', family: 'Fabric', color: '#cac3bb', pattern: 'fabric', sheen: 'matte' },
  { id: 'fabric_03', name: 'Fabric 03', family: 'Fabric', color: '#e4d9c9', pattern: 'fabric', sheen: 'matte' },
  { id: 'fabric_04_01', name: 'Fabric 04-01', family: 'Fabric', color: '#ccc9bd', pattern: 'fabric', sheen: 'matte' },
  { id: 'fabric_04_02', name: 'Fabric 04-02', family: 'Fabric', color: '#a09989', pattern: 'fabric', sheen: 'matte' },
  { id: 'fabric_05', name: 'Fabric 05', family: 'Fabric', color: '#cdbdae', pattern: 'fabric', sheen: 'matte' },
  { id: 'fabric_06', name: 'Fabric 06', family: 'Fabric', color: '#e8ddcd', pattern: 'fabric', sheen: 'matte' },
  { id: 'real_01', name: 'Real 01', family: 'Real wood', color: '#c6a06a', pattern: 'wood', sheen: 'matte' },
  { id: 'real_02', name: 'Real 02', family: 'Real wood', color: '#866646', pattern: 'wood', sheen: 'matte' },
  { id: 'real_03', name: 'Real 03', family: 'Real wood', color: '#926f55', pattern: 'wood', sheen: 'matte' },
  { id: 'real_04', name: 'Real 04', family: 'Real wood', color: '#4d3e2b', pattern: 'wood', sheen: 'matte' },
];

export const SWATCH_FAMILIES = [...new Set(SWATCHES.map((s) => s.family))];

export const swatchById = (id: string) => SWATCHES.find((s) => s.id === id);

/** A hand-picked colour and texture. */
export const customFinish = (color: string, pattern: Pattern, sheen: Sheen): Finish =>
  ({ id: 'custom', name: 'Custom', family: 'Custom', color, pattern, sheen });

export const DEFAULT_FRONT = swatchById('hue_1_1')!;
export const DEFAULT_CARCASS = swatchById('hue_2_1')!;

// ── generated patterns ──────────────────────────────────────────────────────

const SIZE = 512;
/** One texture tile covers this many millimetres of surface. */
export const TILE_MM = 600;

/** Deterministic pseudo-random numbers, so a pattern looks the same every time. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

/** Grey-scale pattern, 0 (dark) … 255, averaging ~225 so a tint keeps its tone. */
function drawPattern(ctx: CanvasRenderingContext2D, pattern: Pattern, size: number) {
  const img = ctx.createImageData(size, size);
  const px = img.data;
  const rand = rng(pattern.length * 7919);
  const put = (i: number, v: number) => {
    const c = Math.max(0, Math.min(255, v));
    px[i] = px[i + 1] = px[i + 2] = c;
    px[i + 3] = 255;
  };
  if (pattern === 'wood') {
    // Vertical grain: bands of varying width that wander slightly, plus fine streaks.
    const phase = Array.from({ length: 6 }, () => rand() * Math.PI * 2);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const t = (x / size) * Math.PI * 2;
        const wobble = Math.sin((y / size) * Math.PI * 2 + phase[0]) * 0.35 + Math.sin((y / size) * Math.PI * 6 + phase[1]) * 0.08;
        const rings = Math.sin((t + wobble) * 9 + Math.sin(t * 3 + phase[2]) * 1.4);
        const streak = Math.sin(t * 61 + phase[3] + Math.sin(y * 0.02) * 0.6);
        put((y * size + x) * 4, 222 + rings * 20 + streak * 6);
      }
    }
  } else if (pattern === 'fabric') {
    // Plain weave: alternating over/under threads, uneven yarn and a little noise.
    // The weave is coarser than real cloth on purpose, so it still reads as fabric
    // from across a room rather than averaging out to a flat colour.
    const cell = 16;
    const slub = Array.from({ length: size / cell }, () => (rand() - 0.5) * 30);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
        const warp = (cx + cy) % 2 === 0;
        const fx = (x % cell) / cell, fy = (y % cell) / cell;
        const thread = warp ? Math.sin(fx * Math.PI) : Math.sin(fy * Math.PI);
        put((y * size + x) * 4, 175 + thread * 65 + (warp ? slub[cx] : slub[cy]) + (rand() - 0.5) * 20);
      }
    }
  } else if (pattern === 'leather') {
    // Pebbled grain: soft cells from a scatter of points, dark creases between.
    const pts = Array.from({ length: 600 }, () => [rand() * size, rand() * size]);
    const grid = new Map<string, number[][]>();
    const g = 32; // must divide SIZE so the pattern tiles seamlessly
    for (const p of pts) {
      const k = `${Math.floor(p[0] / g)},${Math.floor(p[1] / g)}`;
      (grid.get(k) ?? grid.set(k, []).get(k)!).push(p);
    }
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let d1 = 1e9, d2 = 1e9;
        const gx = Math.floor(x / g), gy = Math.floor(y / g);
        for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
          const cellPts = grid.get(`${(gx + ox + size / g) % (size / g)},${(gy + oy + size / g) % (size / g)}`) ?? [];
          for (const p of cellPts) {
            let dx = Math.abs(p[0] - x), dy = Math.abs(p[1] - y);
            dx = Math.min(dx, size - dx); dy = Math.min(dy, size - dy);
            const d = dx * dx + dy * dy;
            if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
          }
        }
        const crease = Math.min(1, (Math.sqrt(d2) - Math.sqrt(d1)) / 3);
        put((y * size + x) * 4, 190 + crease * 45);
      }
    }
  } else {
    for (let i = 0; i < size * size; i++) put(i * 4, 235);
  }
  ctx.putImageData(img, 0, 0);
}

const canvases = new Map<Pattern, HTMLCanvasElement>();
function patternCanvas(pattern: Pattern): HTMLCanvasElement {
  let canvas = canvases.get(pattern);
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    drawPattern(canvas.getContext('2d')!, pattern, SIZE);
    canvases.set(pattern, canvas);
  }
  return canvas;
}

const textures = new Map<Pattern, THREE.Texture>();
/** The shared grey-scale texture for a pattern; materials tint it with their colour. */
export function patternTexture(pattern: Pattern): THREE.Texture | null {
  if (pattern === 'smooth') return null;
  let tex = textures.get(pattern);
  if (!tex) {
    tex = new THREE.CanvasTexture(patternCanvas(pattern));
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    textures.set(pattern, tex);
  }
  return tex;
}

/** A small tinted preview of a finish, for swatch buttons (CSS background). */
const previews = new Map<string, string>();
export function finishPreview(finish: Finish): string {
  const key = `${finish.pattern}|${finish.color}`;
  let url = previews.get(key);
  if (!url) {
    const c = document.createElement('canvas');
    c.width = c.height = 48;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = finish.color;
    ctx.fillRect(0, 0, 48, 48);
    if (finish.pattern !== 'smooth') {
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(patternCanvas(finish.pattern), 0, 0, 160, 160, 0, 0, 48, 48);
    }
    url = c.toDataURL();
    previews.set(key, url);
  }
  return url;
}

const SHEEN: Record<Sheen, { roughness: number; metalness: number }> = {
  matte: { roughness: 0.85, metalness: 0 },
  satin: { roughness: 0.55, metalness: 0 },
  gloss: { roughness: 0.18, metalness: 0 },
  metallic: { roughness: 0.35, metalness: 0.75 },
};

/** A material for a finish. Patterned finishes brighten the tint slightly, since the pattern darkens it. */
export function finishMaterial(finish: Finish): THREE.MeshStandardMaterial {
  const map = patternTexture(finish.pattern);
  const color = new THREE.Color(finish.color);
  if (map) color.multiplyScalar(1.12);
  return new THREE.MeshStandardMaterial({ color, map, ...SHEEN[finish.sheen] });
}
