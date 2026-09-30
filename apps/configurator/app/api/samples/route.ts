import { sampleNames } from './sampleFiles';

export async function GET() {
  return Response.json({ samples: await sampleNames() });
}
