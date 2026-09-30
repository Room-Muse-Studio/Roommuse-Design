import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { HomeScan } from '@mozu/scan-sdk';

const SAMPLES = path.resolve(import.meta.dirname, '..', '..', '..', 'samples');

export const sampleText = (name: string) => readFileSync(path.join(SAMPLES, `${name}.roomscan.json`), 'utf8');
export const twoBedroom = () => JSON.parse(sampleText('twobedroom')) as HomeScan;
