import { readFile } from 'node:fs/promises';
import { sampleFile, sampleNames } from '../sampleFiles';

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  // Only names that exist in samples/, so the path can't be steered elsewhere.
  if (!(await sampleNames()).includes(name)) return Response.json({ error: 'No such sample.' }, { status: 404 });
  const text = await readFile(sampleFile(name), 'utf8');
  return new Response(text, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
