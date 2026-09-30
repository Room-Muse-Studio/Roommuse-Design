import { redirect } from 'next/navigation';

/** /scan/B7K4M2, the same link shape the handoff API hands out, opens that code in the viewer. */
export default async function ScanLink({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  redirect(`/?code=${encodeURIComponent(code)}`);
}
