'use client';

import { Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import Viewer from '@/components/Viewer';
import { parseOpenRequest } from '@/lib/openRequest';

/** Reads the address; in a static export that only happens in the browser, so it sits under Suspense. */
function Editor() {
  const params = useSearchParams();
  const request = useMemo(() => parseOpenRequest(new URLSearchParams(params.toString())), [params]);
  return <Viewer request={request} />;
}

export default function EditorPage() {
  return (
    <Suspense fallback={<main className="centered"><div className="spinner" aria-label="Loading" /></main>}>
      <Editor />
    </Suspense>
  );
}
