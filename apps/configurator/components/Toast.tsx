'use client';

import { useEffect, useState } from 'react';

/** A dark strip at the bottom of the canvas for a passing message; it fades after a few seconds. */
export default function Toast({ message, onDone }: { message: string; onDone?: () => void }) {
  const [shown, setShown] = useState(message);
  useEffect(() => {
    setShown(message);
    if (!message) return;
    const t = window.setTimeout(() => {
      setShown('');
      onDone?.();
    }, 5000);
    return () => window.clearTimeout(t);
  }, [message]);
  if (!shown) return null;
  return <div className="toast" role="status">{shown}</div>;
}
