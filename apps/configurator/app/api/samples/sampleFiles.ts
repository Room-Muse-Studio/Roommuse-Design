import { readdir } from 'node:fs/promises';
import path from 'node:path';

/** The repo's samples/ folder (the app runs from apps/configurator). */
export const SAMPLES_DIR = path.resolve(process.cwd(), '..', '..', 'samples');
const SUFFIX = '.roomscan.json';

/** Sample names, e.g. "twobedroom" for samples/twobedroom.roomscan.json. */
export async function sampleNames(): Promise<string[]> {
  const files = await readdir(SAMPLES_DIR).catch(() => [] as string[]);
  return files.filter((f) => f.endsWith(SUFFIX)).map((f) => f.slice(0, -SUFFIX.length)).sort();
}

export const sampleFile = (name: string) => path.join(SAMPLES_DIR, name + SUFFIX);
