'use client';

/**
 * The front door. A link from the phone (?code= / ?poly= / ?scan=) goes straight
 * to the editor, signed in or not. Otherwise: signed in → the projects; signed
 * out → the sign-in card, or the editor as a guest.
 */
import { useEffect, useState } from 'react';
import SignIn from '@/components/SignIn';
import { useAuth } from '@/components/useAuth';
import { hasGuestStash } from '@/lib/guestStash';
import { isScanLink } from '@/lib/openRequest';

const afterSignIn = () => window.location.replace(hasGuestStash() ? '/editor?restore=1' : '/projects');

export default function Page() {
  const [linked, setLinked] = useState<boolean | null>(null);
  const { user, loading, error } = useAuth();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (isScanLink(params)) {
      window.location.replace(`/editor${window.location.search}`);
      setLinked(true);
    } else setLinked(false);
  }, []);

  useEffect(() => {
    if (linked === false && user) afterSignIn();
  }, [linked, user]);

  if (linked !== false || loading || user) {
    return (
      <main className="centered">
        <div className="spinner" aria-label="Loading" />
      </main>
    );
  }
  return (
    <>
      {error && <p className="banner error top">{error}</p>}
      <SignIn onSignedIn={afterSignIn} onGuest={() => window.location.assign('/editor')} />
    </>
  );
}
