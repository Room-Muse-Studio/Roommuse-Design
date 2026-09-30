'use client';

/** Who is signed in, from the session cookie. `undefined` while asking. */
import { useEffect, useState } from 'react';
import { me, type ApiError, type User } from '@/lib/api';

export function useAuth() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    me()
      .then((u) => { if (!cancelled) setUser(u); })
      .catch((e: ApiError) => {
        if (cancelled) return;
        setUser(null);
        if (e.status && e.status !== 401) setError(e.message);
      });
    return () => { cancelled = true; };
  }, []);
  return { user, loading: user === undefined, error, setUser };
}
